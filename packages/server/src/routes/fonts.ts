import type { FastifyInstance } from "fastify";
import { fontImportSchema } from "@wlm/shared";
import { requireAuth, requireRole } from "../auth.js";
import { deleteFont, importGoogleFont, listFonts } from "../fonts.js";

export async function fontRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/fonts", { preHandler: requireAuth }, async () => ({ fonts: listFonts() }));

  app.post(
    "/api/fonts/import",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const parsed = fontImportSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid font import", issues: parsed.error.issues });
      }
      try {
        const font = await importGoogleFont(parsed.data);
        return reply.code(201).send({ font });
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.delete(
    "/api/fonts/:id",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      if (!deleteFont((request.params as { id: string }).id)) {
        return reply.code(404).send({ error: "Font not found" });
      }
      return { ok: true };
    },
  );
}
