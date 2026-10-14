/**
 * Dashboard: the logged-in home feed. Search is URL-driven from the Navbar —
 * `?q=term` (keyword) or `?semantic=term` (AI similarity).
 */
import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  PenSquare,
  SearchCheck,
  Sparkles,
  Inbox,
  AlertCircle,
  HelpCircle,
  MessageSquarePlus,
  CheckCircle,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { questionService } from '../../services/question/question.service.js';
import { getErrorMessage } from '../../lib/utils';
import QuestionCard from '../../components/QuestionCard/QuestionCard.jsx';
import Pagination from '../../components/Pagination/Pagination.jsx';
import ui from '../../styles/pageStates.module.css';
import styles from './Dashboard.module.css';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const keyword = searchParams.get('q') || '';
  const semantic = searchParams.get('semantic') || '';

  const [questions, setQuestions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const [stats, setStats] = useState(null);

  useEffect(() => {
    let mounted = true;

    const loadStats = async () => {
      try {
        const result = await questionService.getDashboardStats();
        if (mounted) setStats(result.data || null);
      } catch (_err) {
        // Stats are decorative — ignore failures so the feed still renders.
      }
    };

    loadStats();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        let result;
        if (semantic) {
          result = await questionService.searchQuestionsSemantic(semantic);
          setTotalPages(0);
          setTotalCount(0);
        } else if (keyword) {
          result = await questionService.getQuestions({ search: keyword, page, limit: 10 });
        } else {
          result = await questionService.getQuestions({ page, limit: 10 });
        }
        if (mounted) setQuestions(result.data || []);
        if (!semantic && mounted) {
          setTotalPages(result.meta?.totalPages ?? 0);
          setTotalCount(result.meta?.total ?? 0);
        }
      } catch (err) {
        if (mounted) setError(getErrorMessage(err, 'Failed to load questions.'));
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [keyword, semantic, page]);

  // A new search should always start back on page 1.
  useEffect(() => {
    setPage(1);
  }, [keyword, semantic]);

  const firstName = user?.firstName?.trim();
  const welcomeLine = firstName ? `Good to see you, ${firstName}.` : 'Welcome to the forum.';

  return (
    <div className={styles.dashboard}>
      <div className={styles.dashboardHeader}>
        <div>
          <h3 className={styles.dashboardTitle}>{welcomeLine}</h3>
          <p className={styles.dashboardSubtitle}>
            {semantic
              ? `AI similarity results for “${semantic}”`
              : keyword
              ? `Keyword results for “${keyword}”`
              : 'Latest questions from the community.'}
          </p>
        </div>
        <button
          type='button'
          className={styles.dashboardAsk}
          onClick={() => navigate('/questions/ask')}
        >
          <PenSquare size={16} aria-hidden />
          Ask a question
        </button>
      </div>

      {semantic && !isLoading && !error && (
        <div className={styles.dashboardSearchBadge}>
          <Sparkles size={14} aria-hidden />
          Semantic search uses question embeddings to find “questions like this”.
        </div>
      )}

      {stats && (
        <section className={styles.dashStats} aria-label='Forum summary'>
          <div className={styles.dashStatsGrid}>
            <div className={`${styles.dashStatCard} ${styles.dashStatTotal}`}>
              <span className={styles.dashStatIcon} aria-hidden>
                <HelpCircle size={20} />
              </span>
              <div className={styles.dashStatText}>
                <span className={styles.dashStatValue}>{stats.totalQuestions}</span>
                <span className={styles.dashStatLabel}>Total Questions</span>
              </div>
            </div>

            <div className={`${styles.dashStatCard} ${styles.dashStatReplies}`}>
              <span className={styles.dashStatIcon} aria-hidden>
                <MessageSquarePlus size={20} />
              </span>
              <div className={styles.dashStatText}>
                <span className={styles.dashStatValue}>{stats.totalReplies}</span>
                <span className={styles.dashStatLabel}>Total Replies</span>
              </div>
            </div>

            <div className={`${styles.dashStatCard} ${styles.dashStatAnswered}`}>
              <span className={styles.dashStatIcon} aria-hidden>
                <CheckCircle size={20} />
              </span>
              <div className={styles.dashStatText}>
                <span className={styles.dashStatValue}>{stats.answeredQuestions}</span>
                <span className={styles.dashStatLabel}>Answered Questions</span>
              </div>
            </div>

            <div className={`${styles.dashStatCard} ${styles.dashStatMine}`}>
              <span className={styles.dashStatIcon} aria-hidden>
                <UserRound size={20} />
              </span>
              <div className={styles.dashStatText}>
                <span className={styles.dashStatValue}>{stats.myQuestions}</span>
                <span className={styles.dashStatLabel}>My Questions</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {isLoading && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--loading']}`} role='status'>
          <div className={styles.dashboardSpinner} aria-hidden />
          Loading questions…
        </div>
      )}

      {!isLoading && error && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--error']}`} role='alert'>
          <div className={styles.dashboardErrorInner}>
            <AlertCircle size={18} aria-hidden />
            <span>{error}</span>
          </div>
        </div>
      )}

      {!isLoading && !error && questions.length === 0 && (
        <div className={`${ui.pageStates__message} ${ui['pageStates__message--empty']}`}>
          <div className={styles.dashboardEmptyInner}>
            <Inbox size={28} aria-hidden />
            {semantic || keyword ? (
              <>
                <p>No questions matched your search.</p>
                <p className={styles.dashboardEmptyHint}>
                  Try different keywords or run an AI similarity search from the top bar.
                </p>
              </>
            ) : (
              <>
                <p>No questions yet.</p>
                <p className={styles.dashboardEmptyHint}>
                  Be the first to ask something useful!
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {!isLoading && !error && questions.length > 0 && (
        <div className={styles.dashboardList}>
          {questions.map((question, index) => (
            <QuestionCard
              key={question.questionHash || question.id || index}
              question={question}
              highlight={semantic || keyword}
            />
          ))}
          {!semantic && totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          )}
        </div>
      )}

      {!isLoading && !error && !semantic && totalCount > 0 && (
        <p className={styles.dashboardPageInfo}>
          Showing page {page} of {totalPages || 1} · {totalCount} question
          {totalCount === 1 ? '' : 's'}
        </p>
      )}

      {!isLoading && !error && (
        <div className={styles.dashboardFooterNote}>
          <SearchCheck size={14} aria-hidden />
          Two search modes are available from the top bar: keyword and AI semantic search.
        </div>
      )}
    </div>
  );
}