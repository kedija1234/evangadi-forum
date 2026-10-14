import { body, param, query } from 'express-validator';
import { validationErrorHandler } from '../../../middleware/validation-handler.js';

/** Reusable path parameter validation for `/api/rag/documents/:documentId`. */
export const documentIdParamValidation = [
  param('documentId')
    .notEmpty()
    .withMessage('documentId is required')
    .isInt({ min: 1 })
    .withMessage('documentId must be a positive integer'),
  validationErrorHandler,
];

/**
 * GET /api/rag/documents/:documentId/search
 */
export const searchInDocumentValidation = [
  ...documentIdParamValidation,
  query('query')
    .notEmpty()
    .withMessage('query is required')
    .isString()
    .withMessage('query must be a string'),
  query('k')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('k must be an integer between 1 and 50'),
  validationErrorHandler,
];

/**
 * POST /api/rag/documents/:documentId/query
 */
export const queryDocumentValidation = [
  ...documentIdParamValidation,
  body('query')
    .notEmpty()
    .withMessage('query is required')
    .isString()
    .withMessage('query must be a string'),
  validationErrorHandler,
];