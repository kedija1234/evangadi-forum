import express from 'express';
import {
  authenticateUser,
  authorizeAdmin,
  authorizeOwner,
} from '../../../middleware/authentication.js';
import {
  getAdminStatsController,
  listUsersController,
  updateUserRoleController,
  updateUserStatusController,
  resetUserPasswordController,
  deleteUserController,
  listQuestionsController,
  deleteQuestionController,
  listAnswersController,
  deleteAnswerController,
  listDocumentsController,
  deleteDocumentController,
} from '../controller/admin.controller.js';
import {
  updateUserRoleValidation,
  updateUserStatusValidation,
  resetUserPasswordValidation,
  deleteUserValidation,
  deleteQuestionValidation,
  deleteAnswerValidation,
  deleteDocumentValidation,
} from '../validations/admin.validation.js';

const router = express.Router();

// Every admin route requires an authenticated admin/owner session.
router.use(authenticateUser, authorizeAdmin);

router.get('/stats', getAdminStatsController);

router.get('/users', listUsersController);
router.patch('/users/:userId/role', updateUserRoleValidation, updateUserRoleController);
router.patch('/users/:userId/status', updateUserStatusValidation, updateUserStatusController);
router.patch('/users/:userId/password', resetUserPasswordValidation, resetUserPasswordController);
// Owner-only: permanently removing a member from the forum.
router.delete('/users/:userId', authorizeOwner, deleteUserValidation, deleteUserController);

router.get('/questions', listQuestionsController);
router.delete(
  '/questions/:questionId',
  deleteQuestionValidation,
  deleteQuestionController,
);

router.get('/answers', listAnswersController);
router.delete('/answers/:answerId', deleteAnswerValidation, deleteAnswerController);

router.get('/documents', listDocumentsController);
router.delete(
  '/documents/:documentId',
  deleteDocumentValidation,
  deleteDocumentController,
);

export default router;