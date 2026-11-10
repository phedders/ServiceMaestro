import type { FastifyInstance } from "fastify";
import { loginSchema } from "@wlm/shared";
import { db } from "../db.js";
import { verifyPassword } from "../password.js";
import {
  createSession,
  destroySession,
  makeSessionCookie,
  parseCookies,
  requireAuth,
  userForRequest,
} from "../auth.js";
import { COOKIE_NAME } from "../config.js";

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: "admin" | "editor" | "operator" | "musician" | "viewer";
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid credentials" });

    const row = db
      .prepare("SELECT id, username, password_hash, role FROM users WHERE username = ?")
      .get(parsed.data.username) as UserRow | undefined;
    if (!row || !verifyPassword(parsed.data.password, row.password_hash)) {
      return reply.code(401).send({ error: "Invalid username or password" });
    }

    const session = createSession(row.id);
    const cookie = makeSessionCookie(session.token);
    reply.setCookie(cookie.name, cookie.value, cookie.options);
    return { user: { id: row.id, username: row.username, role: row.role } };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
    if (token) destroySession(token);
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (request) => {
    return { user: userForRequest(request) };
  });
}
