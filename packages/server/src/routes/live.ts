import type { FastifyInstance } from "fastify";
import { liveCommandSchema, liveApplySchema, quickTextSchema, startSessionSchema } from "@wlm/shared";
import { requireAuth, requireRole } from "../auth.js";
import { live } from "../live.js";

export async function liveRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/live", { preHandler: requireAuth }, async () => {
    return { state: live.getState() };
  });

  app.post(
    "/api/live/start",
    { preHandler: [requireAuth, requireRole("admin", "operator", "editor")] },
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
    { preHandler: [requireAuth, requireRole("admin", "operator", "editor")] },
    async (request, reply) => {
      const parsed = liveCommandSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid command", issues: parsed.error.issues });
      return { state: live.command(parsed.data) };
    },
  );

  app.post(
    "/api/live/quick-text",
    { preHandler: [requireAuth, requireRole("admin", "operator", "editor")] },
    async (request, reply) => {
      const parsed = quickTextSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Invalid text" });
      return { state: live.quickText(parsed.data.text) };
    },
  );

  app.post(
    "/api/live/apply",
    { preHandler: [requireAuth, requireRole("admin", "operator", "editor")] },
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
    { preHandler: [requireAuth, requireRole("admin", "operator", "editor")] },
    async () => {
      return { state: live.stop() };
    },
  );
}
