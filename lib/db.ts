import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const SCHEMA = `

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  is_educator INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  owner_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enrollments (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('teacher','student')),
  PRIMARY KEY (course_id, user_id)
);

CREATE TABLE IF NOT EXISTS banks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  bank_id INTEGER REFERENCES banks(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('mc','multi','tf','short','essay','file')),
  prompt TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',
  answer_json TEXT NOT NULL DEFAULT '{}',
  points REAL NOT NULL DEFAULT 1,
  feedback TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'quiz' CHECK (kind IN ('quiz','exam','assignment')),
  time_limit_min INTEGER,
  available_from TEXT,
  due_at TEXT,
  lock_at TEXT,
  allow_late INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  shuffle_questions INTEGER NOT NULL DEFAULT 1,
  shuffle_options INTEGER NOT NULL DEFAULT 1,
  feedback_mode TEXT NOT NULL DEFAULT 'after_due' CHECK (feedback_mode IN ('immediate','after_due','never')),
  show_correct INTEGER NOT NULL DEFAULT 1,
  focus_policy TEXT NOT NULL DEFAULT 'submit' CHECK (focus_policy IN ('off','log','submit')),
  focus_warnings INTEGER NOT NULL DEFAULT 0,
  require_fullscreen INTEGER NOT NULL DEFAULT 1,
  block_copy INTEGER NOT NULL DEFAULT 1,
  one_at_a_time INTEGER NOT NULL DEFAULT 0,
  lock_backtrack INTEGER NOT NULL DEFAULT 0,
  require_pledge INTEGER NOT NULL DEFAULT 1,
  require_lockdown INTEGER NOT NULL DEFAULT 0,
  seb_quit_hash TEXT NOT NULL DEFAULT '',
  seb_extra_keys TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0,
  assign_all INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exam_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
  bank_id INTEGER REFERENCES banks(id) ON DELETE CASCADE,
  draw_count INTEGER
);

CREATE TABLE IF NOT EXISTS exam_assignees (
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (exam_id, user_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  deadline_at TEXT,
  submitted_at TEXT,
  submit_reason TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','graded')),
  score REAL,
  max_score REAL,
  late INTEGER NOT NULL DEFAULT 0,
  layout_json TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT 'browser',
  focus_losses INTEGER NOT NULL DEFAULT 0,
  overall_feedback TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer_json TEXT,
  file_path TEXT,
  file_name TEXT,
  auto_correct INTEGER,
  points_awarded REAL,
  needs_grading INTEGER NOT NULL DEFAULT 0,
  feedback TEXT NOT NULL DEFAULT '',
  UNIQUE (attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS attempt_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
`;

declare global {
  // eslint-disable-next-line no-var
  var __examDb: DatabaseSync | undefined;
}

function open(): DatabaseSync {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const conn = new DatabaseSync(path.join(DATA_DIR, "exam-online.db"));
  conn.exec("PRAGMA busy_timeout = 10000;");
  conn.exec("PRAGMA journal_mode = WAL;");
  conn.exec("PRAGMA foreign_keys = ON;");
  conn.exec(SCHEMA);
  return conn;
}

/** Opened lazily on first use (not at import time), so builds and parallel workers don't contend for the file. */
function getDb(): DatabaseSync {
  return globalThis.__examDb ?? (globalThis.__examDb = open());
}

type Params = (string | number | null)[];

export function all<T = any>(sql: string, ...params: Params): T[] {
  // node:sqlite returns null-prototype rows; copy them so they can be passed to client components.
  return getDb().prepare(sql).all(...params).map((r) => ({ ...r })) as T[];
}
export function get<T = any>(sql: string, ...params: Params): T | undefined {
  const r = getDb().prepare(sql).get(...params);
  return (r ? { ...r } : undefined) as T | undefined;
}
export function run(sql: string, ...params: Params) {
  const r = getDb().prepare(sql).run(...params);
  return { id: Number(r.lastInsertRowid), changes: Number(r.changes) };
}
export function tx<T>(fn: () => T): T {
  getDb().exec("BEGIN");
  try {
    const out = fn();
    getDb().exec("COMMIT");
    return out;
  } catch (e) {
    getDb().exec("ROLLBACK");
    throw e;
  }
}

export const nowIso = () => new Date().toISOString();
