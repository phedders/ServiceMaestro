import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import {
  reorderSchema,
  setlistInputSchema,
  setlistItemInputSchema,
  setlistItemPatchSchema,
  type SetlistDetail,
  type SetlistItem,
  type SetlistSummary,
} from "@wlm/shared";
import { db } from "../db.js";
import { requireAuth, requireRole } from "../auth.js";
import { live } from "../live.js";
import { saveSetlistToGit, deleteSetlistFromGit, saveSongToGit } from "../git-store.js";
import { extractTextFormat } from "../render.js";

interface SetlistRow {
  id: string;
  name: string;
  service_date: string;
  service_time: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  item_count?: number;
}

interface ItemRow {
  id: string;
  position: number;
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
}

interface SongRow {
  id: string;
  title: string;
  key: string | null;
  lyrics: string;
  verse_order: string | null;
}

function mapItem(row: ItemRow): SetlistItem {
  return {
    id: row.id,
    position: row.position,
    kind: row.kind,
    songId: row.song_id,
    title: row.title,
    content: row.content,
    format: (row.text_format as SetlistItem["format"]) ?? null,
    keyOverride: row.key_override,
    transpose: row.transpose,
    maxLines: row.max_lines,
    verseOrder: row.verse_order,
    notes: row.notes,
  };
}

function mapSetlist(row: SetlistRow): SetlistSummary {
  return {
    id: row.id,
    name: row.name,
    serviceDate: row.service_date,
    serviceTime: row.service_time,
    notes: row.notes,
    itemCount: row.item_count ?? 0,
    updatedAt: row.updated_at,
  };
}

async function persistGit(id: string, request: FastifyRequest): Promise<void> {
  await saveSetlistToGit(id).catch((error) => request.log.warn({ err: error }, "git set list save failed"));
}

function detail(id: string): SetlistDetail | null {  const row = db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM setlist_items i WHERE i.setlist_id = s.id) AS item_count
       FROM setlists s WHERE s.id = ?`,
    )
    .get(id) as SetlistRow | undefined;
  if (!row) return null;
  const items = db
    .prepare("SELECT * FROM setlist_items WHERE setlist_id = ? ORDER BY position ASC, rowid ASC")
    .all(id) as ItemRow[];
  return { ...mapSetlist(row), items: items.map(mapItem) };
}

export async function setlistRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/setlists", { preHandler: requireAuth }, async () => {
    const rows = db
      .prepare(
        `SELECT s.*, (SELECT COUNT(*) FROM setlist_items i WHERE i.setlist_id = s.id) AS item_count
         FROM setlists s ORDER BY s.service_date DESC, s.service_time DESC, s.name COLLATE NOCASE`,
      )
      .all() as SetlistRow[];
    return { setlists: rows.map(mapSetlist) };
  });

  app.get("/api/setlists/:id", { preHandler: requireAuth }, async (request, reply) => {
    const result = detail((request.params as { id: string }).id);
    if (!result) return reply.code(404).send({ error: "Set list not found" });
    return { setlist: result };
  });

  app.post(
    "/api/setlists",
    { preHandler: [requireAuth, requireRole("admin", "editor", "operator")] },
    async (request, reply) => {
      const parsed = setlistInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid set list", issues: parsed.error.issues });
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO setlists (id, name, service_date, service_time, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        parsed.data.name,
        parsed.data.serviceDate,
        parsed.data.serviceTime ?? null,
        parsed.data.notes ?? null,
        now,
        now,
      );
      await persistGit(id, request);
      return reply.code(201).send({ setlist: detail(id) });
    },
  );

  app.patch(
    "/api/setlists/:id",
    { preHandler: [requireAuth, requireRole("admin", "editor", "operator")] },
    async (request, reply) => {
      const parsed = setlistInputSchema.partial().safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid set list", issues: parsed.error.issues });
      const id = (request.params as { id: string }).id;
      const existing = db.prepare("SELECT * FROM setlists WHERE id = ?").get(id) as SetlistRow | undefined;
      if (!existing) return reply.code(404).send({ error: "Set list not found" });
      const data = parsed.data;
      db.prepare(
        `UPDATE setlists SET name = ?, service_date = ?, service_time = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        data.name ?? existing.name,
        data.serviceDate ?? existing.service_date,
        data.serviceTime !== undefined ? data.serviceTime : existing.service_time,
        data.notes !== undefined ? data.notes : existing.notes,
        new Date().toISOString(),
        id,
      );
      await persistGit(id, request);
      return { setlist: detail(id) };
    },
  );

  app.delete(
    "/api/setlists/:id",
    { preHandler: [requireAuth, requireRole("admin", "editor", "operator")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const result = db.prepare("DELETE FROM setlists WHERE id = ?").run(id);
      if (!result.changes) return reply.code(404).send({ error: "Set list not found" });
      await deleteSetlistFromGit(id).catch((error) => request.log.warn({ err: error }, "git delete failed"));
      return { ok: true };
    },
  );

  app.post(
    "/api/setlists/:id/items",
    { preHandler: [requireAuth, requireRole("admin", "editor", "operator")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      if (!db.prepare("SELECT id FROM setlists WHERE id = ?").get(id)) {
        return reply.code(404).send({ error: "Set list not found" });
      }
      const parsed = setlistItemInputSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid item", issues: parsed.error.issues });
      const data = parsed.data;

      let title = data.title?.trim() ?? "";
      let content = data.content ?? null;
      let format = data.kind === "text" ? data.format ?? null : null;
      if (data.kind === "song") {
        if (!data.songId) return reply.code(400).send({ error: "songId is required for song items" });
        const song = db.prepare("SELECT title FROM songs WHERE id = ?").get(data.songId) as
          | { title: string }
          | undefined;
        if (!song) return reply.code(400).send({ error: "Song not found" });
        title = title || song.title;
        content = null;
      } else {
        if (!content) return reply.code(400).send({ error: "content is required for text items" });
        const extracted = extractTextFormat(content);
        if (extracted.format) {
          content = extracted.content;
          if (!format) format = extracted.format;
        }
        title = title || content.split("\n").find((line) => line.trim())?.trim() || "Text";
      }

      const row = db
        .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM setlist_items WHERE setlist_id = ?")
        .get(id) as { next: number };
      const itemId = randomUUID();
      db.prepare(
        `INSERT INTO setlist_items
         (id, setlist_id, position, kind, song_id, title, content, text_format, key_override, transpose, max_lines, verse_order, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        itemId,
        id,
        row.next,
        data.kind,
        data.songId ?? null,
        title,
        content,
        format,
        data.keyOverride ?? null,
        data.transpose ?? 0,
        data.maxLines ?? 4,
        data.verseOrder ?? null,
        data.notes ?? null,
      );
      db.prepare("UPDATE setlists SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
      await persistGit(id, request);
      return reply.code(201).send({ setlist: detail(id) });
    },
  );

  app.patch(
    "/api/setlists/:id/items/:itemId",
    { preHandler: [requireAuth, requireRole("admin", "editor", "operator")] },
    async (request, reply) => {
      const { id, itemId } = request.params as { id: string; itemId: string };
      const parsed = setlistItemPatchSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid item", issues: parsed.error.issues });
      const existing = db
        .prepare("SELECT * FROM setlist_items WHERE id = ? AND setlist_id = ?")
        .get(itemId, id) as ItemRow | undefined;
      if (!existing) return reply.code(404).send({ error: "Item not found" });
      const data = parsed.data;
      let nextContent = data.content !== undefined ? data.content : existing.content;
      let nextFormat =
        data.format !== undefined
          ? data.format
          : (existing.text_format as SetlistItem["format"] | null);
      if (existing.kind === "text" && data.content !== undefined) {
        const extracted = extractTextFormat(nextContent ?? "");
        if (extracted.format) {
          nextContent = extracted.content;
          if (data.format === undefined) nextFormat = extracted.format;
        }
      }
      db.prepare(
        `UPDATE setlist_items SET title = ?, content = ?, text_format = ?, key_override = ?, transpose = ?, max_lines = ?, verse_order = ?, notes = ?
         WHERE id = ?`,
      ).run(
        data.title ?? existing.title,
        nextContent,
        nextFormat,
        data.keyOverride !== undefined ? data.keyOverride : existing.key_override,
        data.transpose ?? existing.transpose,
        data.maxLines ?? existing.max_lines,
        data.verseOrder !== undefined ? data.verseOrder : existing.verse_order,
        data.notes !== undefined ? data.notes : existing.notes,
        itemId,
      );
      db.prepare("UPDATE setlists SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
      await persistGit(id, request);
      return { setlist: detail(id) };
    },
  );

  app.post(
    "/api/setlists/:id/items/:itemId/save-to-inventory",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const { id, itemId } = request.params as { id: string; itemId: string };
      const parsed = setlistItemPatchSchema.safeParse(request.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: "Invalid item", issues: parsed.error.issues });
      const existing = db
        .prepare("SELECT * FROM setlist_items WHERE id = ? AND setlist_id = ?")
        .get(itemId, id) as ItemRow | undefined;
      if (!existing) return reply.code(404).send({ error: "Item not found" });
      if (existing.kind !== "song" || !existing.song_id) {
        return reply.code(400).send({ error: "Only song items can be saved to the song library" });
      }
      const song = db
        .prepare("SELECT id, title, key, lyrics, verse_order FROM songs WHERE id = ?")
        .get(existing.song_id) as SongRow | undefined;
      if (!song) return reply.code(404).send({ error: "Song not found" });

      const data = parsed.data;
      const title = (data.title !== undefined ? data.title.trim() : existing.title) || song.title;
      const content = data.content !== undefined ? data.content : existing.content;
      const key = data.keyOverride !== undefined ? data.keyOverride : existing.key_override;
      const transpose = data.transpose ?? existing.transpose;
      const maxLines = data.maxLines ?? existing.max_lines;
      const verseOrder = data.verseOrder !== undefined ? data.verseOrder : existing.verse_order;
      const notes = data.notes !== undefined ? data.notes : existing.notes;
      const now = new Date().toISOString();

      const apply = db.transaction(() => {
        db.prepare(
          `UPDATE songs SET title = ?, key = ?, lyrics = ?, verse_order = ?, updated_at = ? WHERE id = ?`,
        ).run(
          title,
          key !== undefined ? key : song.key,
          content !== undefined && content !== null ? content : song.lyrics,
          verseOrder !== undefined ? verseOrder : song.verse_order,
          now,
          song.id,
        );
        // The item now follows the library version again; transpose, notes and
        // screen/page settings remain specific to this set list.
        db.prepare(
          `UPDATE setlist_items SET title = ?, content = NULL, key_override = NULL,
             transpose = ?, max_lines = ?, verse_order = NULL, notes = ? WHERE id = ?`,
        ).run(title, transpose, maxLines, notes, itemId);
        db.prepare("UPDATE setlists SET updated_at = ? WHERE id = ?").run(now, id);
      });
      apply();

      await saveSongToGit(song.id).catch((error) =>
        request.log.warn({ err: error }, "git song save failed"),
      );
      await persistGit(id, request);
      return { setlist: detail(id) };
    },
  );

  app.delete(
    "/api/setlists/:id/items/:itemId",
    { preHandler: [requireAuth, requireRole("admin", "editor", "operator")] },
    async (request, reply) => {
      const { id, itemId } = request.params as { id: string; itemId: string };
      const result = db
        .prepare("DELETE FROM setlist_items WHERE id = ? AND setlist_id = ?")
        .run(itemId, id);
      if (!result.changes) return reply.code(404).send({ error: "Item not found" });
      db.prepare("UPDATE setlists SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
      await persistGit(id, request);
      return { setlist: detail(id) };
    },
  );

  app.post(
    "/api/setlists/:id/reorder",
    { preHandler: [requireAuth, requireRole("admin", "editor", "operator")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const parsed = reorderSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid order" });
      const current = db.prepare("SELECT id FROM setlist_items WHERE setlist_id = ?").all(id) as Array<{ id: string }>;
      const currentIds = new Set(current.map((row) => row.id));
      if (parsed.data.ids.length !== currentIds.size || parsed.data.ids.some((itemId) => !currentIds.has(itemId))) {
        return reply.code(400).send({ error: "Reorder must include every item exactly once" });
      }
      const updateOrder = db.transaction((ids: string[]) => {
        const stmt = db.prepare("UPDATE setlist_items SET position = ? WHERE id = ? AND setlist_id = ?");
        ids.forEach((itemId, index) => stmt.run(index, itemId, id));
        db.prepare("UPDATE setlists SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
      });
      updateOrder(parsed.data.ids);
      await persistGit(id, request);
      return { setlist: detail(id) };
    },
  );

  app.get("/api/setlists/:id/revisions", { preHandler: requireAuth }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!db.prepare("SELECT id FROM setlists WHERE id = ?").get(id)) {
      return reply.code(404).send({ error: "Set list not found" });
    }
    return { revisions: live.listRevisions(id) };
  });

  app.post(
    "/api/setlists/:id/publish",
    { preHandler: [requireAuth, requireRole("admin", "editor", "operator")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      try {
        const revision = live.publish(id, request.user?.id ?? null);
        return reply.code(201).send({ revision });
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );
}
