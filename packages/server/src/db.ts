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
    permissions_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL UNIQUE,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id);

  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    module TEXT,
    method TEXT,
    path TEXT,
    status INTEGER,
    detail TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id, created_at DESC);

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
    background_id TEXT,
    stinger_id TEXT,
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
    content_source TEXT NOT NULL DEFAULT 'text',
    background_id TEXT,
    stinger_id TEXT,
    stinger_overrides_json TEXT,
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
    smart_wrap_min_words INTEGER NOT NULL DEFAULT 15,
    smart_wrap_modules TEXT NOT NULL DEFAULT '["songs","text","bible"]',
    lower_third_image_max_height_percent REAL NOT NULL DEFAULT 30,
    lower_third_image_padding INTEGER NOT NULL DEFAULT 48,
    lower_third_font_family TEXT,
    lower_third_text_scale REAL,
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

  CREATE TABLE IF NOT EXISTS songselect_watch_files (
    path TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    status TEXT NOT NULL,
    song_id TEXT,
    message TEXT,
    processed_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_songselect_watch_processed
    ON songselect_watch_files(processed_at DESC);

  CREATE TABLE IF NOT EXISTS backgrounds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    preset TEXT,
    image_path TEXT,
    use_global_colors INTEGER NOT NULL DEFAULT 0,
    colors_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stingers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    preset TEXT,
    image_path TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 1200,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tarp_themes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    background_json TEXT NOT NULL,
    font_family TEXT NOT NULL,
    text_color TEXT NOT NULL,
    accent_color TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tarp_presentations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    aspect TEXT NOT NULL DEFAULT '16:9',
    theme_id TEXT REFERENCES tarp_themes(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tarp_pages (
    id TEXT PRIMARY KEY,
    presentation_id TEXT NOT NULL REFERENCES tarp_presentations(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    theme_id TEXT REFERENCES tarp_themes(id) ON DELETE SET NULL,
    start_from_previous INTEGER NOT NULL DEFAULT 0,
    transition_json TEXT,
    normal_json TEXT NOT NULL,
    lowerthird_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tarp_pages_presentation ON tarp_pages(presentation_id, position);

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

ensureColumn("users", "permissions_json", "TEXT");
ensureColumn("songs", "source_format", "TEXT");
ensureColumn("songs", "source_path", "TEXT");
ensureColumn("songs", "verse_order", "TEXT");
ensureColumn("songs", "alternate_titles", "TEXT");
ensureColumn("songs", "lyrics_markdown", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("setlist_items", "verse_order", "TEXT");
ensureColumn("setlist_items", "text_format", "TEXT");
ensureColumn("setlist_items", "text_align", "TEXT");
ensureColumn("setlist_items", "image_fit", "TEXT");
ensureColumn("setlist_items", "content_source", "TEXT NOT NULL DEFAULT 'text'");
ensureColumn("setlist_items", "background_id", "TEXT");
ensureColumn("setlist_items", "stinger_id", "TEXT");
ensureColumn("setlist_items", "stinger_overrides_json", "TEXT");
ensureColumn("setlists", "background_id", "TEXT");
ensureColumn("setlists", "stinger_id", "TEXT");
ensureColumn("service_sessions", "revision_id", "TEXT");
ensureColumn("service_sessions", "pending_json", "TEXT");
ensureColumn("display_config", "max_words", "INTEGER NOT NULL DEFAULT 90");
ensureColumn("display_config", "smart_page_splits", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("display_config", "smart_wrap_min_words", "INTEGER NOT NULL DEFAULT 15");
ensureColumn("display_config", "smart_wrap_modules", "TEXT NOT NULL DEFAULT '[\"songs\",\"text\",\"bible\"]'");
ensureColumn("display_config", "lower_third_image_max_height_percent", "REAL NOT NULL DEFAULT 30");
ensureColumn("display_config", "lower_third_image_padding", "INTEGER NOT NULL DEFAULT 48");
ensureColumn("display_config", "lower_third_font_family", "TEXT");
ensureColumn("display_config", "lower_third_text_scale", "REAL");
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

const tarpThemeNow = new Date().toISOString();
const defaultTarpThemes = [
  {
    id: "tarp-midnight",
    name: "Midnight",
    background: { type: "color", color: "#0b1220" },
    fontFamily: '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
    textColor: "#ffffff",
    accentColor: "#4cc2ff",
  },
  {
    id: "tarp-paper",
    name: "Paper",
    background: { type: "color", color: "#f4efe7" },
    fontFamily: 'Georgia, "Times New Roman", serif',
    textColor: "#1d1a16",
    accentColor: "#b45309",
  },
  {
    id: "tarp-warm",
    name: "Warm",
    background: { type: "color", color: "#1d1210" },
    fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif',
    textColor: "#fff7ed",
    accentColor: "#fb923c",
  },
];
const seedTarpTheme = db.prepare(
  `INSERT OR IGNORE INTO tarp_themes
   (id, name, background_json, font_family, text_color, accent_color, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
for (const theme of defaultTarpThemes) {
  seedTarpTheme.run(
    theme.id,
    theme.name,
    JSON.stringify(theme.background),
    theme.fontFamily,
    theme.textColor,
    theme.accentColor,
    tarpThemeNow,
    tarpThemeNow,
  );
}

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
