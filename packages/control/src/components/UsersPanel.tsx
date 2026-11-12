import { useEffect, useState } from "react";
import {
  MODULE_PERMISSIONS,
  defaultPermissionsForRole,
  type ModulePermissions,
  type PublicUser,
  type Role,
  type UserManagementEntry,
} from "@sm/shared";
import { api, ApiError } from "../api";

interface UserDraft {
  username: string;
  role: Role;
  permissions: ModulePermissions;
}

const ROLE_OPTIONS: Role[] = ["admin", "editor", "operator", "musician", "viewer"];

function draftFromUser(user: UserManagementEntry): UserDraft {
  return {
    username: user.username,
    role: user.role,
    permissions: { ...user.permissions },
  };
}

export function UsersPanel({
  currentUser,
  notify,
}: {
  currentUser: PublicUser;
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [users, setUsers] = useState<UserManagementEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
  const [loading, setLoading] = useState(true);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("viewer");
  const [newPermissions, setNewPermissions] = useState<ModulePermissions>(
    defaultPermissionsForRole("viewer"),
  );
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [creating, setCreating] = useState(false);

  async function loadUsers() {
    setLoading(true);
    try {
      const result = await api.users();
      setUsers(result.users);
      setDrafts(
        Object.fromEntries(result.users.map((user) => [user.id, draftFromUser(user)])),
      );
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not load users", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  function patchDraft(id: string, patch: Partial<UserDraft>) {
    setDrafts((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  }

  function changeRole(id: string, role: Role) {
    patchDraft(id, {
      role,
      permissions:
        role === "admin" ? defaultPermissionsForRole("admin") : defaultPermissionsForRole(role),
    });
  }

  function togglePermission(
    id: string,
    module: keyof ModulePermissions,
    checked: boolean,
  ) {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        permissions: { ...current[id].permissions, [module]: checked },
      },
    }));
  }

  async function createUser() {
    if (!newUsername.trim() || newPassword.length < 8) {
      notify("Enter a username and a password of at least 8 characters", "error");
      return;
    }
    setCreating(true);
    try {
      await api.createUser({
        username: newUsername.trim(),
        password: newPassword,
        role: newRole,
        permissions: newPermissions,
      });
      setNewUsername("");
      setNewPassword("");
      setNewRole("viewer");
      setNewPermissions(defaultPermissionsForRole("viewer"));
      await loadUsers();
      notify("User created");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not create user", "error");
    } finally {
      setCreating(false);
    }
  }

  async function saveUser(user: UserManagementEntry) {
    const draft = drafts[user.id];
    if (!draft) return;
    setBusyId(user.id);
    try {
      await api.updateUser(user.id, {
        username: draft.username.trim(),
        role: draft.role,
        permissions: draft.permissions,
      });
      await loadUsers();
      notify(`Updated ${draft.username}`);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not update user", "error");
    } finally {
      setBusyId("");
    }
  }

  async function resetPassword(user: UserManagementEntry) {
    const password = passwords[user.id] ?? "";
    if (password.length < 8) {
      notify("Password must be at least 8 characters", "error");
      return;
    }
    setBusyId(user.id);
    try {
      await api.resetUserPassword(user.id, password);
      setPasswords((current) => ({ ...current, [user.id]: "" }));
      notify(`Password reset for ${user.username}`);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not reset password", "error");
    } finally {
      setBusyId("");
    }
  }

  async function deleteUser(user: UserManagementEntry) {
    if (!confirm(`Delete user “${user.username}”? Their sessions and passkeys will be removed.`)) {
      return;
    }
    setBusyId(user.id);
    try {
      await api.deleteUser(user.id);
      await loadUsers();
      notify("User deleted");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not delete user", "error");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="panel users-panel">
      <div className="panel-heading">
        <div>
          <h2>Users and write access</h2>
          <p className="muted">
            Admin-only. Read access is available to every signed-in user; these checkboxes control
            who may change content or operate live output.
          </p>
        </div>
        <span className="muted">{users.length} users</span>
      </div>

      <div className="user-create-grid">
        <label>
          Username
          <input
            value={newUsername}
            onChange={(event) => setNewUsername(event.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          Initial password
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="At least 8 characters"
          />
        </label>
        <label>
          Role
          <select value={newRole} onChange={(event) => {
            const role = event.target.value as Role;
            setNewRole(role);
            setNewPermissions(defaultPermissionsForRole(role));
          }}>
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button primary"
          onClick={createUser}
          disabled={creating}
          title="Create a new user account"
        >
          {creating ? "Creating…" : "Add user"}
        </button>
      </div>
      {newRole !== "admin" && (
        <PermissionChecks
          permissions={newPermissions}
          onChange={(module, checked) =>
            setNewPermissions((current) => ({ ...current, [module]: checked }))
          }
        />
      )}

      {loading ? (
        <p className="muted">Loading users…</p>
      ) : (
        <div className="user-list">
          {users.map((user) => {
            const draft = drafts[user.id] ?? draftFromUser(user);
            const busy = busyId === user.id;
            return (
              <article key={user.id} className="user-row">
                <div className="user-row-heading">
                  <label>
                    Username
                    <input
                      value={draft.username}
                      onChange={(event) => patchDraft(user.id, { username: event.target.value })}
                    />
                  </label>
                  <label>
                    Role
                    <select
                      value={draft.role}
                      onChange={(event) => changeRole(user.id, event.target.value as Role)}
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="muted">
                    {user.passkeyCount} passkey{user.passkeyCount === 1 ? "" : "s"}
                  </span>
                  <div className="button-row">
                    <button
                      className="button small"
                      onClick={() => saveUser(user)}
                      disabled={busy}
                      title="Save this user's role and module permissions"
                    >
                      Save
                    </button>
                    {user.id !== currentUser.id && (
                      <button
                        className="button ghost small danger-text"
                        onClick={() => deleteUser(user)}
                        disabled={busy}
                        title="Delete this user and their passkeys"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>

                {draft.role === "admin" ? (
                  <p className="hint">Administrators always have full write access.</p>
                ) : (
                  <PermissionChecks
                    permissions={draft.permissions}
                    onChange={(module, checked) => togglePermission(user.id, module, checked)}
                  />
                )}

                <div className="user-password-row">
                  <label>
                    Reset password
                    <input
                      type="password"
                      value={passwords[user.id] ?? ""}
                      onChange={(event) =>
                        setPasswords((current) => ({
                          ...current,
                          [user.id]: event.target.value,
                        }))
                      }
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                    />
                  </label>
                  <button
                    className="button ghost small"
                    onClick={() => resetPassword(user)}
                    disabled={busy}
                    title={`Set a new password for ${user.username}`}
                  >
                    Set password
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function PermissionChecks({
  permissions,
  onChange,
}: {
  permissions: ModulePermissions;
  onChange: (module: keyof ModulePermissions, checked: boolean) => void;
}) {
  return (
    <div className="permission-grid">
      {MODULE_PERMISSIONS.map((module) => (
        <label key={module.id} className="permission-check" title={module.description}>
          <input
            type="checkbox"
            checked={Boolean(permissions[module.id])}
            onChange={(event) => onChange(module.id, event.target.checked)}
          />
          <span>{module.label}</span>
        </label>
      ))}
    </div>
  );
}
