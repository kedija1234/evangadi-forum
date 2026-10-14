/**
 * Shared question list card used on the Dashboard and My Questions pages.
 * Navigates to `/questions/:questionHash` on click.
 */
import { Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, User, Clock, ArrowUpRight } from 'lucide-react';
import { timeAgo } from '../../lib/utils';
import RoleBadge from '../RoleBadge/RoleBadge';
import styles from './QuestionCard.module.css';

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Splits a keyword search into unique lowercase terms (longest first so a
 * longer term like "database" wins over "data" during matching).
 */
function buildHighlightTerms(query) {
  if (!query) return [];
  const seen = new Set();
  const terms = [];
  query
    .split(/[^\p{L}\p{N}]+/u)
    .map(word => word.trim().toLowerCase())
    .filter(word => word.length > 0)
    .forEach(word => {
      if (!seen.has(word)) {
        seen.add(word);
        terms.push(word);
      }
    });
  return terms.sort((a, b) => b.length - a.length);
}

/**
 * Wraps every occurrence of the given terms in <mark>. Split with a capturing
 * group interleaves plain text and matches (odd indexes), so no regex .test()
 * state issues.
 */
function highlightMatches(text, terms) {
  if (!text || terms.length === 0) return text;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  return text.split(pattern).map((part, index) => {
    if (index % 2 === 1) {
      return <mark key={index}>{part}</mark>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

/**
 * @param {Object} props
 * @param {Object} props.question - Question object from the API.
 * @param {string} [props.highlight] - Search phrase whose words should be marked.
 */
export default function QuestionCard({ question, highlight }) {
  const navigate = useNavigate();

  if (!question) return null;

  const { questionHash, title, content, answerCount, createdAt, author } =
    question;

  const terms = buildHighlightTerms(highlight);
  const handleClick = () => navigate(`/questions/${questionHash}`);

  return (
    <article
      className={styles.card}
      onClick={handleClick}
      role='link'
      tabIndex={0}
      aria-label={`Open question: ${title}`}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      <div className={styles.cardContent}>
        <h3 className={styles.cardTitle}>
          {terms.length > 0 ? highlightMatches(title, terms) : title}
        </h3>
        {content && (
          <p className={styles.cardExcerpt}>
            {terms.length > 0 ? highlightMatches(content, terms) : content}
          </p>
        )}

        <div className={styles.cardMeta}>
          <span className={styles.cardMetaItem}>
            <User size={14} aria-hidden />
            {author ? `${author.firstName} ${author.lastName}` : 'Unknown'}
            <RoleBadge role={author?.role} />
          </span>

          <span className={styles.cardMetaItem}>
            <MessageSquare size={14} aria-hidden />
            {answerCount ?? 0} {Number(answerCount) === 1 ? 'answer' : 'answers'}
          </span>

          {createdAt && (
            <span className={styles.cardMetaItem}>
              <Clock size={14} aria-hidden />
              {timeAgo(createdAt)}
            </span>
          )}
        </div>
      </div>

      <div className={styles.cardArrow} aria-hidden>
        <ArrowUpRight size={18} />
      </div>
    </article>
  );
}