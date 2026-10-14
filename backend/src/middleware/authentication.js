import jwt from 'jsonwebtoken';
import {
  UnauthenticatedError,
  ForbiddenError,
} from '../utils/errors/index.js';
import { safeExecute } from '../../db/config.js';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

export const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthenticatedError('Authentication invalid');
    }

    const token = authHeader.split(' ')[1];
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (error) {
      throw new UnauthenticatedError('Authentication invalid');
    }

    // Enforce live account status so an auto-banned (deactivated) user is cut
    // off immediately, not just at their next login.
    const rows = await safeExecute(
      'SELECT is_active FROM users WHERE user_id = ? LIMIT 1',
      [payload.id],
    );
    if (rows.length === 0 || Number(rows[0].is_active) !== 1) {
      throw new UnauthenticatedError(
        'Your account has been deactivated. Contact an administrator.',
      );
    }

    req.user = {
      id: payload.id,
      firstName: payload.firstName,
      lastName: payload.lastName,
      role: payload.role || 'user',
    };
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Route guard for admin/owner endpoints. Must run after {@link authenticateUser}.
 * The `owner` role is the site super-user and inherits every admin ability.
 */
export const authorizeAdmin = (req, res, next) => {
  const role = req.user?.role;
  if (role !== 'admin' && role !== 'owner') {
    throw new ForbiddenError('Admin access required');
  }
  next();
};

/**
 * Route guard for owner-only endpoints (e.g. permanently removing users and
 * promoting to admin). Must run after {@link authenticateUser}.
 */
export const authorizeOwner = (req, res, next) => {
  if (req.user?.role !== 'owner') {
    throw new ForbiddenError('Owner access required');
  }
  next();
};
