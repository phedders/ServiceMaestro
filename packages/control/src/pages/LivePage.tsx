import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type {
  DisplayConfig,
  DisplayViewLink,
  FontOption,
  LiveState,
  SetlistSummary,
} from "@sm/shared";
import { api, ApiError } from "../api";
import { SlidePreview } from "../components/SlidePreview";
import { Transport } from "../components/Transport";
import { ItemList, PageList } from "../components/LivePanels";
import { QuickText } from "../components/QuickText";
import { compactDate } from "../service-date";

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

const DEFAULT_QUEUE_HEIGHT = 420;
const MIN_QUEUE_HEIGHT = 220;
const MAX_QUEUE_HEIGHT = 1000;
const QUEUE_HEIGHT_STORAGE_KEY = "sm-live-queue-height";
const PREVIEW_VIEWS = [
  { id: "full", label: "Fullscreen" },
  { id: "lowerthird", label: "Lowerthird" },
  { id: "two-thirds", label: "Two-thirds" },
  { id: "stage", label: "Stage" },
  { id: "chords", label: "Chords" },
] as const;

function clampQueueHeight(value: number): number {
  return Math.max(MIN_QUEUE_HEIGHT, Math.min(MAX_QUEUE_HEIGHT, Math.round(value)));
}

function initialQueueHeight(): number {
  try {
    const stored = Number(window.localStorage.getItem(QUEUE_HEIGHT_STORAGE_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampQueueHeight(stored) : DEFAULT_QUEUE_HEIGHT;
  } catch {
    return DEFAULT_QUEUE_HEIGHT;
  }
}

export default function LivePage({
  live,
  displayViews,
  onCommand,
  onQuickText,
  onStarted,
  notify,
}: {
  live: LiveState;
  displayViews: DisplayViewLink[];
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
      lowerThirdImageMaxHeightPercent: 30,
      lowerThirdImagePadding: 48,
      lowerThirdFontFamily: '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
      lowerThirdTextScale: 1,
    },
  );
  const [configSaving, setConfigSaving] = useState(false);
  const [previewView, setPreviewView] = useState("full");
  const [queueHeight, setQueueHeight] = useState(initialQueueHeight);
  const queueResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(QUEUE_HEIGHT_STORAGE_KEY, String(queueHeight));
    } catch {
      // Layout persistence is optional; dragging still works for this session.
    }
  }, [queueHeight]);

  useEffect(() => () => document.body.classList.remove("resizing-live-queue"), []);

  function startQueueResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture may be unavailable for programmatic or older pointer events.
    }
    queueResizeRef.current = { startY: event.clientY, startHeight: queueHeight };
    document.body.classList.add("resizing-live-queue");
  }

  function moveQueueResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = queueResizeRef.current;
    if (!drag) return;
    setQueueHeight(clampQueueHeight(drag.startHeight + event.clientY - drag.startY));
  }

  function endQueueResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!queueResizeRef.current) return;
    queueResizeRef.current = null;
    document.body.classList.remove("resizing-live-queue");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

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
    live.displayConfig?.lowerThirdImageMaxHeightPercent,
    live.displayConfig?.lowerThirdImagePadding,
    live.displayConfig?.lowerThirdFontFamily,
    live.displayConfig?.lowerThirdTextScale,
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

  const previewLink = displayViews.find((view) => view.id === previewView);
  const previewLabel =
    PREVIEW_VIEWS.find((view) => view.id === previewView)?.label ?? PREVIEW_VIEWS[0].label;

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
                  {setlist.name} — {compactDate(setlist.serviceDate)} ({setlist.itemCount} items)
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
          <button
            className="button primary"
            disabled={!selected || starting}
            onClick={start}
            title="Start a live or rehearsal session with the selected set list"
          >
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
        <div className="panel-heading preview-heading">
          <div className="preview-heading-title">
            <h2>Preview</h2>
            <span className={`badge ${live.status}`}>{live.status}</span>
          </div>
          <div className="preview-view-switcher" role="group" aria-label="Preview view">
            {PREVIEW_VIEWS.map((view) => {
              if (!displayViews.some((link) => link.id === view.id)) return null;
              return (
                <button
                  key={view.id}
                  type="button"
                  className={`preview-view-button ${previewView === view.id ? "active" : ""}`}
                  aria-pressed={previewView === view.id}
                  onClick={() => setPreviewView(view.id)}
                  title={`Preview the ${view.label} live view`}
                >
                  {view.label}
                </button>
              );
            })}
          </div>
        </div>
        {previewLink ? (
          <div className="preview-frame">
            <iframe
              key={previewLink.id}
              src={previewLink.url}
              title={`${previewLabel} live preview`}
              loading="eager"
            />
            {live.blank && <div className="slide-blanked">BLANK</div>}
          </div>
        ) : (
          <SlidePreview live={live} />
        )}
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
            <button
              className="button ghost"
              onClick={() => onCommand({ type: "footer", text: footer })}
              title="Apply this footer text to the live outputs"
            >
              Set
            </button>
          </div>
        </label>
      </section>

      <div
        className="live-queue-section"
        style={{ "--live-queue-height": `${queueHeight}px` } as CSSProperties}
      >
        <div className="live-queue-grid">
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
        </div>
        <button
          type="button"
          className="live-queue-resize"
          onPointerDown={startQueueResize}
          onPointerMove={moveQueueResize}
          onPointerUp={endQueueResize}
          onPointerCancel={endQueueResize}
          onLostPointerCapture={endQueueResize}
          onDoubleClick={() => setQueueHeight(DEFAULT_QUEUE_HEIGHT)}
          title="Drag to resize the set-list and queue panels; double-click to reset"
          aria-label="Resize set-list and queue panels"
        >
          <span className="live-queue-grip" aria-hidden="true" />
        </button>
      </div>

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
            <p className="muted">
              Global styling applies to the lower-third, centered two-thirds and full-screen views.
              The lower-third has separate font and size controls. Stage and chords keep their fixed
              style.
            </p>
          </div>
          <button
            className="button primary"
            onClick={saveConfig}
            disabled={configSaving}
            title="Save and broadcast the display style/page-splitting settings"
          >
            {configSaving ? "Saving…" : "Save display config"}
          </button>
        </div>
        <div className="display-config-grid">
          <label>
            Global font
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
            Global text size · {Math.round(displayConfig.textScale * 100)}%
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
            Lower-third font
            <select
              value={displayConfig.lowerThirdFontFamily}
              onChange={(event) =>
                setDisplayConfig({
                  ...displayConfig,
                  lowerThirdFontFamily: event.target.value,
                })
              }
            >
              {fonts.map((font) => (
                <option key={font.id} value={font.family}>
                  {font.label}
                  {font.source === "google" ? " (Google)" : ""}
                </option>
              ))}
              {!fonts.some((font) => font.family === displayConfig.lowerThirdFontFamily) && (
                <option value={displayConfig.lowerThirdFontFamily}>Custom / imported</option>
              )}
            </select>
          </label>
          <label>
            Lower-third text size · {Math.round(displayConfig.lowerThirdTextScale * 100)}%
            <input
              type="range"
              min={50}
              max={200}
              step={5}
              value={displayConfig.lowerThirdTextScale * 100}
              onChange={(event) =>
                setDisplayConfig({
                  ...displayConfig,
                  lowerThirdTextScale: Number(event.target.value) / 100,
                })
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
          <label>
            Lower-third image max height · {displayConfig.lowerThirdImageMaxHeightPercent}%
            <input
              type="range"
              min={5}
              max={80}
              step={1}
              value={displayConfig.lowerThirdImageMaxHeightPercent}
              onChange={(event) =>
                setDisplayConfig({
                  ...displayConfig,
                  lowerThirdImageMaxHeightPercent: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            Lower-third border padding · {displayConfig.lowerThirdImagePadding}px
            <input
              type="number"
              min={0}
              max={200}
              value={displayConfig.lowerThirdImagePadding}
              onChange={(event) =>
                setDisplayConfig({
                  ...displayConfig,
                  lowerThirdImagePadding: Math.round(Math.max(0, Number(event.target.value) || 0)),
                })
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
                reached first. Long lines are wrapped by the browser to fit.
              </small>
            </span>
          </label>
        </div>
        <p className="hint">
          Lower-third font and text size are independent of the global settings. Text and images are
          anchored to the bottom with the configured border padding. Images keep their original
          aspect ratio and are never stretched; their maximum height is a percentage of the screen,
          reduced by that padding.
        </p>
      </section>
    </div>
  );
}
