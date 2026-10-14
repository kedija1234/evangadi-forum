import express from 'express';
import { authenticateUser } from '../../../middleware/authentication.js';
import { param } from 'express-validator';
import { validationErrorHandler } from '../../../middleware/validation-handler.js';
import {
  getNotificationsController,
  markNotificationReadController,
  markAllNotificationsReadController,
} from '../controller/notification.controller.js';

const router = express.Router();

/**
 * @route GET /api/notifications
 * @desc List the current user's notifications + unread count
 * @access Protected
 */
router.get('/', authenticateUser, getNotificationsController);

/**
 * @route POST /api/notifications/read-all
 * @desc Mark every notification of the current user as read
 * @access Protected
 */
router.post(
  '/read-all',
  authenticateUser,
  markAllNotificationsReadController,
);

/**
 * @route POST /api/notifications/:notificationId/read
 * @desc Mark a single notification as read
 * @access Protected
 */
router.post(
  '/:notificationId/read',
  authenticateUser,
  [
    param('notificationId')
      .isInt({ min: 1 })
      .withMessage('notificationId must be a positive integer'),
    validationErrorHandler,
  ],
  markNotificationReadController,
);

export default router;