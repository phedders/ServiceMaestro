import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { ADMIN_PASSWORD, ASSETS_DIR, DATA_DIR } from "./config.js";
import { hashPassword } from "./password.js";

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(ASSETS_DIR, { recursive: true });

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
    verse_order TEXT,
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
    verse_order TEXT,
    notes TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_setlist_items_setlist ON setlist_items(setlist_id, position);

  CREATE TABLE IF NOT EXISTS setlist_revisions (
    id TEXT PRIMARY KEY,
    setlist_id TEXT NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
    revision_no INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT,
    UNIQUE(setlist_id, revision_no)
  );
  CREATE INDEX IF NOT EXISTS idx_setlist_revisions_setlist ON setlist_revisions(setlist_id, revision_no);

  CREATE TABLE IF NOT EXISTS service_sessions (
    id TEXT PRIMARY KEY,
    setlist_id TEXT,
    revision_id TEXT,
    setlist_name TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    pending_json TEXT,
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

  CREATE TABLE IF NOT EXISTS display_config (
    id TEXT PRIMARY KEY,
    font_family TEXT NOT NULL,
    text_color TEXT NOT NULL,
    text_scale REAL NOT NULL,
    max_lines INTEGER NOT NULL,
    max_words INTEGER NOT NULL DEFAULT 90,
    smart_page_splits INTEGER NOT NULL DEFAULT 1,
    lower_third_image_max_height_percent REAL NOT NULL DEFAULT 30,
    lower_third_image_padding INTEGER NOT NULL DEFAULT 48,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fonts (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    family TEXT NOT NULL,
    source_url TEXT,
    css_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS song_verse_orders (
    id TEXT PRIMARY KEY,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    order_text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(song_id, name)
  );
  CREATE INDEX IF NOT EXISTS idx_song_verse_orders_song ON song_verse_orders(song_id);

  CREATE TABLE IF NOT EXISTS song_assets (
    id TEXT PRIMARY KEY,
    song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    key TEXT,
    format TEXT NOT NULL,
    mime TEXT NOT NULL,
    path TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    pages INTEGER,
    source TEXT,
    created_at TEXT NOT NULL,
    created_by TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_song_assets_song ON song_assets(song_id);
`);

function ensureColumn(table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("songs", "source_format", "TEXT");
ensureColumn("songs", "source_path", "TEXT");
ensureColumn("songs", "verse_order", "TEXT");
ensureColumn("songs", "alternate_titles", "TEXT");
ensureColumn("songs", "lyrics_markdown", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("setlist_items", "verse_order", "TEXT");
ensureColumn("setlist_items", "text_format", "TEXT");
ensureColumn("setlist_items", "text_align", "TEXT");
ensureColumn("setlist_items", "image_fit", "TEXT");
ensureColumn("service_sessions", "revision_id", "TEXT");
ensureColumn("service_sessions", "pending_json", "TEXT");
ensureColumn("display_config", "max_words", "INTEGER NOT NULL DEFAULT 90");
ensureColumn("display_config", "smart_page_splits", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("display_config", "lower_third_image_max_height_percent", "REAL NOT NULL DEFAULT 30");
ensureColumn("display_config", "lower_third_image_padding", "INTEGER NOT NULL DEFAULT 48");
db.exec("CREATE INDEX IF NOT EXISTS idx_songs_source_path ON songs(source_path)");

db.prepare(
  `INSERT INTO display_config
     (id, font_family, text_color, text_scale, max_lines, max_words, smart_page_splits,
      lower_third_image_max_height_percent, lower_third_image_padding, updated_at)
   VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(id) DO NOTHING`,
).run(
  '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
  "#ffffff",
  1,
  4,
  90,
  1,
  30,
  48,
  new Date().toISOString(),
);

db.prepare(
  `INSERT INTO app_settings (key, value, updated_at) VALUES ('page_navigation', 'stop', ?)
   ON CONFLICT(key) DO NOTHING`,
).run(new Date().toISOString());

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
    `[sm] Seeded admin user "admin" (password from SM_ADMIN_PASSWORD, default "admin"). Change it before use.`,
  );
}
