import { apiClient } from '../core/api.client.js';

/**
 * Posts an answer to a question.
 * @param {number} questionId
 * @param {string} content
 */
async function postAnswer(questionId, content) {
  const response = await apiClient.post('/api/answers', { questionId, content });
  return response.data;
}

/**
 * Votes on an answer: 1 = up, -1 = down, 0 = remove my vote.
 * @param {number} answerId
 * @param {-1 | 0 | 1} vote
 */
async function voteAnswer(answerId, vote) {
  const response = await apiClient.post(`/api/answers/${answerId}/vote`, { vote });
  return response.data;
}

/** Service for answer-related API calls. */
export const answerService = {
  postAnswer,
  voteAnswer,
};