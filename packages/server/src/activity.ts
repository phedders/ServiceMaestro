import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { ActivityEntry, ActivityPage, PublicUser } from "@sm/shared";
import { db } from "./db.js";

interface ActivityRow {
  id: string;
  user_id: string | null;
  username: string;
  action: string;
  module: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  detail: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

interface ActivityInput {
  request?: FastifyRequest;
  user?: PublicUser | null;
  username?: string;
  action: string;
  module?: string | null;
  method?: string | null;
  path?: string | null;
  status?: number | null;
  detail?: string | null;
}

function mapRow(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    action: row.action,
    module: row.module,
    method: row.method,
    path: row.path,
    status: row.status,
    detail: row.detail,
    ip: row.ip,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}

export function moduleForPath(pathname: string): string | null {
  if (pathname.startsWith("/api/auth")) return "auth";
  if (pathname.startsWith("/api/users")) return "users";
  if (
    pathname.startsWith("/api/songs") ||
    pathname.startsWith("/api/import") ||
    pathname.startsWith("/api/assets")
  ) {
    return "songs";
  }
  if (pathname.startsWith("/api/setlists")) return "setlists";
  if (pathname.startsWith("/api/live")) return "live";
  if (pathname.startsWith("/api/images")) return "images";
  if (pathname.startsWith("/api/tarp")) return "tarp";
  if (pathname.startsWith("/api/backgrounds")) return "backgrounds";
  if (pathname.startsWith("/api/stingers")) return "stingers";
  if (pathname.startsWith("/api/bible")) return "bible";
  if (pathname.startsWith("/api/integrations/churchsuite")) return "churchsuite";
  if (
    pathname.startsWith("/api/fonts") ||
    pathname.startsWith("/api/settings") ||
    pathname.startsWith("/api/display") ||
    pathname.startsWith("/api/git") ||
    pathname.startsWith("/api/ssl") ||
    pathname.startsWith("/api/activity")
  ) {
    return "settings";
  }
  return null;
}

export function logActivity(input: ActivityInput): void {
  const request = input.request;
  const user = input.user ?? request?.user ?? null;
  const pathname = input.path ?? request?.url.split("?")[0] ?? null;
  const method = input.method ?? request?.method ?? null;
  const username = input.username ?? user?.username ?? "anonymous";
  db.prepare(
    `INSERT INTO activity_log
       (id, user_id, username, action, module, method, path, status, detail, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    user?.id ?? null,
    username,
    input.action,
    input.module ?? (pathname ? moduleForPath(pathname) : null),
    method,
    pathname,
    input.status ?? null,
    input.detail?.slice(0, 4000) ?? null,
    request?.ip ?? null,
    typeof request?.headers["user-agent"] === "string"
      ? request.headers["user-agent"].slice(0, 500)
      : null,
    new Date().toISOString(),
  );
}

export function logRequestActivity(request: FastifyRequest, status: number): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const pathname = request.url.split("?")[0];
  // Authentication events are logged explicitly with success/failure detail.
  if (
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname.startsWith("/api/auth/passkey/login/") ||
    pathname.startsWith("/api/auth/passkeys/")
  ) {
    return;
  }
  const action =
    method === "POST"
      ? "create"
      : method === "PUT" || method === "PATCH"
        ? "update"
        : method === "DELETE"
          ? "delete"
          : method.toLowerCase();
  logActivity({
    request,
    action,
    method,
    path: pathname,
    status,
  });
}

export function listActivity(options: {
  limit?: number;
  offset?: number;
  module?: string;
  userId?: string;
  q?: string;
} = {}): ActivityPage {
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 100)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.module) {
    where.push("module = ?");
    params.push(options.module);
  }
  if (options.userId) {
    where.push("user_id = ?");
    params.push(options.userId);
  }
  if (options.q?.trim()) {
    where.push(
      "(username LIKE ? OR action LIKE ? OR module LIKE ? OR path LIKE ? OR detail LIKE ?)",
    );
    const value = `%${options.q.trim()}%`;
    params.push(value, value, value, value, value);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM activity_log ${clause}`).get(...params) as {
      count: number;
    }
  ).count;
  const rows = db
    .prepare(
      `SELECT * FROM activity_log ${clause}
       ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as ActivityRow[];
  return {
    entries: rows.map(mapRow),
    total,
    limit,
    offset,
  };
}
