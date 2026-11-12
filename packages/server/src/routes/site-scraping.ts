import type { FastifyInstance } from "fastify";
import { zipSync } from "fflate";
import { siteCredentialInputSchema, siteScraperDownloadSchema } from "@sm/shared";
import { requireAuth, requirePermission } from "../auth.js";
import {
  deleteSiteCredentials,
  downloadSiteSong,
  listSiteScraperProviders,
  saveSiteCredentials,
  searchSiteSongs,
} from "../site-scraping.js";
import { importSiteSong } from "../site-scraping-import.js";

export async function siteScrapingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/site-scraping/providers", { preHandler: requireAuth }, async (request) => {
    return { providers: listSiteScraperProviders(request.user!.id) };
  });

  app.put(
    "/api/site-scraping/providers/:provider/credentials",
    { preHandler: requireAuth },
    async (request, reply) => {
      const providerId = (request.params as { provider: string }).provider;
      const provider = listSiteScraperProviders(request.user!.id).find(
        (entry) => entry.id === providerId,
      );
      if (!provider) return reply.code(404).send({ error: "Unknown site scraper provider" });
      const parsed = siteCredentialInputSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid credentials", issues: parsed.error.issues });
      }
      try {
        return {
          provider: saveSiteCredentials(request.user!.id, providerId, parsed.data),
        };
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "Could not save site credentials",
        });
      }
    },
  );

  app.delete(
    "/api/site-scraping/providers/:provider/credentials",
    { preHandler: requireAuth },
    async (request, reply) => {
      const providerId = (request.params as { provider: string }).provider;
      const provider = listSiteScraperProviders(request.user!.id).find(
        (entry) => entry.id === providerId,
      );
      if (!provider) return reply.code(404).send({ error: "Unknown site scraper provider" });
      deleteSiteCredentials(request.user!.id, providerId);
      return { ok: true };
    },
  );

  app.get(
    "/api/site-scraping/providers/:provider/search",
    { preHandler: requireAuth },
    async (request, reply) => {
      const providerId = (request.params as { provider: string }).provider;
      const provider = listSiteScraperProviders(request.user!.id).find(
        (entry) => entry.id === providerId,
      );
      if (!provider) return reply.code(404).send({ error: "Unknown site scraper provider" });
      const query = String((request.query as { q?: string }).q ?? "").trim();
      if (!query) return reply.code(400).send({ error: "Enter a song search query" });
      try {
        return { results: await searchSiteSongs(request.user!.id, providerId, query) };
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "Could not search the song site",
        });
      }
    },
  );

  app.post(
    "/api/site-scraping/providers/:provider/lyrics",
    { preHandler: requireAuth },
    async (request, reply) => {
      const providerId = (request.params as { provider: string }).provider;
      const provider = listSiteScraperProviders(request.user!.id).find(
        (entry) => entry.id === providerId,
      );
      if (!provider) return reply.code(404).send({ error: "Unknown site scraper provider" });
      const parsed = siteScraperDownloadSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid song lookup", issues: parsed.error.issues });
      }
      const data = parsed.data;
      try {
        const files = await downloadSiteSong(
          request.user!.id,
          providerId,
          {
            provider: providerId,
            songNumber: data.songNumber,
            slug: data.slug,
            title: data.title,
            authors: data.authors ?? [],
            availableKinds: data.availableKinds ?? [],
          },
          ["lyrics"],
        );
        const lyrics = files.find((file) => file.kind === "lyrics");
        if (!lyrics) return reply.code(404).send({ error: "No lyrics available for this song" });
        return { lyrics: lyrics.data.toString("utf8") };
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "Could not load song lyrics",
        });
      }
    },
  );

  app.post(
    "/api/site-scraping/providers/:provider/import",
    { preHandler: [requireAuth, requirePermission("songs")] },
    async (request, reply) => {
      const providerId = (request.params as { provider: string }).provider;
      const provider = listSiteScraperProviders(request.user!.id).find(
        (entry) => entry.id === providerId,
      );
      if (!provider) return reply.code(404).send({ error: "Unknown site scraper provider" });
      const parsed = siteScraperDownloadSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid song import", issues: parsed.error.issues });
      }
      const data = parsed.data;
      try {
        const result = await importSiteSong(
          request.user!.id,
          providerId,
          {
            provider: providerId,
            songNumber: data.songNumber,
            slug: data.slug,
            title: data.title,
            authors: data.authors ?? [],
            availableKinds: data.availableKinds ?? [],
          },
          data.kinds ?? [],
          request.user?.id ?? null,
        );
        return result;
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "Could not import the song",
        });
      }
    },
  );

  app.post(
    "/api/site-scraping/providers/:provider/download",
    { preHandler: requireAuth },
    async (request, reply) => {
      const providerId = (request.params as { provider: string }).provider;
      const provider = listSiteScraperProviders(request.user!.id).find(
        (entry) => entry.id === providerId,
      );
      if (!provider) return reply.code(404).send({ error: "Unknown site scraper provider" });
      const parsed = siteScraperDownloadSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid song download", issues: parsed.error.issues });
      }
      const data = parsed.data;
      try {
        const files = await downloadSiteSong(
          request.user!.id,
          providerId,
          {
            provider: providerId,
            songNumber: data.songNumber,
            slug: data.slug,
            title: data.title,
            authors: data.authors ?? [],
            availableKinds: data.availableKinds ?? [],
          },
          data.kinds ?? [],
        );
        if (!files.length) return reply.code(400).send({ error: "No downloadable files returned" });
        if (files.length === 1) {
          const file = files[0];
          return reply
            .header("content-disposition", `attachment; filename="${file.filename}"`)
            .type(file.mime)
            .send(file.data);
        }
        const entries = Object.fromEntries(
          files.map((file) => [file.filename, new Uint8Array(file.data)]),
        );
        const archive = Buffer.from(zipSync(entries));
        const safeTitle = data.title.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 100) || "song";
        return reply
          .header("content-disposition", `attachment; filename="${safeTitle}.zip"`)
          .type("application/zip")
          .send(archive);
      } catch (error) {
        return reply.code(400).send({
          error: error instanceof Error ? error.message : "Could not download the song files",
        });
      }
    },
  );
}
