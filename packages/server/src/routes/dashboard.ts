import type { FastifyInstance } from "fastify";
import { dashboardLayoutSchema, type DashboardLayout } from "@sm/shared";
import { db } from "../db.js";
import { requireAuth } from "../auth.js";
import { DEFAULT_LAYOUT } from "../default-layout.js";

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/dashboard/layout", { preHandler: requireAuth }, async (request) => {
    const row = db
      .prepare("SELECT layout_json FROM dashboard_layouts WHERE user_id = ?")
      .get(request.user!.id) as { layout_json: string } | undefined;
    if (!row) return { layout: DEFAULT_LAYOUT, isDefault: true };
    try {
      return { layout: JSON.parse(row.layout_json) as DashboardLayout, isDefault: false };
    } catch {
      return { layout: DEFAULT_LAYOUT, isDefault: true };
    }
  });

  app.put("/api/dashboard/layout", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = dashboardLayoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid layout", issues: parsed.error.issues });
    }
    db.prepare(
      `INSERT INTO dashboard_layouts (user_id, layout_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET layout_json = excluded.layout_json, updated_at = excluded.updated_at`,
    ).run(request.user!.id, JSON.stringify(parsed.data), new Date().toISOString());
    return { layout: parsed.data, isDefault: false };
  });

  app.post("/api/dashboard/layout/reset", { preHandler: requireAuth }, async (request) => {
    db.prepare("DELETE FROM dashboard_layouts WHERE user_id = ?").run(request.user!.id);
    return { layout: DEFAULT_LAYOUT, isDefault: true };
  });
}
