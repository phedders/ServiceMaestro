import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SongAssetKind } from "@sm/shared";
import { requireAuth, requireRole } from "../auth.js";
import { deleteAsset, getAsset, listAssets, saveAsset } from "../assets.js";

const KINDS: SongAssetKind[] = ["score_pdf", "guitar_tab", "chordpro", "lyrics", "image"];

const metadataSchema = z.object({
  kind: z.enum(["score_pdf", "guitar_tab", "chordpro", "lyrics", "image"]).default("score_pdf"),
  title: z.string().trim().max(300).optional(),
  key: z.string().trim().max(20).optional(),
});

function fieldValue(fields: Record<string, unknown>, name: string): string | undefined {
  const value = fields[name] as { value?: unknown } | { value?: unknown }[] | undefined;
  if (Array.isArray(value)) return value[0]?.value == null ? undefined : String(value[0].value);
  return value?.value == null ? undefined : String(value.value);
}

export async function assetRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/songs/:id/assets", { preHandler: requireAuth }, async (request) => {
    const id = (request.params as { id: string }).id;
    return { assets: listAssets(id) };
  });

  app.post(
    "/api/songs/:id/assets",
    { preHandler: [requireAuth, requireRole("admin", "editor", "operator")] },
    async (request, reply) => {
      const songId = (request.params as { id: string }).id;
      const file = await request.file({ limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
      if (!file) return reply.code(400).send({ error: "No file uploaded" });

      try {
        const buffer = await file.toBuffer();
        const fields = file.fields as unknown as Record<string, unknown>;
        const parsed = metadataSchema.safeParse({
          kind: fieldValue(fields, "kind") ?? "score_pdf",
          title: fieldValue(fields, "title"),
          key: fieldValue(fields, "key"),
        });
        if (!parsed.success) {
          return reply.code(400).send({ error: "Invalid asset metadata", issues: parsed.error.issues });
        }
        if (!KINDS.includes(parsed.data.kind)) {
          return reply.code(400).send({ error: "Invalid asset kind" });
        }

        const asset = saveAsset({
          songId,
          buffer,
          filename: file.filename,
          mime: file.mimetype,
          kind: parsed.data.kind,
          title: parsed.data.title,
          key: parsed.data.key ?? null,
          source: "upload",
          userId: request.user?.id ?? null,
        });
        return reply.code(201).send({ asset });
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  app.get("/api/assets/:id/file", { preHandler: requireAuth }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const found = getAsset(id);
    if (!found || !fs.existsSync(found.absolutePath)) {
      return reply.code(404).send({ error: "Asset not found" });
    }
    const filename = `${found.asset.title.replace(/[^\w .-]/g, "_")}.${found.asset.format}`;
    reply
      .type(found.asset.mime)
      .header("content-length", found.asset.bytes)
      .header("content-disposition", `inline; filename="${filename}"`)
      .header("cache-control", "private, max-age=300");
    return reply.send(fs.createReadStream(found.absolutePath));
  });

  app.get("/api/assets/:id", { preHandler: requireAuth }, async (request, reply) => {
    const found = getAsset((request.params as { id: string }).id);
    if (!found) return reply.code(404).send({ error: "Asset not found" });
    return { asset: found.asset };
  });

  app.delete(
    "/api/assets/:id",
    { preHandler: [requireAuth, requireRole("admin", "editor", "operator")] },
    async (request, reply) => {
      const ok = deleteAsset((request.params as { id: string }).id);
      if (!ok) return reply.code(404).send({ error: "Asset not found" });
      return { ok: true };
    },
  );
}
