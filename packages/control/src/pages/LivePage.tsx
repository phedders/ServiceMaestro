import { useEffect, useState } from "react";
import type { LiveState, SetlistSummary } from "@wlm/shared";
import { api, ApiError } from "../api";
import { SlidePreview } from "../components/SlidePreview";
import { Transport } from "../components/Transport";
import { ItemList, PageList } from "../components/LivePanels";
import { QuickText } from "../components/QuickText";

export default function LivePage({
  live,
  onCommand,
  onQuickText,
  onStarted,
  notify,
}: {
  live: LiveState;
  onCommand: (payload: Record<string, unknown>) => void;
  onQuickText: (text: string) => void;
  onStarted: (state: LiveState) => void;
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [setlists, setSetlists] = useState<SetlistSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<"live" | "rehearsal">("live");
  const [starting, setStarting] = useState(false);
  const [footer, setFooter] = useState(live.footer);

  useEffect(() => {
    setFooter(live.footer);
  }, [live.footer]);

  useEffect(() => {
    api
      .setlists()
      .then((result) => {
        setSetlists(result.setlists);
        if (!selected && result.setlists[0]) setSelected(result.setlists[0].id);
      })
      .catch(() => undefined);
  }, []);

  async function start() {
    if (!selected) return;
    setStarting(true);
    try {
      const result = await api.startLive(selected, mode);
      onStarted(result.state);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not start session", "error");
    } finally {
      setStarting(false);
    }
  }

  if (live.status === "idle") {
    return (
      <section className="panel start-panel">
        <div>
          <h2>Start a live session</h2>
          <p className="muted">
            The set list is snapshotted when the session starts. Editing it afterwards will not change
            what is currently live.
          </p>
        </div>
        <div className="start-controls">
          <label>
            Set list
            <select value={selected} onChange={(event) => setSelected(event.target.value)}>
              <option value="">Choose a set list…</option>
              {setlists.map((setlist) => (
                <option key={setlist.id} value={setlist.id}>
                  {setlist.name} — {setlist.serviceDate} ({setlist.itemCount} items)
                </option>
              ))}
            </select>
          </label>
          <label>
            Mode
            <select value={mode} onChange={(event) => setMode(event.target.value as "live" | "rehearsal")}>
              <option value="live">Live</option>
              <option value="rehearsal">Rehearsal</option>
            </select>
          </label>
          <button className="button primary" disabled={!selected || starting} onClick={start}>
            {starting ? "Starting…" : "Start session"}
          </button>
        </div>
        {!setlists.length && (
          <p className="hint">Create a set list first under “Set lists”, then add songs or text.</p>
        )}
      </section>
    );
  }

  return (
    <div className="live-layout">
      {live.pendingUpdate && (
        <div className="banner live-banner">
          Update queued for after the current item (revision {live.pendingRevision ?? "?"}).
        </div>
      )}
      <section className="panel preview-panel">
        <div className="panel-heading">
          <h2>Preview</h2>
          <span className={`badge ${live.status}`}>{live.status}</span>
        </div>
        <SlidePreview live={live} />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Transport</h2>
          <span className="muted">{live.setlistName}</span>
        </div>
        <Transport live={live} onCommand={onCommand} />
        <label className="footer-field">
          Footer
          <div className="inline-field">
            <input
              value={footer}
              onChange={(event) => setFooter(event.target.value)}
              placeholder="Optional footer text"
              onKeyDown={(event) => {
                if (event.key === "Enter") onCommand({ type: "footer", text: footer });
              }}
            />
            <button className="button ghost" onClick={() => onCommand({ type: "footer", text: footer })}>
              Set
            </button>
          </div>
        </label>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Items</h2>
          <span className="muted">{live.items.length} in session</span>
        </div>
        <ItemList live={live} onCommand={onCommand} />
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Pages</h2>
          <span className="muted">
            {live.pageCount ? `${live.pageIndex + 1} / ${live.pageCount}` : "0 pages"}
          </span>
        </div>
        <PageList live={live} onCommand={onCommand} />
      </section>

      <section className="panel wide-panel">
        <div className="panel-heading">
          <h2>Quick text</h2>
          <span className="muted">Display immediately</span>
        </div>
        <QuickText onSend={onQuickText} />
      </section>
    </div>
  );
}
