import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  defaultPermissionsForRole,
  userCreateSchema,
  userPasswordResetSchema,
  userUpdateSchema,
  type Role,
} from "@sm/shared";
import { requireAuth, requireRole, deleteUserSessions } from "../auth.js";
import { db } from "../db.js";
import { hashPassword } from "../password.js";
import {
  adminCount,
  getUserById,
  listUserManagementEntries,
  normalizePermissions,
  parseStoredPermissions,
  serializePermissions,
} from "../users.js";

function userEntry(id: string) {
  return listUserManagementEntries().find((entry) => entry.id === id) ?? null;
}

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/users",
    { preHandler: [requireAuth, requireRole("admin")] },
    async () => ({ users: listUserManagementEntries() }),
  );

  app.post(
    "/api/users",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const parsed = userCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid user", issues: parsed.error.issues });
      }
      const data = parsed.data;
      if (db.prepare("SELECT id FROM users WHERE lower(username) = lower(?)").get(data.username)) {
        return reply.code(409).send({ error: "That username is already in use" });
      }
      const id = randomUUID();
      const permissions = normalizePermissions(data.permissions, data.role as Role);
      db.prepare(
        `INSERT INTO users (id, username, password_hash, role, permissions_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        data.username,
        hashPassword(data.password),
        data.role,
        serializePermissions(permissions),
        new Date().toISOString(),
      );
      return reply.code(201).send({ user: userEntry(id) });
    },
  );

  app.patch(
    "/api/users/:id",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const parsed = userUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid user", issues: parsed.error.issues });
      }
      const id = (request.params as { id: string }).id;
      const existing = getUserById(id);
      if (!existing) return reply.code(404).send({ error: "User not found" });
      const data = parsed.data;
      const nextRole = (data.role ?? existing.role) as Role;
      if (existing.role === "admin" && nextRole !== "admin" && adminCount() <= 1) {
        return reply.code(400).send({ error: "The last admin cannot be demoted" });
      }
      if (
        data.username &&
        db
          .prepare("SELECT id FROM users WHERE lower(username) = lower(?) AND id <> ?")
          .get(data.username, id)
      ) {
        return reply.code(409).send({ error: "That username is already in use" });
      }
      const permissions =
        data.permissions !== undefined
          ? normalizePermissions(data.permissions, nextRole)
          : data.role !== undefined && data.role !== existing.role
            ? defaultPermissionsForRole(nextRole)
            : parseStoredPermissions(existing.permissions_json, existing.role);
      db.prepare(
        "UPDATE users SET username = ?, role = ?, permissions_json = ? WHERE id = ?",
      ).run(
        data.username ?? existing.username,
        nextRole,
        serializePermissions(permissions),
        id,
      );
      return { user: userEntry(id) };
    },
  );

  app.post(
    "/api/users/:id/password",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const parsed = userPasswordResetSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid password", issues: parsed.error.issues });
      }
      const id = (request.params as { id: string }).id;
      if (!getUserById(id)) return reply.code(404).send({ error: "User not found" });
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
        hashPassword(parsed.data.password),
        id,
      );
      deleteUserSessions(id, id === request.user?.id ? request.cookies.sm_session : undefined);
      return { ok: true };
    },
  );

  app.delete(
    "/api/users/:id",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const id = (request.params as { id: string }).id;
      if (id === request.user?.id) {
        return reply.code(400).send({ error: "You cannot delete your own account" });
      }
      const existing = getUserById(id);
      if (!existing) return reply.code(404).send({ error: "User not found" });
      if (existing.role === "admin" && adminCount() <= 1) {
        return reply.code(400).send({ error: "The last admin cannot be deleted" });
      }
      db.prepare("DELETE FROM users WHERE id = ?").run(id);
      return { ok: true };
    },
  );
}
