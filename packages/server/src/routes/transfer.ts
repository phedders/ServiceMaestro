import type { FastifyInstance } from "fastify";
import { requireAuth, requirePermission } from "../auth.js";
import {
  exportSetlistBuffer,
  importSetlistFile,
  previewSetlistImport,
} from "../setlist-transfer.js";
import { buildSongSheetPdf } from "../song-sheet.js";
import { saveSetlistToGit, saveTarpLibraryToGit } from "../git-store.js";

export async function transferRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/setlists/:id/export", { preHandler: requireAuth }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const format = String((request.query as { format?: string }).format ?? "json");
    try {
      const result = exportSetlistBuffer(id, format === "bundle");
      return reply
        .type(result.contentType)
        .header("content-disposition", `attachment; filename="${result.filename}"`)
        .send(result.buffer);
    } catch (error) {
      return reply.code(404).send({ error: (error as Error).message });
    }
  });

  app.get(
    "/api/setlists/:id/songs.pdf",
    { preHandler: requireAuth },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      try {
        const result = await buildSongSheetPdf(id);
        return reply
          .type("application/pdf")
          .header("content-disposition", `attachment; filename="${result.filename}"`)
          .header("cache-control", "no-store")
          .send(result.buffer);
      } catch (error) {
        return reply.code(404).send({ error: (error as Error).message });
      }
    },
  );

  app.post(
    "/api/setlists/import/preview",
    { preHandler: [requireAuth, requirePermission("setlists")] },
    async (request, reply) => {
      const file = await request.file({ limits: { fileSize: 200 * 1024 * 1024, files: 1 } });
      if (!file) return reply.code(400).send({ error: "No file uploaded" });
      try {
        const buffer = await file.toBuffer();
        return { preview: previewSetlistImport(buffer, file.filename) };
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.post(
    "/api/setlists/import",
    { preHandler: [requireAuth, requirePermission("setlists")] },
    async (request, reply) => {
      const file = await request.file({ limits: { fileSize: 200 * 1024 * 1024, files: 1 } });
      if (!file) return reply.code(400).send({ error: "No file uploaded" });
      try {
        const buffer = await file.toBuffer();
        const report = importSetlistFile(buffer, file.filename, request.user?.id ?? null);
        await saveSetlistToGit(report.setlistId).catch((error) =>
          request.log.warn({ err: error }, "git import save failed"),
        );
        await saveTarpLibraryToGit().catch((error) =>
          request.log.warn({ err: error }, "git Tarp import save failed"),
        );
        return reply.code(201).send({ report });
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );
}
