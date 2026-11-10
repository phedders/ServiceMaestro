import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { songInputSchema, type Song } from "@wlm/shared";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { saveSongToGit, deleteSongFromGit } from "../git-store.js";

interface SongRow {
  id: string;
  title: string;
  author: string | null;
  copyright: string | null;
  ccli: string | null;
  key: string | null;
  lyrics: string;
  verse_order: string | null;
  source_format: string | null;
  source_path: string | null;
  created_at: string;
  updated_at: string;
}

function mapSong(row: SongRow): Song {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    copyright: row.copyright,
    ccli: row.ccli,
    key: row.key,
    lyrics: row.lyrics,
    verseOrder: row.verse_order,
    sourceFormat: row.source_format,
    sourcePath: row.source_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function songRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/songs", { preHandler: requireAuth }, async (request) => {
    const query = (request.query as { q?: string }).q?.trim();
    const rows = query
      ? (db
          .prepare(
            `SELECT * FROM songs
             WHERE title LIKE ? OR author LIKE ? OR lyrics LIKE ?
             ORDER BY title COLLATE NOCASE ASC LIMIT 500`,
          )
          .all(`%${query}%`, `%${query}%`, `%${query}%`) as SongRow[])
      : (db.prepare("SELECT * FROM songs ORDER BY title COLLATE NOCASE ASC LIMIT 500").all() as SongRow[]);
    return { songs: rows.map(mapSong) };
  });

  app.get("/api/songs/:id", { preHandler: requireAuth }, async (request, reply) => {
    const row = db.prepare("SELECT * FROM songs WHERE id = ?").get((request.params as { id: string }).id) as
      | SongRow
      | undefined;
    if (!row) return reply.code(404).send({ error: "Song not found" });
    return { song: mapSong(row) };
  });

  app.post(
    "/api/songs",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const parsed = songInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid song", issues: parsed.error.issues });
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO songs (id, title, author, copyright, ccli, key, lyrics, verse_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        parsed.data.title,
        parsed.data.author ?? null,
        parsed.data.copyright ?? null,
        parsed.data.ccli ?? null,
        parsed.data.key ?? null,
        parsed.data.lyrics,
        parsed.data.verseOrder ?? null,
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
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const parsed = songInputSchema.partial().safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid song", issues: parsed.error.issues });
      const id = (request.params as { id: string }).id;
      const existing = db.prepare("SELECT * FROM songs WHERE id = ?").get(id) as SongRow | undefined;
      if (!existing) return reply.code(404).send({ error: "Song not found" });
      const data = parsed.data;
      db.prepare(
        `UPDATE songs SET title = ?, author = ?, copyright = ?, ccli = ?, key = ?, lyrics = ?, verse_order = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        data.title ?? existing.title,
        data.author !== undefined ? data.author : existing.author,
        data.copyright !== undefined ? data.copyright : existing.copyright,
        data.ccli !== undefined ? data.ccli : existing.ccli,
        data.key !== undefined ? data.key : existing.key,
        data.lyrics ?? existing.lyrics,
        data.verseOrder !== undefined ? data.verseOrder : existing.verse_order,
        new Date().toISOString(),
        id,
      );
      const row = db.prepare("SELECT * FROM songs WHERE id = ?").get(id) as SongRow;
      await saveSongToGit(id).catch((error) => request.log.warn({ err: error }, "git save failed"));
      return { song: mapSong(row) };
    },
  );

  app.delete(
    "/api/songs/:id",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const result = db.prepare("DELETE FROM songs WHERE id = ?").run(id);
      if (!result.changes) return reply.code(404).send({ error: "Song not found" });
      await deleteSongFromGit(id).catch((error) => request.log.warn({ err: error }, "git delete failed"));
      return { ok: true };
    },
  );
}
