import { useEffect, useState } from "react";
import {
  MODULE_PERMISSIONS,
  type ActivityEntry,
} from "@sm/shared";
import { api, ApiError } from "../api";
import { compactDateTime } from "../service-date";

const FILTER_MODULES = [
  { id: "", label: "All modules" },
  ...MODULE_PERMISSIONS.map((module) => ({ id: module.id, label: module.label })),
  { id: "auth", label: "Authentication" },
  { id: "users", label: "Users" },
];

export function ActivityPanel({
  notify,
}: {
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [module, setModule] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await api.activity({
        limit: 200,
        module: module || undefined,
        q: query.trim() || undefined,
      });
      setEntries(result.entries);
      setTotal(result.total);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not load activity log", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className="panel activity-panel">
      <div className="panel-heading">
        <div>
          <h2>User activity</h2>
          <p className="muted">
            Admin-only audit trail of logins, content changes, live commands, exports and account
            actions. {total} entries match.
          </p>
        </div>
        <div className="button-row">
          <select value={module} onChange={(event) => setModule(event.target.value)}>
            {FILTER_MODULES.map((entry) => (
              <option key={entry.id || "all"} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search user, action or path"
          />
          <button
            className="button"
            onClick={load}
            disabled={loading}
            title="Refresh the activity log"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {entries.length ? (
        <div className="activity-list">
          {entries.map((entry) => (
            <div key={entry.id} className="activity-row">
              <div className="activity-main">
                <strong>{entry.username}</strong>
                <span className="muted">{compactDateTime(entry.createdAt)}</span>
              </div>
              <div className="activity-action">
                <span>{entry.action}</span>
                {entry.module && <span className="muted">{entry.module}</span>}
              </div>
              <code>{entry.detail || entry.path || "—"}</code>
              <span className="muted">
                {entry.status ?? "—"}
                {entry.ip ? ` · ${entry.ip}` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">{loading ? "Loading activity…" : "No activity recorded yet."}</p>
      )}
    </section>
  );
}
