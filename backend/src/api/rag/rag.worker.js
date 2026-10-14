/**
 * Background worker for RAG document processing. Runs in its own process so
 * CPU-heavy PDF parsing and long Gemini quota retries never block the API
 * server's event loop. Processes jobs sequentially as they arrive.
 */
import { processDocumentJob } from './service/rag.service.js';

let jobQueue = Promise.resolve();

/**
 * Runs one document job and reports the terminal state back to the parent.
 *
 * @param {number} documentId - Document id to process.
 * @returns {Promise<void>}
 */
async function runJob(documentId) {
  try {
    const finalRow = await processDocumentJob(documentId);
    process.send({
      type: 'done',
      documentId,
      status: finalRow?.status,
      errorMessage: finalRow?.error_message,
    });
  } catch (error) {
    process.send({
      type: 'done',
      documentId,
      status: 'failed',
      errorMessage: error.message,
    });
  }
}

process.on('message', message => {
  if (message?.type !== 'process') return;
  jobQueue = jobQueue
    .then(() => runJob(message.documentId))
    .catch(error => {
      console.error('RAG worker job error:', error.message);
    });
});

process.on('disconnect', () => {
  process.exit(0);
});