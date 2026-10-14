import bcrypt from 'bcryptjs';
import { db, safeExecute } from '../../../../db/config.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../../../utils/errors/index.js';
import { resolveStoragePath } from '../../rag/service/rag.service.js';

/**
 * Maps a user row to the admin-facing user shape with content counts.
 */
function mapAdminUser(row) {
  return {
    id: row.user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    role: row.role,
    isActive: Number(row.is_active) === 1,
    questionCount: Number(row.question_count) || 0,
    answerCount: Number(row.answer_count) || 0,
    documentCount: Number(row.document_count) || 0,
    createdAt: row.created_at,
  };
}

/**
 * Dashboard summary counts for the admin home screen.
 */
export const getAdminStatsService = async () => {
  const [[users], [questions], [answers], [documents]] =
    await Promise.all([
      db.query('SELECT COUNT(*) AS n FROM users'),
      db.query('SELECT COUNT(*) AS n FROM questions'),
      db.query('SELECT COUNT(*) AS n FROM answers'),
      db.query('SELECT COUNT(*) AS n FROM documents'),
    ]);

  const [recentSql] = await db.query(`
    SELECT 'question' AS type, q.question_id AS id, q.title AS label,
           u.first_name, u.last_name, q.created_at
    FROM questions q JOIN users u ON u.user_id = q.user_id
    ORDER BY q.created_at DESC LIMIT 8
  `);

  return {
    counts: {
      users: users[0].n,
      questions: questions[0].n,
      answers: answers[0].n,
      documents: documents[0].n,
    },
    recentActivity: recentSql,
  };
};

/**
 * Lists all users with per-user content counts.
 */
export const listUsersService = async () => {
  const sql = `
    SELECT
      u.user_id, u.first_name, u.last_name, u.email, u.role, u.is_active, u.created_at,
      (SELECT COUNT(*) FROM questions q WHERE q.user_id = u.user_id) AS question_count,
      (SELECT COUNT(*) FROM answers a WHERE a.user_id = u.user_id) AS answer_count,
      (SELECT COUNT(*) FROM documents d WHERE d.user_id = u.user_id) AS document_count
    FROM users u
    ORDER BY u.created_at DESC
  `;
  const rows = await safeExecute(sql, []);
  return rows.map(mapAdminUser);
};

/**
 * Updates a user's role (`admin`, `user`, or `owner`).
 *
 * Permission model:
 *  - Admins may only promote `user` → `admin`; demoting an admin back to
 *    `user` is owner-only.
 *  - The `owner` role may only be granted by an existing owner — except that
 *    when the forum has no owner yet, any active admin may bootstrap it.
 *  - Only the owner may change another owner's role; the last remaining owner
 *    can never be demoted, protecting the forum.
 */
export const updateUserRoleService = async ({ userId, role, actorId }) => {
  if (!['admin', 'user', 'owner'].includes(role)) {
    throw new BadRequestError('role must be "admin", "user", or "owner"');
  }

  const targetId = Number(userId);
  if (targetId === Number(actorId)) {
    throw new BadRequestError('You cannot change your own role');
  }

  const actorRows = await safeExecute(
    'SELECT user_id, role FROM users WHERE user_id = ? AND is_active = 1 LIMIT 1',
    [Number(actorId)],
  );
  if (actorRows.length === 0) {
    throw new NotFoundError('Actor account not found');
  }
  const actorRole = actorRows[0].role;

  const ownerCountRows = await safeExecute(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND is_active = 1",
    [],
  );
  const ownerCount = Number(ownerCountRows[0]?.n) || 0;

  // Actors must hold admin or owner to change roles at all.
  if (actorRole !== 'owner' && actorRole !== 'admin') {
    throw new ForbiddenError('Admin access required to change roles');
  }

  // Granting `owner` is reserved for an existing owner — except bootstrap:
  // with no owner yet, any active admin may assign the first owner.
  if (role === 'owner' && actorRole !== 'owner') {
    if (ownerCount > 0) {
      throw new ForbiddenError('Only an existing owner can assign the owner role');
    }
  }

  const rows = await safeExecute(
    'SELECT user_id, role FROM users WHERE user_id = ? LIMIT 1',
    [targetId],
  );
  if (rows.length === 0) {
    throw new NotFoundError(`User ${targetId} not found`);
  }
  const targetRole = rows[0].role;

  // Admins may only promote users to admin — demoting an admin is owner-only.
  if (actorRole === 'admin' && targetRole === 'admin' && role !== 'admin') {
    throw new ForbiddenError('Only the owner can demote an admin');
  }

  // Only the owner may change another owner's role (admins cannot touch owners).
  if (targetRole === 'owner' && actorRole !== 'owner' && role !== 'owner') {
    throw new ForbiddenError('Only the owner can demote an owner');
  }

  // Never demote the last remaining owner.
  if (targetRole === 'owner' && ownerCount <= 1 && role !== 'owner') {
    throw new BadRequestError('The last owner cannot be demoted');
  }

  await safeExecute('UPDATE users SET role = ? WHERE user_id = ?', [
    role,
    targetId,
  ]);
  return { id: targetId, role };
};

/**
 * Activates or deactivates a user account.
 *
 * Permission model:
 *  - Admins may deactivate/reactivate regular `user` accounts.
 *  - Only the owner may deactivate/reactivate an admin or another owner,
 *    and the last remaining owner can never be deactivated.
 */
export const updateUserStatusService = async ({
  userId,
  isActive,
  actorId,
}) => {
  const active = Boolean(isActive);

  const targetId = Number(userId);
  if (targetId === Number(actorId)) {
    throw new BadRequestError('You cannot deactivate your own account');
  }

  const actorRows = await safeExecute(
    'SELECT role FROM users WHERE user_id = ? AND is_active = 1 LIMIT 1',
    [Number(actorId)],
  );
  if (actorRows.length === 0) {
    throw new NotFoundError('Actor account not found');
  }
  const actorRole = actorRows[0].role;

  const rows = await safeExecute(
    'SELECT user_id, role FROM users WHERE user_id = ? LIMIT 1',
    [targetId],
  );
  if (rows.length === 0) {
    throw new NotFoundError(`User ${targetId} not found`);
  }
  const targetRole = rows[0].role;

  // Only the owner may deactivate or reactivate an admin or another owner.
  if (
    (targetRole === 'admin' || targetRole === 'owner') &&
    actorRole !== 'owner'
  ) {
    throw new ForbiddenError('Only the owner can change an admin account status');
  }

  // Only the owner may deactivate another owner; never the last one.
  if (targetRole === 'owner' && actorRole !== 'owner') {
    throw new ForbiddenError('Only the owner can deactivate an owner');
  }
  if (targetRole === 'owner' && !active) {
    const ownerCountRows = await safeExecute(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'owner' AND is_active = 1",
      [],
    );
    if (Number(ownerCountRows[0]?.n) <= 1) {
      throw new BadRequestError('The last owner cannot be deactivated');
    }
  }

  await safeExecute('UPDATE users SET is_active = ? WHERE user_id = ?', [
    active ? 1 : 0,
    targetId,
  ]);
  return { id: targetId, isActive: active };
};

/**
 * Resets a user's password to a fresh value chosen by an admin or owner.
 *
 * Permission model:
 *  - Admins may reset passwords for regular `user` accounts.
 *  - The owner may reset the password of any other account (admins and owners).
 *  - No one can reset their own password from this endpoint.
 */
export const resetUserPasswordService = async ({
  userId,
  newPassword,
  actorId,
}) => {
  const targetId = Number(userId);
  if (targetId === Number(actorId)) {
    throw new BadRequestError('You cannot reset your own password');
  }

  const actorRows = await safeExecute(
    'SELECT role FROM users WHERE user_id = ? AND is_active = 1 LIMIT 1',
    [Number(actorId)],
  );
  if (actorRows.length === 0) {
    throw new NotFoundError('Actor account not found');
  }
  const actorRole = actorRows[0].role;

  if (actorRole !== 'admin' && actorRole !== 'owner') {
    throw new ForbiddenError('Admin access required to reset passwords');
  }

  const rows = await safeExecute(
    'SELECT user_id, role FROM users WHERE user_id = ? LIMIT 1',
    [targetId],
  );
  if (rows.length === 0) {
    throw new NotFoundError(`User ${targetId} not found`);
  }
  const targetRole = rows[0].role;

  // Admins may only reset regular user accounts.
  if (actorRole !== 'owner' && targetRole !== 'user') {
    throw new ForbiddenError(
      'Only the owner can reset an admin or owner password',
    );
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(newPassword, salt);
  await safeExecute('UPDATE users SET password_hash = ? WHERE user_id = ?', [
    hashedPassword,
    targetId,
  ]);
  return { id: targetId };
};

/**
 * Permanently deletes a user (cascades to their content).
 */
export const adminDeleteUserService = async ({ userId, actorId }) => {
  const targetId = Number(userId);
  if (targetId === Number(actorId)) {
    throw new BadRequestError('You cannot delete your own account');
  }

  const rows = await safeExecute(
    'SELECT user_id, role FROM users WHERE user_id = ? LIMIT 1',
    [targetId],
  );
  if (rows.length === 0) {
    throw new NotFoundError(`User ${targetId} not found`);
  }

  if (rows[0].role === 'owner') {
    const ownerCountRows = await safeExecute(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'owner'",
      [],
    );
    if (Number(ownerCountRows[0]?.n) <= 1) {
      throw new BadRequestError('The last owner cannot be deleted');
    }
  }

  await safeExecute('DELETE FROM users WHERE user_id = ?', [targetId]);
  return { id: targetId };
};

/**
 * Lists all questions regardless of author.
 */
export const listAllQuestionsService = async () => {
  const sql = `
    SELECT
      q.question_id, q.question_hash, q.title, q.content, q.created_at, q.updated_at,
      u.user_id, u.first_name, u.last_name,
      COUNT(a.answer_id) AS answer_count
    FROM questions q
    JOIN users u ON u.user_id = q.user_id
    LEFT JOIN answers a ON a.question_id = q.question_id
    GROUP BY q.question_id, q.question_hash, q.title, q.content,
             q.created_at, q.updated_at, u.user_id, u.first_name, u.last_name
    ORDER BY q.created_at DESC
  `;
  const rows = await safeExecute(sql, []);
  return rows.map(row => ({
    id: row.question_id,
    questionHash: row.question_hash,
    title: row.title,
    content: row.content,
    answerCount: Number(row.answer_count) || 0,
    createdAt: row.created_at,
    author: {
      id: row.user_id,
      firstName: row.first_name,
      lastName: row.last_name,
    },
  }));
};

/**
 * Deletes any question (cascades answers + question vector).
 */
export const adminDeleteQuestionService = async questionId => {
  const targetId = Number(questionId);
  const rows = await safeExecute(
    'SELECT question_id FROM questions WHERE question_id = ? LIMIT 1',
    [targetId],
  );
  if (rows.length === 0) {
    throw new NotFoundError(`Question ${targetId} not found`);
  }

  await safeExecute('DELETE FROM questions WHERE question_id = ?', [targetId]);
  return { id: targetId };
};

/**
 * Lists all answers regardless of author.
 */
export const listAllAnswersService = async () => {
  const sql = `
    SELECT
      a.answer_id, a.content, a.created_at,
      u.user_id, u.first_name, u.last_name,
      q.question_id, q.title AS question_title, q.question_hash
    FROM answers a
    JOIN users u ON u.user_id = a.user_id
    JOIN questions q ON q.question_id = a.question_id
    ORDER BY a.created_at DESC
  `;
  const rows = await safeExecute(sql, []);
  return rows.map(row => ({
    id: row.answer_id,
    content: row.content,
    createdAt: row.created_at,
    author: {
      id: row.user_id,
      firstName: row.first_name,
      lastName: row.last_name,
    },
    question: {
      id: row.question_id,
      title: row.question_title,
      questionHash: row.question_hash,
    },
  }));
};

/**
 * Deletes any answer.
 */
export const adminDeleteAnswerService = async answerId => {
  const targetId = Number(answerId);
  const rows = await safeExecute(
    'SELECT answer_id FROM answers WHERE answer_id = ? LIMIT 1',
    [targetId],
  );
  if (rows.length === 0) {
    throw new NotFoundError(`Answer ${targetId} not found`);
  }

  await safeExecute('DELETE FROM answers WHERE answer_id = ?', [targetId]);
  return { id: targetId };
};

/**
 * Lists all RAG documents regardless of owner.
 */
export const listAllDocumentsService = async () => {
  const sql = `
    SELECT
      d.document_id, d.title, d.mime_type, d.byte_size, d.status,
      d.error_message, d.created_at,
      u.user_id, u.first_name, u.last_name
    FROM documents d
    JOIN users u ON u.user_id = d.user_id
    ORDER BY d.created_at DESC
  `;
  const rows = await safeExecute(sql, []);
  return rows.map(row => ({
    id: row.document_id,
    title: row.title,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size) || 0,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    owner: {
      id: row.user_id,
      firstName: row.first_name,
      lastName: row.last_name,
    },
  }));
};

/**
 * Deletes any document (unlinks its PDF first).
 */
export const adminDeleteDocumentService = async documentId => {
  const targetId = Number(documentId);
  const rows = await safeExecute(
    'SELECT storage_path FROM documents WHERE document_id = ? LIMIT 1',
    [targetId],
  );
  if (rows.length === 0) {
    throw new NotFoundError(`Document ${targetId} not found`);
  }

  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(resolveStoragePath(rows[0].storage_path));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new BadRequestError(`Failed to delete file: ${error.message}`);
    }
  }

  await safeExecute('DELETE FROM documents WHERE document_id = ?', [targetId]);
  return { id: targetId };
};

