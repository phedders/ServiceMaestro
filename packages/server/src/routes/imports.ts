import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth.js";
import { importSongs, scanSongs } from "../importer.js";
import { parseSongFile } from "../importers/index.js";

const applySchema = z.object({
  paths: z.array(z.string().min(1).max(1000)).max(2000).optional(),
  decisions: z
    .array(
      z.object({
        path: z.string().min(1).max(1000),
        action: z.enum(["skip", "replace", "duplicate"]),
        title: z.string().trim().max(300).optional(),
        alternateTitles: z.string().trim().max(2000).optional().nullable(),
      }),
    )
    .max(2000)
    .optional(),
  simplifyPageIds: z.boolean().optional(),
});

const parseSchema = z.object({
  filename: z.string().min(1).max(500),
  content: z.string().min(1).max(2_000_000),
});

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/import/scan",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (_request, reply) => {
      try {
        return scanSongs();
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.post(
    "/api/import/apply",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const parsed = applySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid import request", issues: parsed.error.issues });
      }
      try {
        return importSongs(
          parsed.data.paths,
          undefined,
          parsed.data.decisions,
          { simplifyPageIds: parsed.data.simplifyPageIds },
        );
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.post(
    "/api/import/parse",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const parsed = parseSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid file", issues: parsed.error.issues });
      }
      return { song: parseSongFile(parsed.data.filename, parsed.data.content) };
    },
  );
}
