import type { FastifyInstance } from "fastify";
import { displayOutputSchema } from "@sm/shared";
import { requireAuth, requirePermission } from "../auth.js";
import {
  createDisplayOutput,
  deleteDisplayOutput,
  listDisplayOutputs,
  updateDisplayOutput,
} from "../display-outputs.js";
import { saveSharedSettingsToGit } from "../git-store.js";
import { getDisplayConfig } from "../display-config.js";
import { live } from "../live.js";

function scope(value: unknown): "shared" | "local" {
  return value === "local" ? "local" : "shared";
}

export async function outputRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/outputs", { preHandler: requireAuth }, async () => ({
    outputs: listDisplayOutputs(),
  }));

  app.post(
    "/api/outputs",
    { preHandler: [requireAuth, requirePermission("settings")] },
    async (request, reply) => {
      const body = request.body as { output?: unknown; scope?: unknown } | undefined;
      const parsed = displayOutputSchema.safeParse(body?.output);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid output", issues: parsed.error.issues });
      }
      try {
        const output = createDisplayOutput(parsed.data, scope(body?.scope));
        if (output.scope === "shared") {
          await saveSharedSettingsToGit().catch((error) =>
            request.log.warn({ err: error }, "shared output save failed"),
          );
        }
        live.updateDisplayConfig(getDisplayConfig());
        return reply.code(201).send({ output, outputs: listDisplayOutputs() });
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "Could not create output",
        });
      }
    },
  );

  app.put(
    "/api/outputs/:id",
    { preHandler: [requireAuth, requirePermission("settings")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const body = request.body as { output?: unknown } | undefined;
      const parsed = displayOutputSchema.safeParse(body?.output);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid output", issues: parsed.error.issues });
      }
      try {
        const output = updateDisplayOutput(id, parsed.data);
        if (output.scope === "shared") {
          await saveSharedSettingsToGit().catch((error) =>
            request.log.warn({ err: error }, "shared output save failed"),
          );
        }
        live.updateDisplayConfig(getDisplayConfig());
        return { output, outputs: listDisplayOutputs() };
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "Could not update output",
        });
      }
    },
  );

  app.delete(
    "/api/outputs/:id",
    { preHandler: [requireAuth, requirePermission("settings")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const existing = listDisplayOutputs().find((output) => output.id === id);
      if (!existing) return reply.code(404).send({ error: "Output not found" });
      deleteDisplayOutput(id);
      if (existing.scope === "shared") {
        await saveSharedSettingsToGit().catch((error) =>
          request.log.warn({ err: error }, "shared output save failed"),
        );
      }
      live.updateDisplayConfig(getDisplayConfig());
      return { ok: true, outputs: listDisplayOutputs() };
    },
  );
}
