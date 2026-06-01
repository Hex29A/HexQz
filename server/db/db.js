import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.DB_PATH || join(__dirname, '..', '..', 'data', 'hexqz.sqlite');
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

export default db;
