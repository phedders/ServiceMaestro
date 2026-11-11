import type { LiveState } from "@sm/shared";

export function Transport({
  live,
  onCommand,
  compact = false,
}: {
  live: LiveState;
  onCommand: (payload: Record<string, unknown>) => void;
  compact?: boolean;
}) {
  const active = live.status !== "idle";
  return (
    <div className={`transport ${compact ? "compact" : ""}`}>
      <div className="transport-row">
        <button
          className="button"
          disabled={!active}
          onClick={() => onCommand({ type: "prev" })}
          title="Go back one page, or to the previous item at the start of an item"
        >
          ← Previous
        </button>
        <button
          className="button primary"
          disabled={!active}
          onClick={() => onCommand({ type: "next" })}
          title="Advance one page, or to the next item at the end of an item"
        >
          Next →
        </button>
        <button
          className={`button ${live.blank ? "danger" : "ghost"}`}
          disabled={!active}
          onClick={() => onCommand({ type: "blank", value: !live.blank })}
          title={live.blank ? "Show the current live page" : "Blank the live outputs"}
        >
          {live.blank ? "Show" : "Blank"}
        </button>
      </div>
      <div className="transport-row">
        <div className="stepper">
          <span>Transpose</span>
          <button
            className="button ghost small"
            disabled={!active}
            onClick={() => onCommand({ type: "transpose", delta: -1 })}
            title="Transpose down one semitone"
          >
            −
          </button>
          <strong>{live.transpose > 0 ? `+${live.transpose}` : live.transpose}</strong>
          <button
            className="button ghost small"
            disabled={!active}
            onClick={() => onCommand({ type: "transpose", delta: 1 })}
            title="Transpose up one semitone"
          >
            +
          </button>
        </div>
        <div className="stepper">
          <span>Lines / page</span>
          <button
            className="button ghost small"
            disabled={!active}
            onClick={() => onCommand({ type: "maxLines", value: Math.max(1, live.maxLines - 1) })}
            title="Reduce the maximum lines per page"
          >
            −
          </button>
          <strong>{live.maxLines}</strong>
          <button
            className="button ghost small"
            disabled={!active}
            onClick={() => onCommand({ type: "maxLines", value: Math.min(20, live.maxLines + 1) })}
            title="Increase the maximum lines per page"
          >
            +
          </button>
        </div>
      </div>
      <div className="transport-meta">
        {active ? (
          <>
            <span>{live.title || live.setlistName}</span>
            <span>
              page {live.pageCount ? live.pageIndex + 1 : 0} / {live.pageCount}
            </span>
          </>
        ) : (
          <span>Start a session to control the output.</span>
        )}
      </div>
    </div>
  );
}
