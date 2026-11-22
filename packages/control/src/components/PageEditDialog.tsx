import { useEffect, useState } from "react";
import type { LivePage } from "@sm/shared";
import { api, ApiError } from "../api";

type PageEditTarget = "queue" | "setlist" | "source";

export function PageEditDialog({
  page,
  canSaveToSetlist,
  onSave,
  onClose,
}: {
  page: LivePage;
  canSaveToSetlist: boolean;
  onSave: (target: PageEditTarget, source: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"source" | "rendered">("source");
  const [source, setSource] = useState(page.source ?? "");
  const [preview, setPreview] = useState(page.html);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const itemIndex = page.itemIndex;
  const itemKind = page.itemKind;
  const pageNumber = (page.sourcePageIndex ?? page.index) + 1;
  const sourceLabel = itemKind === "song" ? "song" : "text";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (mode !== "rendered" || itemIndex == null || itemIndex < 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .livePagePreview(itemIndex, source)
        .then((result) => {
          if (cancelled) return;
          setPreview(result.html);
          setPreviewError(null);
        })
        .catch((error) => {
          if (cancelled) return;
          setPreviewError(
            error instanceof ApiError ? error.message : "Could not render this page",
          );
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, source, itemIndex]);

  const save = (target: PageEditTarget) => {
    onSave(target, source);
    onClose();
  };

  return (
    <div
      className="alt-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="alt-modal page-edit-modal" role="dialog" aria-modal="true">
        <div className="alt-modal-heading">
          <div>
            <h3>Edit page {pageNumber}</h3>
            <p className="muted">
              Change this page without touching the rest of the item.
            </p>
          </div>
          <button className="button ghost small" onClick={onClose} title="Close without saving">
            Close
          </button>
        </div>

        <div className="page-edit-toolbar">
          <div className="page-edit-tabs" role="tablist" aria-label="Page editor view">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "source"}
              className={`button small ${mode === "source" ? "" : "ghost"}`}
              onClick={() => setMode("source")}
            >
              Raw source
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "rendered"}
              className={`button small ${mode === "rendered" ? "" : "ghost"}`}
              onClick={() => setMode("rendered")}
            >
              Rendered text
            </button>
          </div>
          <span className="hint">
            Saving marks this page for reload. Click its ↻ icon when you are ready to
            show it live.
          </span>
        </div>

        {mode === "source" ? (
          <textarea
            className="page-edit-source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            rows={18}
            spellCheck={false}
            placeholder={
              itemKind === "song"
                ? "[Chorus]\nAmazing grace, how sweet the sound"
                : "Enter the text for this page"
            }
          />
        ) : (
          <div className="page-edit-rendered-wrap">
            {previewError ? (
              <p className="error-text">{previewError}</p>
            ) : (
              <div
                className="page-edit-rendered page-text slide-inner"
                dangerouslySetInnerHTML={{ __html: preview }}
              />
            )}
          </div>
        )}

        <div className="page-edit-actions">
          <button
            type="button"
            className="button ghost"
            onClick={() => save("queue")}
            title="Apply this edit only to the current live queue"
          >
            Save in queue
          </button>
          <button
            type="button"
            className="button ghost"
            onClick={() => save("setlist")}
            disabled={!canSaveToSetlist}
            title={
              canSaveToSetlist
                ? "Save this page override on the set-list item"
                : "Start this session from a set list to save there"
            }
          >
            Save to setlist
          </button>
          <button
            type="button"
            className="button"
            onClick={() => save("source")}
            disabled={!canSaveToSetlist}
            title={
              canSaveToSetlist
                ? `Save this page override to the ${sourceLabel}`
                : `Start this session from a set list to save to the ${sourceLabel}`
            }
          >
            Save to {sourceLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
