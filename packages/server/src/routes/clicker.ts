import type { FastifyInstance } from "fastify";
import { clickerConfigSchema, type ClickerConfig } from "@sm/shared";
import { requireAuth } from "../auth.js";
import { db } from "../db.js";

const CLICKER_PREFERENCE_KEY = "clicker";

function readConfig(userId: string): ClickerConfig | null {
  const row = db
    .prepare(
      "SELECT value, updated_at FROM user_preferences WHERE user_id = ? AND key = ?",
    )
    .get(userId, CLICKER_PREFERENCE_KEY) as
    | { value: string; updated_at: string }
    | undefined;
  if (!row) return null;
  try {
    const parsed = clickerConfigSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? { ...parsed.data, updatedAt: row.updated_at } : null;
  } catch {
    return null;
  }
}

export async function clickerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/clicker", { preHandler: requireAuth }, async (request) => {
    const userId = request.user?.id;
    return { config: userId ? readConfig(userId) : null };
  });

  app.put("/api/clicker", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = clickerConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid clicker configuration", issues: parsed.error.issues });
    }
    const userId = request.user?.id;
    if (!userId) return reply.code(401).send({ error: "Not signed in" });
    const updatedAt = new Date().toISOString();
    const config: ClickerConfig = { ...parsed.data, updatedAt };
    db.prepare(
      `INSERT INTO user_preferences (user_id, key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
    ).run(userId, CLICKER_PREFERENCE_KEY, JSON.stringify(parsed.data), updatedAt);
    return { config };
  });
}
