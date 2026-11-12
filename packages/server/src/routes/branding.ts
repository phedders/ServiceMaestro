import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { requireAuth, requireRole } from "../auth.js";
import {
  brandingLogo,
  deleteBrandingLogo,
  getBranding,
  saveBranding,
  saveBrandingLogo,
} from "../branding.js";

export async function brandingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/branding", async () => ({ branding: getBranding() }));

  app.put(
    "/api/branding",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const body = request.body as { navBackground?: unknown } | null;
      if (typeof body?.navBackground !== "string" && body?.navBackground !== null) {
        return reply.code(400).send({ error: "Invalid navigation background" });
      }
      try {
        return { branding: saveBranding({ navBackground: body.navBackground }) };
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.post(
    "/api/branding/logo",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const file = await request.file({ limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
      if (!file) return reply.code(400).send({ error: "No logo uploaded" });
      try {
        const branding = saveBrandingLogo(await file.toBuffer(), file.filename);
        return reply.code(201).send({ branding });
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.delete(
    "/api/branding/logo",
    { preHandler: [requireAuth, requireRole("admin")] },
    async () => ({ branding: deleteBrandingLogo() }),
  );

  app.get("/branding/logo", async (_request, reply) => {
    const logo = brandingLogo();
    if (!logo) return reply.code(404).send({ error: "Logo not found" });
    return reply
      .type(logo.mime)
      .header("cache-control", "no-cache")
      .send(fs.readFileSync(logo.path));
  });
}
