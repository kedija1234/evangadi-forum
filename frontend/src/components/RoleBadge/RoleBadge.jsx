import styles from './RoleBadge.module.css';

/**
 * Coloured pill showing a forum member's role (Owner / Admin / User).
 * Renders nothing when the role is unknown, so it is safe anywhere an
 * author object is displayed.
 */
export default function RoleBadge({ role = 'user', size = 'sm' }) {
  const label =
    role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Member';

  return (
    <span
      className={`${styles.badge} ${
        role === 'owner'
          ? styles.badgeOwner
          : role === 'admin'
            ? styles.badgeAdmin
            : styles.badgeUser
      } ${size === 'md' ? styles.badgeMd : ''}`}
      title={label}
    >
      {label}
    </span>
  );
}