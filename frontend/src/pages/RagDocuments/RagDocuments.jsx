/**
 * Knowledge Base: upload private PDFs and interrogate them in three ways —
 * Ask AI (grounded Q&A), Search (semantic chunk ranking), and Preview (PDF reader).
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload,
  FileText,
  Trash2,
  Sparkles,
  Search,
  Eye,
  AlertCircle,
  Inbox,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { ragService } from '../../services/rag/rag.service.js';
import { getErrorMessage } from '../../lib/utils';
import RagAnswerBody from '../../components/RagAnswerBody/RagAnswerBody.jsx';
import ui from '../../styles/pageStates.module.css';
import styles from './RagDocuments.module.css';

const TABS = [
  { id: 'ask', label: 'Ask AI', icon: Sparkles },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'preview', label: 'Preview', icon: Eye },
];

const STATUS_META = {
  ready: { label: 'Ready', className: 'statusReady' },
  processing: { label: 'Processing…', className: 'statusProcessing' },
  failed: { label: 'Failed', className: 'statusFailed' },
};

const VALID_MIME = ['application/pdf'];

export default function RagDocuments() {
  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState(null);

  const [activeTab, setActiveTab] = useState('ask');
  const [selectedId, setSelectedId] = useState(null);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const [uploaded, setUploaded] = useState(null);
  const fileInputRef = useRef(null);

  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const [askQuery, setAskQuery] = useState('');
  const [askResult, setAskResult] = useState(null);
  const [isAsking, setIsAsking] = useState(false);
  const [askError, setAskError] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewName, setPreviewName] = useState('');
  const [previewError, setPreviewError] = useState(null);

  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    setListError(null);
    try {
      const result = await ragService.listDocuments();
      const docs = result.data || [];
      setDocuments(docs);
      setSelectedId(prev =>
        docs.some(doc => doc.document_id === prev)
          ? prev
          : (docs[0]?.document_id ?? null),
      );
    } catch (err) {
      setListError(getErrorMessage(err, 'Failed to load documents.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadDocuments();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDocuments]);

  // Revoke the last object URL so we never leak memory.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const selectedDoc = documents.find(doc => doc.document_id === selectedId) || null;
  const readySelected = selectedDoc?.status === 'ready';

  // While the selected document is being processed in the background, poll
  // its status until it reaches a terminal state (ready | failed).
  const selectedDocId = selectedDoc?.document_id;
  const selectedDocStatus = selectedDoc?.status;
  useEffect(() => {
    if (!selectedDocId || selectedDocStatus !== 'processing') return undefined;

    const timer = window.setInterval(async () => {
      try {
        const result = await ragService.listDocuments();
        const docs = result.data || [];
        setDocuments(docs);
        const updated = docs.find(doc => doc.document_id === selectedDocId);
        if (updated && updated.status !== 'processing') {
          window.clearInterval(timer);
        }
      } catch {
        // Transient failure — keep polling on the next tick.
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [selectedDocId, selectedDocStatus]);

  const handleFileSelect = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!VALID_MIME.includes(file.type)) {
      setUploadError('Only PDF files are accepted.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('PDF must be 5 MB or smaller.');
      return;
    }

    setUploadError(null);
    setUploaded(null);
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const result = await ragService.uploadPdf(file, setUploadProgress);
      setUploaded('Document uploaded. Processing started…');
      await loadDocuments();
      const uploadedId = result.data?.document_id;
      if (uploadedId) setSelectedId(uploadedId);
      setActiveTab('search');
    } catch (err) {
      setUploadError(getErrorMessage(err, 'Upload failed.'));
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDelete = async () => {
    if (!selectedDoc) return;
    if (!window.confirm(`Delete "${selectedDoc.title}"? This cannot be undone.`)) return;

    setDeleteError(null);
    setIsDeleting(true);
    try {
      await ragService.deleteDocument(selectedDoc.document_id);
      const next = documents.filter(doc => doc.document_id !== selectedDoc.document_id);
      setDocuments(next);
      setSelectedId(next[0]?.document_id ?? null);
      setAskResult(null);
      setSearchResult(null);
      setPreviewUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    } catch (err) {
      setDeleteError(getErrorMessage(err, 'Failed to delete the document.'));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAsk = async e => {
    e.preventDefault();
    if (!readySelected) return;
    const query = askQuery.trim();
    if (query.length === 0) return;

    setAskError(null);
    setAskResult(null);
    setIsAsking(true);
    try {
      const result = await ragService.queryDocument(selectedDoc.document_id, query);
      setAskResult(result.data);
    } catch (err) {
      setAskError(getErrorMessage(err, 'AI answer is unavailable right now.'));
    } finally {
      setIsAsking(false);
    }
  };

  const handleSearch = async e => {
    e.preventDefault();
    if (!readySelected) return;
    const query = searchQuery.trim();
    if (query.length === 0) return;

    setSearchError(null);
    setSearchResult(null);
    setIsSearching(true);
    try {
      const result = await ragService.searchInDocument(selectedDoc.document_id, query);
      setSearchResult(result.data);
    } catch (err) {
      setSearchError(getErrorMessage(err, 'Search failed.'));
    } finally {
      setIsSearching(false);
    }
  };

  const handlePreview = async () => {
    if (!selectedDoc) return;

    setPreviewError(null);
    setPreviewUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPreviewName('');
    try {
      const { objectUrl } = await ragService.fetchPdfObjectUrl(selectedDoc.document_id);
      setPreviewUrl(objectUrl);
      setPreviewName(selectedDoc.title);
    } catch (err) {
      setPreviewError(getErrorMessage(err, 'Failed to load the PDF.'));
    }
  };

  const formatSize = bytes => {
    if (!bytes) return '0 B';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };

  return (
    <div className={styles.rag}>
      <div className={styles.ragHeader}>
        <p className={styles.ragLead}>
          Upload study material as PDFs, then ask questions, find passages, and
          read them — all in one place.
        </p>
        <input
          ref={fileInputRef}
          type='file'
          accept='application/pdf,.pdf'
          hidden
          onChange={handleFileSelect}
        />
        <button
          type='button'
          className={styles.ragUpload}
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploading ? (
            <>
              <Loader2 size={16} className={styles.ragSpin} aria-hidden />
              Uploading… {uploadProgress}%
            </>
          ) : (
            <>
              <Upload size={16} aria-hidden />
              Upload PDF
            </>
          )}
        </button>
      </div>

      {uploadError && (
        <div className={styles.ragUploadFeedback} role='alert'>
          <AlertCircle size={16} aria-hidden />
          <span>{uploadError}</span>
        </div>
      )}
      {uploaded && (
        <div className={styles.ragUploadSuccess} role='status'>
          <Sparkles size={16} aria-hidden />
          <span>{uploaded}</span>
        </div>
      )}

      {isLoading && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--loading']}`} role='status'>
          <div className={styles.ragSpinner} aria-hidden />
          Loading your knowledge base…
        </div>
      )}

      {!isLoading && listError && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--error']}`} role='alert'>
          <div className={styles.ragErrorInner}>
            <AlertCircle size={18} aria-hidden />
            <span>{listError}</span>
          </div>
        </div>
      )}

      {!isLoading && !listError && documents.length === 0 && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--empty']}`}>
          <div className={styles.ragEmptyInner}>
            <Inbox size={28} aria-hidden />
            <p>No documents yet.</p>
            <p className={styles.ragEmptyHint}>
              Upload a PDF (max 5 MB) to start building a searchable knowledge base.
            </p>
            <button
              type='button'
              className={styles.ragEmptyCta}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={16} aria-hidden />
              Upload your first PDF
            </button>
          </div>
        </div>
      )}

      {!isLoading && !listError && documents.length > 0 && (
        <div className={styles.ragGrid}>
          <aside className={styles.ragDocList}>
            <h3 className={styles.ragDocListTitle}>Your documents</h3>
            <ul className={styles.ragDocListItems}>
              {documents.map(doc => {
                const statusMeta = STATUS_META[doc.status] || STATUS_META.processing;
                const active = doc.document_id === selectedId;
                return (
                  <li key={doc.document_id}>
                    <button
                      type='button'
                      className={`${styles.ragDocItem} ${
                        active ? styles.ragDocItemActive : ''
                      }`}
                      onClick={() => {
                        setSelectedId(doc.document_id);
                        if (previewUrl) URL.revokeObjectURL(previewUrl);
                        setPreviewUrl(null);
                      }}
                    >
                      <FileText size={18} className={styles.ragDocIcon} aria-hidden />
                      <span className={styles.ragDocCopy}>
                        <span className={styles.ragDocName}>{doc.title}</span>
                        <span className={styles.ragDocMeta}>
                          {formatSize(doc.byte_size)} ·{' '}
                          <span className={`${styles.ragStatus} ${styles[statusMeta.className]}`}>
                            {statusMeta.label}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className={styles.ragPanel}>
            {!selectedDoc && <p>No document selected.</p>}

            {selectedDoc && (
              <>
                <div className={styles.ragPanelHeader}>
                  <h3 className={styles.ragPanelTitle}>{selectedDoc.title}</h3>
                  <div className={styles.ragPanelActions}>
                    <button
                      type='button'
                      className={styles.ragButtonSecondary}
                      onClick={() => setActiveTab('preview')}
                      disabled={!readySelected}
                      title={readySelected ? 'Open PDF preview' : 'Only ready documents can be previewed'}
                    >
                      <Eye size={15} aria-hidden />
                      Preview
                    </button>
                    <button
                      type='button'
                      className={styles.ragButtonDanger}
                      onClick={handleDelete}
                      disabled={isDeleting}
                      title='Delete this document'
                    >
                      {isDeleting ? (
                        <Loader2 size={15} className={styles.ragSpin} aria-hidden />
                      ) : (
                        <Trash2 size={15} aria-hidden />
                      )}
                    </button>
                  </div>
                </div>

                {selectedDoc.status === 'failed' && (
                  <div className={styles.ragDocError} role='alert'>
                    <AlertCircle size={15} aria-hidden />
                    <span>{selectedDoc.error_message || 'Processing failed.'}</span>
                  </div>
                )}

                {deleteError && (
                  <div className={styles.ragDocError} role='alert'>
                    <AlertCircle size={15} aria-hidden />
                    <span>{deleteError}</span>
                  </div>
                )}

                {selectedDoc.status === 'ready' && (
                  <div className={styles.ragTabs} role='tablist'>
                    {TABS.map(tab => {
                      const isActive = activeTab === tab.id;
                      const TabIcon = tab.icon;
                      return (
                        <button
                          key={tab.id}
                          type='button'
                          role='tab'
                          aria-selected={isActive}
                          className={`${styles.ragTab} ${
                            isActive ? styles.ragTabActive : ''
                          }`}
                          onClick={() => setActiveTab(tab.id)}
                        >
                          <TabIcon size={15} aria-hidden />
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedDoc.status === 'ready' && activeTab === 'ask' && (
                  <form className={styles.ragQueryForm} onSubmit={handleAsk}>
                    <textarea
                      className={styles.ragQueryInput}
                      placeholder='Ask a question about this document…'
                      value={askQuery}
                      onChange={e => setAskQuery(e.target.value)}
                      rows={4}
                    />
                    <div className={styles.ragQueryActions}>
                      <button
                        type='submit'
                        className={styles.ragQuerySubmit}
                        disabled={isAsking || askQuery.trim().length === 0}
                      >
                        {isAsking ? (
                          <>
                            <Loader2 size={16} className={styles.ragSpin} aria-hidden />
                            Asking…
                          </>
                        ) : (
                          <>
                            <Sparkles size={16} aria-hidden />
                            Ask AI
                          </>
                        )}
                      </button>
                    </div>

                    {askError && (
                      <div className={styles.ragQueryError} role='alert'>
                        <AlertCircle size={16} aria-hidden />
                        <span>{askError}</span>
                      </div>
                    )}

                    {askResult && (
                      <div className={styles.ragAskResult} role='status'>
                        <RagAnswerBody>{askResult.answer || ''}</RagAnswerBody>
                        {Array.isArray(askResult.citations) &&
                          askResult.citations.length > 0 && (
                            <div className={styles.ragCitations}>
                              <p className={styles.ragCitationsLabel}>
                                Citations ({askResult.citations.length})
                              </p>
                              <ul className={styles.ragCitationsList}>
                                {askResult.citations.map((citation, index) => (
                                  <li key={index} className={styles.ragCitationItem}>
                                    <span className={styles.ragCitationRef}>
                                      [{index + 1}]
                                    </span>
                                    {typeof citation === 'string'
                                      ? citation
                                      : String(citation?.excerpt ?? '')}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        {Array.isArray(askResult.chunksUsed) &&
                          askResult.chunksUsed.length > 0 && (
                            <p className={styles.ragChunksNote}>
                              Answer uses {askResult.chunksUsed.length} passage
                              {askResult.chunksUsed.length === 1 ? '' : 's'} from this
                              document.
                            </p>
                          )}
                      </div>
                    )}
                  </form>
                )}

                {selectedDoc.status === 'ready' && activeTab === 'search' && (
                  <form className={styles.ragQueryForm} onSubmit={handleSearch}>
                    <textarea
                      className={styles.ragQueryInput}
                      placeholder='Search passages by meaning (e.g. how does retry backoff work?)…'
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      rows={3}
                    />
                    <div className={styles.ragQueryActions}>
                      <button
                        type='submit'
                        className={styles.ragQuerySubmit}
                        disabled={isSearching || searchQuery.trim().length === 0}
                      >
                        {isSearching ? (
                          <>
                            <Loader2 size={16} className={styles.ragSpin} aria-hidden />
                            Searching…
                          </>
                        ) : (
                          <>
                            <Search size={16} aria-hidden />
                            Search
                          </>
                        )}
                      </button>
                    </div>

                    {searchError && (
                      <div className={styles.ragQueryError} role='alert'>
                        <AlertCircle size={16} aria-hidden />
                        <span>{searchError}</span>
                      </div>
                    )}

                    {searchResult && (
                      <div className={styles.ragSearchResults} role='status'>
                        <p className={styles.ragSearchCount}>
                          {searchResult.results.length === 0
                            ? 'No passages clearly matched. Try different wording.'
                            : `${searchResult.results.length} matching passage${
                                searchResult.results.length === 1 ? '' : 'es'
                              }`}
                        </p>
                        {searchResult.results.map(result => (
                          <div key={result.chunkId} className={styles.ragSearchHit}>
                            <div className={styles.ragSearchHitHeader}>
                              <span>Passage #{result.chunkIndex}</span>
                            </div>
                            <p className={styles.ragSearchExcerpt}>{result.excerpt}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </form>
                )}

                {selectedDoc.status === 'ready' && activeTab === 'preview' && (
                  <div className={styles.ragPreview}>
                    {previewError && (
                      <div className={styles.ragQueryError} role='alert'>
                        <AlertCircle size={16} aria-hidden />
                        <span>{previewError}</span>
                      </div>
                    )}
                    {!previewUrl && (
                      <div className={`${ui.pageStates__message} ${ui['pageStates__message--empty']}`}>
                        <div className={styles.ragPreviewInner}>
                          <Eye size={26} aria-hidden />
                          <p>Preview this PDF in the browser.</p>
                          <button
                            type='button'
                            className={styles.ragPreviewButton}
                            onClick={handlePreview}
                          >
                            <RefreshCw size={15} aria-hidden />
                            Load preview
                          </button>
                        </div>
                      </div>
                    )}
                    {previewUrl && (
                      <iframe
                        className={styles.ragPreviewFrame}
                        src={`${previewUrl}#toolbar=1&navpanes=1`}
                        title={previewName || 'Document preview'}
                      />
                    )}
                  </div>
                )}

                {selectedDoc.status === 'processing' && (
                  <div className={`${ui.pageStates__message} ${ui['pageStates__message--loading']}`} role='status'>
                    <div className={styles.ragSpinner} aria-hidden />
                    Processing this document into searchable passages. This runs in the
                    background and can take a minute while the AI embedding quota cools
                    down — the list updates automatically.
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}