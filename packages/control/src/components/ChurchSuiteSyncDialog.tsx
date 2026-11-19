import { useEffect } from "react";
import type { ChurchSuiteSyncPreview } from "@sm/shared";

const CHANGE_LABELS = {
  added: "Added",
  removed: "Removed",
  updated: "Changed",
  setlist: "Set list",
} as const;

export function ChurchSuiteSyncDialog({
  preview,
  busy,
  onSync,
  onCreateNew,
  onClose,
}: {
  preview: ChurchSuiteSyncPreview;
  busy: boolean;
  onSync: () => void;
  onCreateNew: () => void;
  onClose: () => void;
}) {
  const { existingSetlist, changes, summary } = preview;
  const hasChanges = changes.length > 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  return (
    <div
      className="alt-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="alt-modal cs-sync-modal" role="dialog" aria-modal="true">
        <div className="alt-modal-heading">
          <div>
            <h3>Update existing set list</h3>
            <p className="muted">
              “{existingSetlist.name}” is already linked to this ChurchSuite plan. Review the
              differences before syncing the latest plan into it.
            </p>
          </div>
          <button
            type="button"
            className="button ghost small"
            onClick={onClose}
            disabled={busy}
            title="Close without changing the set list"
          >
            Close
          </button>
        </div>

        <div className="cs-sync-summary">
          <span className="cs-sync-chip added">{summary.added} added</span>
          <span className="cs-sync-chip updated">{summary.updated} changed</span>
          <span className="cs-sync-chip removed">{summary.removed} removed</span>
          <span className="cs-sync-chip unchanged">{summary.unchanged} unchanged</span>
          {summary.manual > 0 && (
            <span className="cs-sync-chip manual">{summary.manual} manual kept</span>
          )}
        </div>

        {hasChanges ? (
          <div className="cs-sync-changes">
            {changes.map((change, index) => (
              <article
                key={`${change.kind}:${change.title}:${index}`}
                className={`cs-sync-change ${change.kind}`}
              >
                <div className="cs-sync-change-heading">
                  <span className={`cs-sync-kind ${change.kind}`}>
                    {CHANGE_LABELS[change.kind]}
                  </span>
                  <strong>{change.title}</strong>
                </div>
                {change.detail && <p className="muted">{change.detail}</p>}
                {change.fields.length > 0 && (
                  <div className="cs-sync-fields">
                    {change.fields.map((field) => (
                      <div className="cs-sync-field" key={`${field.label}:${index}`}>
                        <span className="cs-sync-label">{field.label}</span>
                        <span className="cs-sync-before">{field.before ?? "—"}</span>
                        <span className="cs-sync-arrow">→</span>
                        <span className="cs-sync-after">{field.after ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="cs-sync-empty">
            This set list already matches the ChurchSuite plan. There is nothing to sync.
          </p>
        )}

        <p className="hint">
          Syncing updates and reorders the imported plan items, adds new plan items, removes items
          deleted from the plan, and keeps manually added items. Songs and Bible readings use the
          choices currently selected in the plan form.
        </p>

        <div className="cs-sync-actions">
          <button
            type="button"
            className="button ghost"
            onClick={onCreateNew}
            disabled={busy}
            title="Create a separate set list instead of updating the linked one"
          >
            Create separate set list
          </button>
          <button
            type="button"
            className="button primary"
            onClick={onSync}
            disabled={busy || !hasChanges}
            title={
              hasChanges
                ? "Apply these changes to the linked set list"
                : "There are no changes to sync"
            }
          >
            {busy ? "Syncing…" : "Sync changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
