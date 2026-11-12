import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requirePermission } from "../auth.js";
import { getSongSelectWatchStatus, runSongSelectWatch } from "../songselect-watch.js";

const scanSchema = z.object({
  force: z.boolean().optional(),
});

export async function songSelectRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/integrations/songselect/watch",
    { preHandler: requireAuth },
    async () => ({ status: getSongSelectWatchStatus() }),
  );

  app.post(
    "/api/integrations/songselect/watch/scan",
    { preHandler: [requireAuth, requirePermission("songs")] },
    async (request, reply) => {
      const parsed = scanSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid scan request", issues: parsed.error.issues });
      }
      const report = await runSongSelectWatch(Boolean(parsed.data.force));
      if (!report) {
        return reply.code(409).send({ error: "A scan is already running" });
      }
      return { report, status: getSongSelectWatchStatus() };
    },
  );
}
