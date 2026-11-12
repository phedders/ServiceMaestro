import type { FastifyInstance } from "fastify";
import { requireAuth, requireRole } from "../auth.js";
import { exportActivityCsv, listActivity } from "../activity.js";

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/activity/export",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const query = request.query as {
        module?: string;
        userId?: string;
        q?: string;
      };
      const filename = `service-maestro-activity-${new Date().toISOString().slice(0, 10)}.csv`;
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="${filename}"`);
      return exportActivityCsv({
        module: query.module?.trim() || undefined,
        userId: query.userId?.trim() || undefined,
        q: query.q?.trim() || undefined,
      });
    },
  );

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
