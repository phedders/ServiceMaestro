import { useEffect, useRef, useState } from "react";
import { formatChangeValue, type FormChange } from "../form-changes";

export function SaveButton({
  label,
  savingLabel = "Saving…",
  onClick,
  changes,
  disabled = false,
  disabledTitle,
  saving = false,
  title,
  className = "button primary",
  small = false,
}: {
  label: string;
  savingLabel?: string;
  onClick: () => void;
  changes: FormChange[];
  disabled?: boolean;
  disabledTitle?: string;
  saving?: boolean;
  title?: string;
  className?: string;
  small?: boolean;
}) {
  const dirty = changes.length > 0;
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!dirty) setOpen(false);
  }, [dirty]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const buttonClass = [className, small ? "small" : "", "save-button"]
    .filter(Boolean)
    .join(" ");
  const resolvedTitle = disabled
    ? disabledTitle ?? title
    : !dirty
      ? "No changes to save"
      : title;

  return (
    <span
      className={`save-button-wrap ${dirty ? "has-changes" : ""}`}
      ref={wrapRef}
    >
      <button
        type="button"
        className={buttonClass}
        onClick={onClick}
        disabled={disabled || saving || !dirty}
        title={resolvedTitle}
      >
        {saving ? savingLabel : label}
      </button>
      {dirty && (
        <button
          type="button"
          className={`save-change-count ${small ? "small" : ""}`}
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label={`Review ${changes.length} unsaved change${
            changes.length === 1 ? "" : "s"
          }`}
          title="Review unsaved changes"
        >
          +{changes.length}
        </button>
      )}
      {open && dirty && (
        <div className="save-change-popover" role="dialog" aria-label="Unsaved changes">
          <div className="save-change-heading">
            <strong>
              {changes.length} unsaved change{changes.length === 1 ? "" : "s"}
            </strong>
            <button
              type="button"
              className="save-change-close"
              onClick={() => setOpen(false)}
              aria-label="Close change summary"
            >
              ×
            </button>
          </div>
          <ul>
            {changes.map((change, index) => (
              <li key={`${change.label}-${index}`}>
                <span className="save-change-label">{change.label}</span>
                {change.detail ? (
                  <span className="save-change-detail">{change.detail}</span>
                ) : change.hideValues ? (
                  <span className="save-change-detail">Changed</span>
                ) : (
                  <span className="save-change-values">
                    <span>{formatChangeValue(change.before)}</span>
                    <span className="save-change-arrow" aria-hidden="true">
                      →
                    </span>
                    <span>{formatChangeValue(change.after)}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
