import type { CSSProperties } from "react";
import type { LiveState } from "@sm/shared";

export function SlidePreview({ live, compact = false }: { live: LiveState; compact?: boolean }) {
  const page = live.pages[live.pageIndex];
  const config = live.displayConfig;
  return (
    <div
      className={`slide-preview ${compact ? "compact" : ""} ${live.blank ? "blanked" : ""}`}
      style={
        config
          ? ({
              color: config.textColor,
              fontFamily: config.fontFamily,
              "--sm-text-scale": config.textScale,
            } as CSSProperties)
          : undefined
      }
    >
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
