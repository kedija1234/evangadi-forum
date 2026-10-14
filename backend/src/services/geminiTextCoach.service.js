/**
 * AI "coach" services backed by the Gemini text model:
 *  - Question draft coach: feedback + suggestions before posting.
 *  - Answer fit: how well a draft answer addresses a question.
 *  - RAG answer: ground an answer strictly in retrieved document chunks.
 */
import { safeExecute } from '../../db/config.js';
import { NotFoundError } from '../utils/errors/index.js';
import {
  generateText,
  extractJsonFromResponse,
  TEXT_MODEL,
} from './gemini.service.js';

const COACH_SYSTEM_PROMPT = `
You are an expert programming-forum coach for a cohort of software-engineering
learners. You give concise, encouraging, concrete advice. Always reply with
valid JSON only — no markdown fences.`;

const ANSWER_SUGGEST_SYSTEM_PROMPT = `
You are an expert software-engineering mentor writing a complete forum answer.
Write clear, well-structured Markdown. Prefer short code blocks, lists, and
concrete examples. Do NOT wrap the whole reply in a markdown fence and do NOT
add a standalone summary line — just the answer body.`;

/**
 * Builds a coaching prompt from a draft question.
 */
function buildDraftCoachPrompt({ title, content }) {
  return `
Review the following forum question draft and suggest improvements.

Title:
"""${title || '(no title yet)'}"""

Content:
"""${content}"""

Analyze clarity, completeness, formatting, and how likely a peer is to help in
one pass. Return JSON with this exact shape:
{
  "feedback": "2-3 sentence overall assessment",
  "tips": ["short actionable tip 1", "short actionable tip 2", "short actionable tip 3"]
}`;
}

/**
 * AI Question Draft Coach.
 *
 * @param {Object} input
 * @param {string} [input.title] - Draft title.
 * @param {string} input.content - Draft body.
 * @returns {Promise<Object>} `{ feedback, tips }`.
 */
export const generateQuestionDraftCoachService = async ({ title, content }) => {
  const raw = await generateText(buildDraftCoachPrompt({ title, content }), {
    model: TEXT_MODEL,
    systemInstruction: COACH_SYSTEM_PROMPT,
  });

  const parsed = extractJsonFromResponse(raw);

  if (!parsed || !Array.isArray(parsed.tips)) {
    // Fall back to a safe, plain-text summary of the model reply.
    return { feedback: raw.trim(), tips: [] };
  }

  return {
    feedback: typeof parsed.feedback === 'string' ? parsed.feedback : '',
    tips: parsed.tips.map(String).filter(Boolean),
  };
};

/**
 * Builds a prompt evaluating how well a draft answer fits a question.
 */
function buildAnswerFitPrompt(question, answerText) {
  return `
Evaluate how well the following answer addresses the given question.

Question title:
"""${question.title}"""

Question content:
"""${question.content}"""

Draft answer:
"""${answerText}"""

Return JSON with this exact shape:
{
  "level": "strong | partial | weak",
  "note": "1-2 sentences explaining the fit, what is missing, and how to improve"
}`;
}

/**
 * AI Answer Fit evaluation.
 *
 * @param {Object} input
 * @param {string} input.questionHash - 16-char hex hash of the question.
 * @param {string} input.answerText - Draft answer (min 20 chars).
 * @returns {Promise<Object>} `{ level, note }`.
 * @throws {NotFoundError} When the question does not exist.
 */
export const assessAnswerAgainstQuestionService = async ({
  questionHash,
  answerText,
}) => {
  const questionSql =
    'SELECT question_id, title, content FROM questions WHERE question_hash = ? LIMIT 1';
  const rows = await safeExecute(questionSql, [questionHash]);

  if (rows.length === 0) {
    throw new NotFoundError('Question not found');
  }

  const raw = await generateText(
    buildAnswerFitPrompt(rows[0], answerText),
    { model: TEXT_MODEL, systemInstruction: COACH_SYSTEM_PROMPT },
  );

  const parsed = extractJsonFromResponse(raw);
  const level =
    parsed && ['strong', 'partial', 'weak'].includes(parsed.level)
      ? parsed.level
      : 'partial';

  return {
    level,
    note:
      typeof parsed?.note === 'string'
        ? parsed.note
        : 'The AI could not produce a structured evaluation, but here is its raw reply:\n' + raw.trim(),
  };
};

/**
 * Builds a prompt that writes a full answer for a question.
 */
function buildSuggestedAnswerPrompt(question, existingDraft) {
  const draft = existingDraft && existingDraft.trim() ? existingDraft.trim() : null;

  return `
Write a complete, helpful answer to the student's question. Use the question
title and content as your only source of truth. If the question is under-specified,
pick reasonable assumptions and state them briefly.

Question title:
"""${question.title}"""

Question content:
"""${question.content}"""

${draft ? `The student already wrote this draft — rewrite and improve it while keeping its structure and any correct details:\n"""${draft}"""` : ''}

Return the answer as plain Markdown (headings, bold, code fences where useful).`;
}

/**
 * AI Suggested Answer.
 *
 * Generates a full answer draft for a question, optionally rewriting an
 * existing draft, so the user can paste it into the answer form.
 *
 * @param {Object} input
 * @param {string} input.questionHash - 16-char hex hash of the question.
 * @param {string} [input.answerText] - Existing draft answer (optional).
 * @returns {Promise<Object>} `{ suggestion }` - Suggested answer text (Markdown).
 * @throws {NotFoundError} When the question does not exist.
 */
export const generateSuggestedAnswerService = async ({
  questionHash,
  answerText,
}) => {
  const questionSql =
    'SELECT question_id, title, content FROM questions WHERE question_hash = ? LIMIT 1';
  const rows = await safeExecute(questionSql, [questionHash]);

  if (rows.length === 0) {
    throw new NotFoundError('Question not found');
  }

  const raw = await generateText(
    buildSuggestedAnswerPrompt(rows[0], answerText || ''),
    {
      model: TEXT_MODEL,
      systemInstruction: ANSWER_SUGGEST_SYSTEM_PROMPT,
    },
  );

  const suggestion = extractJsonFromResponse(raw)?.answer || raw.trim();

  return { suggestion: suggestion.trim() };
};

/**
 * Builds a prompt that answers only from provided context chunks.
 */
function buildRagAnswerPrompt(query, chunks) {
  const context = chunks
    .map(
      (chunk, index) =>
        `[Chunk ${index + 1} (ref ${chunk.chunkId})]\n${chunk.content}`,
    )
    .join('\n\n---\n\n');

  return `
Answer the user's question using ONLY the provided context chunks. If the
context does not contain the answer, say so honestly. Cite each fact with the
matching [Chunk N] reference and end the reply with a "Sources:" line listing
the refs used as "ref: <chunkId>".

Context chunks:
"""
${context}
"""

User question:
"""${query}"""`;
}

/**
 * Answers a user query using retrieved RAG chunks as grounding.
 *
 * @param {Object} input
 * @param {string} input.query - User question.
 * @param {Array<Object>} input.chunks - `[{ chunkId, content }]` context chunks.
 * @returns {Promise<Object>} `{ answer, citations, chunksUsed }` where
 *   `citations` is an array of passage snippets (strings) and `chunksUsed`
 *   is the array of referenced chunk ids.
 */
export const answerFromRagChunksService = async ({ query, chunks }) => {
  const raw = await generateText(buildRagAnswerPrompt(query, chunks), {
    model: TEXT_MODEL,
    systemInstruction: COACH_SYSTEM_PROMPT,
  });

  const references = (raw.match(/ref:\s*(\d+)/gi) || []).map(m =>
    Number(m.replace(/ref:\s*/i, '')),
  );
  const chunksUsed = Array.from(new Set(references.filter(Boolean)));

  const citations = chunks
    .filter(chunk => chunksUsed.includes(chunk.chunkId))
    .map(chunk => {
      const content = String(chunk.content || '')
        .replace(/\s+/g, ' ')
        .trim();
      return content.length > 180
        ? `${content.slice(0, 180).trimEnd()}…`
        : content;
    });

  const parsed = extractJsonFromResponse(raw);
  const answer = parsed?.answer ? String(parsed.answer) : raw.trim();

  return { answer, citations, chunksUsed };
};