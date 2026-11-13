import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { SongSelectWatchFile, SongSelectWatchReport, SongSelectWatchStatus } from "@sm/shared";
import {
  SONGSELECT_WATCH_DIR,
  SONGSELECT_WATCH_ENABLED,
  SONGSELECT_WATCH_INTERVAL,
} from "./config.js";
import { db } from "./db.js";
import { isSongSelectEnabled } from "./integrations.js";
import { parseCcliText } from "./importers/ccli.js";
import { saveSongToGit } from "./git-store.js";

const MAX_BYTES = 2 * 1024 * 1024;
const EXTENSION = ".txt";
const SOURCE_PREFIX = "songselect/";

interface WatchRow {
  path: string;
  sha256: string;
  status: SongSelectWatchFile["status"];
  song_id: string | null;
  message: string | null;
  processed_at: string;
}

let lastScanAt: string | null = null;
let lastError: string | null = null;
let running = false;

function ensureDirectory(): void {
  fs.mkdirSync(SONGSELECT_WATCH_DIR, { recursive: true });
}

function hashFile(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function listFiles(current = SONGSELECT_WATCH_DIR, root = SONGSELECT_WATCH_DIR): string[] {
  if (!fs.existsSync(current)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(full, root));
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== EXTENSION) continue;
    if (entry.name.endsWith("~")) continue;
    if (fs.statSync(full).size > MAX_BYTES) continue;
    files.push(full);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function relativePath(file: string): string {
  return path.relative(SONGSELECT_WATCH_DIR, file).split(path.sep).join("/");
}

function processedRow(relative: string): WatchRow | undefined {
  return db
    .prepare("SELECT * FROM songselect_watch_files WHERE path = ?")
    .get(relative) as WatchRow | undefined;
}

function record(
  relative: string,
  sha256: string,
  status: SongSelectWatchFile["status"],
  songId: string | null,
  message: string | null,
): SongSelectWatchFile {
  const processedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO songselect_watch_files (path, sha256, status, song_id, message, processed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET sha256 = excluded.sha256, status = excluded.status,
       song_id = excluded.song_id, message = excluded.message, processed_at = excluded.processed_at`,
  ).run(relative, sha256, status, songId, message, processedAt);
  const title = songId
    ? (db.prepare("SELECT title FROM songs WHERE id = ?").get(songId) as
        | { title: string }
        | undefined)?.title ?? null
    : null;
  return {
    path: relative,
    status,
    message,
    songId,
    songTitle: title,
    processedAt,
  };
}

function findDuplicate(ccli: string | null, title: string): { id: string; title: string } | null {
  if (ccli) {
    const byCcli = db.prepare("SELECT id, title FROM songs WHERE ccli = ? LIMIT 1").get(ccli) as
      | { id: string; title: string }
      | undefined;
    if (byCcli) return byCcli;
  }
  return (
    (db
      .prepare("SELECT id, title FROM songs WHERE lower(title) = lower(?) LIMIT 1")
      .get(title) as { id: string; title: string } | undefined) ?? null
  );
}

function mapRecent(row: {
  path: string;
  status: SongSelectWatchFile["status"];
  song_id: string | null;
  message: string | null;
  processed_at: string;
  title: string | null;
}): SongSelectWatchFile {
  return {
    path: row.path,
    status: row.status,
    message: row.message,
    songId: row.song_id,
    songTitle: row.title,
    processedAt: row.processed_at,
  };
}

export function getSongSelectWatchStatus(): SongSelectWatchStatus {
  const files = SONGSELECT_WATCH_DIR ? listFilesSafe() : [];
  const known = new Set(
    (db.prepare("SELECT path FROM songselect_watch_files").all() as Array<{ path: string }>).map(
      (row) => row.path,
    ),
  );
  const recentRows = db
    .prepare(
      `SELECT w.path, w.status, w.song_id, w.message, w.processed_at, s.title
       FROM songselect_watch_files w LEFT JOIN songs s ON s.id = w.song_id
       ORDER BY w.processed_at DESC LIMIT 20`,
    )
    .all() as Array<{
    path: string;
    status: SongSelectWatchFile["status"];
    song_id: string | null;
    message: string | null;
    processed_at: string;
    title: string | null;
  }>;
  return {
    enabled: SONGSELECT_WATCH_ENABLED,
    directory: SONGSELECT_WATCH_DIR,
    intervalSeconds: SONGSELECT_WATCH_INTERVAL,
    running,
    lastScanAt,
    lastError,
    pendingFiles: files.filter((file) => !known.has(relativePath(file))).length,
    recent: recentRows.map(mapRecent),
  };
}

function listFilesSafe(): string[] {
  try {
    if (!fs.existsSync(SONGSELECT_WATCH_DIR)) return [];
    return listFiles();
  } catch {
    return [];
  }
}

export async function runSongSelectWatch(force = false): Promise<SongSelectWatchReport | null> {
  if (!isSongSelectEnabled()) {
    return {
      scanned: 0,
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      files: [],
    };
  }
  if (running) return null;
  running = true;
  lastError = null;
  const report: SongSelectWatchReport = {
    scanned: 0,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    files: [],
  };
  try {
    ensureDirectory();
    const files = listFiles();
    for (const full of files) {
      report.scanned += 1;
      const relative = relativePath(full);
      try {
        const sha256 = hashFile(full);
        const processed = processedRow(relative);
        if (!force && processed?.sha256 === sha256) continue;

        const stat = fs.statSync(full);
        if (stat.size > MAX_BYTES) {
          report.errors += 1;
          report.files.push(record(relative, sha256, "error", null, "File is larger than 2 MB"));
          continue;
        }
        const parsed = parseCcliText(relative, fs.readFileSync(full, "utf8"));
        if (!parsed.lyrics.trim()) {
          report.skipped += 1;
          report.files.push(
            record(relative, sha256, "skipped", null, "No lyric content found"),
          );
          continue;
        }

        const sourcePath = `${SOURCE_PREFIX}${relative}`;
        const existingBySource = db
          .prepare("SELECT id FROM songs WHERE source_path = ?")
          .get(sourcePath) as { id: string } | undefined;
        const now = new Date().toISOString();
        if (existingBySource) {
          db.prepare(
            `UPDATE songs SET title = ?, author = ?, copyright = ?, ccli = ?, lyrics = ?,
             source_format = 'ccli', source_path = ?, updated_at = ? WHERE id = ?`,
          ).run(
            parsed.title,
            parsed.author,
            parsed.copyright,
            parsed.ccli,
            parsed.lyrics,
            sourcePath,
            now,
            existingBySource.id,
          );
          await saveSongToGit(existingBySource.id).catch(() => undefined);
          report.updated += 1;
          report.files.push(
            record(relative, sha256, "updated", existingBySource.id, "Lyrics updated"),
          );
          continue;
        }

        const duplicate = findDuplicate(parsed.ccli, parsed.title);
        if (duplicate) {
          report.skipped += 1;
          report.files.push(
            record(
              relative,
              sha256,
              "skipped",
              duplicate.id,
              `Already exists as “${duplicate.title}”`,
            ),
          );
          continue;
        }

        const id = randomUUID();
        db.prepare(
          `INSERT INTO songs
           (id, title, alternate_titles, author, copyright, ccli, key, lyrics, verse_order,
            lyrics_markdown, source_format, source_path, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 'ccli', ?, ?, ?)`,
        ).run(
          id,
          parsed.title,
          parsed.alternateTitles,
          parsed.author,
          parsed.copyright,
          parsed.ccli,
          parsed.key,
          parsed.lyrics,
          sourcePath,
          now,
          now,
        );
        await saveSongToGit(id).catch(() => undefined);
        report.imported += 1;
        report.files.push(record(relative, sha256, "imported", id, "Imported"));
      } catch (error) {
        report.errors += 1;
        let sha256 = "";
        try {
          sha256 = hashFile(full);
        } catch {
          // Leave the hash empty when the file has already disappeared.
        }
        report.files.push(
          record(relative, sha256, "error", null, (error as Error).message.slice(0, 500)),
        );
      }
    }
    lastScanAt = new Date().toISOString();
    return report;
  } catch (error) {
    lastError = (error as Error).message;
    lastScanAt = new Date().toISOString();
    report.errors += 1;
    return report;
  } finally {
    running = false;
  }
}

export function startSongSelectWatcher(): () => void {
  if (!SONGSELECT_WATCH_ENABLED) return () => undefined;
  if (isSongSelectEnabled()) {
    try {
      ensureDirectory();
    } catch (error) {
      lastError = (error as Error).message;
    }
  }
  const initial = setTimeout(() => void runSongSelectWatch(), 1500);
  const timer = setInterval(
    () => void runSongSelectWatch(),
    SONGSELECT_WATCH_INTERVAL * 1000,
  );
  return () => {
    clearTimeout(initial);
    clearInterval(timer);
  };
}
