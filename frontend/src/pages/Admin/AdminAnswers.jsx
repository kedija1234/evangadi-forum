/**
 * Admin Answers: view every answer across the forum and moderate as needed.
 */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Trash2, AlertCircle, Inbox } from 'lucide-react';
import { adminService } from '../../services/admin/admin.service.js';
import { getErrorMessage } from '../../lib/utils';
import ui from '../../styles/pageStates.module.css';
import styles from './Admin.module.css';

export default function AdminAnswers() {
  const [answers, setAnswers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminService.getAnswers();
      setAnswers(data || []);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load answers.'));
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
    const ok = window.confirm(
      `Delete this answer by ${target.author.firstName} ${target.author.lastName}?`,
    );
    if (!ok) return;

    setBusyId(target.id);
    try {
      await adminService.deleteAnswer(target.id);
      await load();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete answer.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={styles.admin}>
      <div className={styles.adminHeader}>
        <h3 className={styles.adminTitle}>
          <MessageCircle size={18} style={{ verticalAlign: -3, marginRight: 6 }} aria-hidden />
          Manage Answers
        </h3>
        <p className={styles.adminSubtitle}>
          All answers across the forum.
        </p>
      </div>

      {isLoading && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--loading']}`} role='status'>
          Loading answers…
        </div>
      )}

      {!isLoading && error && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--error']}`} role='alert'>
          <AlertCircle size={18} aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {!isLoading && !error && answers.length === 0 && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--empty']}`}>
          <Inbox size={24} aria-hidden />
          <span>No answers posted yet.</span>
        </div>
      )}

      {!isLoading && !error && answers.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Answer</th>
                <th>Question</th>
                <th>Author</th>
                <th>Posted</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {answers.map(a => (
                <tr key={a.id}>
                  <td>
                    <div className={styles.cellMuted}>{a.content.slice(0, 150)}…</div>
                  </td>
                  <td>
                    <Link
                      to={`/questions/${a.question.questionHash}`}
                      className={styles.cellPrimary}
                      style={{ color: 'inherit' }}
                    >
                      {a.question.title}
                    </Link>
                  </td>
                  <td>
                    {a.author.firstName} {a.author.lastName}
                  </td>
                  <td>
                    <span className={styles.cellMuted}>
                      {new Date(a.createdAt).toLocaleDateString()}
                    </span>
                  </td>
                  <td>
                    <button
                      type='button'
                      className={`${styles.btn} ${styles.btnDanger}`}
                      disabled={busyId === a.id}
                      onClick={() => handleDelete(a)}
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