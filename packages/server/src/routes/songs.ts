import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  chordProPreviewSchema,
  simplifySongPageIds,
  songBulkDeleteSchema,
  songDifferentSchema,
  songInputSchema,
  songPageIdFixApplySchema,
  songPageNameCandidates,
  songPrioritySchema,
  songVerseOrderInputSchema,
  songVerseOrderPatchSchema,
  type Song,
  type SongPageIdFixPreview,
  type SongPageIdFixScan,
  type SongVerseOrder,
} from "@sm/shared";
import { db } from "../db.js";
import { requireAuth, requirePermission } from "../auth.js";
import { saveSongToGit, deleteSongFromGit, deleteSongsFromGit } from "../git-store.js";
import { addDefaultVerseTags } from "../lyrics.js";
import { parseChordPro } from "../importers/index.js";
import { getAppSettings } from "../settings.js";
import { findDuplicateGroups, findSongAlternatives } from "../song-matching.js";

interface SongRow {
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
  priority: number;
  different_from_ids: string | null;
  source_format: string | null;
  source_path: string | null;
  created_at: string;
  updated_at: string;
}

interface VerseOrderRow {
  id: string;
  song_id: string;
  name: string;
  order_text: string;
  created_at: string;
  updated_at: string;
}

function mapVerseOrder(row: VerseOrderRow): SongVerseOrder {
  return {
    id: row.id,
    songId: row.song_id,
    name: row.name,
    order: row.order_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function verseOrders(songId: string): SongVerseOrder[] {
  const rows = db
    .prepare(
      "SELECT * FROM song_verse_orders WHERE song_id = ? ORDER BY name COLLATE NOCASE ASC",
    )
    .all(songId) as VerseOrderRow[];
  return rows.map(mapVerseOrder);
}

function parseDifferentIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string" && Boolean(id))
      : [];
  } catch {
    return [];
  }
}

function mapSong(row: SongRow): Song {
  return {
    id: row.id,
    title: row.title,
    alternateTitles: row.alternate_titles,
    author: row.author,
    copyright: row.copyright,
    ccli: row.ccli,
    key: row.key,
    lyrics: row.lyrics,
    verseOrder: row.verse_order,
    lyricsMarkdown: Boolean(row.lyrics_markdown),
    verseOrders: verseOrders(row.id),
    priority: row.priority ?? 0,
    differentFromIds: parseDifferentIds(row.different_from_ids),
    sourceFormat: row.source_format,
    sourcePath: row.source_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pageIdFixScan(songIds?: string[]): SongPageIdFixScan {
  const shortcuts = getAppSettings().pageIdShortcuts;
  const rows = (songIds?.length
    ? db
        .prepare(
          `SELECT id, title, lyrics, verse_order FROM songs
           WHERE id IN (${songIds.map(() => "?").join(",")})`,
        )
        .all(...songIds)
    : db.prepare("SELECT id, title, lyrics, verse_order FROM songs").all()) as Array<{
    id: string;
    title: string;
    lyrics: string;
    verse_order: string | null;
  }>;
  const songs: SongPageIdFixPreview[] = [];
  let totalLabels = 0;
  for (const row of rows) {
    const simplified = simplifySongPageIds(row.lyrics, row.verse_order, shortcuts);
    const verseOrderChanged = (simplified.verseOrder ?? null) !== (row.verse_order ?? null);
    if (!simplified.changes.length && !verseOrderChanged) continue;
    songs.push({
      songId: row.id,
      title: row.title,
      changes: simplified.changes,
      lyricsChanged: simplified.lyrics !== row.lyrics,
      verseOrderChanged,
    });
    totalLabels += simplified.changes.length;
  }
  songs.sort((a, b) => a.title.localeCompare(b.title));
  return { songs, totalSongs: songs.length, totalLabels };
}

export async function songRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/songs", { preHandler: requireAuth }, async (request) => {
    const query = (request.query as { q?: string }).q?.trim();
    const rows = query
      ? (db
          .prepare(
            `SELECT * FROM songs
             WHERE title LIKE ? OR alternate_titles LIKE ? OR author LIKE ? OR lyrics LIKE ?
             ORDER BY title COLLATE NOCASE ASC LIMIT 500`,
          )
          .all(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`) as SongRow[])
      : (db.prepare("SELECT * FROM songs ORDER BY title COLLATE NOCASE ASC LIMIT 500").all() as SongRow[]);
    return { songs: rows.map(mapSong) };
  });

  app.get("/api/songs/:id/alternatives", { preHandler: requireAuth }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const current = db.prepare("SELECT * FROM songs WHERE id = ?").get(id) as SongRow | undefined;
    if (!current) return reply.code(404).send({ error: "Song not found" });
    const query = (request.query as { q?: string }).q?.trim() || null;
    const songs = db.prepare("SELECT * FROM songs").all() as SongRow[];
    return { alternatives: findSongAlternatives(current, songs, query) };
  });

  app.get("/api/songs/page-names", { preHandler: requireAuth }, async () => {
    const rows = db.prepare("SELECT lyrics FROM songs").all() as Array<{ lyrics: string }>;
    const names = new Map<string, string>();
    for (const row of rows) {
      for (const name of songPageNameCandidates(row.lyrics)) {
        if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
      }
    }
    return {
      names: [...names.values()].sort((a, b) => a.localeCompare(b)),
    };
  });

  app.post(
    "/api/songs/chordpro-preview",
    { preHandler: [requireAuth, requirePermission("songs")] },
    async (request, reply) => {
      const parsed = chordProPreviewSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid ChordPro file", issues: parsed.error.issues });
      }
      const song = parseChordPro(parsed.data.filename, parsed.data.content);
      return {
        preview: {
          filename: parsed.data.filename,
          title: song.title,
          alternateTitles: song.alternateTitles,
          author: song.author,
          copyright: song.copyright,
          ccli: song.ccli,
          key: song.key,
          lyrics: song.lyrics,
          warnings: song.warnings,
        },
      };
    },
  );

  app.get("/api/songs/duplicates", { preHandler: requireAuth }, async () => {
    const rows = db.prepare("SELECT * FROM songs").all() as SongRow[];
    return { groups: findDuplicateGroups(rows) };
  });

  app.patch(
    "/api/songs/:id/priority",
    { preHandler: [requireAuth, requirePermission("songs")] },
    async (request, reply) => {
      const parsed = songPrioritySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid priority", issues: parsed.error.issues });
      }
      const id = (request.params as { id: string }).id;
      const result = db
        .prepare("UPDATE songs SET priority = ?, updated_at = ? WHERE id = ?")
        .run(parsed.data.priority, new Date().toISOString(), id);
      if (!result.changes) return reply.code(404).send({ error: "Song not found" });
      await saveSongToGit(id).catch((error) =>
        request.log.warn({ err: error }, "git song priority save failed"),
      );
      const row = db.prepare("SELECT * FROM songs WHERE id = ?").get(id) as SongRow;
      return { song: mapSong(row) };
    },
  );

  app.post(
    "/api/songs/different",
    { preHandler: [requireAuth, requirePermission("songs")] },
    async (request, reply) => {
      const parsed = songDifferentSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid song pair", issues: parsed.error.issues });
      }
      const [firstId, secondId] = parsed.data.songIds;
      if (firstId === secondId) {
        return reply.code(400).send({ error: "Choose two different songs" });
      }
      const first = db.prepare("SELECT * FROM songs WHERE id = ?").get(firstId) as
        | SongRow
        | undefined;
      const second = db.prepare("SELECT * FROM songs WHERE id = ?").get(secondId) as
        | SongRow
        | undefined;
      if (!first || !second) return reply.code(404).send({ error: "Song not found" });
      const firstDifferent = new Set(parseDifferentIds(first.different_from_ids));
      const secondDifferent = new Set(parseDifferentIds(second.different_from_ids));
      firstDifferent.add(secondId);
      secondDifferent.add(firstId);
      const now = new Date().toISOString();
      const update = db.prepare(
        "UPDATE songs SET different_from_ids = ?, updated_at = ? WHERE id = ?",
      );
      db.transaction(() => {
        update.run(JSON.stringify([...firstDifferent]), now, firstId);
        update.run(JSON.stringify([...secondDifferent]), now, secondId);
      })();
      await Promise.all([
        saveSongToGit(firstId).catch((error) =>
          request.log.warn({ err: error }, "git song difference save failed"),
        ),
        saveSongToGit(secondId).catch((error) =>
          request.log.warn({ err: error }, "git song difference save failed"),
        ),
      ]);
      return {
        songs: [
          mapSong(db.prepare("SELECT * FROM songs WHERE id = ?").get(firstId) as SongRow),
          mapSong(db.prepare("SELECT * FROM songs WHERE id = ?").get(secondId) as SongRow),
        ],
      };
    },
  );

  app.get(
    "/api/songs/page-id-fixes",
    { preHandler: [requireAuth, requirePermission("songs")] },
    async () => pageIdFixScan(),
  );

  app.post(
    "/api/songs/page-id-fixes/apply",
    { preHandler: [requireAuth, requirePermission("songs")] },
    async (request, reply) => {
      const parsed = songPageIdFixApplySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid fix request", issues: parsed.error.issues });
      }
      const preview = pageIdFixScan(parsed.data.songIds);
      const ids = new Set(preview.songs.map((song) => song.songId));
      const rows = (ids.size
        ? db
            .prepare(
              `SELECT id, lyrics, verse_order FROM songs
               WHERE id IN (${[...ids].map(() => "?").join(",")})`,
            )
            .all(...ids)
        : []) as Array<{ id: string; lyrics: string; verse_order: string | null }>;
      const shortcuts = getAppSettings().pageIdShortcuts;
      const now = new Date().toISOString();
      const update = db.prepare(
        "UPDATE songs SET lyrics = ?, verse_order = ?, updated_at = ? WHERE id = ?",
      );
      const updatedIds: string[] = [];
      const transaction = db.transaction(() => {
        for (const row of rows) {
          const simplified = simplifySongPageIds(row.lyrics, row.verse_order, shortcuts);
          if (
            simplified.lyrics === row.lyrics &&
            (simplified.verseOrder ?? null) === (row.verse_order ?? null)
          ) {
            continue;
          }
          update.run(simplified.lyrics, simplified.verseOrder, now, row.id);
          updatedIds.push(row.id);
        }
      });
      transaction();
      for (const id of updatedIds) {
        await saveSongToGit(id).catch((error) =>
          request.log.warn({ err: error }, "git page id fix save failed"),
        );
      }
      return { ok: true, updated: updatedIds.length, ids: updatedIds };
    },
  );

  app.get("/api/songs/:id", { preHandler: requireAuth }, async (request, reply) => {
    const row = db.prepare("SELECT * FROM songs WHERE id = ?").get((request.params as { id: string }).id) as
      | SongRow
      | undefined;
    if (!row) return reply.code(404).send({ error: "Song not found" });
    return { song: mapSong(row) };
  });

  app.post(
    "/api/songs",
    { preHandler: [requireAuth, requirePermission("songs")] },
    async (request, reply) => {
      const parsed = songInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid song", issues: parsed.error.issues });
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO songs (id, title, alternate_titles, author, copyright, ccli, key, lyrics, verse_order, lyrics_markdown, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        parsed.data.title,
        parsed.data.alternateTitles ?? null,
        parsed.data.author ?? null,
        parsed.data.copyright ?? null,
        parsed.data.ccli ?? null,
        parsed.data.key ?? null,
        addDefaultVerseTags(parsed.data.lyrics),
        parsed.data.verseOrder ?? null,
        parsed.data.lyricsMarkdown ? 1 : 0,
        now,
        now,
      );
      const row = db.prepare("SELECT * FROM songs WHERE id = ?").get(id) as SongRow;
      await saveSongToGit(id).catch((error) => request.log.warn({ err: error }, "git save failed"));
      return reply.code(201).send({ song: mapSong(row) });
    },
  );

  app.patch(
    "/api/songs/:id",
    { preHandler: [requireAuth, requirePermission("songs")] },
    async (request, reply) => {
      const parsed = songInputSchema.partial().safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid song", issues: parsed.error.issues });
      const id = (request.params as { id: string }).id;
      const existing = db.prepare("SELECT * FROM songs WHERE id = ?").get(id) as SongRow | undefined;
      if (!existing) return reply.code(404).send({ error: "Song not found" });
      const data = parsed.data;
      db.prepare(
        `UPDATE songs SET title = ?, alternate_titles = ?, author = ?, copyright = ?, ccli = ?, key = ?, lyrics = ?, verse_order = ?,
           lyrics_markdown = ?, updated_at = ? WHERE id = ?`,
      ).run(
        data.title ?? existing.title,
        data.alternateTitles !== undefined ? data.alternateTitles : existing.alternate_titles,
        data.author !== undefined ? data.author : existing.author,
        data.copyright !== undefined ? data.copyright : existing.copyright,
        data.ccli !== undefined ? data.ccli : existing.ccli,
        data.key !== undefined ? data.key : existing.key,
        data.lyrics !== undefined ? addDefaultVerseTags(data.lyrics) : existing.lyrics,
        data.verseOrder !== undefined ? data.verseOrder : existing.verse_order,
        data.lyricsMarkdown !== undefined ? (data.lyricsMarkdown ? 1 : 0) : existing.lyrics_markdown,
        new Date().toISOString(),
        id,
      );
      const row = db.prepare("SELECT * FROM songs WHERE id = ?").get(id) as SongRow;
      await saveSongToGit(id).catch((error) => request.log.warn({ err: error }, "git save failed"));
      return { song: mapSong(row) };
    },
  );

  app.post(
    "/api/songs/:id/verse-orders",
    { preHandler: [requireAuth, requirePermission("songs")] },
    async (request, reply) => {
      const songId = (request.params as { id: string }).id;
      if (!db.prepare("SELECT id FROM songs WHERE id = ?").get(songId)) {
        return reply.code(404).send({ error: "Song not found" });
      }
      const parsed = songVerseOrderInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid verse order", issues: parsed.error.issues });
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      try {
        db.prepare(
          `INSERT INTO song_verse_orders (id, song_id, name, order_text, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(id, songId, parsed.data.name, parsed.data.order, now, now);
      } catch {
        return reply.code(409).send({ error: "A verse order with that name already exists" });
      }
      await saveSongToGit(songId).catch((error) =>
        request.log.warn({ err: error }, "git save failed"),
      );
      const row = db.prepare("SELECT * FROM song_verse_orders WHERE id = ?").get(id) as VerseOrderRow;
      return reply.code(201).send({ verseOrder: mapVerseOrder(row) });
    },
  );

  app.patch(
    "/api/songs/:id/verse-orders/:verseOrderId",
    { preHandler: [requireAuth, requirePermission("songs")] },
    async (request, reply) => {
      const { id: songId, verseOrderId } = request.params as {
        id: string;
        verseOrderId: string;
      };
      const parsed = songVerseOrderPatchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid verse order", issues: parsed.error.issues });
      }
      const existing = db
        .prepare("SELECT * FROM song_verse_orders WHERE id = ? AND song_id = ?")
        .get(verseOrderId, songId) as VerseOrderRow | undefined;
      if (!existing) return reply.code(404).send({ error: "Verse order not found" });
      try {
        db.prepare(
          "UPDATE song_verse_orders SET name = ?, order_text = ?, updated_at = ? WHERE id = ?",
        ).run(
          parsed.data.name ?? existing.name,
          parsed.data.order ?? existing.order_text,
          new Date().toISOString(),
          verseOrderId,
        );
      } catch {
        return reply.code(409).send({ error: "A verse order with that name already exists" });
      }
      await saveSongToGit(songId).catch((error) =>
        request.log.warn({ err: error }, "git save failed"),
      );
      const row = db
        .prepare("SELECT * FROM song_verse_orders WHERE id = ?")
        .get(verseOrderId) as VerseOrderRow;
      return { verseOrder: mapVerseOrder(row) };
    },
  );

  app.delete(
    "/api/songs/:id/verse-orders/:verseOrderId",
    { preHandler: [requireAuth, requirePermission("songs")] },
    async (request, reply) => {
      const { id: songId, verseOrderId } = request.params as {
        id: string;
        verseOrderId: string;
      };
      const result = db
        .prepare("DELETE FROM song_verse_orders WHERE id = ? AND song_id = ?")
        .run(verseOrderId, songId);
      if (!result.changes) return reply.code(404).send({ error: "Verse order not found" });
      await saveSongToGit(songId).catch((error) =>
        request.log.warn({ err: error }, "git save failed"),
      );
      return { ok: true };
    },
  );

  app.post(
    "/api/songs/bulk-delete",
    { preHandler: [requireAuth, requirePermission("songs")] },
    async (request, reply) => {
      const parsed = songBulkDeleteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid song selection", issues: parsed.error.issues });
      }
      const ids = [...new Set(parsed.data.ids)];
      const remove = db.prepare("DELETE FROM songs WHERE id = ?");
      const removeTx = db.transaction(() => {
        const removed: string[] = [];
        for (const id of ids) {
          if (remove.run(id).changes) removed.push(id);
        }
        return removed;
      });
      const removed = removeTx();
      await deleteSongsFromGit(removed).catch((error) =>
        request.log.warn({ err: error }, "git bulk song delete failed"),
      );
      return { ok: true, deleted: removed.length, ids: removed };
    },
  );

  app.delete(
    "/api/songs/:id",
    { preHandler: [requireAuth, requirePermission("songs")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const result = db.prepare("DELETE FROM songs WHERE id = ?").run(id);
      if (!result.changes) return reply.code(404).send({ error: "Song not found" });
      await deleteSongFromGit(id).catch((error) => request.log.warn({ err: error }, "git delete failed"));
      return { ok: true };
    },
  );
}
