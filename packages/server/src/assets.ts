import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { SongAsset, SongAssetKind } from "@wlm/shared";
import { ASSETS_DIR, DATA_DIR } from "./config.js";
import { db } from "./db.js";

interface AssetRow {
  id: string;
  song_id: string;
  kind: SongAssetKind;
  title: string;
  key: string | null;
  format: string;
  mime: string;
  path: string;
  bytes: number;
  sha256: string;
  pages: number | null;
  source: string | null;
  created_at: string;
  created_by: string | null;
}

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".cho": "text/plain; charset=utf-8",
  ".crd": "text/plain; charset=utf-8",
  ".chordpro": "text/plain; charset=utf-8",
};

function map(row: AssetRow): SongAsset {
  return {
    id: row.id,
    songId: row.song_id,
    kind: row.kind,
    title: row.title,
    key: row.key,
    format: row.format,
    mime: row.mime,
    bytes: row.bytes,
    sha256: row.sha256,
    pages: row.pages,
    source: row.source,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

export function listAssets(songId: string): SongAsset[] {
  const rows = db
    .prepare("SELECT * FROM song_assets WHERE song_id = ? ORDER BY kind, title COLLATE NOCASE")
    .all(songId) as AssetRow[];
  return rows.map(map);
}

export function getAsset(id: string): { asset: SongAsset; absolutePath: string } | null {
  const row = db.prepare("SELECT * FROM song_assets WHERE id = ?").get(id) as AssetRow | undefined;
  if (!row) return null;
  return { asset: map(row), absolutePath: path.resolve(DATA_DIR, row.path) };
}

export function saveAsset(input: {
  songId: string;
  buffer: Buffer;
  filename: string;
  mime: string | undefined;
  kind: SongAssetKind;
  title?: string;
  key?: string | null;
  source?: string | null;
  userId: string | null;
}): SongAsset {
  const song = db.prepare("SELECT id FROM songs WHERE id = ?").get(input.songId);
  if (!song) throw new Error("Song not found");

  const extension = path.extname(input.filename).toLowerCase();
  const supplied = input.mime && input.mime !== "application/octet-stream" ? input.mime : undefined;
  const mime = (supplied ?? MIME_BY_EXT[extension] ?? "application/octet-stream").split(";")[0].trim();
  const allowed = ["application/pdf", "text/plain", "image/png", "image/jpeg", "image/webp"];
  if (!allowed.includes(mime)) {
    throw new Error(`Unsupported file type: ${mime || extension || "unknown"}`);
  }
  const storedMime = mime === "text/plain" ? "text/plain; charset=utf-8" : mime;

  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const existing = db
    .prepare(
      "SELECT * FROM song_assets WHERE song_id = ? AND sha256 = ? AND kind = ? AND COALESCE(key, '') = ? LIMIT 1",
    )
    .get(input.songId, sha256, input.kind, input.key ?? "") as AssetRow | undefined;
  if (existing) return map(existing);

  const dir = path.join(ASSETS_DIR, "songs", input.songId);
  fs.mkdirSync(dir, { recursive: true });
  const safeExt = extension && /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ".bin";
  const absolute = path.join(dir, `${sha256}${safeExt}`);
  if (!fs.existsSync(absolute)) fs.writeFileSync(absolute, input.buffer);

  const id = randomUUID();
  const relative = path.relative(DATA_DIR, absolute);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO song_assets
     (id, song_id, kind, title, key, format, mime, path, bytes, sha256, pages, source, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    id,
    input.songId,
    input.kind,
    input.title?.trim() || path.basename(input.filename),
    input.key ?? null,
    safeExt.slice(1),
    storedMime,
    relative,
    input.buffer.byteLength,
    sha256,
    input.source ?? null,
    now,
    input.userId,
  );

  const row = db.prepare("SELECT * FROM song_assets WHERE id = ?").get(id) as AssetRow;
  return map(row);
}

export function deleteAsset(id: string): boolean {
  const row = db.prepare("SELECT * FROM song_assets WHERE id = ?").get(id) as AssetRow | undefined;
  if (!row) return false;
  db.prepare("DELETE FROM song_assets WHERE id = ?").run(id);
  const stillUsed = db.prepare("SELECT id FROM song_assets WHERE path = ? LIMIT 1").get(row.path);
  if (!stillUsed) {
    try {
      fs.unlinkSync(path.resolve(DATA_DIR, row.path));
    } catch {
      // File may already be gone.
    }
  }
  return true;
}
