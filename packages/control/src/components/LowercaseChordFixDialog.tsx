import { useEffect } from "react";
import type { SongLowercaseChordChange } from "@sm/shared";

export function LowercaseChordFixDialog({
  changes,
  title = "Lowercase chords found",
  description = "SongSelect sometimes writes chord roots in lowercase, such as [c] or [am]. Fix them to standard uppercase chord names?",
  keepLabel = "Keep as imported",
  fixLabel = "Fix to uppercase",
  busy = false,
  onFix,
  onKeep,
  onDismiss,
}: {
  changes: SongLowercaseChordChange[];
  title?: string;
  description?: string;
  keepLabel?: string;
  fixLabel?: string;
  busy?: boolean;
  onFix: () => void;
  onKeep: () => void;
  onDismiss?: () => void;
}) {
  const dismiss = onDismiss ?? onKeep;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, dismiss]);

  const total = changes.reduce((count, change) => count + change.count, 0);

  return (
    <div
      className="alt-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) dismiss();
      }}
    >
      <div className="alt-modal lowercase-chord-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="alt-modal-heading">
          <div>
            <h3>{title}</h3>
            <p className="muted">{description}</p>
          </div>
        </div>
        <div className="page-id-fix-list">
          {changes.map((change) => (
            <div className="page-id-fix-row" key={`${change.from}:${change.to}`}>
              <strong>
                [{change.from}] → [{change.to}]
              </strong>
              <span>
                {change.count} occurrence{change.count === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </div>
        <p className="muted">
          {total} lowercase chord{total === 1 ? "" : "s"} will be rewritten.
        </p>
        <div className="lowercase-chord-actions">
          <button type="button" className="button ghost" onClick={onKeep} disabled={busy}>
            {keepLabel}
          </button>
          <button type="button" className="button primary" onClick={onFix} disabled={busy}>
            {busy ? "Fixing…" : fixLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
