import { createHash, randomUUID } from "node:crypto";
import type {
  ChordProFilePreview,
  SiteScraperImportResult,
  SiteScraperSearchResult,
  SiteScraperSongUpdateCheck,
  SongResourceKind,
} from "@sm/shared";
import { deleteAsset, saveAsset } from "./assets.js";
import { db } from "./db.js";
import { saveSongToGit } from "./git-store.js";
import { parseChordPro, parsePlainText } from "./importers/index.js";
import { downloadSiteSong, searchSiteSongs } from "./site-scraping.js";

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

function normalizedTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function siteMatchForSong(
  userId: string,
  providerId: string,
  songId: string,
): Promise<SiteScraperSearchResult> {
  const song = db
    .prepare("SELECT id, title, ccli FROM songs WHERE id = ?")
    .get(songId) as { id: string; title: string; ccli: string | null } | undefined;
  if (!song) throw new Error("Song not found");
  const query = song.ccli?.trim() || song.title.trim();
  if (!query) throw new Error("This song has no title or CCLI number to search for");
  const results = await searchSiteSongs(userId, providerId, query);
  const ccli = song.ccli?.trim();
  const match =
    (ccli ? results.find((result) => result.songNumber === ccli) : undefined) ??
    results.find((result) => normalizedTitle(result.title) === normalizedTitle(song.title));
  if (!match) throw new Error("No matching SongSelect song found");
  return match;
}

export async function fetchSiteSongChordPro(
  userId: string,
  providerId: string,
  songId: string,
): Promise<ChordProFilePreview> {
  const match = await siteMatchForSong(userId, providerId, songId);
  if (!match.availableKinds.includes("chord")) {
    throw new Error("SongSelect has no ChordPro file for this song");
  }
  const files = await downloadSiteSong(userId, providerId, match, ["chord"]);
  const chordFile = files.find((file) => file.kind === "chord" || file.kind === "songpro");
  if (!chordFile) throw new Error("SongSelect has no ChordPro file for this song");
  const parsed = parseChordPro(chordFile.filename, chordFile.data.toString("utf8"));
  return {
    filename: chordFile.filename,
    title: parsed.title,
    alternateTitles: parsed.alternateTitles,
    author: parsed.author,
    copyright: parsed.copyright,
    ccli: parsed.ccli,
    key: parsed.key,
    lyrics: parsed.lyrics,
    warnings: parsed.warnings,
  };
}

export async function checkSiteSongUpdates(
  userId: string,
  providerId: string,
  songId: string,
): Promise<SiteScraperSongUpdateCheck> {
  const match = await siteMatchForSong(userId, providerId, songId);

  const remoteFiles = await downloadSiteSong(
    userId,
    providerId,
    match,
    match.availableKinds,
  );
  const localAssets = db
    .prepare("SELECT kind, title, sha256 FROM song_assets WHERE song_id = ? AND source = ?")
    .all(songId, providerId) as Array<{ kind: string; title: string; sha256: string }>;
  const missingKinds: SongResourceKind[] = [];
  const changedKinds: SongResourceKind[] = [];
  for (const file of remoteFiles) {
    const kind = assetKind(file.kind);
    if (!kind) continue;
    const title = assetTitle(file.kind);
    const local = localAssets.find((asset) => asset.kind === kind && asset.title === title);
    if (!local) {
      missingKinds.push(file.kind);
      continue;
    }
    // Generated PDFs can differ byte-for-byte on every render, so only use
    // checksums for stable text artifacts when reporting content updates.
    if (kind === "chordpro" || kind === "lyrics") {
      const sha256 = createHash("sha256").update(file.data).digest("hex");
      if (sha256 !== local.sha256) changedKinds.push(file.kind);
    }
  }
  return {
    provider: providerId,
    song: match,
    missingKinds,
    changedKinds,
    hasUpdates: missingKinds.length > 0 || changedKinds.length > 0,
  };
}
