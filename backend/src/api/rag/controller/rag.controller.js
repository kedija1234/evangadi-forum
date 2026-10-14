import { StatusCodes } from 'http-status-codes';
import {
  createDocumentFromUploadService,
  listDocumentsForUserService,
  getDocumentMetaService,
  deleteDocumentService,
  searchInDocumentService,
  queryDocumentService,
  assertOwnedDocument,
  resolveStoragePath,
} from '../service/rag.service.js';
import { BadRequestError } from '../../../utils/errors/index.js';

/**
 * POST /api/rag/documents
 * Uploads and processes a PDF document.
 */
export const createDocumentController = async (req, res, next) => {
  try {
    if (!req.file) {
      throw new BadRequestError('A PDF file is required');
    }

    const document = await createDocumentFromUploadService({
      file: req.file,
      userId: req.user.id,
    });

    res.status(StatusCodes.CREATED).json({
      success: true,
      message: 'Document uploaded and processed.',
      data: document,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/rag/documents
 * Lists the authenticated user's documents.
 */
export const listDocumentsController = async (req, res, next) => {
  try {
    const documents = await listDocumentsForUserService(req.user.id);

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Documents fetched successfully.',
      data: documents,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/rag/documents/:documentId
 * Returns metadata for a single owned document.
 */
export const getDocumentMetaController = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const document = await getDocumentMetaService(documentId, req.user.id);

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Document fetched successfully.',
      data: document,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/rag/documents/:documentId/file
 * Streams the raw PDF back to the client.
 */
export const getDocumentFileController = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const document = await assertOwnedDocument(documentId, req.user.id);
    const absolutePath = resolveStoragePath(document.storage_path);

    res
      .status(StatusCodes.OK)
      .type(document.mime_type || 'application/pdf')
      .sendFile(absolutePath);
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/rag/documents/:documentId
 * Deletes a document record and its PDF file.
 */
export const deleteDocumentController = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const data = await deleteDocumentService(documentId, req.user.id);

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Document deleted successfully.',
      data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/rag/documents/:documentId/search
 * Semantic search over a document's chunks.
 */
export const searchInDocumentController = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { query, k } = req.query;

    const data = await searchInDocumentService({
      documentId,
      query,
      k: k === undefined ? undefined : Number(k),
      userId: req.user.id,
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Ranked chunk excerpts',
      data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/rag/documents/:documentId/query
 * AI answer grounded in the document's content.
 */
export const queryDocumentController = async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { query } = req.body;

    const data = await queryDocumentService({
      documentId,
      query,
      userId: req.user.id,
    });

    res.status(StatusCodes.OK).json({
      success: true,
      message: 'Answer and citations',
      data,
    });
  } catch (error) {
    next(error);
  }
};