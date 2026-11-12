import { randomUUID } from "node:crypto";
import type {
  SiteScraperImportResult,
  SiteScraperSearchResult,
  SongResourceKind,
} from "@sm/shared";
import { deleteAsset, saveAsset } from "./assets.js";
import { db } from "./db.js";
import { saveSongToGit } from "./git-store.js";
import { parseChordPro, parsePlainText } from "./importers/index.js";
import { downloadSiteSong } from "./site-scraping.js";

const LEGAL_LINE =
  /^(ccli\s*(song|licen[cs]e)|for use solely with the songselect|note:\s*reproduction|©|copyright|\(c\)|all rights reserved)/i;

function cleanLyrics(value: string): string {
  return value
    .split("\n")
    .filter((line) => !LEGAL_LINE.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function assetKind(kind: SongResourceKind): "chordpro" | "lyrics" | "score_pdf" | null {
  if (kind === "chord" || kind === "songpro") return "chordpro";
  if (kind === "lyrics") return "lyrics";
  if (kind === "lead" || kind === "vocal") return "score_pdf";
  return null;
}

function assetTitle(kind: SongResourceKind): string {
  if (kind === "lead") return "Lead sheet";
  if (kind === "vocal") return "Vocal sheet";
  if (kind === "chord") return "ChordPro";
  if (kind === "lyrics") return "Lyrics";
  return "Song file";
}

export async function importSiteSong(
  userId: string,
  providerId: string,
  song: SiteScraperSearchResult,
  kinds: SongResourceKind[] = [],
  assetUserId: string | null = null,
): Promise<SiteScraperImportResult> {
  const selected = kinds.length ? kinds : song.availableKinds;
  const files = await downloadSiteSong(userId, providerId, song, selected);
  if (!files.length) throw new Error("No downloadable files returned");
  const chordFile = files.find((file) => file.kind === "chord" || file.kind === "songpro");
  const lyricsFile = files.find((file) => file.kind === "lyrics");

  const parsed = chordFile
    ? parseChordPro(chordFile.filename, chordFile.data.toString("utf8"))
    : lyricsFile
      ? parsePlainText(lyricsFile.filename, lyricsFile.data.toString("utf8"))
      : null;
  const title = parsed?.title?.trim() || song.title;
  const authors =
    parsed?.author?.trim() || (song.authors.length ? song.authors.join(", ") : null);
  const ccli = parsed?.ccli?.trim() || song.songNumber || null;
  const key = parsed?.key?.trim() || null;
  const copyright = parsed?.copyright?.trim() || null;
  const lyrics = cleanLyrics(parsed?.lyrics ?? "");
  const now = new Date().toISOString();
  const sourceUrl = `${song.provider === "songselect" ? "https://songselect.ccli.com" : ""}/songs/${encodeURIComponent(song.songNumber)}/${encodeURIComponent(song.slug)}`;

  const existing = ccli
    ? (db.prepare("SELECT * FROM songs WHERE ccli = ? LIMIT 1").get(ccli) as
        | { id: string; lyrics: string }
        | undefined)
    : undefined;
  let songId: string;
  let created = false;
  if (existing) {
    songId = existing.id;
    db.prepare(
      `UPDATE songs SET
         title = ?,
         author = COALESCE(author, ?),
         copyright = COALESCE(copyright, ?),
         key = COALESCE(key, ?),
         lyrics = CASE WHEN trim(lyrics) = '' THEN ? ELSE lyrics END,
         source_format = 'songselect',
         source_path = COALESCE(source_path, ?),
         updated_at = ?
       WHERE id = ?`,
    ).run(title, authors, copyright, key, lyrics, sourceUrl, now, songId);
  } else {
    songId = randomUUID();
    created = true;
    db.prepare(
      `INSERT INTO songs
         (id, title, alternate_titles, author, copyright, ccli, key, lyrics, verse_order,
          lyrics_markdown, source_format, source_path, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, NULL, 0, 'songselect', ?, ?, ?)`,
    ).run(songId, title, authors, copyright, ccli, key, lyrics, sourceUrl, now, now);
  }

  const assets = files
    .map((file) => {
      const kind = assetKind(file.kind);
      if (!kind) return null;
      const title = assetTitle(file.kind);
      const previous = db
        .prepare(
          `SELECT id FROM song_assets
           WHERE song_id = ? AND kind = ? AND title = ? AND COALESCE(key, '') = ? AND source = ?`,
        )
        .all(songId, kind, title, key ?? "", providerId) as Array<{ id: string }>;
      for (const row of previous) deleteAsset(row.id);
      return saveAsset({
        songId,
        buffer: file.data,
        filename: file.filename,
        mime: file.mime,
        kind,
        title,
        key,
        source: providerId,
        userId: assetUserId,
      });
    })
    .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));

  await saveSongToGit(songId);
  return {
    song: { id: songId, title, ccli },
    created,
    files: files.map((file) => ({
      kind: file.kind,
      filename: file.filename,
      bytes: file.data.byteLength,
    })),
    assets: assets.length,
  };
}
