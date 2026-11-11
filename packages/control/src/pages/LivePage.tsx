import { useEffect, useState } from "react";
import type { DisplayConfig, FontOption, LiveState, SetlistSummary } from "@wlm/shared";
import { api, ApiError } from "../api";
import { SlidePreview } from "../components/SlidePreview";
import { Transport } from "../components/Transport";
import { ItemList, PageList } from "../components/LivePanels";
import { QuickText } from "../components/QuickText";

const FALLBACK_FONTS: FontOption[] = [
  {
    id: "builtin-clear-sans",
    label: "Clear Sans / system",
    family: '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
    source: "built-in",
    cssUrl: null,
    importedAt: null,
  },
  {
    id: "builtin-system",
    label: "System sans-serif",
    family: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    source: "built-in",
    cssUrl: null,
    importedAt: null,
  },
  {
    id: "builtin-serif",
    label: "Serif",
    family: 'Georgia, "Times New Roman", serif',
    source: "built-in",
    cssUrl: null,
    importedAt: null,
  },
  {
    id: "builtin-humanist",
    label: "Humanist sans",
    family: '"Trebuchet MS", "Segoe UI", sans-serif',
    source: "built-in",
    cssUrl: null,
    importedAt: null,
  },
  {
    id: "builtin-mono",
    label: "Monospace",
    family: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
    source: "built-in",
    cssUrl: null,
    importedAt: null,
  },
];

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
  const [fonts, setFonts] = useState<FontOption[]>(FALLBACK_FONTS);
  const [displayConfig, setDisplayConfig] = useState<DisplayConfig>(
    live.displayConfig ?? {
      fontFamily: '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
      textColor: "#ffffff",
      textScale: 1,
      maxLines: 4,
      maxWords: 90,
      smartPageSplits: true,
    },
  );
  const [configSaving, setConfigSaving] = useState(false);

  useEffect(() => {
    if (live.displayConfig) {
      setDisplayConfig(live.displayConfig);
      return;
    }
    api
      .displayConfig()
      .then((result) => setDisplayConfig(result.config))
      .catch(() => undefined);
  }, [
    live.displayConfig?.fontFamily,
    live.displayConfig?.textColor,
    live.displayConfig?.textScale,
    live.displayConfig?.maxLines,
    live.displayConfig?.maxWords,
    live.displayConfig?.smartPageSplits,
  ]);

  useEffect(() => {
    api
      .fonts()
      .then((result) => setFonts(result.fonts))
      .catch(() => undefined);
  }, []);

  async function saveConfig() {
    setConfigSaving(true);
    try {
      await api.saveDisplayConfig(displayConfig);
      notify("Display settings saved");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save display settings", "error");
    } finally {
      setConfigSaving(false);
    }
  }

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
            {live.queuedItemIndex != null
              ? `Queued: ${live.queuedTitle ?? "item"} · ${live.queuedPages?.length ?? 0} pages`
              : live.pageCount
                ? `${live.pageIndex + 1} / ${live.pageCount}`
                : "0 pages"}
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

      <section className="panel wide-panel">
        <div className="panel-heading">
          <div>
            <h2>Display config</h2>
            <p className="muted">Applies to main and two-thirds. Stage and chords keep their fixed style.</p>
          </div>
          <button className="button primary" onClick={saveConfig} disabled={configSaving}>
            {configSaving ? "Saving…" : "Save display config"}
          </button>
        </div>
        <div className="display-config-grid">
          <label>
            Font
            <select
              value={displayConfig.fontFamily}
              onChange={(event) => setDisplayConfig({ ...displayConfig, fontFamily: event.target.value })}
            >
              {fonts.map((font) => (
                <option key={font.id} value={font.family}>
                  {font.label}
                  {font.source === "google" ? " (Google)" : ""}
                </option>
              ))}
              {!fonts.some((font) => font.family === displayConfig.fontFamily) && (
                <option value={displayConfig.fontFamily}>Custom / imported</option>
              )}
            </select>
          </label>
          <label>
            Text colour
            <input
              type="color"
              value={displayConfig.textColor}
              onChange={(event) => setDisplayConfig({ ...displayConfig, textColor: event.target.value })}
            />
          </label>
          <label>
            Text size · {Math.round(displayConfig.textScale * 100)}%
            <input
              type="range"
              min={50}
              max={200}
              step={5}
              value={displayConfig.textScale * 100}
              onChange={(event) =>
                setDisplayConfig({ ...displayConfig, textScale: Number(event.target.value) / 100 })
              }
            />
          </label>
          <label>
            Max lines / page
            <input
              type="number"
              min={1}
              max={20}
              value={displayConfig.maxLines}
              onChange={(event) =>
                setDisplayConfig({ ...displayConfig, maxLines: Number(event.target.value) || 4 })
              }
            />
          </label>
          <label>
            Max words / page
            <input
              type="number"
              min={1}
              max={500}
              value={displayConfig.maxWords}
              onChange={(event) =>
                setDisplayConfig({ ...displayConfig, maxWords: Number(event.target.value) || 90 })
              }
            />
          </label>
          <label className="checkbox smart-split-field">
            <input
              type="checkbox"
              checked={displayConfig.smartPageSplits}
              onChange={(event) =>
                setDisplayConfig({ ...displayConfig, smartPageSplits: event.target.checked })
              }
            />
            <span>
              Smart page splits
              <small>
                Estimate 1080p coverage from font size and words. Pages break on whichever limit is
                reached first.
              </small>
            </span>
          </label>
        </div>
      </section>
    </div>
  );
}
