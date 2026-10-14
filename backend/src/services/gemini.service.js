/**
 * Central Gemini REST client + helpers used across the forum:
 *  - `embedText` for vector embeddings (semantic search + RAG chunking).
 *  - `generateText` for AI features (draft coach, answer fit, RAG Q&A).
 *
 * Calls the raw REST API with an AbortController timeout. The `@google/genai`
 * SDK was previously used but leaked ~4 GB of heap under quota throttling,
 * crashing any process that ran it; plain fetch with a hard abort is fast,
 * memory-stable, and never leaves hung requests behind.
 */
import { ServiceUnavailableError } from '../utils/errors/index.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable is required');
}

export const EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';
export const TEXT_MODEL =
  process.env.GEMINI_TEXT_MODEL || 'gemini-3.5-flash-lite';

/** Gemini's BatchEmbedContents accepts at most this many texts per request. */
const EMBED_BATCH_SIZE = 100;

/** Max retries per batch when the free-tier quota is exhausted. */
const EMBED_RETRY_MAX = Number(process.env.GEMINI_EMBED_MAX_RETRIES) || 3;

/** Fallback backoff base (ms) when the API omits a RetryInfo delay. */
const EMBED_RETRY_BASE_MS =
  Number(process.env.GEMINI_EMBED_RETRY_BASE_MS) || 1000;

/** Optional pause between batch requests to stay under per-minute quotas. */
const EMBED_BATCH_DELAY_MS =
  Number(process.env.GEMINI_EMBED_BATCH_DELAY_MS) || 0;

/** Upper bound for a single rate-limit wait (matches QuotaFailure ~1min). */
const MAX_RETRY_WAIT_MS = 60000;

/**
 * Hard cap for a single Gemini request. Requests that exceed this are
 * rejected (and actually cancelled via AbortController) instead of hanging.
 */
const GEMINI_REQUEST_TIMEOUT_MS =
  Number(process.env.GEMINI_REQUEST_TIMEOUT_MS) || 75000;

const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL ||
  'https://generativelanguage.googleapis.com/v1beta';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Inspects a Gemini REST error for free-tier quota exhaustion and a suggested
 * retry delay. The error body is `{ error: { code, status, message, details } }`
 * where details may carry `RetryInfo.retryDelay` (e.g. "30s").
 *
 * @param {unknown} error
 * @returns {{ isRateLimited: boolean, retryDelayMs: number }}
 */
function extractRateLimitInfo(error) {
  const payload = error?.payload;
  const inner = payload?.error;

  const code = inner?.code ?? error?.status;
  const message = String(inner?.message ?? error?.message ?? '');
  const details = Array.isArray(inner?.details) ? inner.details : [];

  let retryDelayMs = 0;
  const retryInfo = details.find(detail =>
    String(detail?.['@type']).includes('RetryInfo'),
  );
  if (retryInfo?.retryDelay) {
    const secs = Number.parseFloat(retryInfo.retryDelay);
    if (Number.isFinite(secs) && secs > 0) {
      retryDelayMs = Math.min(secs * 1000, MAX_RETRY_WAIT_MS);
    }
  }
  if (!retryDelayMs) {
    const match = /retry\s+in\s*([\d.]+)\s*s/i.exec(message);
    if (match) {
      const secs = Number.parseFloat(match[1]);
      if (Number.isFinite(secs) && secs > 0) {
        retryDelayMs = Math.min(secs * 1000, MAX_RETRY_WAIT_MS);
      }
    }
  }

  const isRateLimited =
    code === 429 ||
    code === 'RESOURCE_EXHAUSTED' ||
    /quota|RESOURCE_EXHAUSTED/i.test(message);

  return { isRateLimited, retryDelayMs };
}

/**
 * Performs a Gemini REST call with a hard, actually-cancelling timeout.
 *
 * @param {string} path - API path, e.g. `/models/gemini-embedding-001:batchEmbedContents`.
 * @param {Object} body - JSON request body.
 * @returns {Promise<Object>} Parsed success payload.
 * @throws {Error} With `status` and `payload` set for non-2xx responses.
 */
async function geminiFetch(path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${GEMINI_BASE_URL}${path}?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(
        payload?.error?.message || `Gemini request failed (HTTP ${response.status})`,
      );
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(
        `Gemini request timed out after ${GEMINI_REQUEST_TIMEOUT_MS}ms`,
      );
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls batchEmbedContents for one batch, retrying with backoff when the
 * free-tier quota is exhausted.
 *
 * @param {string[]} inputs - Batch of texts (at most {@link EMBED_BATCH_SIZE}).
 * @param {string} taskType - Semantic role of the texts.
 * @returns {Promise<Object>} The Gemini response payload.
 */
async function embedBatchWithRetry(inputs, taskType) {
  let lastError;

  for (let attempt = 0; attempt <= EMBED_RETRY_MAX; attempt += 1) {
    try {
      return await geminiFetch(
        `/models/${EMBEDDING_MODEL}:batchEmbedContents`,
        {
          requests: inputs.map(text => ({
            model: `models/${EMBEDDING_MODEL}`,
            content: { parts: [{ text }] },
            taskType,
          })),
        },
      );
    } catch (error) {
      lastError = error;
      const info = extractRateLimitInfo(error);
      if (!info.isRateLimited || attempt === EMBED_RETRY_MAX) break;

      const waitMs = info.retryDelayMs
        ? info.retryDelayMs + Math.random() * 500
        : EMBED_RETRY_BASE_MS * (attempt + 1) + Math.random() * 500;
      await sleep(waitMs);
    }
  }

  throw lastError;
}

/**
 * Generates an embedding (or many embeddings) for the given text(s).
 *
 * Inputs are split into batches of at most {@link EMBED_BATCH_SIZE} texts to
 * stay within Gemini's BatchEmbedContents limit, and batches are retried with
 * backoff when the free-tier quota is exhausted.
 *
 * @param {string | string[]} text - A single string or an array of strings.
 * @param {'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' | 'SEMANTIC_SIMILARITY'} [taskType]
 *   Semantic role of the text being embedded.
 * @returns {Promise<number[] | number[][]>} Single vector for a string input,
 *   or an array of vectors for an array input.
 * @throws {ServiceUnavailableError} When Gemini is unreachable or returns no values.
 */
export async function embedText(text, taskType = 'RETRIEVAL_DOCUMENT') {
  const isArrayInput = Array.isArray(text);
  const inputs = isArrayInput ? text : [text];

  try {
    const vectors = [];

    for (let i = 0; i < inputs.length; i += EMBED_BATCH_SIZE) {
      const batch = inputs.slice(i, i + EMBED_BATCH_SIZE);
      const response = await embedBatchWithRetry(batch, taskType);

      const batchVectors = (response.embeddings || [])
        .map(emb => emb?.values)
        .filter(Array.isArray);

      if (batchVectors.length !== batch.length) {
        throw new Error(
          `Gemini returned ${batchVectors.length} embeddings for ${batch.length} texts`,
        );
      }

      vectors.push(...batchVectors);

      if (EMBED_BATCH_DELAY_MS > 0 && i + EMBED_BATCH_SIZE < inputs.length) {
        await sleep(EMBED_BATCH_DELAY_MS);
      }
    }

    if (vectors.length === 0) {
      throw new Error('Gemini returned no embedding values');
    }

    return isArrayInput ? vectors : vectors[0];
  } catch (error) {
    throw new ServiceUnavailableError(
      `Failed to generate embedding: ${error.message}`,
    );
  }
}

/**
 * Requests text generation from the Gemini text model.
 *
 * @param {string} prompt - The user-style prompt passed to the model.
 * @param {Object} [options]
 * @param {string} [options.model] - Override model name.
 * @param {string} [options.systemInstruction] - Optional system prompt.
 * @returns {Promise<string>} The model's text reply.
 * @throws {ServiceUnavailableError} When Gemini generation fails.
 */
export async function generateText(
  prompt,
  { model = TEXT_MODEL, systemInstruction } = {},
) {
  try {
    const body = { contents: [{ parts: [{ text: prompt }] }] };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const payload = await geminiFetch(`/models/${model}:generateContent`, body);

    const text = (payload?.candidates?.[0]?.content?.parts || [])
      .map(part => part?.text ?? '')
      .join('')
      .trim();

    if (text.length === 0) {
      throw new Error('Gemini returned an empty response');
    }

    return text;
  } catch (error) {
    throw new ServiceUnavailableError(
      `Failed to generate text: ${error.message}`,
    );
  }
}

/**
 * Asks Gemini to grade how useful an answer is for the given question.
 * Returns exactly one of `'Good'`, `'Moderate'`, or `'Low'`.
 *
 * @param {string} questionText - The question being answered.
 * @param {string} answerText - The submitted answer.
 * @returns {Promise<'Good' | 'Moderate' | 'Low'>}
 */
export async function recommendAnswerGrade(questionText, answerText) {
  const systemInstruction =
    'You are a supportive forum moderator. Assess how well the answer ' +
    'responds to the question using this rubric:\n' +
    '- Good: on-topic, correct, and a genuinely useful response to the question.\n' +
    '- Moderate: mostly on-topic and roughly correct, but incomplete, vague, ' +
    'or missing useful detail.\n' +
    '- Low: spam, gibberish, off-topic or unrelated to the question, or ' +
    'factually wrong.\n' +
    'When in doubt between two levels, choose the higher one. Reply with ' +
    'exactly one word: Good, Moderate, or Low.';

  const prompt =
    `Question:\n${questionText}\n\n` +
    `Answer:\n${answerText}\n\n` +
    `Rate the answer using the rubric. Reply with exactly one word: Good, ` +
    `Moderate, or Low.`;

  const text = await generateText(prompt, { systemInstruction });
  const match = /Good|Moderate|Low/i.exec(text);
  if (!match) return 'Moderate';
  return match[0][0].toUpperCase() + match[0].slice(1).toLowerCase();
}

/**
 * Best-effort extraction of a JSON object from a model reply. Gemini sometimes
 * wraps JSON in markdown fences; this strips them before parsing.
 *
 * @param {string} text - Raw model output.
 * @returns {Object | null} Parsed object, or null when parsing fails.
 */
export function extractJsonFromResponse(text) {
  if (typeof text !== 'string') return null;

  try {
    return JSON.parse(text);
  } catch {
    // strip code fences if present
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      return null;
    }
  }

  const firstBrace = text.indexOf('{');
  if (firstBrace !== -1) {
    try {
      return JSON.parse(text.slice(firstBrace));
    } catch {
      return null;
    }
  }

  return null;
}