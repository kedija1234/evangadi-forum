import { body, param } from 'express-validator';
import { validationErrorHandler } from '../../../middleware/validation-handler.js';

/**
 * POST /api/answers
 */
export const createAnswerValidation = [
  body('questionId')
    .notEmpty()
    .withMessage('questionId is required')
    .isInt({ min: 1 })
    .withMessage('questionId must be a positive integer'),
  body('content')
    .notEmpty()
    .withMessage('Content is required')
    .isString()
    .withMessage('Content must be a string')
    .isLength({ min: 20 })
    .withMessage('Content must be at least 20 characters long'),

  validationErrorHandler,
];

/**
 * POST /api/answers/:answerId/vote
 */
export const voteAnswerValidation = [
  param('answerId')
    .isInt({ min: 1 })
    .withMessage('answerId must be a positive integer'),
  body('vote')
    .isIn([-1, 0, 1])
    .withMessage('vote must be -1 (down), 0 (remove), or 1 (up)'),

  validationErrorHandler,
];