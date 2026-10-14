import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, Menu, LogOut, Sparkles, Bell, Check } from 'lucide-react';
import { notificationService } from '../../services/notification/notification.service.js';
import RoleBadge from '../RoleBadge/RoleBadge';
import styles from './Navbar.module.css';

/** Renders a friendly relative timestamp like "5m ago". */
function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

/**
 * Top bar: page title, debounced text search → `/dashboard?q=…`, optional AI semantic search.
 * Search state is driven by the URL on the dashboard so bookmarks and refresh keep context.
 */
export default function Navbar({ title, subtitle, user, onLogout, onMenuClick }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Initialize searchTerm from URL if we are already on the dashboard
  const [searchTerm, setSearchTerm] = useState(() => {
    const params = new URLSearchParams(location.search);
    return params.get('q') || params.get('semantic') || '';
  });

  // Keep input in sync with URL if it changes externally
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (location.pathname === '/dashboard') {
        const params = new URLSearchParams(location.search);
        setSearchTerm(params.get('q') || params.get('semantic') || '');
      } else {
        setSearchTerm('');
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [location.search, location.pathname]);

  // Debounced keyword search: updates `?q=` on the dashboard (500ms quiet period).
  // Skipped while AI semantic search is active so it can't clobber `?semantic=…`.
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      const params = new URLSearchParams(location.search);
      const inSemanticMode = Boolean(params.get('semantic'));
      if (searchTerm.trim() !== '' && !inSemanticMode) {
        navigate(`/dashboard?q=${encodeURIComponent(searchTerm)}`);
      } else if (
        searchTerm.trim() === '' &&
        location.pathname === '/dashboard' &&
        !inSemanticMode
      ) {
        navigate('/dashboard');
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [searchTerm, navigate, location.pathname, location.search]);

  const handleSemanticSearch = e => {
    e.preventDefault();
    if (searchTerm.trim().length >= 3) {
      navigate(`/dashboard?semantic=${encodeURIComponent(searchTerm)}`);
    }
  };

  const handleSearchSubmit = e => {
    e.preventDefault();
    if (searchTerm.trim()) {
      navigate(`/dashboard?q=${encodeURIComponent(searchTerm)}`);
    }
  };

  // --- Notifications -------------------------------------------------------
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const bellRef = useRef(null);

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    setNotifLoading(true);
    try {
      const { notifications: list, unreadCount: count } =
        await notificationService.getNotifications({ limit: 20 });
      setNotifications(list || []);
      setUnreadCount(count || 0);
    } catch {
      // Non-fatal: keep the previous state on transient failures.
    } finally {
      setNotifLoading(false);
    }
  }, [user]);

  // Initial load + lightweight 20s polling while a user is signed in.
  useEffect(() => {
    if (!user) return undefined;
    loadNotifications();
    const timer = window.setInterval(loadNotifications, 20000);
    return () => window.clearInterval(timer);
  }, [user, loadNotifications]);

  // Refresh right before opening the dropdown so the list is fresh.
  const toggleNotifDropdown = () => {
    if (!notifOpen) loadNotifications();
    setNotifOpen(prev => !prev);
  };

  // Close the dropdown on outside click / on navigation.
  useEffect(() => {
    if (!notifOpen) return undefined;
    const onDocClick = e => {
      if (bellRef.current && !bellRef.current.contains(e.target)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [notifOpen]);

  const openNotification = async notif => {
    setNotifOpen(false);
    if (!notif.isRead) {
      setNotifications(prev =>
        prev.map(n =>
          n.id === notif.id ? { ...n, isRead: true } : n,
        ),
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
      notificationService.markRead(notif.id).catch(() => {});
    }
    if (notif.questionHash) {
      navigate(`/questions/${notif.questionHash}`);
    }
  };

  const markAllRead = async () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    setUnreadCount(0);
    try {
      await notificationService.markAllRead();
    } catch {
      // Non-fatal.
    }
  };

  return (
    <header className={styles.navbar}>
      <button
        type='button'
        className={styles.navbar__menuButton}
        onClick={onMenuClick}
        aria-label='Open navigation menu'
        aria-expanded={false}
      >
        <Menu size={20} />
      </button>
      <div className={styles.navbar__titleBlock}>
        <h2 className={styles.navbar__pageTitle}>{title}</h2>
        {subtitle ? (
          <p className={styles.navbar__pageSubtitle}>{subtitle}</p>
        ) : null}
      </div>

      <form className={styles.navbar__search} onSubmit={handleSearchSubmit}>
        <div className={styles['navbar__search-icon']}>
          <Search size={16} />
        </div>
        <input
          id='search'
          type='text'
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder='Search questions by keyword…'
          className={styles['navbar__search-input']}
          aria-label='Search questions by keyword'
        />
        {searchTerm.length >= 3 && (
          <button
            type='button'
            onClick={handleSemanticSearch}
            className={styles['navbar__semantic-button']}
            title='Use AI Semantic Search'
          >
            <Sparkles size={14} />
            <span className={styles['navbar__semantic-text']}>AI Search</span>
          </button>
        )}
      </form>

      <div className={styles.navbar__actions}>
        {user && (
          <div className={styles.navbar__bellWrap} ref={bellRef}>
            <button
              type='button'
              className={styles.navbar__notification}
              onClick={toggleNotifDropdown}
              aria-label={
                unreadCount > 0
                  ? `Notifications, ${unreadCount} unread`
                  : 'Notifications'
              }
              aria-expanded={notifOpen}
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className={styles.navbar__notificationBadge}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className={styles.navbar__notificationDropdown} role='menu'>
                <div className={styles.navbar__notificationHead}>
                  <span>Notifications</span>
                  {unreadCount > 0 && (
                    <button
                      type='button'
                      className={styles.navbar__notificationMarkAll}
                      onClick={markAllRead}
                    >
                      <Check size={12} aria-hidden /> Mark all read
                    </button>
                  )}
                </div>

                {notifLoading && notifications.length === 0 ? (
                  <p className={styles.navbar__notificationEmpty}>Loading…</p>
                ) : notifications.length === 0 ? (
                  <p className={styles.navbar__notificationEmpty}>
                    No notifications yet.
                  </p>
                ) : (
                  <ul className={styles.navbar__notificationList}>
                    {notifications.map(notif => (
                      <li key={notif.id}>
                        <button
                          type='button'
                          className={`${styles.navbar__notificationItem} ${
                            notif.isRead
                              ? ''
                              : styles.navbar__notificationItemUnread
                          }`}
                          onClick={() => openNotification(notif)}
                        >
                          <span className={styles.navbar__notificationDot} aria-hidden />
                          <span className={styles.navbar__notificationCopy}>
                            <span className={styles.navbar__notificationMessage}>
                              {notif.message}
                            </span>
                            <span className={styles.navbar__notificationTime}>
                              {formatRelativeTime(notif.createdAt)}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        <div className={styles.navbar__user}>
          <div className={styles['navbar__user-info']}>
            <span className={styles['navbar__user-name']}>
              {user ? `${user.firstName} ${user.lastName}` : 'Guest'}
            </span>
            <RoleBadge role={user?.role} />
          </div>
          <div className={styles['navbar__user-avatar']}>
            <img
              src={
                user?.avatar ||
                `https://ui-avatars.com/api/?name=${
                  user?.firstName || 'User'
                }+${user?.lastName || ''}&background=random`
              }
              alt='avatar'
              referrerPolicy='no-referrer'
            />
          </div>
        </div>
        {user && (
          <button
            type='button'
            className={styles.navbar__logout}
            onClick={onLogout}
            aria-label='Logout'
            title='Logout'
          >
            <LogOut size={20} />
          </button>
        )}
      </div>
    </header>
  );
}