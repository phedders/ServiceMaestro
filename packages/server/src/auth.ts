import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PublicUser, Role } from "@sm/shared";
import { COOKIE_NAME, SESSION_DAYS } from "./config.js";
import { db } from "./db.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: PublicUser;
  }
}

interface SessionRow {
  token: string;
  user_id: string;
  username: string;
  role: Role;
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
    .prepare(
      `SELECT s.token, s.user_id, s.expires_at, u.username, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
    )
    .get(token) as SessionRow | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return { id: row.user_id, username: row.username, role: row.role };
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
      secure: process.env.SM_SECURE_COOKIES === "1",
    },
  };
}

export function newUserId(): string {
  return randomUUID();
}
