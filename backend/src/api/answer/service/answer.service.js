import { safeExecute } from '../../../../db/config.js';
import {
  embedText,
  recommendAnswerGrade,
} from '../../../services/gemini.service.js';
import { BadRequestError, NotFoundError } from '../../../utils/errors/index.js';

/** Queries the up/down tallies + current user's vote for one answer. */
async function fetchVoteSummary(answerId, userId) {
  const summarySql = `
    SELECT
      COALESCE(SUM(vote = 1), 0) AS upVotes,
      COALESCE(SUM(vote = -1), 0) AS downVotes,
      COALESCE(SUM(vote), 0) AS voteCount
    FROM answer_votes
    WHERE answer_id = ?
  `;
  const [summaryRow] = await safeExecute(summarySql, [answerId]);

  const mineSql = `
    SELECT vote FROM answer_votes
    WHERE answer_id = ? AND user_id = ?
    LIMIT 1
  `;
  const mineRows = await safeExecute(mineSql, [answerId, userId]);

  return {
    voteCount: Number(summaryRow?.voteCount) || 0,
    upVotes: Number(summaryRow?.upVotes) || 0,
    downVotes: Number(summaryRow?.downVotes) || 0,
    myVote: Number(mineRows[0]?.vote) || 0,
  };
}

/**
 * Creates an answer for a question, blocking users from answering their own.
 *
 * @param {Object} input
 * @param {number} input.questionId - Target question id.
 * @param {string} input.content - Answer body (min 20 chars).
 * @param {number} input.userId - Authenticated user id.
 * @returns {Promise<Object>} Newly created answer including author info.
 * @throws {NotFoundError} When the question does not exist.
 * @throws {BadRequestError} When the user tries to answer their own question.
 */
export const createAnswerService = async ({ questionId, content, userId }) => {
  const questionSql =
    'SELECT question_id, user_id, title, question_hash FROM questions WHERE question_id = ? LIMIT 1';
  const questionRows = await safeExecute(questionSql, [questionId]);

  if (questionRows.length === 0) {
    throw new NotFoundError('Question not found');
  }

  const ownerId = questionRows[0].user_id;
  if (Number(ownerId) === Number(userId)) {
    throw new BadRequestError('You cannot answer your own question');
  }

  const insertSql =
    'INSERT INTO answers (question_id, user_id, content) VALUES (?, ?, ?)';
  const insertResult = await safeExecute(insertSql, [
    questionId,
    userId,
    content,
  ]);
  const answerId = insertResult.insertId;

  const fetchSql = `
    SELECT
      a.answer_id,
      a.question_id,
      a.content,
      a.created_at,
      a.updated_at,
      u.user_id,
      u.first_name,
      u.last_name,
      u.role
    FROM answers a
    JOIN users u ON u.user_id = a.user_id
    WHERE a.answer_id = ?
    LIMIT 1
  `;
  const answerRows = await safeExecute(fetchSql, [answerId]);
  const row = answerRows[0];

  // Best-effort embedding for AI relevance ranking. A failed embedding does
  // not block the answer; the thread just ranks purely on votes until a
  // vector is available (the same trade-off used for questions).
  const sourceText = row.content;
  try {
    const vector = await embedText(sourceText, 'RETRIEVAL_DOCUMENT');
    const vectorSql =
      'INSERT INTO answer_vectors (answer_id, source_text, embedding, status) VALUES (?, ?, ?, ?)';
    await safeExecute(vectorSql, [answerId, sourceText, JSON.stringify(vector), 'ready']);
  } catch (_error) {
    const vectorSql =
      'INSERT INTO answer_vectors (answer_id, source_text, embedding, status) VALUES (?, ?, ?, ?)';
    await safeExecute(vectorSql, [answerId, sourceText, JSON.stringify([]), 'failed']);
  }

  // Best-effort Gemini recommendation (Good / Moderate / Low), stored as a
  // background update so answer creation stays fast. A failure leaves the
  // grade null and the thread falls back to grading from the AI score.
  const questionContent = questionRows[0].content;
  recommendAnswerGrade(questionContent, sourceText)
    .then(grade => {
      const updateSql =
        'UPDATE answer_vectors SET ai_grade = ? WHERE answer_id = ?';
      return safeExecute(updateSql, [grade, answerId]);
    })
    .catch(error => {
      console.warn(
        `[answer-grades] failed to grade answer ${answerId}: ${error.message}`,
      );
    });

  // Notify the question author that their thread got a reply. Best-effort:
  // a notification failure must never block the answer itself.
  try {
    const authorName = [row.first_name, row.last_name].filter(Boolean).join(' ');
    const title = String(questionRows[0].title || 'your question').slice(0, 60);
    const message = `${authorName || 'Someone'} answered your question: ${title}`;
    const notifySql = `
      INSERT INTO notifications (user_id, type, message, question_id, question_hash)
      VALUES (?, 'answer_added', ?, ?, ?)
    `;
    await safeExecute(notifySql, [
      ownerId,
      message.slice(0, 500),
      questionId,
      questionRows[0].question_hash,
    ]);
  } catch (error) {
    console.warn(
      `[notifications] failed to notify question ${questionId}: ${error.message}`,
    );
  }

  return {
    id: row.answer_id,
    questionId: row.question_id,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    voteCount: 0,
    upVotes: 0,
    downVotes: 0,
    myVote: 0,
    aiGrade: null,
    author: {
      id: row.user_id,
      firstName: row.first_name,
      lastName: row.last_name,
      role: row.role || 'user',
    },
  };
};

/**
 * Sets, changes, or removes the authenticated user's vote on an answer.
 *
 * Accepted votes: 1 = up, -1 = down, 0 = remove existing vote.
 *
 * @param {Object} input
 * @param {number} input.answerId - Target answer id.
 * @param {number} input.userId - Authenticated user id.
 * @param {number} input.vote - 1, -1, or 0.
 * @returns {Promise<Object>} `{ voteCount, myVote }`.
 * @throws {NotFoundError} When the answer does not exist.
 */
export const voteAnswerService = async ({ answerId, userId, vote }) => {
  const answerSql =
    'SELECT answer_id FROM answers WHERE answer_id = ? LIMIT 1';
  const answerRows = await safeExecute(answerSql, [answerId]);

  if (answerRows.length === 0) {
    throw new NotFoundError('Answer not found');
  }

  if (vote === 0) {
    await safeExecute(
      'DELETE FROM answer_votes WHERE answer_id = ? AND user_id = ?',
      [answerId, userId],
    );
  } else {
    const upsertSql = `
      INSERT INTO answer_votes (user_id, answer_id, vote)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE vote = ?
    `;
    await safeExecute(upsertSql, [userId, answerId, vote, vote]);
  }

  return fetchVoteSummary(answerId, userId);
};