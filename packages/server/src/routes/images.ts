import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { COOKIE_NAME, OUTPUT_TOKEN } from "../config.js";
import { parseCookies, requireAuth, requireRole, userForToken } from "../auth.js";
import { deleteImage, imageMime, listImages, resolveImage, saveImage } from "../images.js";

function fieldValue(fields: Record<string, unknown>, name: string): string | undefined {
  const value = fields[name] as { value?: unknown } | { value?: unknown }[] | undefined;
  if (Array.isArray(value)) return value[0]?.value == null ? undefined : String(value[0].value);
  return value?.value == null ? undefined : String(value.value);
}

export async function imageRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/images", { preHandler: requireAuth }, async (request) => ({
    root: "images",
    images: listImages((request.query as { q?: string }).q),
  }));

  app.post(
    "/api/images",
    { preHandler: [requireAuth, requireRole("admin", "editor", "operator")] },
    async (request, reply) => {
      const file = await request.file({ limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
      if (!file) return reply.code(400).send({ error: "No image uploaded" });
      try {
        const fields = file.fields as unknown as Record<string, unknown>;
        const image = saveImage({
          buffer: await file.toBuffer(),
          filename: file.filename,
          mime: file.mimetype,
          folder: fieldValue(fields, "folder") ?? "uploads",
        });
        return reply.code(201).send({ image });
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.get("/api/images/file", async (request, reply) => {
    const query = request.query as { path?: string; token?: string };
    const cookies = parseCookies(request.headers.cookie);
    const user = userForToken(cookies[COOKIE_NAME]);
    if (!user && query.token !== OUTPUT_TOKEN) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const absolute = query.path ? resolveImage(query.path) : null;
    if (!absolute || !fs.existsSync(absolute)) {
      return reply.code(404).send({ error: "Image not found" });
    }
    reply
      .type(imageMime(query.path!))
      .header("cache-control", "private, max-age=300");
    return reply.send(fs.createReadStream(absolute));
  });

  app.delete(
    "/api/images",
    { preHandler: [requireAuth, requireRole("admin", "editor", "operator")] },
    async (request, reply) => {
      const relative = (request.query as { path?: string }).path;
      if (!relative || !deleteImage(relative)) {
        return reply.code(404).send({ error: "Image not found" });
      }
      return { ok: true };
    },
  );
}
