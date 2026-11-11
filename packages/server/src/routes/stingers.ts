import type { FastifyInstance } from "fastify";
import { stingerInputSchema } from "@sm/shared";
import { requireAuth, requireRole } from "../auth.js";
import {
  createStinger,
  deleteStinger,
  listStingers,
  updateStinger,
} from "../stingers.js";

export async function stingerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/stingers", { preHandler: requireAuth }, async () => ({
    stingers: listStingers(),
  }));

  app.post(
    "/api/stingers",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const parsed = stingerInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid stinger", issues: parsed.error.issues });
      }
      try {
        return reply.code(201).send({ stinger: createStinger(parsed.data) });
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.patch(
    "/api/stingers/:id",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const parsed = stingerInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid stinger", issues: parsed.error.issues });
      }
      try {
        const stinger = updateStinger((request.params as { id: string }).id, parsed.data);
        if (!stinger) return reply.code(404).send({ error: "Stinger not found" });
        return { stinger };
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.delete(
    "/api/stingers/:id",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      if (!deleteStinger((request.params as { id: string }).id)) {
        return reply.code(404).send({ error: "Stinger not found" });
      }
      return { ok: true };
    },
  );
}
