import type { FastifyInstance } from "fastify";
import { backgroundColorsSchema, backgroundInputSchema } from "@sm/shared";
import { requireAuth, requirePermission } from "../auth.js";
import {
  createBackground,
  deleteBackground,
  getBackgroundColors,
  listBackgrounds,
  saveBackgroundColors,
  updateBackground,
} from "../backgrounds.js";
import { saveSharedSettingsToGit } from "../git-store.js";

export async function backgroundRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/backgrounds", { preHandler: requireAuth }, async () => ({
    backgrounds: listBackgrounds(),
    colors: getBackgroundColors(),
  }));

  app.put(
    "/api/backgrounds/colors",
    { preHandler: [requireAuth, requirePermission("backgrounds")] },
    async (request, reply) => {
      const parsed = backgroundColorsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid background colours", issues: parsed.error.issues });
      }
      const colors = saveBackgroundColors(parsed.data);
      await saveSharedSettingsToGit().catch((error) =>
        request.log.warn({ err: error }, "shared settings save failed"),
      );
      return { colors };
    },
  );

  app.post(
    "/api/backgrounds",
    { preHandler: [requireAuth, requirePermission("backgrounds")] },
    async (request, reply) => {
      const parsed = backgroundInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid background", issues: parsed.error.issues });
      }
      try {
        return reply.code(201).send({ background: createBackground(parsed.data) });
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.patch(
    "/api/backgrounds/:id",
    { preHandler: [requireAuth, requirePermission("backgrounds")] },
    async (request, reply) => {
      const parsed = backgroundInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid background", issues: parsed.error.issues });
      }
      try {
        const background = updateBackground((request.params as { id: string }).id, parsed.data);
        if (!background) return reply.code(404).send({ error: "Background not found" });
        return { background };
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.delete(
    "/api/backgrounds/:id",
    { preHandler: [requireAuth, requirePermission("backgrounds")] },
    async (request, reply) => {
      if (!deleteBackground((request.params as { id: string }).id)) {
        return reply.code(404).send({ error: "Background not found" });
      }
      return { ok: true };
    },
  );
}
