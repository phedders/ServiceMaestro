import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import type {
  SetlistImportPreview,
  SetlistImportReport,
  SongAssetKind,
} from "@wlm/shared";
import { db } from "./db.js";
import { getAsset, listAssets, saveAsset } from "./assets.js";

const FORMAT = "wlm.setlist";
const FORMAT_VERSION = 1;
const MAX_BUNDLE = 200 * 1024 * 1024;

const songSchema = z.object({
  title: z.string(),
  alternateTitles: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  copyright: z.string().nullable().optional(),
  ccli: z.string().nullable().optional(),
  key: z.string().nullable().optional(),
  lyrics: z.string(),
  verseOrder: z.string().nullable().optional(),
  lyricsMarkdown: z.boolean().optional(),
  verseOrders: z
    .array(z.object({ name: z.string(), order: z.string() }))
    .optional(),
});

const itemSchema = z.object({
  position: z.number().int().min(0),
  kind: z.enum(["song", "text"]),
  title: z.string(),
  songId: z.string().optional().nullable(),
  keyOverride: z.string().nullable().optional(),
  transpose: z.number().int().optional(),
  maxLines: z.number().int().optional(),
  verseOrder: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  format: z.enum(["text", "markdown", "html", "rst"]).nullable().optional(),
  song: songSchema.nullable().optional(),
  assetIds: z.array(z.string()).optional(),
});

const assetSchema = z.object({
  id: z.string(),
  kind: z.enum(["score_pdf", "guitar_tab", "chordpro", "lyrics", "image"]),
  title: z.string(),
  key: z.string().nullable().optional(),
  format: z.string(),
  mime: z.string(),
  sha256: z.string(),
  bytes: z.number().int().min(0),
  path: z.string().optional(),
});

const manifestSchema = z.object({
  format: z.literal(FORMAT),
  formatVersion: z.literal(FORMAT_VERSION),
  exportedAt: z.string(),
  generator: z.string().optional(),
  selfContained: z.boolean(),
  setlist: z.object({
    id: z.string().optional(),
    name: z.string(),
    serviceDate: z.string(),
    serviceTime: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  }),
  items: z.array(itemSchema).max(1000),
  assets: z.array(assetSchema).max(1000).optional(),
});

export type SetlistManifest = z.infer<typeof manifestSchema>;

interface ParsedSetlist {
  manifest: SetlistManifest;
  files: Map<string, Uint8Array>;
}

function safeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "setlist";
}

function isZip(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

export function parseSetlistFile(buffer: Buffer, filename: string): ParsedSetlist {
  if (buffer.length > MAX_BUNDLE) throw new Error("Import file is too large");
  let json: unknown;
  const files = new Map<string, Uint8Array>();

  if (isZip(buffer)) {
    const entries = unzipSync(new Uint8Array(buffer));
    const manifestBytes = entries["manifest.json"];
    if (!manifestBytes) throw new Error("Bundle has no manifest.json");
    json = JSON.parse(strFromU8(manifestBytes));
    for (const [name, data] of Object.entries(entries)) {
      if (name.startsWith("assets/")) files.set(name, data);
    }
  } else {
    try {
      json = JSON.parse(buffer.toString("utf8"));
    } catch {
      throw new Error(`${filename} is not valid JSON`);
    }
  }

  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Invalid set list file: ${parsed.error.issues[0]?.message ?? "schema error"}`);
  }
  return { manifest: parsed.data, files };
}

function songRow(id: string): {
  id: string;
  title: string;
  alternate_titles: string | null;
  author: string | null;
  copyright: string | null;
  ccli: string | null;
  key: string | null;
  lyrics: string;
  verse_order: string | null;
  lyrics_markdown: number;
} | undefined {
  return db
    .prepare(
      "SELECT id, title, alternate_titles, author, copyright, ccli, key, lyrics, verse_order, lyrics_markdown FROM songs WHERE id = ?",
    )
    .get(id) as
    | {
        id: string;
        title: string;
        alternate_titles: string | null;
        author: string | null;
        copyright: string | null;
        ccli: string | null;
        key: string | null;
        lyrics: string;
        verse_order: string | null;
        lyrics_markdown: number;
      }
    | undefined;
}

function songVerseOrders(id: string): Array<{ name: string; order: string }> {
  return (
    db
      .prepare("SELECT name, order_text FROM song_verse_orders WHERE song_id = ? ORDER BY name COLLATE NOCASE")
      .all(id) as Array<{ name: string; order_text: string }>
  ).map((row) => ({ name: row.name, order: row.order_text }));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function buildSetlistExport(
  setlistId: string,
  selfContained: boolean,
): { manifest: SetlistManifest; files: Record<string, Uint8Array>; filename: string } {
  const setlist = db.prepare("SELECT * FROM setlists WHERE id = ?").get(setlistId) as
    | {
        id: string;
        name: string;
        service_date: string;
        service_time: string | null;
        notes: string | null;
      }
    | undefined;
  if (!setlist) throw new Error("Set list not found");

  const rows = db
    .prepare("SELECT * FROM setlist_items WHERE setlist_id = ? ORDER BY position ASC, rowid ASC")
    .all(setlistId) as Array<{
    kind: "song" | "text";
    song_id: string | null;
    title: string;
    content: string | null;
    text_format: string | null;
    key_override: string | null;
    transpose: number;
    max_lines: number;
    verse_order: string | null;
    notes: string | null;
  }>;

  const assets: NonNullable<SetlistManifest["assets"]> = [];
  const assetFiles: Record<string, Uint8Array> = {};
  const seenAssets = new Set<string>();

  const items = rows.map((row, index) => {
    if (row.kind === "song" && row.song_id) {
      const song = songRow(row.song_id);
      const songAssets = listAssets(row.song_id);
      const assetIds: string[] = [];
      for (const asset of songAssets) {
        assetIds.push(asset.id);
        if (seenAssets.has(asset.id)) continue;
        seenAssets.add(asset.id);
        const found = getAsset(asset.id);
        if (!found || !fs.existsSync(found.absolutePath)) continue;
        const entry = {
          id: asset.id,
          kind: asset.kind,
          title: asset.title,
          key: asset.key,
          format: asset.format,
          mime: asset.mime,
          sha256: asset.sha256,
          bytes: asset.bytes,
          path: `assets/${asset.id}.${asset.format}`,
        };
        assets.push(entry);
        if (selfContained) {
          assetFiles[entry.path] = new Uint8Array(fs.readFileSync(found.absolutePath));
        }
      }
      return {
        position: index,
        kind: "song" as const,
        title: row.title,
        songId: row.song_id,
        keyOverride: row.key_override,
        transpose: row.transpose,
        maxLines: row.max_lines,
        verseOrder: row.verse_order,
        notes: row.notes,
        content: row.content,
        format: null,
        song: song
          ? {
              title: song.title,
              alternateTitles: song.alternate_titles,
              author: song.author,
              copyright: song.copyright,
              ccli: song.ccli,
              key: song.key,
              lyrics: song.lyrics,
              verseOrder: song.verse_order,
              lyricsMarkdown: Boolean(song.lyrics_markdown),
              verseOrders: songVerseOrders(song.id),
            }
          : null,
        assetIds,
      };
    }
    return {
      position: index,
      kind: "text" as const,
      title: row.title,
      songId: null,
      keyOverride: row.key_override,
      transpose: row.transpose,
      maxLines: row.max_lines,
      verseOrder: row.verse_order,
      notes: row.notes,
      content: row.content ?? "",
      format: (row.text_format as SetlistManifest["items"][number]["format"]) ?? null,
    };
  });

  const manifest: SetlistManifest = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    generator: "service-maestro/0.1.0",
    selfContained,
    setlist: {
      id: setlist.id,
      name: setlist.name,
      serviceDate: setlist.service_date,
      serviceTime: setlist.service_time,
      notes: setlist.notes,
    },
    items,
    assets: assets.length ? assets : undefined,
  };

  const base = `${safeName(setlist.name)}-${setlist.service_date}`;
  return {
    manifest,
    files: assetFiles,
    filename: selfContained ? `${base}.wlm-bundle.zip` : `${base}.wlm-setlist.json`,
  };
}

export function exportSetlistBuffer(
  setlistId: string,
  selfContained: boolean,
): { buffer: Buffer; filename: string; contentType: string } {
  const { manifest, files, filename } = buildSetlistExport(setlistId, selfContained);
  if (!selfContained) {
    return {
      buffer: Buffer.from(JSON.stringify(manifest, null, 2)),
      filename,
      contentType: "application/json",
    };
  }
  const zipEntries: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
    ...files,
  };
  return {
    buffer: Buffer.from(zipSync(zipEntries)),
    filename,
    contentType: "application/zip",
  };
}

function findSongForItem(item: z.infer<typeof itemSchema>): { id: string; title: string } | null {
  if (item.song?.ccli) {
    const byCcli = db.prepare("SELECT id, title FROM songs WHERE ccli = ? LIMIT 1").get(item.song.ccli) as
      | { id: string; title: string }
      | undefined;
    if (byCcli) return byCcli;
  }
  if (item.song?.title) {
    const byTitle = db
      .prepare("SELECT id, title, author FROM songs WHERE lower(title) = lower(?)")
      .all(item.song.title) as Array<{ id: string; title: string; author: string | null }>;
    if (byTitle.length === 1) return byTitle[0];
    if (byTitle.length > 1 && item.song.author) {
      const byAuthor = byTitle.find(
        (song) => normalize(song.author ?? "") === normalize(item.song?.author ?? ""),
      );
      if (byAuthor) return byAuthor;
    }
  }
  return null;
}

export function previewSetlistImport(buffer: Buffer, filename: string): SetlistImportPreview {
  const { manifest } = parseSetlistFile(buffer, filename);
  const songs = manifest.items
    .filter((item) => item.kind === "song")
    .map((item) => {
      const match = findSongForItem(item);
      return {
        title: item.title,
        matched: Boolean(match),
        matchTitle: match?.title ?? null,
        ccli: item.song?.ccli ?? null,
      };
    });
  return {
    fileName: filename,
    selfContained: manifest.selfContained,
    name: manifest.setlist.name,
    serviceDate: manifest.setlist.serviceDate,
    serviceTime: manifest.setlist.serviceTime ?? null,
    itemCount: manifest.items.length,
    songCount: songs.length,
    textCount: manifest.items.filter((item) => item.kind === "text").length,
    songs,
  };
}

export function importSetlistFile(
  buffer: Buffer,
  filename: string,
  userId: string | null,
): SetlistImportReport {
  const { manifest, files } = parseSetlistFile(buffer, filename);
  const nameExists = db
    .prepare("SELECT id FROM setlists WHERE lower(name) = lower(?) LIMIT 1")
    .get(manifest.setlist.name);
  const name = nameExists ? `${manifest.setlist.name} (imported)` : manifest.setlist.name;
  const setlistId = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO setlists (id, name, service_date, service_time, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    setlistId,
    name,
    manifest.setlist.serviceDate,
    manifest.setlist.serviceTime ?? null,
    manifest.setlist.notes ?? null,
    now,
    now,
  );

  const insertItem = db.prepare(
    `INSERT INTO setlist_items
     (id, setlist_id, position, kind, song_id, title, content, text_format, key_override, transpose, max_lines, verse_order, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let importedItems = 0;
  let songsCreated = 0;
  let songsMatched = 0;
  let assetsImported = 0;
  const skipped: Array<{ title: string; reason: string }> = [];

  for (const item of manifest.items) {
    let songId: string | null = null;
    let content = item.content ?? null;

    if (item.kind === "song") {
      const match =
        (item.songId
          ? (db.prepare("SELECT id, title FROM songs WHERE id = ?").get(item.songId) as
              | { id: string; title: string }
              | undefined)
          : undefined) ?? findSongForItem(item);
      if (match) {
        songId = match.id;
        songsMatched += 1;
      } else if (item.song?.lyrics) {
        songId = randomUUID();
        db.prepare(
          `INSERT INTO songs
           (id, title, alternate_titles, author, copyright, ccli, key, lyrics, verse_order, lyrics_markdown, source_format, source_path, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', NULL, ?, ?)`,
        ).run(
          songId,
          item.song.title,
          item.song.alternateTitles ?? null,
          item.song.author ?? null,
          item.song.copyright ?? null,
          item.song.ccli ?? null,
          item.song.key ?? null,
          item.song.lyrics,
          item.song.verseOrder ?? null,
          item.song.lyricsMarkdown ? 1 : 0,
          now,
          now,
        );
        for (const verseOrder of item.song.verseOrders ?? []) {
          db.prepare(
            `INSERT OR IGNORE INTO song_verse_orders (id, song_id, name, order_text, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          ).run(randomUUID(), songId, verseOrder.name, verseOrder.order, now, now);
        }
        songsCreated += 1;
      } else {
        content = item.title;
        skipped.push({ title: item.title, reason: "No local match or embedded song; imported as text placeholder" });
      }
    }

    insertItem.run(
      randomUUID(),
      setlistId,
      item.position,
      songId ? "song" : "text",
      songId,
      item.title,
      content,
      item.kind === "text" ? item.format ?? null : null,
      item.keyOverride ?? null,
      item.transpose ?? 0,
      item.maxLines ?? 4,
      item.verseOrder ?? null,
      item.notes ?? null,
    );
    importedItems += 1;

    if (songId && item.assetIds?.length) {
      for (const assetId of item.assetIds) {
        const asset = manifest.assets?.find((candidate) => candidate.id === assetId);
        if (!asset?.path) continue;
        const data = files.get(asset.path);
        if (!data) continue;
        try {
          saveAsset({
            songId,
            buffer: Buffer.from(data),
            filename: asset.path,
            mime: asset.mime,
            kind: asset.kind as SongAssetKind,
            title: asset.title,
            key: asset.key ?? null,
            source: "import",
            userId,
          });
          assetsImported += 1;
        } catch (error) {
          skipped.push({ title: `${item.title} — ${asset.title}`, reason: (error as Error).message });
        }
      }
    }
  }

  return {
    setlistId,
    setlistName: name,
    importedItems,
    songsCreated,
    songsMatched,
    assetsImported,
    skipped,
  };
}
