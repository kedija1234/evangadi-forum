/**
 * My Questions: only questions authored by the signed-in user.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PenSquare, Inbox, AlertCircle } from 'lucide-react';
import { questionService } from '../../services/question/question.service.js';
import { getErrorMessage } from '../../lib/utils';
import QuestionCard from '../../components/QuestionCard/QuestionCard.jsx';
import Pagination from '../../components/Pagination/Pagination.jsx';
import ui from '../../styles/pageStates.module.css';
import styles from './MyQuestions.module.css';

export default function MyQuestions() {
  const navigate = useNavigate();
  const [myQuestions, setMyQuestions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await questionService.getQuestions({ mine: true, page, limit: 10 });
        if (mounted) {
          setMyQuestions(result.data || []);
          setTotalPages(result.meta?.totalPages ?? 0);
        }
      } catch (err) {
        if (mounted) setError(getErrorMessage(err, 'Failed to load your questions.'));
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [page]);

  return (
    <div className={styles.myQuestions}>
      <div className={styles.myQuestionsHeader}>
        <p className={styles.myQuestionsLead}>
          Questions you have posted. Open any thread to read replies.
        </p>
        <button
          type='button'
          className={styles.myQuestionsAsk}
          onClick={() => navigate('/questions/ask')}
        >
          <PenSquare size={16} aria-hidden />
          Ask a question
        </button>
      </div>

      {isLoading && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--loading']}`} role='status'>
          <div className={styles.myQuestionsSpinner} aria-hidden />
          Loading your questions…
        </div>
      )}

      {!isLoading && error && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--error']}`} role='alert'>
          <div className={styles.myQuestionsErrorInner}>
            <AlertCircle size={18} aria-hidden />
            <span>{error}</span>
          </div>
        </div>
      )}

      {!isLoading && !error && myQuestions.length === 0 && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--empty']}`}>
          <div className={styles.myQuestionsEmptyInner}>
            <Inbox size={28} aria-hidden />
            <p>You haven't asked any questions yet.</p>
            <p className={styles.myQuestionsEmptyHint}>
              Ask your first question and it will show up here.
            </p>
            <button
              type='button'
              className={styles.myQuestionsEmptyCta}
              onClick={() => navigate('/questions/ask')}
            >
              Ask your first question
            </button>
          </div>
        </div>
      )}

      {!isLoading && !error && myQuestions.length > 0 && (
        <div className={styles.myQuestionsList}>
          {myQuestions.map((question, index) => (
            <QuestionCard
              key={question.questionHash || question.id || index}
              question={question}
            />
          ))}
          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          )}
        </div>
      )}
    </div>
  );
}