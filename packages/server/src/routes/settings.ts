import type { FastifyInstance } from "fastify";
import { appSettingsSchema } from "@sm/shared";
import { requireAuth, requirePermission } from "../auth.js";
import { getAppSettings, saveAppSettings } from "../settings.js";
import { saveSharedSettingsToGit } from "../git-store.js";

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", { preHandler: requireAuth }, async () => ({
    settings: getAppSettings(),
  }));

  app.put(
    "/api/settings",
    { preHandler: [requireAuth, requirePermission("settings")] },
    async (request, reply) => {
      const parsed = appSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid settings", issues: parsed.error.issues });
      }
      const settings = saveAppSettings(parsed.data);
      await saveSharedSettingsToGit().catch((error) =>
        request.log.warn({ err: error }, "shared settings save failed"),
      );
      return { settings };
    },
  );
}
