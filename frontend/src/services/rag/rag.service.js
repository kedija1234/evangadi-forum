import { apiClient } from '../core/api.client.js';

/**
 * Lists the authenticated user's documents.
 */
async function listDocuments() {
  const response = await apiClient.get('/api/rag/documents');
  return response.data;
}

/**
 * Uploads a PDF document.
 * @param {File} file - PDF file.
 * @param {(progress: number) => void} [onProgress] - Optional upload progress callback (0-100).
 */
async function uploadPdf(file, onProgress) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiClient.post('/api/rag/documents', formData, {
    // Let the browser attach the correct multipart boundary.
    headers: { 'Content-Type': undefined },
    // Processing embeds every chunk (with quota-retry backoff), which can
    // exceed the default 10s timeout — allow up to 3 minutes.
    timeout: 180000,
    onUploadProgress: progressEvent => {
      if (typeof onProgress === 'function' && progressEvent.total) {
        onProgress(Math.round((progressEvent.loaded * 100) / progressEvent.total));
      }
    },
  });
  return response.data;
}

/**
 * Deletes a document.
 * @param {number} documentId
 */
async function deleteDocument(documentId) {
  const response = await apiClient.delete(`/api/rag/documents/${documentId}`);
  return response.data;
}

/**
 * Semantic search inside a document.
 * @param {number} documentId
 * @param {string} query
 * @param {{ k?: number }} [options]
 */
async function searchInDocument(documentId, query, options = {}) {
  const response = await apiClient.get(`/api/rag/documents/${documentId}/search`, {
    params: { query, ...options },
    // Query embedding can hit free-tier quota backoff (up to ~60s).
    timeout: 120000,
  });
  return response.data;
}

/**
 * AI query grounded in a document's content.
 * @param {number} documentId
 * @param {string} query
 */
async function queryDocument(documentId, query) {
  const response = await apiClient.post(
    `/api/rag/documents/${documentId}/query`,
    { query },
    {
      // Embedding + generation both sit behind quota backoff — give it room.
      timeout: 120000,
    },
  );
  return response.data;
}

/**
 * Streams a document's PDF and returns a usable object URL.
 * @param {number} documentId
 * @returns {Promise<{ blob: Blob, objectUrl: string }>}
 */
async function fetchPdfObjectUrl(documentId) {
  const response = await apiClient.get(`/api/rag/documents/${documentId}/file`, {
    responseType: 'blob',
  });
  const blob = response.data;
  return { blob, objectUrl: URL.createObjectURL(blob) };
}

/** Service for RAG document API calls. */
export const ragService = {
  listDocuments,
  uploadPdf,
  deleteDocument,
  searchInDocument,
  queryDocument,
  fetchPdfObjectUrl,
};