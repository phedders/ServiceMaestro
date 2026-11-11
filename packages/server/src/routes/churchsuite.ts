import type { FastifyInstance } from "fastify";
import { requireAuth, requireRole } from "../auth.js";
import {
  churchsuiteStatus,
  listChurchsuitePlanItems,
  listChurchsuitePlans,
  testChurchsuite,
} from "../churchsuite.js";

export async function churchsuiteRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/integrations/churchsuite/status", { preHandler: requireAuth }, async () => ({
    status: churchsuiteStatus(),
  }));

  app.post(
    "/api/integrations/churchsuite/test",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (_request, reply) => {
      try {
        return await testChurchsuite();
      } catch (error) {
        return reply.code(502).send({ error: (error as Error).message });
      }
    },
  );

  app.get(
    "/api/integrations/churchsuite/plans",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const query = request.query as { from?: string; to?: string; status?: string };
      try {
        return { plans: await listChurchsuitePlans(query) };
      } catch (error) {
        return reply.code(502).send({ error: (error as Error).message });
      }
    },
  );

  app.get(
    "/api/integrations/churchsuite/plans/:id/items",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ error: "Invalid plan id" });
      }
      try {
        return { items: await listChurchsuitePlanItems([id]) };
      } catch (error) {
        return reply.code(502).send({ error: (error as Error).message });
      }
    },
  );
}
