import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { integrationSettingsSchema } from "@sm/shared";
import { requireAuth, requireRole } from "../auth.js";
import { getIntegrationSettings, saveIntegrationSettings } from "../integrations.js";
import { saveSharedSettingsToGit } from "../git-store.js";
import { reloadMqttBridge } from "../mqtt-bridge.js";
import { getMqttSettings, saveMqttSettings } from "../mqtt-settings.js";
import { readSharedSettings } from "../shared-settings.js";

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
      const before = getIntegrationSettings();
      const settings = saveIntegrationSettings(parsed.data);
      if (before.mqtt !== "shared" && settings.mqtt === "shared") {
        const shared = readSharedSettings();
        if (shared.adapters?.mqtt) {
          saveMqttSettings({
            ...shared.adapters.mqtt,
            clientId: getMqttSettings().clientId,
            password: undefined,
          });
        }
      }
      reloadMqttBridge();
      await saveSharedSettingsToGit().catch((error) =>
        request.log.warn({ err: error }, "shared adapter settings save failed"),
      );
      return { settings };
    },
  );
}
