import { apiClient } from '../core/api.client.js';

async function getStats() {
  const response = await apiClient.get('/api/admin/stats');
  return response.data.data;
}

async function getUsers() {
  const response = await apiClient.get('/api/admin/users');
  return response.data.data;
}

async function updateUserRole(userId, role) {
  const response = await apiClient.patch(`/api/admin/users/${userId}/role`, {
    role,
  });
  return response.data.data;
}

async function updateUserStatus(userId, isActive) {
  const response = await apiClient.patch(
    `/api/admin/users/${userId}/status`,
    { isActive },
  );
  return response.data.data;
}

async function resetUserPassword(userId, newPassword) {
  const response = await apiClient.patch(
    `/api/admin/users/${userId}/password`,
    { newPassword },
  );
  return response.data.data;
}

async function deleteUser(userId) {
  const response = await apiClient.delete(`/api/admin/users/${userId}`);
  return response.data.data;
}

async function getQuestions() {
  const response = await apiClient.get('/api/admin/questions');
  return response.data.data;
}

async function deleteQuestion(questionId) {
  const response = await apiClient.delete(
    `/api/admin/questions/${questionId}`,
  );
  return response.data.data;
}

async function getAnswers() {
  const response = await apiClient.get('/api/admin/answers');
  return response.data.data;
}

async function deleteAnswer(answerId) {
  const response = await apiClient.delete(`/api/admin/answers/${answerId}`);
  return response.data.data;
}

async function getDocuments() {
  const response = await apiClient.get('/api/admin/documents');
  return response.data.data;
}

async function deleteDocument(documentId) {
  const response = await apiClient.delete(
    `/api/admin/documents/${documentId}`,
  );
  return response.data.data;
}

export const adminService = {
  getStats,
  getUsers,
  updateUserRole,
  updateUserStatus,
  resetUserPassword,
  deleteUser,
  getQuestions,
  deleteQuestion,
  getAnswers,
  deleteAnswer,
  getDocuments,
  deleteDocument,
};