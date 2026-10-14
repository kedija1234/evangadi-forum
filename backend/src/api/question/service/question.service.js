import { safeExecute } from '../../../../db/config.js';
import { NotFoundError } from '../../../utils/errors/index.js';
import {
  cosineSimilarity,
  parseEmbedding,
  generateHexHash,
} from '../../../utils/vector.js';
import { embedText } from '../../../services/gemini.service.js';

// gemini-embedding-001 scores related content ~0.5-0.74 and unrelated ~0.3-0.7,
// so a strict threshold like 0.75 filters out everything. Keep the default low.
const RECOMMEND_THRESHOLD = Number(process.env.RECOMMEND_THRESHOLD) || 0.2;
// The dashboard AI search should list only genuinely similar questions, so it
// uses a stricter threshold (0.6) and a small result cap (2) than the looser
// "similar questions" sidebar. With gemini-embedding-001, unrelated content can
// still score ~0.6, so limiting to the top matches is what keeps results tight.
const SEMANTIC_SEARCH_THRESHOLD =
  Number(process.env.SEMANTIC_SEARCH_THRESHOLD) || 0.6;
const SEMANTIC_SEARCH_K = Number(process.env.SEMANTIC_SEARCH_K) || 2;
const RECOMMEND_K = Number(process.env.RECOMMEND_K) || 10;
const DEFAULT_ANSWERS_LIMIT = 100;
const DEFAULT_QUESTIONS_PAGE_SIZE = Number(process.env.QUESTIONS_PAGE_SIZE) || 10;

/**
 * Thread ranking blends AI relevance (cosine of question↔answer embeddings)
 * with the net vote score. Both weights must sum conceptually to 1 but are
 * kept independent so they can be tuned in .env.
 */
const ANSWER_RANK_AI_WEIGHT = Number(process.env.ANSWER_RANK_AI_WEIGHT) || 0.5;
const ANSWER_RANK_VOTE_WEIGHT =
  Number(process.env.ANSWER_RANK_VOTE_WEIGHT) || 0.5;

/**
 * Gemini AI-score thresholds used to grade answers as Good / Moderate / Low
 * when a stored grade is not yet available. Based on gemini-embedding-001
 * cosine behavior for related content (~0.5-0.74).
 */
const ANSWER_GOOD_MIN = Number(process.env.ANSWER_GOOD_MIN) || 0.6;
const ANSWER_MODERATE_MIN = Number(process.env.ANSWER_MODERATE_MIN) || 0.45;

/**
 * Maps an AI relevance score (0-1) to a Gemini recommendation label.
 *
 * @param {number} score - Cosine similarity of question↔answer embeddings.
 * @returns {'Good' | 'Moderate' | 'Low' | null} Null when there is no score.
 */
function gradeFromScore(score) {
  if (!Number.isFinite(score) || score <= 0) return null;
  if (score >= ANSWER_GOOD_MIN) return 'Good';
  if (score >= ANSWER_MODERATE_MIN) return 'Moderate';
  return 'Low';
}

/**
 * Maps a flat questions JOIN users JOIN answers row to the API question shape.
 */
function mapQuestionRow(row) {
  return {
    id: row.question_id,
    questionHash: row.question_hash,
    title: row.title,
    content: row.content,
    answerCount: Number(row.answerCount) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: {
      id: row.user_id,
      firstName: row.first_name,
      lastName: row.last_name,
      role: row.role || 'user',
    },
  };
}

/**
 * Hydrates question detail rows from a list of question ids, preserving the
 * original order of `ids`.
 *
 * @param {number[]} ids - Question ids to fetch.
 * @returns {Promise<Array>} Mapped question objects (empty when ids is empty).
 */
async function hydrateQuestionDetails(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const sql = `
    SELECT
      q.question_id,
      q.question_hash,
      q.title,
      q.content,
      q.created_at,
      q.updated_at,
      u.user_id,
      u.first_name,
      u.last_name,
      u.role,
      COUNT(a.answer_id) AS answerCount
    FROM questions q
    JOIN users u ON u.user_id = q.user_id
    LEFT JOIN answers a ON a.question_id = q.question_id
    WHERE q.question_id IN (${ids.map(() => '?').join(',')})
    GROUP BY
      q.question_id, q.question_hash, q.title, q.content,
      q.created_at, q.updated_at, u.user_id, u.first_name, u.last_name, u.role
  `;

  const rows = await safeExecute(sql, ids);
  const byId = new Map(rows.map(row => [row.question_id, mapQuestionRow(row)]));

  return ids.map(id => byId.get(id)).filter(Boolean);
}

/**
 * Creates a question and (best-effort) stores its vector embedding.
 *
 * @param {Object} input
 * @param {string} input.title - Question title.
 * @param {string} input.content - Question body.
 * @param {number} input.userId - Authenticated user id.
 * @returns {Promise<Object>} Question summary with the generated hash.
 */
export const createQuestionWithVectorService = async ({ title, content, userId }) => {
  const questionHash = generateHexHash(16);

  const insertSql =
    'INSERT INTO questions (question_hash, user_id, title, content) VALUES (?, ?, ?, ?)';
  const insertResult = await safeExecute(insertSql, [
    questionHash,
    userId,
    title,
    content,
  ]);
  const questionId = insertResult.insertId;

  const sourceText = `${title}\n\n${content}`;

  try {
    const vector = await embedText(sourceText, 'RETRIEVAL_DOCUMENT');
    const vectorSql =
      'INSERT INTO question_vectors (question_id, source_text, embedding, status) VALUES (?, ?, ?, ?)';
    await safeExecute(vectorSql, [
      questionId,
      sourceText,
      JSON.stringify(vector),
      'ready',
    ]);
  } catch (_error) {
    // Embedding failure should not block question creation; record it instead.
    const vectorSql =
      'INSERT INTO question_vectors (question_id, source_text, embedding, status) VALUES (?, ?, ?, ?)';
    await safeExecute(vectorSql, [
      questionId,
      sourceText,
      JSON.stringify([]),
      'failed',
    ]);
  }

  return { id: questionId, questionHash, title, content, userId };
};

/**
 * Lists questions with optional keyword (`search`) and ownership (`mine`)
 * filters, paginated.
 *
 * @param {Object} input
 * @param {string} [input.search] - LIKE filter over title/content.
 * @param {string} [input.mine] - 'true' filters to the authenticated user.
 * @param {number} input.userId - Authenticated user id.
 * @param {number} [input.page] - 1-based page number.
 * @param {number} [input.limit] - Questions per page.
 * @returns {Promise<Object>} `{ data, meta }`.
 */
export const getQuestionsService = async ({
  search,
  mine,
  userId,
  page = 1,
  limit = DEFAULT_QUESTIONS_PAGE_SIZE,
}) => {
  const conditions = [];
  const params = [];

  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    conditions.push('(q.title LIKE ? OR q.content LIKE ?)');
    params.push(term, term);
  }

  if (mine === 'true' || mine === '1' || mine === true) {
    conditions.push('q.user_id = ?');
    params.push(userId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || DEFAULT_QUESTIONS_PAGE_SIZE));
  const offset = (safePage - 1) * safeLimit;

  const countSql = `
    SELECT COUNT(DISTINCT q.question_id) AS total
    FROM questions q
    JOIN users u ON u.user_id = q.user_id
    ${whereClause}
  `;
  const countRows = await safeExecute(countSql, params);
  const total = Number(countRows[0]?.total) || 0;

  const sql = `
    SELECT
      q.question_id,
      q.question_hash,
      q.title,
      q.content,
      q.created_at,
      q.updated_at,
      u.user_id,
      u.first_name,
      u.last_name,
      u.role,
      COUNT(a.answer_id) AS answerCount
    FROM questions q
    JOIN users u ON u.user_id = q.user_id
    LEFT JOIN answers a ON a.question_id = q.question_id
    ${whereClause}
    GROUP BY
      q.question_id, q.question_hash, q.title, q.content,
      q.created_at, q.updated_at, u.user_id, u.first_name, u.last_name, u.role
    ORDER BY q.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const rows = await safeExecute(sql, [...params, safeLimit, offset]);

  return {
    data: rows.map(mapQuestionRow),
    meta: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total > 0 ? Math.ceil(total / safeLimit) : 0,
      sortBy: 'newest',
      sortOrder: 'desc',
    },
  };
};

/**
 * Computes AI relevance scores (cosine of the question embedding vs each
 * answer embedding). Answers without a ready vector are simply absent from
 * the returned map and treated as score 0.
 *
 * @param {number} questionId - Source question id.
 * @param {number[]} answerIds - Answer ids in the thread.
 * @returns {Promise<Map<number, number>>} answerId → cosine score.
 */
async function computeAnswerAiScores(questionId, answerIds) {
  if (answerIds.length === 0) return new Map();

  const questionVectorSql =
    "SELECT embedding FROM question_vectors WHERE question_id = ? AND status = 'ready' LIMIT 1";
  const questionVectorRows = await safeExecute(questionVectorSql, [questionId]);
  if (questionVectorRows.length === 0) return new Map();

  const questionVector = parseEmbedding(questionVectorRows[0].embedding);
  if (questionVector.length === 0) return new Map();

  const placeholders = answerIds.map(() => '?').join(',');
  const answerVectorSql = `
    SELECT answer_id, embedding
    FROM answer_vectors
    WHERE status = 'ready' AND answer_id IN (${placeholders})
  `;
  const answerVectorRows = await safeExecute(answerVectorSql, answerIds);

  return new Map(
    answerVectorRows.map(row => [
      row.answer_id,
      cosineSimilarity(questionVector, parseEmbedding(row.embedding)),
    ]),
  );
}

/**
 * Ranks answers in place by a blended score of AI relevance and net votes.
 * Votes are min–max normalized across the thread (with a 0 baseline) so a
 * five-upvote answer and a one-upvote answer differ meaningfully.
 *
 * @param {Array} answers - Answer objects (mutated in place).
 */
function rankAnswers(answers) {
  const votes = answers.map(answer => answer.voteCount);
  const maxVote = Math.max(...votes, 0);
  const minVote = Math.min(...votes, 0);
  const range = maxVote - minVote;

  answers.forEach(answer => {
    const normalizedVote = range > 0 ? (answer.voteCount - minVote) / range : 0.5;
    answer.combinedScore =
      ANSWER_RANK_AI_WEIGHT * answer.aiScore +
      ANSWER_RANK_VOTE_WEIGHT * normalizedVote;
  });

  answers.sort(
    (a, b) =>
      b.combinedScore - a.combinedScore ||
      new Date(a.createdAt) - new Date(b.createdAt),
  );

  answers.forEach((answer, index) => {
    answer.rank = index + 1;
  });
}

/**
 * Fetches a single question with a page of its answers.
 *
 * @param {string} questionHash - 16-char hex hash.
 * @param {number} [userId] - Authenticated user id (for the viewer's votes on answers).
 * @param {{ page?: number, limit?: number }} [options] - Answer pagination.
 * @returns {Promise<Object>} `{ question, answers, answersMeta }`.
 * @throws {NotFoundError} When the question does not exist.
 */
export const getSingleQuestionService = async (
  questionHash,
  userId,
  { page = 1, limit = DEFAULT_ANSWERS_LIMIT } = {},
) => {
  const questionSql = `
    SELECT
      q.question_id,
      q.question_hash,
      q.title,
      q.content,
      q.created_at,
      q.updated_at,
      u.user_id,
      u.first_name,
      u.last_name,
      u.role
    FROM questions q
    JOIN users u ON u.user_id = q.user_id
    WHERE q.question_hash = ?
    LIMIT 1
  `;

  const questionRows = await safeExecute(questionSql, [questionHash]);

  if (questionRows.length === 0) {
    throw new NotFoundError('Question not found');
  }

  const questionRow = questionRows[0];

  const countRows = await safeExecute(
    'SELECT COUNT(*) AS total FROM answers WHERE question_id = ?',
    [questionRow.question_id],
  );
  const total = Number(countRows[0]?.total) || 0;

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || DEFAULT_ANSWERS_LIMIT));
  const offset = (safePage - 1) * safeLimit;

  const answersSql = `
    SELECT
      a.answer_id,
      a.question_id,
      a.content,
      a.created_at,
      a.updated_at,
      u.user_id,
      u.first_name,
      u.last_name,
      u.role,
      COALESCE(SUM(v.vote), 0) AS voteCount,
      COALESCE(SUM(v.vote = 1), 0) AS upVotes,
      COALESCE(SUM(v.vote = -1), 0) AS downVotes,
      IFNULL(MAX(CASE WHEN v.user_id = ? THEN v.vote END), 0) AS myVote,
      av.ai_grade
    FROM answers a
    JOIN users u ON u.user_id = a.user_id
    LEFT JOIN answer_votes v ON v.answer_id = a.answer_id
    LEFT JOIN answer_vectors av ON av.answer_id = a.answer_id
    WHERE a.question_id = ?
    GROUP BY
      a.answer_id, a.question_id, a.content, a.created_at, a.updated_at,
      u.user_id, u.first_name, u.last_name, u.role, av.ai_grade
    ORDER BY a.created_at ASC
    LIMIT ? OFFSET ?
  `;

  const answerRows = await safeExecute(answersSql, [
    userId,
    questionRow.question_id,
    safeLimit,
    offset,
  ]);

  const answers = answerRows.map(row => ({
    id: row.answer_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    voteCount: Number(row.voteCount) || 0,
    upVotes: Number(row.upVotes) || 0,
    downVotes: Number(row.downVotes) || 0,
    myVote: Number(row.myVote) || 0,
    aiGrade: row.ai_grade || null,
    aiScore: 0,
    combinedScore: 0,
    rank: 1,
    author: {
      id: row.user_id,
      firstName: row.first_name,
      lastName: row.last_name,
      role: row.role || 'user',
    },
  }));

  // AI relevance ranking: compare each answer embedding with the question
  // embedding, then blend with votes. Missing vectors score 0 (votes only).
  if (answers.length > 0) {
    const aiScores = await computeAnswerAiScores(
      questionRow.question_id,
      answers.map(answer => answer.id),
    );
    answers.forEach(answer => {
      const score = Math.max(0, aiScores.get(answer.id) ?? 0);
      answer.aiScore = score;
      if (!answer.aiGrade) {
        answer.aiGrade = gradeFromScore(score);
      }
    });
    rankAnswers(answers);
  }

  return {
    question: {
      id: questionRow.question_id,
      questionHash: questionRow.question_hash,
      title: questionRow.title,
      content: questionRow.content,
      answerCount: total,
      createdAt: questionRow.created_at,
      updatedAt: questionRow.updated_at,
      author: {
        id: questionRow.user_id,
        firstName: questionRow.first_name,
        lastName: questionRow.last_name,
        role: questionRow.role || 'user',
      },
    },
    answers,
    answersMeta: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total > 0 ? Math.ceil(total / safeLimit) : 0,
    },
  };
};

/**
 * Forum-wide summary counts for the user dashboard.
 *
 * @param {Object} input
 * @param {number} input.userId - Authenticated user id.
 * @returns {Promise<Object>} `{ totalQuestions, totalReplies, answeredQuestions, myQuestions }`.
 */
export const getDashboardStatsService = async ({ userId }) => {
  const [totalQuestions] = await safeExecute(
    'SELECT COUNT(*) AS n FROM questions',
    [],
  );
  const [totalReplies] = await safeExecute('SELECT COUNT(*) AS n FROM answers', []);
  const [answeredQuestions] = await safeExecute(
    'SELECT COUNT(DISTINCT question_id) AS n FROM answers',
    [],
  );
  const [myQuestions] = await safeExecute(
    'SELECT COUNT(*) AS n FROM questions WHERE user_id = ?',
    [userId],
  );

  return {
    totalQuestions: Number(totalQuestions.n) || 0,
    totalReplies: Number(totalReplies.n) || 0,
    answeredQuestions: Number(answeredQuestions.n) || 0,
    myQuestions: Number(myQuestions.n) || 0,
  };
};

/**
 * Performs semantic search over stored question embeddings.
 *
 * @param {Object} input
 * @param {string} input.query - Search text (min 5 chars).
 * @param {number} [input.k] - Max results.
 * @param {number} [input.threshold] - Minimum cosine score.
 * @returns {Promise<Object>} `{ data, meta }`.
 */
export const searchQuestionsSemanticService = async ({
  query,
  k = SEMANTIC_SEARCH_K,
  threshold = SEMANTIC_SEARCH_THRESHOLD,
}) => {
  const queryVector = await embedText(query, 'RETRIEVAL_QUERY');

  const vectorSql =
    "SELECT question_id, embedding FROM question_vectors WHERE status = 'ready'";
  const vectorRows = await safeExecute(vectorSql, []);

  const scored = vectorRows
    .map(row => ({
      questionId: row.question_id,
      score: cosineSimilarity(queryVector, parseEmbedding(row.embedding)),
    }))
    .filter(item => item.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  console.log(
    `[Semantic search] vectors=${vectorRows.length} queryDim=${queryVector.length} threshold=${threshold} k=${k} topScores=${scored
      .slice(0, 5)
      .map(item => item.score.toFixed(4))
      .join(', ')}`,
  );

  const data = await hydrateQuestionDetails(scored.map(item => item.questionId));
  const scoreById = new Map(scored.map(item => [item.questionId, item.score]));

  return {
    data: data.map(question => ({
      ...question,
      score: scoreById.get(question.id) ?? 0,
    })),
    meta: {
      total: data.length,
      k,
      threshold,
      query,
      questionHash: null,
    },
  };
};

/**
 * Finds questions similar to the given one using its stored embedding.
 *
 * @param {Object} input
 * @param {string} input.questionHash - Source question hash.
 * @param {number} [input.k] - Max results.
 * @param {number} [input.threshold] - Minimum cosine score.
 * @returns {Promise<Object>} `{ data, meta }`.
 * @throws {NotFoundError} When the source question does not exist.
 */
export const getSimilarQuestionsService = async ({
  questionHash,
  k = RECOMMEND_K,
  threshold = RECOMMEND_THRESHOLD,
}) => {
  const sourceSql = `
    SELECT q.question_id, qv.embedding
    FROM questions q
    JOIN question_vectors qv ON qv.question_id = q.question_id
    WHERE q.question_hash = ?
    LIMIT 1
  `;
  const sourceRows = await safeExecute(sourceSql, [questionHash]);

  if (sourceRows.length === 0) {
    throw new NotFoundError('Question not found');
  }

  const sourceId = sourceRows[0].question_id;
  const sourceVector = parseEmbedding(sourceRows[0].embedding);

  if (sourceVector.length === 0) {
    return { data: [], meta: { total: 0, k, threshold, query: null, questionHash } };
  }

  const vectorSql =
    "SELECT question_id, embedding FROM question_vectors WHERE status = 'ready' AND question_id <> ?";
  const vectorRows = await safeExecute(vectorSql, [sourceId]);

  const scored = vectorRows
    .map(row => ({
      questionId: row.question_id,
      score: cosineSimilarity(sourceVector, parseEmbedding(row.embedding)),
    }))
    .filter(item => item.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  const data = await hydrateQuestionDetails(scored.map(item => item.questionId));
  const scoreById = new Map(scored.map(item => [item.questionId, item.score]));

  return {
    data: data.map(question => ({
      ...question,
      score: scoreById.get(question.id) ?? 0,
    })),
    meta: {
      total: data.length,
      k,
      threshold,
      query: null,
      questionHash,
    },
  };
};