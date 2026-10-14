/**
 * Admin Documents: view every knowledge-base document and moderate as needed.
 */
import { useState, useEffect, useCallback } from 'react';
import { FileText, Trash2, AlertCircle, Inbox } from 'lucide-react';
import { adminService } from '../../services/admin/admin.service.js';
import { getErrorMessage } from '../../lib/utils';
import ui from '../../styles/pageStates.module.css';
import styles from './Admin.module.css';

const STATUS_PILL = {
  ready: styles.pillReady,
  processing: styles.pillProcessing,
  failed: styles.pillFailed,
};

const fmtSize = bytes => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

export default function AdminDocuments() {
  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminService.getDocuments();
      setDocuments(data || []);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load documents.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const handleDelete = async target => {
    const ok = window.confirm(`Delete document "${target.title}"?`);
    if (!ok) return;

    setBusyId(target.id);
    try {
      await adminService.deleteDocument(target.id);
      await load();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete document.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={styles.admin}>
      <div className={styles.adminHeader}>
        <h3 className={styles.adminTitle}>
          <FileText size={18} style={{ verticalAlign: -3, marginRight: 6 }} aria-hidden />
          Manage Documents
        </h3>
        <p className={styles.adminSubtitle}>
          Every uploaded knowledge-base PDF across all users.
        </p>
      </div>

      {isLoading && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--loading']}`} role='status'>
          Loading documents…
        </div>
      )}

      {!isLoading && error && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--error']}`} role='alert'>
          <AlertCircle size={18} aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {!isLoading && !error && documents.length === 0 && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--empty']}`}>
          <Inbox size={24} aria-hidden />
          <span>No documents uploaded yet.</span>
        </div>
      )}

      {!isLoading && !error && documents.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Document</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map(d => (
                <tr key={d.id}>
                  <td>
                    <span className={styles.cellPrimary}>{d.title}</span>
                    {d.errorMessage && (
                      <div className={styles.cellMuted}>{d.errorMessage}</div>
                    )}
                  </td>
                  <td>
                    {d.owner.firstName} {d.owner.lastName}
                  </td>
                  <td>
                    <span className={`${styles.pill} ${STATUS_PILL[d.status] || styles.pillUser}`}>
                      {d.status}
                    </span>
                  </td>
                  <td>{fmtSize(d.byteSize)}</td>
                  <td>
                    <span className={styles.cellMuted}>
                      {new Date(d.createdAt).toLocaleDateString()}
                    </span>
                  </td>
                  <td>
                    <button
                      type='button'
                      className={`${styles.btn} ${styles.btnDanger}`}
                      disabled={busyId === d.id}
                      onClick={() => handleDelete(d)}
                    >
                      <Trash2 size={14} aria-hidden />
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}