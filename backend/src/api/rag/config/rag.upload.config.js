/**
 * multer configuration for RAG PDF uploads.
 * Files are stored under `RAG_UPLOAD_DIR/<userId>/<timestamp>-<random>.pdf`.
 */
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { BadRequestError } from '../../../utils/errors/index.js';

const RAG_UPLOAD_DIR = process.env.RAG_UPLOAD_DIR || 'uploads/rag';
const RAG_MAX_UPLOAD_MB = Number(process.env.RAG_MAX_UPLOAD_MB) || 5;
const MAX_FILE_BYTES = RAG_MAX_UPLOAD_MB * 1024 * 1024;

/** Absolute path of the configured upload directory. */
export const UPLOAD_ROOT = path.resolve(process.cwd(), RAG_UPLOAD_DIR);

// Ensure the upload root exists on startup.
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

/** Safe filename: keeps the extension only, avoiding path tricks. */
function safeExtension(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  return ext === '.pdf' ? '.pdf' : '.pdf';
}

/**
 * Stores uploaded file at `<UPLOAD_ROOT>/<userId>/<millis>-<random><ext>`
 * and returns the user-relative path (used as `storage_path`).
 */
const pdfStorage = multer.diskStorage({
  destination(req, _file, cb) {
    const userDir = path.join(UPLOAD_ROOT, String(req.user.id));
    fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename(req, file, cb) {
    const random = Math.random().toString(36).slice(2, 10);
    const name = `${Date.now()}-${random}${safeExtension(file)}`;
    req.storagePath = `${req.user.id}/${name}`;
    cb(null, name);
  },
});

export const ragUpload = multer({
  storage: pdfStorage,
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: 1,
  },
  fileFilter(req, file, cb) {
    if (file.mimetype !== 'application/pdf' && safeExtension(file) !== '.pdf') {
      return cb(
        new BadRequestError('Only PDF files are allowed'),
      );
    }
    cb(null, true);
  },
});

/**
 * Express-style error middleware for multer upload errors. Returns a clean 400
 * instead of an unhandled exception (e.g. file too large).
 */
export const createDocumentMulterErrorHandler = (err, _req, _res, next) => {
  if (!err) return next();

  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return next(
      new BadRequestError(
        `File is too large. Maximum allowed size is ${RAG_MAX_UPLOAD_MB}MB.`,
      ),
    );
  }

  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_COUNT') {
    return next(new BadRequestError('Only one file can be uploaded at a time'));
  }

  return next(err);
};