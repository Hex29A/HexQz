import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.DB_PATH || join(__dirname, '..', 'data', 'hexqz.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

try { db.exec('ALTER TABLE quiz ADD COLUMN archived INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE quiz ADD COLUMN light_mode INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE quiz ADD COLUMN answer_time_seconds INTEGER DEFAULT 30'); } catch {}
try { db.exec('ALTER TABLE quiz ADD COLUMN scoreboard_pause_seconds INTEGER DEFAULT 10'); } catch {}
try { db.exec('ALTER TABLE session ADD COLUMN auto_mode INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE session ADD COLUMN answer_time_seconds INTEGER'); } catch {}
try { db.exec('ALTER TABLE session ADD COLUMN scoreboard_pause_seconds INTEGER DEFAULT 10'); } catch {}
try { db.exec('ALTER TABLE session ADD COLUMN question_started_at INTEGER'); } catch {}
try { db.exec('ALTER TABLE session ADD COLUMN current_phase TEXT DEFAULT \'waiting\''); } catch {}
try { db.exec('ALTER TABLE response ADD COLUMN response_time_ms INTEGER'); } catch {}
try { db.exec('ALTER TABLE participant ADD COLUMN secret TEXT'); } catch {}

// Migration: ON DELETE rules on participant/response (issue #18).
// SQLite cannot ALTER a foreign key, so tables created before the rules
// existed are rebuilt once. Detected via PRAGMA foreign_key_list.
function hasOnDelete(table, refTable, action) {
  return db.pragma(`foreign_key_list(${table})`).some(fk => fk.table === refTable && fk.on_delete === action);
}

if (!hasOnDelete('response', 'question', 'CASCADE') || !hasOnDelete('participant', 'session', 'CASCADE')) {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE participant_new (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        team_name TEXT,
        score INTEGER NOT NULL DEFAULT 0,
        secret TEXT
      );
      INSERT INTO participant_new (id, session_id, display_name, team_name, score, secret)
        SELECT id, session_id, display_name, team_name, score, secret FROM participant;
      DROP TABLE participant;
      ALTER TABLE participant_new RENAME TO participant;

      CREATE TABLE response_new (
        id TEXT PRIMARY KEY,
        participant_id TEXT NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
        question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
        answer_id TEXT REFERENCES answer(id) ON DELETE SET NULL,
        text_answer TEXT,
        is_correct INTEGER NOT NULL DEFAULT 0,
        points_awarded INTEGER NOT NULL DEFAULT 0,
        reviewed INTEGER NOT NULL DEFAULT 0,
        answered_at INTEGER DEFAULT (unixepoch()),
        response_time_ms INTEGER,
        UNIQUE(participant_id, question_id)
      );
      INSERT INTO response_new (id, participant_id, question_id, answer_id, text_answer, is_correct, points_awarded, reviewed, answered_at, response_time_ms)
        SELECT id, participant_id, question_id, answer_id, text_answer, is_correct, points_awarded, reviewed, answered_at, response_time_ms FROM response;
      DROP TABLE response;
      ALTER TABLE response_new RENAME TO response;
    `);
  })();
  db.pragma('foreign_keys = ON');
  console.log('[DB] Migrated participant/response tables to ON DELETE rules');
}

export default db;
