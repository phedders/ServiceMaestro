import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { SONGS_DIR } from "./config.js";
import { parseSongFile, type SongFilePreview } from "./importers/index.js";

const MAX_BYTES = 2 * 1024 * 1024;
const EXTENSIONS = new Set([".xml", ".txt", ".cho", ".chordpro", ".crd"]);
const IGNORED_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build"]);

function walk(root: string, current: string, files: string[]): void {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(root, full, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith("~") || /\.(swp|swo|kate-swp)$/i.test(entry.name)) continue;
    if (!EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    if (entry.name.toLowerCase() === "readme.md") continue;
    if (path.basename(entry.name).startsWith("package")) continue;
    const stat = fs.statSync(full);
    if (stat.size > MAX_BYTES) continue;
    files.push(full);
  }
}

export interface ScanReport {
  root: string;
  files: SongFilePreview[];
  errors: Array<{ path: string; error: string }>;
  skipped: number;
}

export function scanSongs(dir = SONGS_DIR): ScanReport {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`Songs directory not found: ${dir}`);
  }
  const files: string[] = [];
  walk(dir, dir, files);
  files.sort((a, b) => a.localeCompare(b));

  const previews: SongFilePreview[] = [];
  const errors: Array<{ path: string; error: string }> = [];
  let skipped = 0;

  for (const full of files) {
    const relative = path.relative(dir, full).split(path.sep).join("/");
    try {
      const content = fs.readFileSync(full, "utf8");
      const parsed = parseSongFile(relative, content);
      if (!parsed.lyrics.trim()) {
        skipped += 1;
        errors.push({ path: relative, error: "No lyric content found" });
        continue;
      }
      previews.push({
        ...parsed,
        path: relative,
        bytes: Buffer.byteLength(content),
      });
    } catch (error) {
      errors.push({ path: relative, error: (error as Error).message });
    }
  }

  return { root: dir, files: previews, errors, skipped };
}

export interface ImportReport {
  imported: number;
  updated: number;
  skipped: Array<{ path: string; reason: string }>;
  errors: Array<{ path: string; error: string }>;
  songs: Array<{ id: string; title: string; path: string }>;
}

function findBySource(path: string): { id: string } | undefined {
  return db.prepare("SELECT id FROM songs WHERE source_path = ?").get(path) as
    | { id: string }
    | undefined;
}

function findDuplicate(preview: SongFilePreview): { id: string; title: string } | undefined {
  if (preview.ccli) {
    const byCcli = db
      .prepare("SELECT id, title FROM songs WHERE ccli = ? LIMIT 1")
      .get(preview.ccli) as { id: string; title: string } | undefined;
    if (byCcli) return byCcli;
  }
  const byTitle = db
    .prepare("SELECT id, title FROM songs WHERE lower(title) = lower(?) LIMIT 1")
    .get(preview.title) as { id: string; title: string } | undefined;
  if (byTitle) return byTitle;
  return undefined;
}

export function importSongs(paths?: string[], dir = SONGS_DIR): ImportReport {
  const report = scanSongs(dir);
  const wanted = paths ? new Set(paths) : null;
  const reportResult: ImportReport = {
    imported: 0,
    updated: 0,
    skipped: [],
    errors: [...report.errors],
    songs: [],
  };

  const insert = db.prepare(
    `INSERT INTO songs
     (id, title, author, copyright, ccli, key, lyrics, source_format, source_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const update = db.prepare(
    `UPDATE songs SET title = ?, author = ?, copyright = ?, ccli = ?, key = ?, lyrics = ?,
       source_format = ?, source_path = ?, updated_at = ?
     WHERE id = ?`,
  );

  for (const preview of report.files) {
    if (wanted && !wanted.has(preview.path)) continue;
    const existing = findBySource(preview.path);
    const now = new Date().toISOString();
    if (existing) {
      update.run(
        preview.title,
        preview.author,
        preview.copyright,
        preview.ccli,
        preview.key,
        preview.lyrics,
        preview.format,
        preview.path,
        now,
        existing.id,
      );
      reportResult.updated += 1;
      reportResult.songs.push({ id: existing.id, title: preview.title, path: preview.path });
      continue;
    }

    const duplicate = findDuplicate(preview);
    if (duplicate) {
      reportResult.skipped.push({
        path: preview.path,
        reason: `Duplicate of “${duplicate.title}” (same CCLI or title)`,
      });
      continue;
    }

    const id = randomUUID();
    insert.run(
      id,
      preview.title,
      preview.author,
      preview.copyright,
      preview.ccli,
      preview.key,
      preview.lyrics,
      preview.format,
      preview.path,
      now,
      now,
    );
    reportResult.imported += 1;
    reportResult.songs.push({ id, title: preview.title, path: preview.path });
  }

  return reportResult;
}
