import express from 'express';
import {
  registerController,
  loginController,
  getCurrentUserController,
} from '../controller/auth.controller.js';
import { authenticateUser } from '../../../middleware/authentication.js';
import {
  registerValidation,
  loginValidation,
} from '../validations/auth.validation.js';

const router = express.Router();

/**
 * @route POST /api/auth/register
 * @desc Register a new user
 * @access Public
 */
router.post('/register', registerValidation, registerController);

/**
 * @route POST /api/auth/login
 * @desc Authenticate user and get token
 * @access Public
 */
router.post('/login', loginValidation, loginController);

/**
 * @route GET /api/auth/me
 * @desc Refresh the session user from the DB (prefers the live role over
 *       the role encoded in the JWT at login time).
 * @access Protected
 */
router.get('/me', authenticateUser, getCurrentUserController);

export default router;
