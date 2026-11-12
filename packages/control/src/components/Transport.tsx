import type { LiveState } from "@sm/shared";

const PLAYBACK_MODES = [
  { value: "single", label: "Single" },
  { value: "loop", label: "Loop" },
  { value: "bounce", label: "Bounce" },
] as const;

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
  const autoplay = live.autoplay;
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
      {active && autoplay && (
        <div className="transport-autoplay">
          <div className="transport-autoplay-heading">
            <strong>
              {autoplay.itemKind === "tarp" ? "Tarp playback" : "Image list playback"}
            </strong>
            <span className={`badge ${autoplay.overridden ? "rehearsal" : ""}`}>
              {autoplay.overridden ? "Temporary override" : "Set-list settings"}
            </span>
          </div>
          <div className="transport-row">
            <button
              type="button"
              className={`button small ${autoplay.autoplay ? "primary" : "ghost"}`}
              onClick={() =>
                onCommand({ type: "autoplay", autoplay: !autoplay.autoplay })
              }
              title={
                autoplay.autoplay
                  ? "Temporarily stop automatic page changes"
                  : "Temporarily start automatic page changes"
              }
            >
              {autoplay.autoplay ? "Autoplay on" : "Autoplay off"}
            </button>
            <label className="transport-select">
              <span>Mode</span>
              <select
                value={autoplay.mode}
                onChange={(event) =>
                  onCommand({ type: "autoplay", mode: event.target.value })
                }
                title="Temporarily override the loop mode for this live item"
              >
                {PLAYBACK_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="stepper">
              <span>Delay</span>
              <button
                type="button"
                className="button ghost small"
                onClick={() =>
                  onCommand({
                    type: "autoplay",
                    delaySeconds: Math.max(1, autoplay.delaySeconds - 1),
                  })
                }
                title="Reduce the temporary playback delay"
              >
                −
              </button>
              <strong>{autoplay.delaySeconds}s</strong>
              <button
                type="button"
                className="button ghost small"
                onClick={() =>
                  onCommand({
                    type: "autoplay",
                    delaySeconds: Math.min(300, autoplay.delaySeconds + 1),
                  })
                }
                title="Increase the temporary playback delay"
              >
                +
              </button>
            </div>
            {autoplay.overridden && (
              <button
                type="button"
                className="button ghost small"
                onClick={() => onCommand({ type: "autoplay", reset: true })}
                title="Restore the playback settings saved in the set list"
              >
                Reset
              </button>
            )}
          </div>
          <p className="hint transport-autoplay-hint">
            Temporary changes apply to this live session only and do not alter the set list.
          </p>
        </div>
      )}
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
