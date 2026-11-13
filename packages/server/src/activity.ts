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

type ActivityListener = (entry: ActivityEntry) => void;

const activityListeners = new Set<ActivityListener>();

export function onActivity(listener: ActivityListener): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
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
  if (pathname.startsWith("/api/mqtt")) return "mqtt";
  if (pathname.startsWith("/api/integrations/churchsuite")) return "churchsuite";
  if (
    pathname.startsWith("/api/fonts") ||
    pathname.startsWith("/api/settings") ||
    pathname.startsWith("/api/display") ||
    pathname.startsWith("/api/git") ||
    pathname.startsWith("/api/ssl") ||
    pathname.startsWith("/api/branding") ||
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
  const entry: ActivityEntry = {
    id: randomUUID(),
    userId: user?.id ?? null,
    username,
    action: input.action,
    module: input.module ?? (pathname ? moduleForPath(pathname) : null),
    method,
    path: pathname,
    status: input.status ?? null,
    detail: input.detail?.slice(0, 4000) ?? null,
    ip: request?.ip ?? null,
    userAgent:
      typeof request?.headers["user-agent"] === "string"
        ? request.headers["user-agent"].slice(0, 500)
        : null,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO activity_log
       (id, user_id, username, action, module, method, path, status, detail, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    entry.userId,
    entry.username,
    entry.action,
    entry.module,
    entry.method,
    entry.path,
    entry.status,
    entry.detail,
    entry.ip,
    entry.userAgent,
    entry.createdAt,
  );
  for (const listener of activityListeners) {
    try {
      listener(entry);
    } catch {
      // Audit persistence must not fail because an optional listener is broken.
    }
  }
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

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  // Avoid spreadsheet formula injection from user-controlled details.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportActivityCsv(
  options: {
    module?: string;
    userId?: string;
    q?: string;
    maxEntries?: number;
  } = {},
): string {
  const maxEntries = Math.max(1, Math.min(50_000, Math.floor(options.maxEntries ?? 50_000)));
  const rows: ActivityEntry[] = [];
  let offset = 0;
  while (rows.length < maxEntries) {
    const page = listActivity({
      module: options.module,
      userId: options.userId,
      q: options.q,
      limit: Math.min(500, maxEntries - rows.length),
      offset,
    });
    rows.push(...page.entries);
    if (!page.entries.length || rows.length >= page.total || offset >= page.total) break;
    offset += page.entries.length;
  }

  const header = [
    "id",
    "created_at",
    "username",
    "action",
    "module",
    "method",
    "path",
    "status",
    "detail",
    "ip",
    "user_agent",
  ];
  return [header, ...rows.map((entry) => [
    entry.id,
    entry.createdAt,
    entry.username,
    entry.action,
    entry.module,
    entry.method,
    entry.path,
    entry.status,
    entry.detail,
    entry.ip,
    entry.userAgent,
  ])]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")
    .concat("\r\n");
}

const ACTIVITY_RETENTION_KEY = "activity_retention_days";
const DAY_MS = 24 * 60 * 60 * 1000;

export function getActivityRetentionDays(): number {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(ACTIVITY_RETENTION_KEY) as { value: string } | undefined;
  const days = Number(row?.value);
  return Number.isFinite(days) && days > 0 ? Math.min(3650, Math.floor(days)) : 0;
}

export function pruneActivityLog(retentionDays = getActivityRetentionDays()): number {
  if (retentionDays <= 0) return 0;
  const cutoff = new Date(Date.now() - retentionDays * DAY_MS).toISOString();
  const result = db.prepare("DELETE FROM activity_log WHERE created_at < ?").run(cutoff);
  return Number(result.changes);
}

export function saveActivityRetentionDays(retentionDays: number): {
  retentionDays: number;
  deleted: number;
} {
  const days = Math.max(0, Math.min(3650, Math.floor(retentionDays)));
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(ACTIVITY_RETENTION_KEY, String(days), now);
  return { retentionDays: days, deleted: pruneActivityLog(days) };
}

export function startActivityRetention(): () => void {
  const prune = () => {
    try {
      pruneActivityLog();
    } catch {
      // Retention failures should never prevent the app from starting.
    }
  };
  prune();
  const timer = setInterval(prune, DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
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
