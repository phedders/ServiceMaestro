import { useEffect, useState } from "react";
import {
  MODULE_PERMISSIONS,
  type ActivityEntry,
} from "@sm/shared";
import { api, ApiError } from "../api";
import { compactDateTime } from "../service-date";
import { downloadBlob } from "../site-download";

const FILTER_MODULES = [
  { id: "", label: "All modules" },
  ...MODULE_PERMISSIONS.map((module) => ({ id: module.id, label: module.label })),
  { id: "auth", label: "Authentication" },
  { id: "users", label: "Users" },
  { id: "mqtt", label: "MQTT" },
];

const RETENTION_OPTIONS = [0, 30, 90, 180, 365, 730, 1095, 1825, 3650];

function retentionLabel(days: number): string {
  return days === 0 ? "forever" : `${days} days`;
}

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
  const [exporting, setExporting] = useState(false);
  const [retentionDays, setRetentionDays] = useState(0);
  const [savingRetention, setSavingRetention] = useState(false);

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

  async function loadRetention() {
    try {
      const result = await api.activityRetention();
      setRetentionDays(result.retentionDays);
    } catch {
      // Leave the safe "keep forever" default when the setting cannot be loaded.
    }
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const result = await api.activityExport({
        module: module || undefined,
        q: query.trim() || undefined,
      });
      downloadBlob(result.blob, result.filename);
      notify("Exported activity log");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not export activity log", "error");
    } finally {
      setExporting(false);
    }
  }

  async function saveRetention() {
    setSavingRetention(true);
    try {
      const result = await api.saveActivityRetention(retentionDays);
      setRetentionDays(result.retentionDays);
      await load();
      notify(
        result.deleted
          ? `Activity retention set to ${retentionLabel(result.retentionDays)}; removed ${result.deleted} old ${result.deleted === 1 ? "entry" : "entries"}`
          : `Activity retention set to ${retentionLabel(result.retentionDays)}`,
      );
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save activity retention", "error");
    } finally {
      setSavingRetention(false);
    }
  }

  useEffect(() => {
    void load();
    void loadRetention();
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
          <button
            className="button"
            onClick={() => void exportCsv()}
            disabled={loading || exporting}
            title="Export all entries matching the current module and search filters as CSV"
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      <div className="activity-retention">
        <label>
          Retention
          <select
            value={retentionDays}
            onChange={(event) => setRetentionDays(Number(event.target.value))}
          >
            {RETENTION_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days === 0 ? "Keep forever" : `${days} days`}
              </option>
            ))}
            {!RETENTION_OPTIONS.includes(retentionDays) && (
              <option value={retentionDays}>{retentionDays} days</option>
            )}
          </select>
        </label>
        <button
          className="button"
          onClick={() => void saveRetention()}
          disabled={savingRetention}
          title="Delete activity entries older than the selected retention period"
        >
          {savingRetention ? "Saving…" : "Save retention"}
        </button>
        <span className="muted">
          Older entries are pruned immediately and checked daily. The default keeps everything.
        </span>
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
