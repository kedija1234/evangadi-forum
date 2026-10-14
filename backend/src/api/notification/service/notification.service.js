import { safeExecute } from '../../../../db/config.js';

/**
 * Lists a user's notifications (newest first) plus the unread count so the
 * UI can show a badge without a second round trip.
 *
 * @param {Object} input
 * @param {number} input.userId - Authenticated user id (recipient).
 * @param {number} [input.limit] - Max rows to return.
 * @returns {Promise<Object>} `{ notifications, unreadCount }`.
 */
export const getNotificationsService = async ({ userId, limit = 30 }) => {
  const limitN = Number.isFinite(Number(limit)) ? Math.min(Math.max(Number(limit), 1), 100) : 30;

  const listSql = `
    SELECT
      notification_id,
      type,
      message,
      question_id,
      question_hash,
      is_read,
      created_at
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC, notification_id DESC
    LIMIT ?
  `;
  const rows = await safeExecute(listSql, [userId, limitN]);

  const countSql =
    'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0';
  const countRows = await safeExecute(countSql, [userId]);

  const notifications = rows.map(row => ({
    id: row.notification_id,
    type: row.type,
    message: row.message,
    questionId: row.question_id,
    questionHash: row.question_hash,
    isRead: Boolean(Number(row.is_read)),
    createdAt: row.created_at,
  }));

  return {
    notifications,
    unreadCount: Number(countRows[0]?.count) || 0,
  };
};

/**
 * Marks a single notification as read. Only the recipient can mark it.
 *
 * @param {Object} input
 * @param {number} input.userId - Authenticated user id.
 * @param {number} input.notificationId - Notification id.
 * @returns {Promise<{ isRead: boolean }>}
 */
export const markNotificationReadService = async ({
  userId,
  notificationId,
}) => {
  const sql =
    'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND notification_id = ?';
  await safeExecute(sql, [userId, notificationId]);
  return { isRead: true };
};

/**
 * Marks every notification of a user as read.
 *
 * @param {Object} input
 * @param {number} input.userId - Authenticated user id.
 * @returns {Promise<{ success: boolean }>}
 */
export const markAllNotificationsReadService = async ({ userId }) => {
  const sql = 'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0';
  await safeExecute(sql, [userId]);
  return { success: true };
};