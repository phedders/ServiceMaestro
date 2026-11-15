import type { FastifyInstance } from "fastify";
import { archiveBulkSchema, type ArchivesData } from "@sm/shared";
import { requireAuth, requirePermission } from "../auth.js";
import { db } from "../db.js";
import {
  deleteSetlistFromGit,
  deleteSongsFromGit,
  saveSetlistToGit,
  saveSongToGit,
} from "../git-store.js";

function archivedSongs(): ArchivesData["songs"] {
  return (
    db
      .prepare(
        `SELECT id, title, author, ccli, key, updated_at, archived_at
         FROM songs WHERE archived_at IS NOT NULL
         ORDER BY archived_at DESC, title COLLATE NOCASE`,
      )
      .all() as Array<{
      id: string;
      title: string;
      author: string | null;
      ccli: string | null;
      key: string | null;
      updated_at: string;
      archived_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    title: row.title,
    author: row.author,
    ccli: row.ccli,
    key: row.key,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  }));
}

function archivedSetlists(): ArchivesData["setlists"] {
  return (
    db
      .prepare(
        `SELECT s.id, s.name, s.service_date, s.service_time, s.updated_at, s.archived_at,
                (SELECT COUNT(*) FROM setlist_items i WHERE i.setlist_id = s.id) AS item_count
         FROM setlists s WHERE s.archived_at IS NOT NULL
         ORDER BY s.archived_at DESC, s.service_date DESC, s.name COLLATE NOCASE`,
      )
      .all() as Array<{
      id: string;
      name: string;
      service_date: string;
      service_time: string | null;
      updated_at: string;
      archived_at: string;
      item_count: number;
    }>
  ).map((row) => ({
    id: row.id,
    name: row.name,
    serviceDate: row.service_date,
    serviceTime: row.service_time,
    itemCount: row.item_count,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  }));
}

export async function archiveRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/archives", { preHandler: requireAuth }, async () => ({
    songs: archivedSongs(),
    setlists: archivedSetlists(),
  }));

  app.post(
    "/api/archives/songs/restore",
    { preHandler: [requireAuth, requirePermission("songs")] },
    async (request, reply) => {
      const parsed = archiveBulkSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid archive selection", issues: parsed.error.issues });
      }
      const ids = [...new Set(parsed.data.ids)];
      const now = new Date().toISOString();
      const update = db.prepare(
        "UPDATE songs SET archived_at = NULL, updated_at = ? WHERE id = ? AND archived_at IS NOT NULL",
      );
      const restored: string[] = [];
      const restore = db.transaction(() => {
        for (const id of ids) {
          if (update.run(now, id).changes) restored.push(id);
        }
      });
      restore();
      for (const id of restored) {
        await saveSongToGit(id).catch((error) =>
          request.log.warn({ err: error }, "git song restore save failed"),
        );
      }
      return { ok: true, restored: restored.length, ids: restored };
    },
  );

  app.post(
    "/api/archives/songs/delete",
    { preHandler: [requireAuth, requirePermission("songs")] },
    async (request, reply) => {
      const parsed = archiveBulkSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid archive selection", issues: parsed.error.issues });
      }
      const ids = [...new Set(parsed.data.ids)];
      const remove = db.prepare("DELETE FROM songs WHERE id = ? AND archived_at IS NOT NULL");
      const deleted: string[] = [];
      const apply = db.transaction(() => {
        for (const id of ids) {
          if (remove.run(id).changes) deleted.push(id);
        }
      });
      apply();
      await deleteSongsFromGit(deleted).catch((error) =>
        request.log.warn({ err: error }, "git archived song delete failed"),
      );
      return { ok: true, deleted: deleted.length, ids: deleted };
    },
  );

  app.post(
    "/api/archives/setlists/restore",
    { preHandler: [requireAuth, requirePermission("setlists")] },
    async (request, reply) => {
      const parsed = archiveBulkSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid archive selection", issues: parsed.error.issues });
      }
      const ids = [...new Set(parsed.data.ids)];
      const now = new Date().toISOString();
      const update = db.prepare(
        "UPDATE setlists SET archived_at = NULL, updated_at = ? WHERE id = ? AND archived_at IS NOT NULL",
      );
      const restored: string[] = [];
      const restore = db.transaction(() => {
        for (const id of ids) {
          if (update.run(now, id).changes) restored.push(id);
        }
      });
      restore();
      for (const id of restored) {
        await saveSetlistToGit(id).catch((error) =>
          request.log.warn({ err: error }, "git setlist restore save failed"),
        );
      }
      return { ok: true, restored: restored.length, ids: restored };
    },
  );

  app.post(
    "/api/archives/setlists/delete",
    { preHandler: [requireAuth, requirePermission("setlists")] },
    async (request, reply) => {
      const parsed = archiveBulkSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid archive selection", issues: parsed.error.issues });
      }
      const ids = [...new Set(parsed.data.ids)];
      const remove = db.prepare(
        "DELETE FROM setlists WHERE id = ? AND archived_at IS NOT NULL",
      );
      const deleted: string[] = [];
      const apply = db.transaction(() => {
        for (const id of ids) {
          if (remove.run(id).changes) deleted.push(id);
        }
      });
      apply();
      for (const id of deleted) {
        await deleteSetlistFromGit(id).catch((error) =>
          request.log.warn({ err: error }, "git archived setlist delete failed"),
        );
      }
      return { ok: true, deleted: deleted.length, ids: deleted };
    },
  );
}
