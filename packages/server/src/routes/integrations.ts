import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { integrationSettingsSchema } from "@sm/shared";
import { requireAuth, requireRole } from "../auth.js";
import { getIntegrationSettings, saveIntegrationSettings } from "../integrations.js";

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/integrations/settings", { preHandler: requireAuth }, async () => ({
    settings: getIntegrationSettings(),
  }));

  app.put(
    "/api/integrations/settings",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = integrationSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid adapter settings", issues: parsed.error.issues });
      }
      return { settings: saveIntegrationSettings(parsed.data) };
    },
  );
}
