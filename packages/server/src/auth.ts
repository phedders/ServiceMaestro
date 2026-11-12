import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PermissionModule, PublicUser, Role } from "@sm/shared";
import { COOKIE_NAME, SECURE_COOKIES, SESSION_DAYS } from "./config.js";
import { db } from "./db.js";
import { getUserById, hasPermission, mapUser } from "./users.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: PublicUser;
  }
}

interface SessionRow {
  user_id: string;
  expires_at: string;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function createSession(userId: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(token, userId, now.toISOString(), expires.toISOString());
  return { token, expiresAt: expires };
}

export function destroySession(token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function userForToken(token: string | undefined): PublicUser | null {
  if (!token) return null;
  const row = db
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?")
    .get(token) as SessionRow | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  const user = getUserById(row.user_id);
  return user ? mapUser(user) : null;
}

export function userForRequest(request: FastifyRequest): PublicUser | null {
  const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
  return userForToken(token);
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = userForRequest(request);
  if (!user) {
    await reply.code(401).send({ error: "Unauthorized" });
    return;
  }
  request.user = user;
}

export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      await reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    if (!roles.includes(request.user.role)) {
      await reply.code(403).send({ error: "Forbidden" });
    }
  };
}

export function requirePermission(module: PermissionModule) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      await reply.code(401).send({ error: "Unauthorized" });
      return;
    }
    if (!hasPermission(request.user, module)) {
      await reply.code(403).send({ error: `No write access to ${module}` });
    }
  };
}

export function deleteUserSessions(userId: string, exceptToken?: string): void {
  if (exceptToken) {
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND token <> ?").run(userId, exceptToken);
  } else {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
}

export function makeSessionCookie(token: string): {
  name: string;
  value: string;
  options: { path: string; httpOnly: boolean; sameSite: "lax"; maxAge: number; secure: boolean };
} {
  return {
    name: COOKIE_NAME,
    value: token,
    options: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_DAYS * 24 * 60 * 60,
      secure: SECURE_COOKIES,
    },
  };
}

export function newUserId(): string {
  return randomUUID();
}
