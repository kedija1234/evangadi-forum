/**
 * RAG services: user-owned PDF documents, chunked + embedded, with semantic
 * search and grounded AI answers.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { safeExecute } from '../../../../db/config.js';
import { BadRequestError, NotFoundError } from '../../../utils/errors/index.js';
import {
  cosineSimilarity,
  parseEmbedding,
  chunkText,
} from '../../../utils/vector.js';
import { embedText } from '../../../services/gemini.service.js';
import { answerFromRagChunksService } from '../../../services/geminiTextCoach.service.js';
import { UPLOAD_ROOT } from '../config/rag.upload.config.js';

const RAG_SEARCH_THRESHOLD = Number(process.env.RAG_SEARCH_THRESHOLD) || 0.2;
const RAG_SEARCH_K = Number(process.env.RAG_SEARCH_K) || 10;
const RAG_CHUNK_CHARS = Number(process.env.RAG_CHUNK_CHARS) || 900;
const RAG_CHUNK_OVERLAP = Number(process.env.RAG_CHUNK_OVERLAP) || 120;
const RAG_MAX_CHUNKS_PER_DOC = Number(process.env.RAG_MAX_CHUNKS_PER_DOC) || 1000;
const RAG_MAX_PDFS_PER_USER = Number(process.env.RAG_MAX_PDFS_PER_USER) || 20;
const RAG_MIN_TEXT_CHARS = Number(process.env.RAG_MIN_TEXT_CHARS) || 50;
const RAG_MAX_PARSE_PAGES = Number(process.env.RAG_MAX_PARSE_PAGES) || 100;

/**
 * Character-trigram set for a passage (skips trigrams spanning whitespace so
 * word-boundary noise doesn't inflate similarity).
 *
 * @param {string} text
 * @returns {Set<string>}
 */
function textTrigrams(text) {
  const grams = new Set();
  const normalized = (text || '').toLowerCase();
  for (let i = 0; i + 3 <= normalized.length; i += 1) {
    const gram = normalized.slice(i, i + 3);
    const left = gram[0];
    const right = gram[2];
    if (left === ' ' || left === '\n' || right === ' ' || right === '\n') {
      continue;
    }
    grams.add(gram);
  }
  return grams;
}

/**
 * Jaccard overlap (0-1) between two passages using character trigrams. High
 * when the passages are near-duplicates (overlapping chunk windows).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function passageOverlapRatio(a, b) {
  const gramsA = textTrigrams(a);
  const gramsB = textTrigrams(b);
  if (gramsA.size === 0 || gramsB.size === 0) return 0;

  let intersection = 0;
  for (const gram of gramsA) {
    if (gramsB.has(gram)) intersection += 1;
  }
  return intersection / (gramsA.size + gramsB.size - intersection);
}

/**
 * Extracts plain text from a PDF via pdf.js directly. Uses only
 * `getTextContent` (no geometry/cell building) and calls `page.cleanup()`
 * after each page so memory stays flat even for large documents. The
 * higher-level `pdf-parse` wrapper held ~4 GB on the same 247 KB file.
 *
 * @param {Buffer} buffer - Raw PDF bytes.
 * @returns {Promise<string>} Concatenated text with page breaks.
 */
async function parsePdfText(buffer) {
  let doc;
  try {
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
    });
    doc = await loadingTask.promise;

    const pageCount = Math.min(doc.numPages, RAG_MAX_PARSE_PAGES);
    const parts = [];
    for (let i = 1; i <= pageCount; i += 1) {
      const page = await doc.getPage(i);
      try {
        const content = await page.getTextContent();
        const text = content.items
          .map(item => (typeof item.str === 'string' ? item.str : ''))
          .join(' ');
        parts.push(text);
      } finally {
        page.cleanup();
      }
    }

    return parts.join('\n');
  } finally {
    if (doc) await doc.destroy();
  }
}

/** Maps a `documents` row to the API shape. */
function mapDocumentRow(row) {
  return {
    document_id: row.document_id,
    title: row.title,
    mime_type: row.mime_type,
    byte_size: Number(row.byte_size) || 0,
    status: row.status,
    error_message: row.error_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
    user_id: row.user_id,
    storage_path: row.storage_path,
  };
}

/**
 * Resolves a document's `storage_path` to an absolute path on disk.
 *
 * @param {string} storagePath - User-relative path (e.g. "3/172-abc.pdf").
 * @returns {string} Absolute path.
 */
export function resolveStoragePath(storagePath) {
  return path.resolve(UPLOAD_ROOT, storagePath);
}

/**
 * Verifies a document exists and belongs to the authenticated user.
 *
 * @param {number} documentId - Document id from the URL.
 * @param {number} userId - Authenticated user id.
 * @returns {Promise<Object>} The raw document row.
 * @throws {NotFoundError} When missing or not owned.
 */
export async function assertOwnedDocument(documentId, userId) {
  const sql =
    'SELECT * FROM documents WHERE document_id = ? AND user_id = ? LIMIT 1';
  const rows = await safeExecute(sql, [documentId, userId]);

  if (rows.length === 0) {
    throw new NotFoundError('Document not found');
  }
  return rows[0];
}

/**
 * Marks a document as failed on disk/db and returns its mapped row.
 *
 * @param {number} documentId - Document id.
 * @param {string} message - Failure reason stored in `error_message`.
 * @returns {Promise<Object>} Mapped document.
 */
async function markDocumentFailed(documentId, message) {
  const failSql =
    'UPDATE documents SET status = ?, error_message = ? WHERE document_id = ?';
  await safeExecute(failSql, ['failed', message, documentId]);
  const rows = await safeExecute(
    'SELECT * FROM documents WHERE document_id = ? LIMIT 1',
    [documentId],
  );
  return mapDocumentRow(rows[0]);
}

/**
 * Processes a single uploaded document in the background: parses the PDF,
 * chunks it, embeds each chunk (with quota-retry backoff), and stores vectors.
 * Sets the document to `ready` on success or `failed` on error.
 *
 * @param {number} documentId - Document id to process.
 * @returns {Promise<Object>} Final document row (ready or failed).
 */
export async function processDocumentJob(documentId) {
  const docRows = await safeExecute(
    'SELECT * FROM documents WHERE document_id = ? LIMIT 1',
    [documentId],
  );
  const row = docRows[0];
  if (!row) return mapDocumentRow(row);

  try {
    // 1. Parse the PDF to text.
    let parsedText;
    try {
      const buffer = await fs.readFile(resolveStoragePath(row.storage_path));
      parsedText = await parsePdfText(buffer);
    } catch (parseError) {
      return markDocumentFailed(documentId, `Failed to parse PDF: ${parseError.message}`);
    }

    if (parsedText.trim().length < RAG_MIN_TEXT_CHARS) {
      return markDocumentFailed(
        documentId,
        `PDF contains too little extractable text (min ${RAG_MIN_TEXT_CHARS} chars)`,
      );
    }

    // 2. Chunk text into overlapping segments.
    let chunks = chunkText(parsedText, RAG_CHUNK_CHARS, RAG_CHUNK_OVERLAP);
    if (chunks.length > RAG_MAX_CHUNKS_PER_DOC) {
      chunks = chunks.slice(0, RAG_MAX_CHUNKS_PER_DOC);
    }
    if (chunks.length === 0) {
      return markDocumentFailed(documentId, 'No text chunks could be extracted');
    }

    // 3. Generate embeddings for every chunk (batched + quota-retry aware).
    let vectors;
    try {
      vectors = await embedText(chunks, 'RETRIEVAL_DOCUMENT');
    } catch (embedError) {
      return markDocumentFailed(
        documentId,
        `Failed to generate embeddings: ${embedError.message}`,
      );
    }

    // 4. Store chunks + vectors.
    for (let i = 0; i < chunks.length; i += 1) {
      const chunkSql =
        'INSERT INTO document_chunks (document_id, chunk_index, content) VALUES (?, ?, ?)';
      const chunkResult = await safeExecute(chunkSql, [documentId, i, chunks[i]]);
      const chunkId = chunkResult.insertId;

      const vectorSql =
        'INSERT INTO document_chunk_vectors (chunk_id, source_text, embedding, status) VALUES (?, ?, ?, ?)';
      await safeExecute(vectorSql, [
        chunkId,
        chunks[i],
        JSON.stringify(vectors[i] || []),
        'ready',
      ]);
    }

    // 5. Mark ready.
    const readySql =
      'UPDATE documents SET status = ?, error_message = NULL WHERE document_id = ?';
    await safeExecute(readySql, ['ready', documentId]);

    const rows = await safeExecute(
      'SELECT * FROM documents WHERE document_id = ? LIMIT 1',
      [documentId],
    );
    return mapDocumentRow(rows[0]);
  } catch (error) {
    return markDocumentFailed(documentId, error.message);
  }
}

/**
 * Serializes background processing in a dedicated child process so CPU-heavy
 * PDF parsing and long Gemini quota retries can never block the API server.
 *
 * The child (`rag.worker.js`) owns the job queue; the api process only hands
 * off document ids and forgets them.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, '..', 'rag.worker.js');

let ragWorker = null;
let ragWorkerPending = new Map();

function getRagWorker() {
  if (ragWorker && ragWorker.connected && !ragWorker.killed) return ragWorker;

  ragWorker = fork(WORKER_PATH, [], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  ragWorker.on('message', message => {
    if (message?.type === 'done') {
      ragWorkerPending.delete(message.documentId);
    }
  });
  ragWorker.on('error', err => {
    console.error('RAG worker error:', err.message);
  });
  ragWorker.on('exit', () => {
    const orphaned = Array.from(ragWorkerPending.keys());
    ragWorkerPending = new Map();
    for (const documentId of orphaned) {
      updateDocumentFailed(documentId).catch(() => {});
    }
    ragWorker = null;
  });
  return ragWorker;
}

/** Marks a document as failed directly from the api process. */
async function updateDocumentFailed(documentId) {
  await safeExecute(
    "UPDATE documents SET status = 'failed', error_message = ? WHERE document_id = ?",
    [
      'Background processing restarted. Please delete this document and upload it again.',
      documentId,
    ],
  );
}

/**
 * Hands a document id to the worker for background processing.
 *
 * @param {number} documentId - Document id to process.
 */
function enqueueDocumentProcessing(documentId) {
  const worker = getRagWorker();
  ragWorkerPending.set(documentId, Date.now());
  worker.send({ type: 'process', documentId });
}

process.on('exit', () => {
  if (ragWorker) ragWorker.kill();
});

/**
 * Marks documents left in `processing` from a previous server run as failed.
 * Their background jobs died with the old process and can never finish, so
 * they are surfaced to the user instead of blocking forever.
 *
 * @returns {Promise<void>}
 */
export async function resetInterruptedDocumentsService() {
  await safeExecute(
    "UPDATE documents SET status = 'failed', error_message = ? WHERE status = 'processing'",
    [
      'Processing was interrupted (server restarted). Please delete this document and upload the PDF again.',
    ],
  );
}

/**
 * Registers an upload and schedules background processing. Returns
 * immediately with a `processing` document; the frontend polls for the
 * `ready`/`failed` terminal state.
 *
 * @param {Object} input
 * @param {Object} input.file - Multer file object.
 * @param {number} input.userId - Authenticated user id.
 * @returns {Promise<Object>} Document object in `processing` state.
 */
export const createDocumentFromUploadService = async ({ file, userId }) => {
  if (!file) {
    throw new BadRequestError('A PDF file is required');
  }

  const countSql = 'SELECT COUNT(*) AS total FROM documents WHERE user_id = ?';
  const countRows = await safeExecute(countSql, [userId]);
  if (Number(countRows[0].total) >= RAG_MAX_PDFS_PER_USER) {
    throw new BadRequestError(
      `You have reached the maximum of ${RAG_MAX_PDFS_PER_USER} documents`,
    );
  }

  const storagePath = file.storagePath || `${userId}/${file.filename}`;
  const insertSql = `
    INSERT INTO documents (user_id, title, mime_type, storage_path, byte_size, status)
    VALUES (?, ?, ?, ?, ?, 'processing')
  `;
  const insertResult = await safeExecute(insertSql, [
    userId,
    file.originalname,
    file.mimetype || 'application/pdf',
    storagePath,
    file.size || 0,
  ]);
  const documentId = insertResult.insertId;

  enqueueDocumentProcessing(documentId);

  const rows = await safeExecute(
    'SELECT * FROM documents WHERE document_id = ? LIMIT 1',
    [documentId],
  );
  return mapDocumentRow(rows[0]);
};

/**
 * Lists the authenticated user's documents (newest first).
 *
 * @param {number} userId - Authenticated user id.
 * @returns {Promise<Object[]>} Mapped documents.
 */
export const listDocumentsForUserService = async userId => {
  const sql =
    'SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC';
  const rows = await safeExecute(sql, [userId]);
  return rows.map(mapDocumentRow);
};

/**
 * Fetches metadata for a single owned document.
 *
 * @param {number} documentId - Document id.
 * @param {number} userId - Authenticated user id.
 * @returns {Promise<Object>} Mapped document.
 */
export const getDocumentMetaService = async (documentId, userId) => {
  const row = await assertOwnedDocument(documentId, userId);
  return mapDocumentRow(row);
};

/**
 * Deletes an owned document and its PDF from disk.
 *
 * @param {number} documentId - Document id.
 * @param {number} userId - Authenticated user id.
 * @returns {Promise<Object>} `{ id }`.
 */
export const deleteDocumentService = async (documentId, userId) => {
  const row = await assertOwnedDocument(documentId, userId);

  try {
    await fs.unlink(resolveStoragePath(row.storage_path));
  } catch (error) {
    // Ignore missing files; only surface genuine permissions errors.
    if (error?.code !== 'ENOENT') {
      throw new BadRequestError(`Failed to delete file: ${error.message}`);
    }
  }

  const deleteSql = 'DELETE FROM documents WHERE document_id = ?';
  await safeExecute(deleteSql, [documentId]);

  return { id: documentId };
};

/**
 * Returns the chunks of a document whose status is `ready`, or an empty array.
 *
 * @param {number} documentId - Document id.
 * @returns {Promise<Array<{chunk_id: number, chunk_index: number, content: string}>>}
 */
async function fetchReadyChunks(documentId) {
  const sql =
    'SELECT chunk_id, chunk_index, content FROM document_chunks WHERE document_id = ? ORDER BY chunk_index ASC';
  return safeExecute(sql, [documentId]);
}

/**
 * Requires an owned document that finished processing (status `ready`).
 *
 * @param {number} documentId - Document id.
 * @param {number} userId - Authenticated user id.
 * @returns {Promise<Object>} Raw document row.
 */
async function assertReadyDocument(documentId, userId) {
  const row = await assertOwnedDocument(documentId, userId);
  if (row.status !== 'ready') {
    throw new BadRequestError(
      'Document is not ready yet. Wait for processing to finish.',
    );
  }
  return row;
}

/**
 * Semantic search inside a single document.
 *
 * @param {Object} input
 * @param {number} input.documentId - Document id.
 * @param {string} input.query - Search text.
 * @param {number} [input.k] - Max chunk results.
 * @param {number} input.userId - Authenticated user id.
 * @returns {Promise<Object>} `{ query, results }`.
 */
export const searchInDocumentService = async ({
  documentId,
  query,
  k = RAG_SEARCH_K,
  userId,
}) => {
  await assertReadyDocument(documentId, userId);

  const queryVector = await embedText(query, 'RETRIEVAL_QUERY');

  const vectorSql = `
    SELECT cv.chunk_id, cv.embedding, c.chunk_index AS chunk_index
    FROM document_chunk_vectors cv
    JOIN document_chunks c ON c.chunk_id = cv.chunk_id
    WHERE c.document_id = ? AND cv.status = 'ready'
  `;
  const vectorRows = await safeExecute(vectorSql, [documentId]);

  const scored = vectorRows
    .map(row => ({
      chunkId: row.chunk_id,
      chunkIndex: row.chunk_index,
      score: cosineSimilarity(queryVector, parseEmbedding(row.embedding)),
    }));

  // Debug: log score distribution when search yields nothing.
  if (scored.length > 0) {
    const scores = scored.map(s => s.score).sort((a, b) => b - a);
    console.log(
      `[RAG search] doc=${documentId} chunks=${vectorRows.length} queryDim=${queryVector.length} storeDim=${parseEmbedding(vectorRows[0].embedding).length} threshold=${RAG_SEARCH_THRESHOLD} topScores=${scores.slice(0, 5).map(s => s.toFixed(4)).join(', ')}`,
    );
  }

  const thresholdFiltered = scored
    .filter(item => item.score >= RAG_SEARCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  if (thresholdFiltered.length === 0) {
    return { query, results: [] };
  }

  // Pull content before deduplicating so overlapping chunk windows can be
  // detected, but bound the work by a generous pre-slice of the best scores.
  const candidates = thresholdFiltered.slice(0, Math.max(k, 40));
  const candidateIds = candidates.map(item => item.chunkId);
  const placeholders = candidateIds.map(() => '?').join(',');
  const contentSql = `SELECT chunk_id, content FROM document_chunks WHERE chunk_id IN (${placeholders})`;
  const contentRows = await safeExecute(contentSql, candidateIds);
  const contentById = new Map(
    contentRows.map(row => [row.chunk_id, row.content]),
  );

  // Collapse near-duplicate passages (consecutive chunks from the same
  // paragraph are ~90% identical because chunking uses overlapping windows).
  // Kept in score order; a passage is skipped if half of its text already
  // appears in a higher-scored kept passage.
  const results = [];
  for (const item of candidates) {
    const excerpt = contentById.get(item.chunkId) || '';
    if (excerpt.length === 0) continue;
    if (
      results.some(kept => passageOverlapRatio(kept.excerpt, excerpt) >= 0.5)
    ) {
      continue;
    }
    results.push({
      chunkId: item.chunkId,
      chunkIndex: item.chunkIndex,
      score: item.score,
      excerpt,
    });
    if (results.length >= k) break;
  }

  return { query, results };
};

/**
 * AI Q&A grounded in the content of a single document.
 *
 * @param {Object} input
 * @param {number} input.documentId - Document id.
 * @param {string} input.query - User question.
 * @param {number} input.userId - Authenticated user id.
 * @returns {Promise<Object>} `{ answer, citations, chunksUsed }`.
 */
export const queryDocumentService = async ({ documentId, query, userId }) => {
  await assertReadyDocument(documentId, userId);

  const searchResult = await searchInDocumentService({
    documentId,
    query,
    k: RAG_SEARCH_K,
    userId,
  });

  const allChunks = await fetchReadyChunks(documentId);
  const chunkByIndex = new Map(
    allChunks.map(chunk => [chunk.chunk_index, chunk]),
  );

  const topChunks = searchResult.results
    .map(item => {
      const chunk = chunkByIndex.get(item.chunkIndex);
      return chunk
        ? {
            chunkId: chunk.chunk_id,
            chunkIndex: chunk.chunk_index,
            content: chunk.content,
          }
        : null;
    })
    .filter(Boolean);

  if (topChunks.length === 0) {
    return {
      answer:
        'No relevant passages were found in this document for your question.',
      citations: [],
      chunksUsed: [],
    };
  }

  return answerFromRagChunksService({ query, chunks: topChunks });
};