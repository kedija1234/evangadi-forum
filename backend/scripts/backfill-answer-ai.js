/**
 * Backfills AI data for answers created before the answer-ranking/grade
 * features existed:
 *   1. Embeds answers that have no `answer_vectors` row (so thread ranking
 *      and the score-based grade fallback work for them).
 *   2. Grades answers (Good / Moderate / Low) that have no `ai_grade` yet.
 *
 * Answers are processed sequentially with a small delay between Gemini calls
 * to respect the free-tier per-minute quota.
 *
 * Usage:
 *   node scripts/backfill-answer-ai.js
 *   node scripts/backfill-answer-ai.js --redo   # re-grade answers that already have a grade
 */
import 'dotenv/config';
import { setTimeout as sleep } from 'node:timers/promises';
import { db } from '../db/config.js';
import {
  embedText,
  recommendAnswerGrade,
} from '../src/services/gemini.service.js';

const REDO = process.argv.includes('--redo');

const BATCH_DELAY_MS = Number(process.env.GEMINI_EMBED_BATCH_DELAY_MS) || 0;
const sleepMs = (waitMs) =>
  waitMs > 0 ? sleep(Math.min(waitMs, 1000)) : Promise.resolve();

const rows = await db.query(
  `SELECT
     a.answer_id,
     q.content AS question_content,
     a.content AS answer_content,
     av.vector_id,
     av.status,
     av.ai_grade
   FROM answers a
   JOIN questions q ON q.question_id = a.question_id
   LEFT JOIN answer_vectors av ON av.answer_id = a.answer_id
   ORDER BY a.answer_id`,
).then(([result]) => result);

console.log(`Found ${rows.length} answer(s) to process.`);

let embedded = 0;
let graded = 0;
let embedFailed = 0;
let gradeFailed = 0;

for (const row of rows) {
  console.log(`\n[answer ${row.answer_id}]`);

  if (!row.vector_id) {
    try {
      const vector = await embedText(row.answer_content, 'RETRIEVAL_DOCUMENT');
      await db.query(
        `INSERT INTO answer_vectors (answer_id, source_text, embedding, status)
         VALUES (?, ?, ?, 'ready')`,
        [row.answer_id, row.answer_content, JSON.stringify(vector)],
      );
      embedded += 1;
      console.log('  embedded ✓');
    } catch (error) {
      embedFailed += 1;
      console.warn(`  embedding failed (vector left absent): ${error.message}`);
    }
    await sleepMs(BATCH_DELAY_MS);
  }

  if (!row.ai_grade || REDO) {
    try {
      const grade = await recommendAnswerGrade(
        row.question_content,
        row.answer_content,
      );
      await db.query(
        'UPDATE answer_vectors SET ai_grade = ? WHERE answer_id = ?',
        [grade, row.answer_id],
      );
      graded += 1;
      console.log(`  graded → ${grade}`);
    } catch (error) {
      gradeFailed += 1;
      console.warn(
        `  grading failed (score-based fallback will still show a label): ${error.message}`,
      );
    }
    await sleepMs(1000);
  } else {
    console.log(`  grade already present: ${row.ai_grade}`);
  }
}

console.log(
  `\nDone. embedded=${embedded} embed_failed=${embedFailed} graded=${graded} grade_failed=${gradeFailed}`,
);
await db.end();
process.exit(0);