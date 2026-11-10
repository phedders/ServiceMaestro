import type { FastifyInstance } from "fastify";
import { requireAuth, requireRole } from "../auth.js";
import {
  getBooks,
  getChapter,
  getPassage,
  listTranslations,
  reloadBibleCatalog,
} from "../bible.js";

function int(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function bibleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/bible/translations", { preHandler: requireAuth }, async () => {
    return { translations: listTranslations() };
  });

  app.get("/api/bible/books", { preHandler: requireAuth }, async (request, reply) => {
    const code = String((request.query as { translation?: string }).translation ?? "");
    const books = getBooks(code);
    if (!books) return reply.code(404).send({ error: "Translation not found" });
    return { books };
  });

  app.get("/api/bible/chapter", { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as { translation?: string; book?: string; chapter?: string };
    const book = int(query.book);
    const chapter = int(query.chapter);
    if (!query.translation || !book || !chapter) {
      return reply.code(400).send({ error: "translation, book and chapter are required" });
    }
    const passage = getChapter(query.translation, book, chapter);
    if (!passage) return reply.code(404).send({ error: "Passage not found" });
    return { passage };
  });

  app.get("/api/bible/passage", { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as {
      translation?: string;
      book?: string;
      chapter?: string;
      from?: string;
      to?: string;
    };
    const book = int(query.book);
    const chapter = int(query.chapter);
    if (!query.translation || !book || !chapter) {
      return reply.code(400).send({ error: "translation, book and chapter are required" });
    }
    const from = query.from ? int(query.from) : undefined;
    const to = query.to ? int(query.to) : undefined;
    const passage = getPassage(query.translation, book, chapter, from ?? undefined, to ?? undefined);
    if (!passage) return reply.code(404).send({ error: "Passage not found" });
    return { passage };
  });

  app.post(
    "/api/bible/reload",
    { preHandler: [requireAuth, requireRole("admin")] },
    async () => {
      const catalog = reloadBibleCatalog();
      return {
        translations: listTranslations(),
        errors: catalog.errors,
      };
    },
  );
}
