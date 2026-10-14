import { apiClient } from '../core/api.client.js';

/**
 * Fetches the current user's notifications + unread count.
 * @param {{ limit?: number }} [params]
 */
async function getNotifications({ limit = 30 } = {}) {
  const response = await apiClient.get('/api/notifications', {
    params: { limit },
  });
  return response.data.data;
}

/**
 * Marks a single notification as read.
 * @param {number} notificationId
 */
async function markRead(notificationId) {
  const response = await apiClient.post(
    `/api/notifications/${notificationId}/read`,
  );
  return response.data.data;
}

/** Marks every notification of the current user as read. */
async function markAllRead() {
  const response = await apiClient.post('/api/notifications/read-all');
  return response.data.data;
}

/** Service for notification-related API calls. */
export const notificationService = {
  getNotifications,
  markRead,
  markAllRead,
};