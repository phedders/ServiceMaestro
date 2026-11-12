import {
  ALL_MODULE_PERMISSIONS,
  defaultPermissionsForRole,
  emptyModulePermissions,
  type ModulePermissions,
  type PermissionModule,
  type PublicUser,
  type Role,
  type UserManagementEntry,
} from "@sm/shared";
import { db } from "./db.js";

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: Role;
  permissions_json: string | null;
  created_at: string;
}

export function parseRole(value: unknown): Role {
  return value === "admin" ||
    value === "editor" ||
    value === "operator" ||
    value === "musician" ||
    value === "viewer"
    ? value
    : "viewer";
}

export function normalizePermissions(value: unknown, role: Role): ModulePermissions {
  if (role === "admin") return defaultPermissionsForRole("admin");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultPermissionsForRole(role);
  }
  const permissions = emptyModulePermissions();
  for (const module of ALL_MODULE_PERMISSIONS) {
    permissions[module] = Boolean((value as Record<string, unknown>)[module]);
  }
  return permissions;
}

export function parseStoredPermissions(raw: string | null, role: Role): ModulePermissions {
  if (!raw) return defaultPermissionsForRole(role);
  try {
    return normalizePermissions(JSON.parse(raw) as unknown, role);
  } catch {
    return defaultPermissionsForRole(role);
  }
}

export function serializePermissions(permissions: ModulePermissions): string {
  return JSON.stringify(permissions);
}

export function mapUser(row: UserRow): PublicUser {
  const role = parseRole(row.role);
  return {
    id: row.id,
    username: row.username,
    role,
    permissions: parseStoredPermissions(row.permissions_json, role),
  };
}

export function getUserById(id: string): UserRow | null {
  return (
    (db
      .prepare(
        "SELECT id, username, password_hash, role, permissions_json, created_at FROM users WHERE id = ?",
      )
      .get(id) as UserRow | undefined) ?? null
  );
}

export function getUserByUsername(username: string): UserRow | null {
  return (
    (db
      .prepare(
        "SELECT id, username, password_hash, role, permissions_json, created_at FROM users WHERE username = ?",
      )
      .get(username) as UserRow | undefined) ?? null
  );
}

export function listUserManagementEntries(): UserManagementEntry[] {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.role, u.permissions_json, u.created_at,
              (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkey_count
       FROM users u ORDER BY u.username COLLATE NOCASE`,
    )
    .all() as Array<UserRow & { passkey_count: number }>;
  return rows.map((row) => {
    const user = mapUser(row);
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      permissions: user.permissions,
      passkeyCount: row.passkey_count,
      createdAt: row.created_at,
    };
  });
}

export function hasPermission(
  user: Pick<PublicUser, "role" | "permissions">,
  module: PermissionModule,
): boolean {
  return user.role === "admin" || user.permissions[module] === true;
}

export function adminCount(): number {
  return (db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get() as {
    count: number;
  }).count;
}
