/**
 * Vector math + text chunking helpers for semantic search and RAG.
 */

/**
 * Computes the cosine similarity between two equal-length numeric vectors.
 *
 * @param {number[]} a - First vector.
 * @param {number[]} b - Second vector.
 * @returns {number} Cosine similarity score in the range [-1, 1] (0 on malformed input).
 */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Normalizes a single vector row from the database: `embedding` may be a JSON
 * string or an object; returns a plain array of numbers.
 *
 * @param {string | number[] | object} embedding - Stored embedding value.
 * @returns {number[]} Plain numeric array.
 */
export function parseEmbedding(embedding) {
  if (Array.isArray(embedding)) return embedding;
  if (typeof embedding === 'string') {
    try {
      const parsed = JSON.parse(embedding);
      return Array.isArray(parsed) ? parsed : parsed?.values || [];
    } catch {
      return [];
    }
  }
  if (embedding && typeof embedding === 'object') {
    return Array.isArray(embedding.values) ? embedding.values : [];
  }
  return [];
}

/**
 * Splits plain text into overlapping chunks of roughly `chunkChars` characters.
 * Chunks try to break on sentence boundaries when possible.
 *
 * @param {string} text - Extracted source text.
 * @param {number} chunkChars - Target chunk size in characters.
 * @param {number} overlap - Number of overlapping characters between chunks.
 * @returns {string[]} Array of text chunks.
 */
export function chunkText(text, chunkChars = 900, overlap = 120) {
  const cleaned = (text || '').replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];

  const size = Math.max(64, Math.floor(chunkChars));
  const overlapN = Math.max(0, Math.min(Math.floor(overlap), size - 1));
  const step = size - overlapN;

  const chunks = [];
  let start = 0;

  while (start < cleaned.length) {
    let end = Math.min(start + size, cleaned.length);

    if (end < cleaned.length) {
      // Try to break at a sentence/newline boundary before the hard end.
      const window = cleaned.slice(Math.max(0, end - 220), end);
      const lastPeriod = window.lastIndexOf('. ');
      const lastNewline = window.lastIndexOf('\n');
      let boundary = -1;
      if (lastPeriod > 120) boundary = lastPeriod + 1;
      else if (lastNewline > 60) boundary = lastNewline + 1;

      if (boundary !== -1) {
        // Never shrink the chunk below (overlap + 1) chars; this keeps
        // `start` advancing, otherwise the loop would never make progress.
        const candidate = Math.max(start + overlapN + 1, start + boundary);
        if (candidate < end) end = candidate;
      }
    }

    chunks.push(cleaned.slice(start, end).trim());

    if (end >= cleaned.length) break;

    const next = end - overlapN;
    if (next <= start) break; // safety: guarantee forward progress
    start = next;
  }

  return chunks.filter(Boolean);
}

/**
 * Generates a unique 16-character lowercase hex string (question hash).
 *
 * @returns {string} 16-char hex string.
 */
export function generateHexHash(length = 16) {
  const bytes = new Uint8Array(Math.ceil(length / 2));
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length);
}