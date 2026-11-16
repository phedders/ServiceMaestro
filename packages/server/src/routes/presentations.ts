import type { FastifyInstance } from "fastify";
import { presentationsConfigSchema, type PresentationsConfig } from "@sm/shared";
import { requireAuth } from "../auth.js";
import { db } from "../db.js";

const PRESENTATIONS_PREFERENCE_KEY = "presentations";

function readConfig(userId: string): PresentationsConfig | null {
  const row = db
    .prepare(
      "SELECT value, updated_at FROM user_preferences WHERE user_id = ? AND key = ?",
    )
    .get(userId, PRESENTATIONS_PREFERENCE_KEY) as
    | { value: string; updated_at: string }
    | undefined;
  if (!row) return null;
  try {
    const parsed = presentationsConfigSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? { ...parsed.data, updatedAt: row.updated_at } : null;
  } catch {
    return null;
  }
}

export async function presentationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/presentations", { preHandler: requireAuth }, async (request) => {
    const userId = request.user?.id;
    return { config: userId ? readConfig(userId) : null };
  });

  app.put("/api/presentations", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = presentationsConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid presentation configuration", issues: parsed.error.issues });
    }
    const userId = request.user?.id;
    if (!userId) return reply.code(401).send({ error: "Not signed in" });
    const updatedAt = new Date().toISOString();
    const config: PresentationsConfig = { ...parsed.data, updatedAt };
    db.prepare(
      `INSERT INTO user_preferences (user_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
    ).run(userId, PRESENTATIONS_PREFERENCE_KEY, JSON.stringify(parsed.data), updatedAt);
    return { config };
  });
}
