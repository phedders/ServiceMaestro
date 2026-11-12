import type { FastifyInstance } from "fastify";
import { requireAuth, requireRole } from "../auth.js";
import { listActivity } from "../activity.js";

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/activity",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request) => {
      const query = request.query as {
        limit?: string;
        offset?: string;
        module?: string;
        userId?: string;
        q?: string;
      };
      return listActivity({
        limit: query.limit === undefined ? 100 : Number(query.limit),
        offset: query.offset === undefined ? 0 : Number(query.offset),
        module: query.module?.trim() || undefined,
        userId: query.userId?.trim() || undefined,
        q: query.q?.trim() || undefined,
      });
    },
  );
}
