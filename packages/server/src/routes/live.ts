import type { FastifyInstance } from "fastify";
import {
  liveCommandSchema,
  liveApplySchema,
  quickImageSchema,
  quickSongSchema,
  quickTextSchema,
  startSessionSchema,
} from "@sm/shared";
import { requireAuth, requirePermission } from "../auth.js";
import { live } from "../live.js";

export async function liveRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/live", { preHandler: requireAuth }, async () => {
    return { state: live.getState() };
  });

  app.post(
    "/api/live/start",
    { preHandler: [requireAuth, requirePermission("live")] },
    async (request, reply) => {
      const parsed = startSessionSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid start request" });
      try {
        return { state: live.start(parsed.data.setlistId, parsed.data.status, request.user?.id ?? null) };
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.post(
    "/api/live/command",
    { preHandler: [requireAuth, requirePermission("live")] },
    async (request, reply) => {
      const parsed = liveCommandSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid command", issues: parsed.error.issues });
      return { state: live.command(parsed.data) };
    },
  );

  app.post(
    "/api/live/quick-text",
    { preHandler: [requireAuth, requirePermission("live")] },
    async (request, reply) => {
      const parsed = quickTextSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid text" });
      return { state: live.quickText(parsed.data.text) };
    },
  );

  app.post(
    "/api/live/quick-song",
    { preHandler: [requireAuth, requirePermission("live")] },
    async (request, reply) => {
      const parsed = quickSongSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid song", issues: parsed.error.issues });
      }
      try {
        return {
          state: live.quickSong(parsed.data.songId, {
            keyOverride: parsed.data.keyOverride,
            transpose: parsed.data.transpose,
            verseOrder: parsed.data.verseOrder,
          }),
        };
      } catch (error) {
        return reply.code(404).send({ error: (error as Error).message });
      }
    },
  );

  app.post(
    "/api/live/quick-image",
    { preHandler: [requireAuth, requirePermission("live")] },
    async (request, reply) => {
      const parsed = quickImageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid image", issues: parsed.error.issues });
      }
      try {
        return { state: live.quickImage(parsed.data.path, parsed.data.title) };
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.post(
    "/api/live/apply",
    { preHandler: [requireAuth, requirePermission("live")] },
    async (request, reply) => {
      const parsed = liveApplySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid apply request", issues: parsed.error.issues });
      }
      try {
        const state = parsed.data.revisionId
          ? live.applyRevision(parsed.data.revisionId, parsed.data.mode)
          : live.applyCurrent(parsed.data.setlistId!, parsed.data.mode, request.user?.id ?? null);
        return { state };
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.post(
    "/api/live/stop",
    { preHandler: [requireAuth, requirePermission("live")] },
    async () => {
      return { state: live.stop() };
    },
  );
}
