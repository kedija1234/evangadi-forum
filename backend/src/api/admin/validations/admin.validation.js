import { param, body } from 'express-validator';
import { validationErrorHandler } from '../../../middleware/validation-handler.js';

const idParam = (name, label) => [
  param(name)
    .notEmpty()
    .withMessage(`${label} is required`)
    .isInt({ min: 1 })
    .withMessage(`${label} must be a positive integer`),
];

export const userIdParamValidation = idParam('userId', 'userId');
export const questionIdParamValidation = idParam(
  'questionId',
  'questionId',
);
export const answerIdParamValidation = idParam('answerId', 'answerId');
export const documentIdParamValidation = idParam(
  'documentId',
  'documentId',
);

/**
 * Validates the body of the role-change endpoint. The `owner` role is
 * reserved for the site super-user and can only be assigned (or revoked)
 * by another owner — handled in the service layer.
 */
export const updateUserRoleValidation = [
  ...userIdParamValidation,
  body('role')
    .notEmpty()
    .withMessage('role is required')
    .isIn(['admin', 'user', 'owner'])
    .withMessage('role must be "admin", "user", or "owner"'),
  validationErrorHandler,
];

export const updateUserStatusValidation = [
  ...userIdParamValidation,
  body('isActive')
    .notEmpty()
    .withMessage('isActive is required')
    .isBoolean()
    .withMessage('isActive must be a boolean'),
  validationErrorHandler,
];

export const resetUserPasswordValidation = [
  ...userIdParamValidation,
  body('newPassword')
    .notEmpty()
    .withMessage('New password is required')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/[A-Z]/)
    .withMessage('Password must include at least one capital letter')
    .matches(/[a-z]/)
    .withMessage('Password must include at least one lowercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must include at least one number')
    .matches(/[^A-Za-z0-9]/)
    .withMessage('Password must include at least one special character'),
  validationErrorHandler,
];

export const deleteQuestionValidation = [
  ...questionIdParamValidation,
  validationErrorHandler,
];

export const deleteAnswerValidation = [
  ...answerIdParamValidation,
  validationErrorHandler,
];

export const deleteDocumentValidation = [
  ...documentIdParamValidation,
  validationErrorHandler,
];

export const deleteUserValidation = [
  ...userIdParamValidation,
  validationErrorHandler,
];