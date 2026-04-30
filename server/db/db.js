import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.DB_PATH || join(__dirname, '..', '..', 'data', 'hexqz.sqlite');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read/write performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run schema migrations
const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// Add columns if missing (safe migrations)
try { db.exec('ALTER TABLE quiz ADD COLUMN archived INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE quiz ADD COLUMN light_mode INTEGER DEFAULT 0'); } catch {}

export default db;
