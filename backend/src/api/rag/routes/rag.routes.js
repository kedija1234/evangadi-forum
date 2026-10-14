import express from 'express';
import { authenticateUser } from '../../../middleware/authentication.js';
import {
  ragUpload,
  createDocumentMulterErrorHandler,
} from '../config/rag.upload.config.js';
import {
  createDocumentController,
  listDocumentsController,
  getDocumentMetaController,
  getDocumentFileController,
  deleteDocumentController,
  searchInDocumentController,
  queryDocumentController,
} from '../controller/rag.controller.js';
import {
  documentIdParamValidation,
  searchInDocumentValidation,
  queryDocumentValidation,
} from '../validations/rag.validation.js';

const router = express.Router();

// All RAG routes are protected.
router.use(authenticateUser);

/**
 * @route POST /api/rag/documents
 * @desc Upload + process a PDF document
 * @access Protected
 */
router.post(
  '/',
  ragUpload.single('file'),
  createDocumentMulterErrorHandler,
  createDocumentController,
);

/**
 * @route GET /api/rag/documents
 * @desc List my documents
 * @access Protected
 */
router.get('/', listDocumentsController);

/**
 * @route GET /api/rag/documents/:documentId/search
 * @desc Semantic search inside a document
 * @access Protected
 */
router.get(
  '/:documentId/search',
  searchInDocumentValidation,
  searchInDocumentController,
);

/**
 * @route POST /api/rag/documents/:documentId/query
 * @desc AI query grounded in a document
 * @access Protected
 */
router.post(
  '/:documentId/query',
  queryDocumentValidation,
  queryDocumentController,
);

/**
 * @route GET /api/rag/documents/:documentId/file
 * @desc Stream the raw PDF
 * @access Protected
 */
router.get(
  '/:documentId/file',
  documentIdParamValidation,
  getDocumentFileController,
);

/**
 * @route GET /api/rag/documents/:documentId
 * @desc Document metadata
 * @access Protected
 */
router.get(
  '/:documentId',
  documentIdParamValidation,
  getDocumentMetaController,
);

/**
 * @route DELETE /api/rag/documents/:documentId
 * @desc Delete a document
 * @access Protected
 */
router.delete(
  '/:documentId',
  documentIdParamValidation,
  deleteDocumentController,
);

export default router;