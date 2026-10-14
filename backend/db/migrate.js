import { db } from './config.js';

/**
 * Applies idempotent column additions needed for the admin role system.
 * Safe to run on every server start: each column is only added when missing.
 */
export async function ensureAdminSchema() {
  await ensureColumn('users', 'role', "VARCHAR(20) NOT NULL DEFAULT 'user'");
  await ensureColumn('users', 'is_active', 'TINYINT(1) NOT NULL DEFAULT 1');
  await ensureIndex('users', 'idx_users_role', 'role');
}

/**
 * Creates the `answer_votes` table (up/down votes on answers) when missing.
 * Safe to run on every server start.
 */
export async function ensureAnswerVotesSchema() {
  await ensureTable(
    'answer_votes',
    `
    CREATE TABLE IF NOT EXISTS \`answer_votes\` (
      \`user_id\` INT NOT NULL,
      \`answer_id\` INT NOT NULL,
      \`vote\` TINYINT NOT NULL DEFAULT 1,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`user_id\`, \`answer_id\`),
      FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`user_id\`) ON DELETE CASCADE,
      FOREIGN KEY (\`answer_id\`) REFERENCES \`answers\`(\`answer_id\`) ON DELETE CASCADE,
      INDEX \`idx_answer_votes_answer_id\` (\`answer_id\`),
      CONSTRAINT \`chk_answer_votes_value\` CHECK (\`vote\` IN (-1, 1))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  );
}

/**
 * Creates the `answer_vectors` table (per-answer embeddings for AI ranking)
 * when missing. Safe to run on every server start.
 */
export async function ensureAnswerVectorsSchema() {
  await ensureTable(
    'answer_vectors',
    `
    CREATE TABLE IF NOT EXISTS \`answer_vectors\` (
      \`vector_id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
      \`answer_id\` INT NOT NULL,
      \`source_text\` TEXT NOT NULL,
      \`embedding\` JSON NOT NULL,
      \`status\` VARCHAR(20) DEFAULT 'ready',
      \`ai_grade\` VARCHAR(16) DEFAULT NULL,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (\`answer_id\`) REFERENCES \`answers\`(\`answer_id\`) ON DELETE CASCADE,
      UNIQUE KEY \`uniq_answer_vectors_answer_id\` (\`answer_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  );

  await ensureColumn(
    'answer_vectors',
    'ai_grade',
    'VARCHAR(16) DEFAULT NULL',
  );
}

/**
 * Creates the `notifications` table (per-user activity alerts) when missing.
 * Safe to run on every server start.
 */
export async function ensureNotificationsSchema() {
  await ensureTable(
    'notifications',
    `
    CREATE TABLE IF NOT EXISTS \`notifications\` (
      \`notification_id\` BIGINT AUTO_INCREMENT PRIMARY KEY,
      \`user_id\` INT NOT NULL,
      \`type\` VARCHAR(32) NOT NULL DEFAULT 'answer_added',
      \`message\` VARCHAR(512) NOT NULL,
      \`question_id\` INT NOT NULL,
      \`question_hash\` CHAR(16) NOT NULL,
      \`is_read\` TINYINT(1) NOT NULL DEFAULT 0,
      \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`user_id\`) ON DELETE CASCADE,
      FOREIGN KEY (\`question_id\`) REFERENCES \`questions\`(\`question_id\`) ON DELETE CASCADE,
      INDEX \`idx_notifications_user_read\` (\`user_id\`, \`is_read\`, \`created_at\`),
      INDEX \`idx_notifications_question\` (\`question_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `,
  );
}

async function ensureTable(table, createSql) {
  const [tables] = await db.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table],
  );
  if (tables.length === 0) {
    await db.query(createSql);
    console.log(`[migrate] created table ${table}`);
  }
}

async function ensureColumn(table, column, definition) {
  const [columns] = await db.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column],
  );
  if (columns.length === 0) {
    await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`[migrate] added column ${table}.${column}`);
  }
}

async function ensureIndex(table, indexName, column) {
  const [indexes] = await db.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName],
  );
  if (indexes.length === 0) {
    await db.query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` (\`${column}\`)`);
    console.log(`[migrate] added index ${table}.${indexName}`);
  }
}