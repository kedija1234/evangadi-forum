/**
 * Admin Questions: view every posted question and moderate (delete) as needed.
 */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, Trash2, AlertCircle, Inbox } from 'lucide-react';
import { adminService } from '../../services/admin/admin.service.js';
import { getErrorMessage } from '../../lib/utils';
import ui from '../../styles/pageStates.module.css';
import styles from './Admin.module.css';

export default function AdminQuestions() {
  const [questions, setQuestions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminService.getQuestions();
      setQuestions(data || []);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load questions.'));
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
    const ok = window.confirm(`Delete this question: "${target.title}"?`);
    if (!ok) return;

    setBusyId(target.id);
    try {
      await adminService.deleteQuestion(target.id);
      await load();
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to delete question.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={styles.admin}>
      <div className={styles.adminHeader}>
        <h3 className={styles.adminTitle}>
          <MessageSquare size={18} style={{ verticalAlign: -3, marginRight: 6 }} aria-hidden />
          Manage Questions
        </h3>
        <p className={styles.adminSubtitle}>
          All questions across the forum. Deleting also removes its answers and AI vector.
        </p>
      </div>

      {isLoading && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--loading']}`} role='status'>
          Loading questions…
        </div>
      )}

      {!isLoading && error && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--error']}`} role='alert'>
          <AlertCircle size={18} aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {!isLoading && !error && questions.length === 0 && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--empty']}`}>
          <Inbox size={24} aria-hidden />
          <span>No questions posted yet.</span>
        </div>
      )}

      {!isLoading && !error && questions.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Question</th>
                <th>Author</th>
                <th>Answers</th>
                <th>Posted</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {questions.map(q => (
                <tr key={q.id}>
                  <td>
                    <Link
                      to={`/questions/${q.questionHash}`}
                      className={styles.cellPrimary}
                      style={{ color: 'inherit' }}
                    >
                      {q.title}
                    </Link>
                    <div className={styles.cellMuted}>{q.content.slice(0, 120)}…</div>
                  </td>
                  <td>
                    {q.author.firstName} {q.author.lastName}
                  </td>
                  <td>{q.answerCount}</td>
                  <td>
                    <span className={styles.cellMuted}>
                      {new Date(q.createdAt).toLocaleDateString()}
                    </span>
                  </td>
                  <td>
                    <button
                      type='button'
                      className={`${styles.btn} ${styles.btnDanger}`}
                      disabled={busyId === q.id}
                      onClick={() => handleDelete(q)}
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