import type { LiveState } from "@wlm/shared";

export function SlidePreview({ live, compact = false }: { live: LiveState; compact?: boolean }) {
  const page = live.pages[live.pageIndex];
  return (
    <div className={`slide-preview ${compact ? "compact" : ""} ${live.blank ? "blanked" : ""}`}>
      <div className="slide-preview-inner">
        {page ? (
          <div className="slide-html" dangerouslySetInnerHTML={{ __html: page.html }} />
        ) : (
          <div className="slide-empty">
            {live.status === "idle" ? "No live session" : "No pages"}
          </div>
        )}
      </div>
      {live.footer && <div className="slide-preview-footer">{live.footer}</div>}
      {live.blank && <div className="slide-blanked">BLANK</div>}
    </div>
  );
}
