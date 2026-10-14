import express from 'express';
import { authenticateUser } from '../../../middleware/authentication.js';
import {
  createAnswerController,
  voteAnswerController,
} from '../controller/answer.controller.js';
import {
  createAnswerValidation,
  voteAnswerValidation,
} from '../validations/answer.validation.js';

const router = express.Router();

/**
 * @route POST /api/answers
 * @desc Post an answer to a question
 * @access Protected
 */
router.post('/', authenticateUser, createAnswerValidation, createAnswerController);

/**
 * @route POST /api/answers/:answerId/vote
 * @desc Upvote / downvote / revoke a vote on an answer
 * @access Protected
 */
router.post(
  '/:answerId/vote',
  authenticateUser,
  voteAnswerValidation,
  voteAnswerController,
);

export default router;