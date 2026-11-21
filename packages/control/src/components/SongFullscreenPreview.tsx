import { useEffect, useRef, useState } from "react";
import { FullscreenButton } from "./FullscreenButton";

export function SongFullscreenPreview({
  src,
  title,
  pageCount,
  onClose,
}: {
  src: string;
  title: string;
  pageCount: number;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [page, setPage] = useState(0);

  function goTo(next: number) {
    const target = Math.max(0, Math.min(Math.max(0, pageCount - 1), next));
    setPage(target);
    const previewWindow = iframeRef.current?.contentWindow as
      | (Window & { __smPreviewGoto?: (index: number) => void })
      | null;
    previewWindow?.__smPreviewGoto?.(target);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.fullscreenElement) {
        onClose();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        goTo(event.key === "ArrowLeft" ? page - 1 : page + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div
      className="alt-backdrop song-preview-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !document.fullscreenElement) onClose();
      }}
    >
      <div className="alt-modal song-preview-modal" role="dialog" aria-modal="true" aria-label="Fullscreen output preview">
        <div className="alt-modal-heading song-preview-heading">
          <div>
            <h3>Preview as fullscreen output</h3>
            <p className="muted">{title || "Song preview"}</p>
          </div>
          <div className="button-row">
            <div className="song-preview-controls">
              <button
                type="button"
                className="button ghost small"
                onClick={() => goTo(page - 1)}
                disabled={page <= 0}
                title="Show the previous page"
              >
                ‹ Previous
              </button>
              <span className="muted">
                {pageCount ? page + 1 : 0} / {pageCount}
              </span>
              <button
                type="button"
                className="button ghost small"
                onClick={() => goTo(page + 1)}
                disabled={page >= pageCount - 1}
                title="Show the next page"
              >
                Next ›
              </button>
            </div>
            <FullscreenButton
              targetRef={frameRef}
              label="Fullscreen"
              title="Show the preview fullscreen"
            />
            <button type="button" className="button ghost small" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="song-preview-frame" ref={frameRef}>
          <iframe
            ref={iframeRef}
            src={src}
            title={`${title || "Song"} fullscreen output preview`}
            onLoad={() => goTo(page)}
          />
        </div>
      </div>
    </div>
  );
}
