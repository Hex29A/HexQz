CREATE TABLE IF NOT EXISTS quiz (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  admin_token TEXT NOT NULL UNIQUE,
  theme_color TEXT DEFAULT '#6366f1',
  logo_url TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS question (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quiz(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  text TEXT NOT NULL,
  image_url TEXT,
  type TEXT NOT NULL DEFAULT 'single_choice',
  correct_value REAL,
  tolerance REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS answer (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0,
  part_label TEXT
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL REFERENCES quiz(id),
  join_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'waiting',
  current_question_index INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS participant (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id),
  display_name TEXT NOT NULL,
  team_name TEXT,
  score INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS response (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participant(id),
  question_id TEXT NOT NULL REFERENCES question(id),
  answer_id TEXT REFERENCES answer(id),
  text_answer TEXT,
  is_correct INTEGER NOT NULL DEFAULT 0,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  reviewed INTEGER NOT NULL DEFAULT 0,
  answered_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(participant_id, question_id)
);
