import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  tarpPageInputSchema,
  tarpPresentationInputSchema,
  tarpReorderSchema,
  tarpThemeInputSchema,
} from "@sm/shared";
import { requireAuth, requireRole } from "../auth.js";
import {
  addTarpPage,
  createTarpPresentation,
  createTarpTheme,
  deleteTarpPage,
  deleteTarpPresentation,
  deleteTarpTheme,
  getTarpPresentation,
  getTarpTheme,
  listTarpPresentations,
  listTarpThemes,
  reorderTarpPages,
  updateTarpPage,
  updateTarpPresentation,
  updateTarpTheme,
} from "../tarp.js";
import { saveTarpLibraryToGit } from "../git-store.js";

async function persistTarp(request: FastifyRequest): Promise<void> {
  await saveTarpLibraryToGit().catch((error) =>
    request.log.warn({ err: error }, "git Tarp library save failed"),
  );
}

export async function tarpRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/tarp/themes", { preHandler: requireAuth }, async () => ({
    themes: listTarpThemes(),
  }));

  app.post(
    "/api/tarp/themes",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const parsed = tarpThemeInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid Tarp theme", issues: parsed.error.issues });
      }
      const theme = createTarpTheme(parsed.data);
      await persistTarp(request);
      return reply.code(201).send({ theme });
    },
  );

  app.patch(
    "/api/tarp/themes/:id",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const parsed = tarpThemeInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid Tarp theme", issues: parsed.error.issues });
      }
      const theme = updateTarpTheme((request.params as { id: string }).id, parsed.data);
      if (!theme) return reply.code(404).send({ error: "Tarp theme not found" });
      await persistTarp(request);
      return { theme };
    },
  );

  app.delete(
    "/api/tarp/themes/:id",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      if (!deleteTarpTheme((request.params as { id: string }).id)) {
        return reply.code(404).send({ error: "Tarp theme not found" });
      }
      await persistTarp(request);
      return { ok: true };
    },
  );

  app.get("/api/tarp/presentations", { preHandler: requireAuth }, async () => ({
    presentations: listTarpPresentations(),
  }));

  app.post(
    "/api/tarp/presentations",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const parsed = tarpPresentationInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid Tarp presentation", issues: parsed.error.issues });
      }
      const presentation = createTarpPresentation(parsed.data);
      await persistTarp(request);
      return reply.code(201).send({ presentation });
    },
  );

  app.get("/api/tarp/presentations/:id", { preHandler: requireAuth }, async (request, reply) => {
    const presentation = getTarpPresentation((request.params as { id: string }).id);
    if (!presentation) return reply.code(404).send({ error: "Tarp presentation not found" });
    return { presentation };
  });

  app.patch(
    "/api/tarp/presentations/:id",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const parsed = tarpPresentationInputSchema.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid Tarp presentation", issues: parsed.error.issues });
      }
      const presentation = updateTarpPresentation(
        (request.params as { id: string }).id,
        parsed.data,
      );
      if (!presentation) return reply.code(404).send({ error: "Tarp presentation not found" });
      await persistTarp(request);
      return { presentation };
    },
  );

  app.delete(
    "/api/tarp/presentations/:id",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      if (!deleteTarpPresentation((request.params as { id: string }).id)) {
        return reply.code(404).send({ error: "Tarp presentation not found" });
      }
      await persistTarp(request);
      return { ok: true };
    },
  );

  app.post(
    "/api/tarp/presentations/:id/pages",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const body = request.body as { fromPageId?: string | null } | undefined;
      const presentation = addTarpPage(
        (request.params as { id: string }).id,
        body?.fromPageId ?? null,
      );
      if (!presentation) return reply.code(404).send({ error: "Tarp presentation not found" });
      await persistTarp(request);
      return reply.code(201).send({ presentation });
    },
  );

  app.patch(
    "/api/tarp/pages/:id",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const parsed = tarpPageInputSchema.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid Tarp page", issues: parsed.error.issues });
      }
      const page = updateTarpPage((request.params as { id: string }).id, parsed.data);
      if (!page) return reply.code(404).send({ error: "Tarp page not found" });
      await persistTarp(request);
      return { page };
    },
  );

  app.delete(
    "/api/tarp/pages/:id",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      if (!deleteTarpPage((request.params as { id: string }).id)) {
        return reply.code(404).send({ error: "Tarp page not found" });
      }
      await persistTarp(request);
      return { ok: true };
    },
  );

  app.post(
    "/api/tarp/presentations/:id/pages/reorder",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const parsed = tarpReorderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid page order", issues: parsed.error.issues });
      }
      const presentation = reorderTarpPages(
        (request.params as { id: string }).id,
        parsed.data.pageIds,
      );
      if (!presentation) return reply.code(404).send({ error: "Tarp presentation not found" });
      await persistTarp(request);
      return { presentation };
    },
  );
}
