import express from 'express';
import { authenticateUser } from '../../../middleware/authentication.js';
import {
  createQuestionController,
  getQuestionsController,
  getSingleQuestionController,
  searchQuestionsSemanticController,
  getSimilarQuestionsController,
  assessAnswerAgainstQuestionController,
  generateQuestionDraftCoachController,
  generateSuggestedAnswerController,
  getDashboardStatsController,
} from '../controller/question.controller.js';
import {
  createQuestionValidation,
  getQuestionsValidation,
  getSingleQuestionValidation,
  searchQuestionsValidation,
  getSimilarQuestionsValidation,
  assessAnswerFitValidation,
  generateQuestionDraftCoachValidation,
  generateAnswerSuggestionValidation,
} from '../validations/question.validation.js';

const router = express.Router();

// All question routes are protected.
router.use(authenticateUser);

/**
 * @route GET /api/questions
 * @desc List questions (keyword search / mine filters)
 * @access Protected
 */
router.get('/', getQuestionsValidation, getQuestionsController);

/**
 * @route POST /api/questions
 * @desc Create a question + auto-embed
 * @access Protected
 */
router.post('/', createQuestionValidation, createQuestionController);

/**
 * @route POST /api/questions/draft-coach
 * @desc AI draft coach for questions
 * @access Protected
 */
router.post(
  '/draft-coach',
  generateQuestionDraftCoachValidation,
  generateQuestionDraftCoachController,
);

/**
 * @route GET /api/questions/search
 * @desc Semantic search over question embeddings
 * @access Protected
 */
router.get('/search', searchQuestionsValidation, searchQuestionsSemanticController);

/**
 * @route GET /api/questions/stats
 * @desc Dashboard summary counts (total/all/answered/my questions)
 * @access Protected
 */
router.get('/stats', getDashboardStatsController);

/**
 * @route POST /api/questions/:questionHash/answer-fit
 * @desc AI answer fit evaluation
 * @access Protected
 */
router.post(
  '/:questionHash/answer-fit',
  assessAnswerFitValidation,
  assessAnswerAgainstQuestionController,
);

/**
 * @route POST /api/questions/:questionHash/answer-suggest
 * @desc AI-drafted answer suggestion for the question
 * @access Protected
 */
router.post(
  '/:questionHash/answer-suggest',
  generateAnswerSuggestionValidation,
  generateSuggestedAnswerController,
);

/**
 * @route GET /api/questions/:questionHash/similar
 * @desc Similar questions by embedding
 * @access Protected
 */
router.get(
  '/:questionHash/similar',
  getSimilarQuestionsValidation,
  getSimilarQuestionsController,
);

/**
 * @route GET /api/questions/:questionHash
 * @desc Single question with answers
 * @access Protected
 */
router.get(
  '/:questionHash',
  getSingleQuestionValidation,
  getSingleQuestionController,
);

export default router;