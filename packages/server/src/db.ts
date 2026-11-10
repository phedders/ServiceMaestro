import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { ADMIN_PASSWORD, DATA_DIR } from "./config.js";
import { hashPassword } from "./password.js";

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "app.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS songs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT,
    copyright TEXT,
    ccli TEXT,
    key TEXT,
    lyrics TEXT NOT NULL,
    source_format TEXT,
    source_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS setlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    service_date TEXT NOT NULL,
    service_time TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS setlist_items (
    id TEXT PRIMARY KEY,
    setlist_id TEXT NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL,
    song_id TEXT REFERENCES songs(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    content TEXT,
    key_override TEXT,
    transpose INTEGER NOT NULL DEFAULT 0,
    max_lines INTEGER NOT NULL DEFAULT 4,
    notes TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_setlist_items_setlist ON setlist_items(setlist_id, position);

  CREATE TABLE IF NOT EXISTS service_sessions (
    id TEXT PRIMARY KEY,
    setlist_id TEXT,
    setlist_name TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );

  CREATE TABLE IF NOT EXISTS live_state (
    session_id TEXT PRIMARY KEY REFERENCES service_sessions(id) ON DELETE CASCADE,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS dashboard_layouts (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    layout_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

function ensureColumn(table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("songs", "source_format", "TEXT");
ensureColumn("songs", "source_path", "TEXT");
db.exec("CREATE INDEX IF NOT EXISTS idx_songs_source_path ON songs(source_path)");

const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as
  | { id: string }
  | undefined;

if (!admin) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, 'admin', ?)",
  ).run(randomUUID(), "admin", hashPassword(ADMIN_PASSWORD), now);
  // eslint-disable-next-line no-console
  console.warn(
    `[wlm] Seeded admin user "admin" (password from WLM_ADMIN_PASSWORD, default "admin"). Change it before use.`,
  );
}
