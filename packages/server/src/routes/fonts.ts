import type { FastifyInstance } from "fastify";
import { fontImportSchema, type FontOption } from "@sm/shared";
import { requireAuth, requireRole } from "../auth.js";
import { deleteFont, importGoogleFont, listFonts } from "../fonts.js";
import { missingSharedFonts, readSharedSettings } from "../shared-settings.js";
import { saveSharedSettingsToGit } from "../git-store.js";

export async function fontRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/fonts", { preHandler: requireAuth }, async () => {
    const fonts = listFonts();
    const sharedFonts = readSharedSettings().fonts;
    return {
      fonts,
      sharedFonts,
      missingFonts: missingSharedFonts(fonts, sharedFonts),
    };
  });

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
        await saveSharedSettingsToGit().catch((error) =>
          request.log.warn({ err: error }, "shared font settings save failed"),
        );
        return reply.code(201).send({ font });
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.post(
    "/api/fonts/import-missing",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request) => {
      const fonts = listFonts();
      const missing = missingSharedFonts(fonts, readSharedSettings().fonts);
      const downloaded: FontOption[] = [];
      const failed: Array<{ id: string; label: string; error: string }> = [];
      for (const font of missing) {
        try {
          downloaded.push(
            await importGoogleFont(
              font.cssUrl ? { url: font.cssUrl } : { family: font.label },
            ),
          );
        } catch (error) {
          request.log.warn({ err: error, font: font.label }, "missing font download failed");
          failed.push({ id: font.id, label: font.label, error: (error as Error).message });
        }
      }
      await saveSharedSettingsToGit().catch((error) =>
        request.log.warn({ err: error }, "shared font settings save failed"),
      );
      return { ok: failed.length === 0, downloaded, failed };
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
