import { StatusCodes } from 'http-status-codes';
import {
  getNotificationsService,
  markNotificationReadService,
  markAllNotificationsReadService,
} from '../service/notification.service.js';

/**
 * GET /api/notifications
 *
 * @param {import('express').Request} req - Express request.
 * @param {import('express').Response} res - Express response.
 * @param {import('express').NextFunction} next - Express next.
 */
export const getNotificationsController = async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 30;
    const data = await getNotificationsService({
      userId: req.user.id,
      limit,
    });

    res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/notifications/:notificationId/read
 *
 * @param {import('express').Request} req - Express request.
 * @param {import('express').Response} res - Express response.
 * @param {import('express').NextFunction} next - Express next.
 */
export const markNotificationReadController = async (req, res, next) => {
  try {
    const data = await markNotificationReadService({
      userId: req.user.id,
      notificationId: Number(req.params.notificationId),
    });

    res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/notifications/read-all
 *
 * @param {import('express').Request} req - Express request.
 * @param {import('express').Response} res - Express response.
 * @param {import('express').NextFunction} next - Express next.
 */
export const markAllNotificationsReadController = async (req, res, next) => {
  try {
    const data = await markAllNotificationsReadService({
      userId: req.user.id,
    });

    res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};