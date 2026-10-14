/**
 * Creates (or updates) an administrator account.
 *
 * Usage:
 *   node scripts/create-admin.js "Admin" "User" admin@evangadiforum.com "YourPass.123"
 *
 * The account is marked role='admin' and is_active=1. If the email already
 * exists it is promoted to admin and the password is reset.
 */
import dotenv from 'dotenv';
dotenv.config();
import bcrypt from 'bcryptjs';
import { db } from '../db/config.js';

const [firstName, lastName, email, password] = process.argv.slice(2);

if (!firstName || !lastName || !email || !password) {
  console.error(
    'Usage: node scripts/create-admin.js <firstName> <lastName> <email> <password>',
  );
  process.exit(1);
}

const normalizedEmail = email.trim().toLowerCase();

if (password.length < 6) {
  console.error('Password must be at least 6 characters long.');
  process.exit(1);
}

const salt = await bcrypt.genSalt(10);
const passwordHash = await bcrypt.hash(password, salt);

const [rows] = await db.query('SELECT user_id FROM users WHERE email = ?', [
  normalizedEmail,
]);

if (rows.length > 0) {
  await db.query(
    'UPDATE users SET first_name = ?, last_name = ?, password_hash = ?, role = ?, is_active = 1 WHERE user_id = ?',
    [firstName, lastName, passwordHash, 'admin', rows[0].user_id],
  );
  console.log(`Admin account updated: ${normalizedEmail} (user_id=${rows[0].user_id})`);
} else {
  const [result] = await db.query(
    'INSERT INTO users (first_name, last_name, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, 1)',
    [firstName, lastName, normalizedEmail, passwordHash, 'admin'],
  );
  console.log(`Admin account created: ${normalizedEmail} (user_id=${result.insertId})`);
}

console.log('Login with these credentials on the forum.');
await db.end();
process.exit(0);