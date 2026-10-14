/**
 * Shared pagination controls. Renders nothing when there is only one page.
 *
 * @param {Object} props
 * @param {number} props.page - Current 1-based page.
 * @param {number} props.totalPages - Total number of pages.
 * @param {function(number): void} props.onPageChange - Callback with the new page.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './Pagination.module.css';

/**
 * Builds a page list with `…` gaps for long ranges:
 * always shows page 1, the last page, the current page and its neighbours.
 */
function buildPages(current, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([1, totalPages, current - 1, current, current + 1]);
  const sorted = [...pages]
    .filter(page => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);

  const result = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous !== 0 && page - previous > 1) {
      result.push('ellipsis');
    }
    result.push(page);
    previous = page;
  }
  return result;
}

export default function Pagination({ page, totalPages, onPageChange }) {
  if (!totalPages || totalPages <= 1) return null;

  const pages = buildPages(page, totalPages);

  return (
    <nav className={styles.pagination} aria-label='Pagination'>
      <button
        type='button'
        className={styles.paginationButton}
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label='Previous page'
      >
        <ChevronLeft size={16} aria-hidden />
      </button>

      {pages.map((entry, index) =>
        entry === 'ellipsis' ? (
          <span key={`ellipsis-${index}`} className={styles.paginationEllipsis}>
            …
          </span>
        ) : (
          <button
            key={entry}
            type='button'
            className={
              entry === page
                ? `${styles.paginationButton} ${styles.paginationButtonActive}`
                : styles.paginationButton
            }
            onClick={() => onPageChange(entry)}
            aria-current={entry === page ? 'page' : undefined}
          >
            {entry}
          </button>
        ),
      )}

      <button
        type='button'
        className={styles.paginationButton}
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        aria-label='Next page'
      >
        <ChevronRight size={16} aria-hidden />
      </button>
    </nav>
  );
}