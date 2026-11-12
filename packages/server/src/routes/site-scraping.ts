import type { FastifyInstance } from "fastify";
import { siteCredentialInputSchema } from "@sm/shared";
import { requireAuth } from "../auth.js";
import {
  deleteSiteCredentials,
  listSiteScraperProviders,
  saveSiteCredentials,
} from "../site-scraping.js";

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
}
