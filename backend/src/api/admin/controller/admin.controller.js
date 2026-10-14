import { StatusCodes } from 'http-status-codes';
import {
  getAdminStatsService,
  listUsersService,
  updateUserRoleService,
  updateUserStatusService,
  resetUserPasswordService,
  adminDeleteUserService,
  listAllQuestionsService,
  adminDeleteQuestionService,
  listAllAnswersService,
  adminDeleteAnswerService,
  listAllDocumentsService,
  adminDeleteDocumentService,
} from '../service/admin.service.js';

/**
 * GET /api/admin/stats — dashboard summary.
 */
export const getAdminStatsController = async (req, res, next) => {
  try {
    const data = await getAdminStatsService();
    res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/users — list all users.
 */
export const listUsersController = async (req, res, next) => {
  try {
    const data = await listUsersService();
    res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/users/:userId/role — promote/demote a user.
 */
export const updateUserRoleController = async (req, res, next) => {
  try {
    const data = await updateUserRoleService({
      userId: req.params.userId,
      role: req.body.role,
      actorId: req.user.id,
    });
    res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/users/:userId/status — activate/deactivate a user.
 */
export const updateUserStatusController = async (req, res, next) => {
  try {
    const data = await updateUserStatusService({
      userId: req.params.userId,
      isActive: req.body.isActive,
      actorId: req.user.id,
    });
    res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/users/:userId — remove a user permanently.
 */
export const deleteUserController = async (req, res, next) => {
  try {
    const data = await adminDeleteUserService({
      userId: req.params.userId,
      actorId: req.user.id,
    });
    res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/users/:userId/password — reset a user's password.
 */
export const resetUserPasswordController = async (req, res, next) => {
  try {
    const data = await resetUserPasswordService({
      userId: req.params.userId,
      newPassword: req.body.newPassword,
      actorId: req.user.id,
    });
    res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/questions — list all questions.
 */
export const listQuestionsController = async (req, res, next) => {
  try {
    const data = await listAllQuestionsService();
    res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/questions/:questionId — remove any question.
 */
export const deleteQuestionController = async (req, res, next) => {
  try {
    const data = await adminDeleteQuestionService(req.params.questionId);
    res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/answers — list all answers.
 */
export const listAnswersController = async (req, res, next) => {
  try {
    const data = await listAllAnswersService();
    res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/answers/:answerId — remove any answer.
 */
export const deleteAnswerController = async (req, res, next) => {
  try {
    const data = await adminDeleteAnswerService(req.params.answerId);
    res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/documents — list all knowledge-base documents.
 */
export const listDocumentsController = async (req, res, next) => {
  try {
    const data = await listAllDocumentsService();
    res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/documents/:documentId — remove any document.
 */
export const deleteDocumentController = async (req, res, next) => {
  try {
    const data = await adminDeleteDocumentService(req.params.documentId);
    res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};