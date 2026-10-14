import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import Navbar from '../Navbar/Navbar.jsx';
import Sidebar from '../Sidebar/Sidebar.jsx';
import styles from './Layout.module.css';

/**
 * Authenticated shell: fixed sidebar + scrollable main column + footer.
 * Add new `pathname` branches below when you introduce more protected routes.
 */
export default function Layout() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close the mobile drawer once a route change happens (nav links toggle it).
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Close the drawer with the Escape key.
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const onKey = e => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  // Lock page scroll while the drawer overlay is open.
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  /** Navbar title: keep in sync with routes in `App.jsx`. */
  const getTitle = () => {
    const path = location.pathname;
    if (path === '/dashboard') return 'Home';
    if (path === '/my-questions') return 'Your topics';
    if (path === '/questions/ask') return 'Ask a question';
    if (path.startsWith('/questions/')) return 'Discussion';
    if (path === '/rag-documents') return 'Knowledge base';
    if (path === '/admin') return 'Admin dashboard';
    if (path === '/admin/users') return 'Manage users';
    if (path === '/admin/questions') return 'Manage questions';
    if (path === '/admin/answers') return 'Manage answers';
    if (path === '/admin/documents') return 'Manage documents';
    return 'Forum';
  };

  /** One-line context under the title (helps students orient on each screen). */
  const getSubtitle = () => {
    const path = location.pathname;
    if (path === '/dashboard')
      return 'Browse the feed, search by keyword, or run AI similarity search.';
    if (path === '/my-questions')
      return 'Questions you have posted. Open any thread to read replies or edit context.';
    if (path === '/questions/ask')
      return 'A clear title and reproducible steps get faster, more accurate answers.';
    if (path.startsWith('/questions/'))
      return 'Read the thread, review related topics, and reply with markdown if you can help.';
    if (path === '/rag-documents')
      return 'Private PDF library: reader, semantic search, and AI answers with citations per document.';
    if (path === '/admin') return 'Site-wide overview and control panel.';
    if (path === '/admin/users') return 'Promote, deactivate, or remove accounts.';
    if (path === '/admin/questions') return 'Review and moderate all questions.';
    if (path === '/admin/answers') return 'Review and moderate all answers.';
    if (path === '/admin/documents') return 'Review all knowledge-base documents.';
    return '';
  };

  return (
    <div className={styles.layout}>
      <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
      <div
        className={`${styles.layout__overlay} ${
          sidebarOpen ? styles['layout__overlay--visible'] : ''
        }`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden
      />
      <div className={styles.layout__content}>
        <Navbar
          title={getTitle()}
          subtitle={getSubtitle()}
          user={user}
          onLogout={logout}
          onMenuClick={() => setSidebarOpen(prev => !prev)}
        />
        <main className={styles.layout__main}>
          <div className={styles.layout__mainInner}>
            <Outlet />
          </div>
        </main>

        <footer className={styles.layout__footer}>
          <div className={styles['layout__footer-content']}>
            <div className={styles['layout__footer-branding']}>
              <h4 className={styles['layout__footer-title']}>Evangadi Forum</h4>
              <p className={styles['layout__footer-tagline']}>
                A practice space for technical Q&A, peer feedback, and
                AI-assisted search, built for Evangadi learners and mentors.
              </p>
              <p className={styles['layout__footer-copyright']}>
                © 2026 Evangadi Forum. For educational use.
              </p>
            </div>
            <nav className={styles['layout__footer-nav']}>
              <a href='#' className={styles['layout__footer-link']}>
                About
              </a>
              <a href='#' className={styles['layout__footer-link']}>
                Privacy
              </a>
              <a href='#' className={styles['layout__footer-link']}>
                Terms
              </a>
              <a href='#' className={styles['layout__footer-link']}>
                Contact
              </a>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}
