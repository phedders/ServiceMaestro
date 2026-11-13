import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { churchsuiteImportSchema } from "@sm/shared";
import { requireAuth, requirePermission } from "../auth.js";
import { isChurchSuiteEnabled } from "../integrations.js";
import {
  churchsuiteStatus,
  listChurchsuitePlanItems,
  listChurchsuitePlans,
  testChurchsuite,
} from "../churchsuite.js";
import {
  importChurchsuitePlan,
  previewChurchsuitePlan,
} from "../churchsuite-import.js";

async function requireChurchSuite(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!isChurchSuiteEnabled()) {
    await reply.code(404).send({ error: "ChurchSuite adapter is disabled" });
  }
}

export async function churchsuiteRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/integrations/churchsuite/status",
    { preHandler: [requireAuth, requireChurchSuite] },
    async () => ({
      status: churchsuiteStatus(),
    }),
  );

  app.post(
    "/api/integrations/churchsuite/test",
    { preHandler: [requireAuth, requireChurchSuite, requirePermission("churchsuite")] },
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
    { preHandler: [requireAuth, requireChurchSuite] },
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
    { preHandler: [requireAuth, requireChurchSuite] },
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

  app.get(
    "/api/integrations/churchsuite/plans/:id/preview",
    { preHandler: [requireAuth, requireChurchSuite] },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ error: "Invalid plan id" });
      }
      try {
        return { preview: await previewChurchsuitePlan(id) };
      } catch (error) {
        return reply.code(502).send({ error: (error as Error).message });
      }
    },
  );

  app.post(
    "/api/integrations/churchsuite/plans/:id/import",
    { preHandler: [requireAuth, requireChurchSuite, requirePermission("churchsuite")] },
    async (request, reply) => {
      const id = Number((request.params as { id: string }).id);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.code(400).send({ error: "Invalid plan id" });
      }
      const parsed = churchsuiteImportSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid import options", issues: parsed.error.issues });
      }
      try {
        return await importChurchsuitePlan(id, parsed.data);
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );
}
