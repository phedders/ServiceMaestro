import type { FastifyInstance } from "fastify";
import { requireAuth, requirePermission } from "../auth.js";
import { deleteImage, listImages, saveImage } from "../images.js";

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
    { preHandler: [requireAuth, requirePermission("images")] },
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

  app.delete(
    "/api/images",
    { preHandler: [requireAuth, requirePermission("images")] },
    async (request, reply) => {
      const relative = (request.query as { path?: string }).path;
      if (!relative || !deleteImage(relative)) {
        return reply.code(404).send({ error: "Image not found" });
      }
      return { ok: true };
    },
  );
}
