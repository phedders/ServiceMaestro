import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DISPLAY_BACKGROUND_PATTERNS,
  type BackgroundAsset,
  type DisplayBackground,
  type DisplayBackgroundPattern,
  type DisplayConfig,
  type DisplayViewLink,
  type FontOption,
  type ImageAsset,
  type LiveState,
  type SetlistSummary,
  type SmartWrapModule,
} from "@sm/shared";
import { api, ApiError } from "../api";
import { ReadOnlyFieldset } from "../page-access";
import { SaveButton } from "../components/SaveButton";
import { changeList } from "../form-changes";
import { ScaledPreviewFrame } from "../components/ScaledPreviewFrame";
import { SlidePreview } from "../components/SlidePreview";
import { Transport } from "../components/Transport";
import { ItemList, PageList } from "../components/LivePanels";
import { FontSelect } from "../components/FontSelect";
import { MqttControls } from "../components/MqttControls";
import { QuickText } from "../components/QuickText";
import { findPreviewScreen, loadPreviewScreenId } from "../preview-screen";
import { compactDate } from "../service-date";
import { useSessionState } from "../session-state";
import {
  SHORTCUT_CHANGE_EVENT,
  SHORTCUT_LABELS,
  formatShortcut,
  loadKeyboardShortcuts,
  type KeyboardShortcuts,
} from "../keyboard";

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
const PHONE_LINEAR_STORAGE_KEY = "sm-live-phone-linear";
const FULLSCREEN_PAGE_LIST_STORAGE_KEY = "sm-live-fullscreen-pages";

function initialPhoneLinear(): boolean {
  try {
    return window.localStorage.getItem(PHONE_LINEAR_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function initialFullscreenPageList(): boolean {
  try {
    return window.localStorage.getItem(FULLSCREEN_PAGE_LIST_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

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
  const [backgrounds, setBackgrounds] = useState<BackgroundAsset[]>([]);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [shortcuts, setShortcuts] = useState<KeyboardShortcuts>(loadKeyboardShortcuts);
  const [displayConfig, setDisplayConfig] = useState<DisplayConfig>(
    live.displayConfig ?? {
      fontFamily: '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
      textColor: "#ffffff",
      textScale: 1,
      fontSizeUnit: "responsive",
      background: { type: "none" },
      maxLines: 4,
      maxWords: 90,
      smartPageSplits: true,
      smartWrapMinWords: 15,
      smartWrapModules: ["songs", "text", "bible"],
      lowerThirdImageMaxHeightPercent: 30,
      lowerThirdImagePadding: 48,
      lowerThirdFontFamily: '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
      lowerThirdTextScale: 1,
    },
  );
  const [savedDisplayConfig, setSavedDisplayConfig] =
    useState<DisplayConfig>(displayConfig);
  const [configSaving, setConfigSaving] = useState(false);
  const [previewView, setPreviewView] = useSessionState("live:preview-view", "full");
  const [previewScreenId] = useState(loadPreviewScreenId);
  const previewScreen = findPreviewScreen(previewScreenId);
  const [queueHeight, setQueueHeight] = useState(initialQueueHeight);
  const [phoneLinear, setPhoneLinear] = useState(initialPhoneLinear);
  const [fullscreenPageList, setFullscreenPageList] = useState(initialFullscreenPageList);

  useEffect(() => {
    const refresh = () => setShortcuts(loadKeyboardShortcuts());
    window.addEventListener(SHORTCUT_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SHORTCUT_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const queueResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(QUEUE_HEIGHT_STORAGE_KEY, String(queueHeight));
    } catch {
      // Layout persistence is optional; dragging still works for this session.
    }
  }, [queueHeight]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PHONE_LINEAR_STORAGE_KEY, phoneLinear ? "1" : "0");
    } catch {
      // Layout persistence is optional; the checkbox still works for this session.
    }
  }, [phoneLinear]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        FULLSCREEN_PAGE_LIST_STORAGE_KEY,
        fullscreenPageList ? "1" : "0",
      );
    } catch {
      // Layout persistence is optional; the toggle still works for this session.
    }
  }, [fullscreenPageList]);

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
      setSavedDisplayConfig(live.displayConfig);
      return;
    }
    api
      .displayConfig()
      .then((result) => {
        setDisplayConfig(result.config);
        setSavedDisplayConfig(result.config);
      })
      .catch(() => undefined);
  }, [
    live.displayConfig?.fontFamily,
    live.displayConfig?.textColor,
    live.displayConfig?.textScale,
    live.displayConfig?.fontSizeUnit,
    JSON.stringify(live.displayConfig?.background ?? null),
    live.displayConfig?.maxLines,
    live.displayConfig?.maxWords,
    live.displayConfig?.smartPageSplits,
    live.displayConfig?.smartWrapMinWords,
    live.displayConfig?.smartWrapModules?.join(","),
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
    api
      .backgrounds()
      .then((result) => setBackgrounds(result.backgrounds))
      .catch(() => undefined);
    api
      .images()
      .then((result) => setImages(result.images))
      .catch(() => undefined);
  }, []);

  function toggleSmartWrapModule(module: SmartWrapModule, checked: boolean) {
    setDisplayConfig((current) => ({
      ...current,
      smartWrapModules: checked
        ? [...new Set([...current.smartWrapModules, module])]
        : current.smartWrapModules.filter((entry) => entry !== module),
    }));
  }

  function setDisplayBackground(background: DisplayBackground) {
    setDisplayConfig((current) => ({ ...current, background }));
  }

  function changeBackgroundType(type: DisplayBackground["type"]) {
    switch (type) {
      case "none":
        setDisplayBackground({ type: "none" });
        break;
      case "color":
        setDisplayBackground({ type: "color", color: "#07111f" });
        break;
      case "gradient":
        setDisplayBackground({
          type: "gradient",
          from: "#07111f",
          to: "#1e3a8a",
          angle: 180,
        });
        break;
      case "pattern":
        setDisplayBackground({
          type: "pattern",
          preset: "stripes",
          background: "#07111f",
          foreground: "#4cc2ff",
        });
        break;
      case "asset":
        setDisplayBackground({
          type: "asset",
          backgroundId: backgrounds[0]?.id ?? "",
        });
        break;
      case "image":
        setDisplayBackground({ type: "image", path: images[0]?.path ?? "" });
        break;
    }
  }

  function updateGradientBackground(
    patch: Partial<Extract<DisplayBackground, { type: "gradient" }>>,
  ) {
    setDisplayConfig((current) =>
      current.background.type === "gradient"
        ? { ...current, background: { ...current.background, ...patch } }
        : current,
    );
  }

  function updatePatternBackground(
    patch: Partial<Extract<DisplayBackground, { type: "pattern" }>>,
  ) {
    setDisplayConfig((current) =>
      current.background.type === "pattern"
        ? { ...current, background: { ...current.background, ...patch } }
        : current,
    );
  }

  async function saveConfig() {
    setConfigSaving(true);
    try {
      const result = await api.saveDisplayConfig(displayConfig);
      setDisplayConfig(result.config);
      setSavedDisplayConfig(result.config);
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

  const previewOptions = displayViews.filter((view) => view.kind !== "app");
  const previewLink =
    previewOptions.find((view) => view.id === previewView) ?? previewOptions[0];
  const previewLabel = previewLink?.label ?? "Preview";

  if (live.status === "idle") {
    return (
      <ReadOnlyFieldset className="panel start-panel">
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
      </ReadOnlyFieldset>
    );
  }

  const displayConfigChanges = changeList([
    { label: "Font", before: savedDisplayConfig.fontFamily, after: displayConfig.fontFamily },
    { label: "Text colour", before: savedDisplayConfig.textColor, after: displayConfig.textColor },
    { label: "Text size", before: savedDisplayConfig.textScale, after: displayConfig.textScale },
    {
      label: "Font size unit",
      before: savedDisplayConfig.fontSizeUnit,
      after: displayConfig.fontSizeUnit,
    },
    {
      label: "Background",
      before: savedDisplayConfig.background,
      after: displayConfig.background,
    },
    {
      label: "Default lines / page",
      before: savedDisplayConfig.maxLines,
      after: displayConfig.maxLines,
    },
    { label: "Max words", before: savedDisplayConfig.maxWords, after: displayConfig.maxWords },
    {
      label: "Smart page splits",
      before: savedDisplayConfig.smartPageSplits,
      after: displayConfig.smartPageSplits,
    },
    {
      label: "Smart wrap minimum words",
      before: savedDisplayConfig.smartWrapMinWords,
      after: displayConfig.smartWrapMinWords,
    },
    {
      label: "Smart wrap modules",
      before: savedDisplayConfig.smartWrapModules,
      after: displayConfig.smartWrapModules,
    },
    {
      label: "Lower-third image height",
      before: savedDisplayConfig.lowerThirdImageMaxHeightPercent,
      after: displayConfig.lowerThirdImageMaxHeightPercent,
    },
    {
      label: "Lower-third image padding",
      before: savedDisplayConfig.lowerThirdImagePadding,
      after: displayConfig.lowerThirdImagePadding,
    },
    {
      label: "Lower-third font",
      before: savedDisplayConfig.lowerThirdFontFamily,
      after: displayConfig.lowerThirdFontFamily,
    },
    {
      label: "Lower-third text size",
      before: savedDisplayConfig.lowerThirdTextScale,
      after: displayConfig.lowerThirdTextScale,
    },
  ]);

  return (
    <div className={`live-layout ${phoneLinear ? "live-phone-linear" : ""}`}>
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
            <span
              className="muted preview-screen-size"
              title="This preview emulates the selected screen size and aspect ratio"
            >
              {previewScreen.width} × {previewScreen.height}
            </span>
          </div>
          <div className="preview-view-switcher" role="group" aria-label="Preview view">
            {previewOptions.map((view) => {
              const active = previewLink?.id === view.id;
              return (
                <button
                  key={view.id}
                  type="button"
                  className={`preview-view-button ${active ? "active" : ""}`}
                  aria-pressed={active}
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
          <ScaledPreviewFrame
            key={previewLink.id}
            src={previewLink.url}
            title={`${previewLabel} live preview`}
            screen={previewScreen}
          >
            {live.blank && <div className="slide-blanked">BLANK</div>}
          </ScaledPreviewFrame>
        ) : (
          <SlidePreview live={live} />
        )}
      </section>

      <ReadOnlyFieldset className="panel">
        <div className="panel-heading">
          <h2>
            Transport
            {live.pageCount > 0 && (
              <span className="transport-page-summary">
                {" :: Page "}
                {live.pageIndex + 1}/{live.pageCount}
                {live.halfPageMode ? " · ½" : ""}
              </span>
            )}
          </h2>
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
      </ReadOnlyFieldset>

      <div
        className="live-queue-section"
        style={{ "--live-queue-height": `${queueHeight}px` } as CSSProperties}
      >
        <label className="checkbox live-phone-linear-toggle">
          <input
            type="checkbox"
            checked={phoneLinear}
            onChange={(event) => setPhoneLinear(event.target.checked)}
          />
          Expand panels on phone — page scrolls instead of each section
        </label>
        <div className="live-queue-grid">
          <ReadOnlyFieldset className="panel">
            <div className="panel-heading">
              <h2>Items</h2>
              <span className="muted">{live.items.length} in session</span>
            </div>
            <ItemList live={live} onCommand={onCommand} />
          </ReadOnlyFieldset>

          <ReadOnlyFieldset className="panel">
            <div className="panel-heading">
              <h2>Pages</h2>
              <div className="page-heading-actions">
                <label
                  className="checkbox page-fullscreen-toggle"
                  title="Preview the fullscreen version: hide chord symbols and show syllable split hyphens"
                >
                  <input
                    type="checkbox"
                    checked={fullscreenPageList}
                    onChange={(event) => setFullscreenPageList(event.target.checked)}
                  />
                  Fullscreen version
                </label>
                <span className="muted">
                  {live.queuedItemIndex != null
                    ? `Queued: ${live.queuedTitle ?? "item"} · ${live.queuedPages?.length ?? 0} pages`
                    : live.pageCount
                      ? `${live.pageIndex + 1} / ${live.pageCount}`
                      : "0 pages"}
                </span>
              </div>
            </div>
            <PageList
              live={live}
              onCommand={onCommand}
              fullscreen={fullscreenPageList}
            />
          </ReadOnlyFieldset>
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

      <ReadOnlyFieldset className="panel wide-panel">
        <div className="panel-heading">
          <h2>Quick text</h2>
          <span className="muted">Display immediately</span>
        </div>
        <QuickText onSend={onQuickText} />
      </ReadOnlyFieldset>

      <MqttControls placement="live" notify={notify} />

      <ReadOnlyFieldset className="panel wide-panel">
        <div className="panel-heading">
          <div>
            <h2>Display config</h2>
            <p className="muted">
              Global styling applies to the lower-third, centered two-thirds and full-screen views.
              The lower-third has separate font and size controls. Stage and chords keep their fixed
              style. These settings sync to other servers through the set lists repository.
            </p>
          </div>
          <SaveButton
            label="Save display config"
            savingLabel="Saving…"
            onClick={saveConfig}
            changes={displayConfigChanges}
            saving={configSaving}
            title="Save and broadcast the display style/page-splitting settings"
          />
        </div>
        <div className="display-config-grid">
          <div className="display-background-settings">
            <div>
              <h3>Background</h3>
              <p className="muted">
                Global background for outputs when the set list or item does not specify one.
              </p>
            </div>
            <div className="display-background-grid">
              <label>
                Source
                <select
                  value={displayConfig.background.type}
                  onChange={(event) =>
                    changeBackgroundType(event.target.value as DisplayBackground["type"])
                  }
                >
                  <option value="none">None (output colour)</option>
                  <option value="color">Solid colour</option>
                  <option value="gradient">Gradient</option>
                  <option value="pattern">Pattern</option>
                  <option value="asset">Background library</option>
                  <option value="image">Image library</option>
                </select>
              </label>
              {displayConfig.background.type === "color" && (
                <label>
                  Colour
                  <input
                    type="color"
                    value={displayConfig.background.color}
                    onChange={(event) =>
                      setDisplayBackground({ type: "color", color: event.target.value })
                    }
                  />
                </label>
              )}
              {displayConfig.background.type === "gradient" && (
                <>
                  <label>
                    From
                    <input
                      type="color"
                      value={displayConfig.background.from}
                      onChange={(event) => updateGradientBackground({ from: event.target.value })}
                    />
                  </label>
                  <label>
                    To
                    <input
                      type="color"
                      value={displayConfig.background.to}
                      onChange={(event) => updateGradientBackground({ to: event.target.value })}
                    />
                  </label>
                  <label>
                    Angle
                    <input
                      type="number"
                      min={0}
                      max={360}
                      value={displayConfig.background.angle}
                      onChange={(event) =>
                        updateGradientBackground({
                          angle: Math.max(0, Math.min(360, Number(event.target.value) || 0)),
                        })
                      }
                    />
                  </label>
                </>
              )}
              {displayConfig.background.type === "pattern" && (
                <>
                  <label>
                    Pattern
                    <select
                      value={displayConfig.background.preset}
                      onChange={(event) =>
                        updatePatternBackground({
                          preset: event.target.value as DisplayBackgroundPattern,
                        })
                      }
                    >
                      {DISPLAY_BACKGROUND_PATTERNS.map((preset) => (
                        <option key={preset} value={preset}>
                          {preset[0].toUpperCase() + preset.slice(1)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Background
                    <input
                      type="color"
                      value={displayConfig.background.background}
                      onChange={(event) =>
                        updatePatternBackground({ background: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Pattern colour
                    <input
                      type="color"
                      value={displayConfig.background.foreground}
                      onChange={(event) =>
                        updatePatternBackground({ foreground: event.target.value })
                      }
                    />
                  </label>
                </>
              )}
              {displayConfig.background.type === "asset" && (
                <label className="display-background-wide">
                  Background
                  <select
                    value={displayConfig.background.backgroundId}
                    onChange={(event) =>
                      setDisplayBackground({
                        type: "asset",
                        backgroundId: event.target.value,
                      })
                    }
                  >
                    <option value="">Choose a background…</option>
                    {backgrounds.map((background) => (
                      <option key={background.id} value={background.id}>
                        {background.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {displayConfig.background.type === "image" && (
                <label className="display-background-wide">
                  Image
                  <select
                    value={displayConfig.background.path}
                    onChange={(event) =>
                      setDisplayBackground({ type: "image", path: event.target.value })
                    }
                  >
                    <option value="">Choose an image…</option>
                    {images.map((image) => (
                      <option key={image.path} value={image.path}>
                        {image.folder ? `${image.folder}/` : ""}
                        {image.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <p className="hint">
              Set-list and item backgrounds take precedence. Images are stretched to cover the
              output without changing their aspect ratio.
            </p>
          </div>
          <label>
            Global font
            <FontSelect
              value={displayConfig.fontFamily}
              fonts={fonts}
              onChange={(fontFamily) => setDisplayConfig({ ...displayConfig, fontFamily })}
              title="Choose the global display font"
            />
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
            Font size units
            <select
              value={displayConfig.fontSizeUnit}
              onChange={(event) =>
                setDisplayConfig({
                  ...displayConfig,
                  fontSizeUnit: event.target.value as DisplayConfig["fontSizeUnit"],
                })
              }
              title="Choose how display text sizes scale with the output screen"
            >
              <option value="responsive">Responsive (rem/vw clamp)</option>
              <option value="vmin">vmin (shortest screen edge)</option>
            </select>
          </label>
          <label>
            Lower-third font
            <FontSelect
              value={displayConfig.lowerThirdFontFamily}
              fonts={fonts}
              onChange={(lowerThirdFontFamily) =>
                setDisplayConfig({ ...displayConfig, lowerThirdFontFamily })
              }
              title="Choose the lower-third display font"
            />
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
            Smart wrap minimum words
            <input
              type="number"
              min={1}
              max={100}
              value={displayConfig.smartWrapMinWords}
              onChange={(event) =>
                setDisplayConfig({
                  ...displayConfig,
                  smartWrapMinWords: Math.max(
                    1,
                    Math.min(100, Number(event.target.value) || 15),
                  ),
                })
              }
            />
          </label>
          <div className="smart-wrap-modules">
            <span className="field-label">Server smart wrap applies to</span>
            <div className="button-row">
              {(
                [
                  ["songs", "Songs"],
                  ["text", "Text"],
                  ["bible", "Bible"],
                ] as const
              ).map(([module, label]) => (
                <label key={module} className="checkbox">
                  <input
                    type="checkbox"
                    checked={displayConfig.smartWrapModules.includes(module)}
                    onChange={(event) => toggleSmartWrapModule(module, event.target.checked)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
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
                reached first. Server smart wrap splits selected modules only when a line reaches
                the minimum word count; shorter lines are wrapped by the browser.
              </small>
            </span>
          </label>
        </div>
        <p className="hint">
          Lower-third font and text size are independent of the global settings. Text and images are
          anchored to the bottom with the configured border padding. Images keep their original
          aspect ratio and are never stretched; their maximum height is a percentage of the screen,
          reduced by that padding. Font size units apply to all display templates: responsive keeps
          the existing rem/vw clamps, while vmin scales text from the shortest screen edge for more
          predictable portrait and ultrawide layouts.
        </p>
        <div className="queue-defaults">
          <label>
            Default lines / page
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
          <p className="hint">
            Used when a set-list item without its own <strong>Lines / page</strong> setting is
            loaded. Changing the Transport <strong>Lines/page</strong> control stores that value on
            the current item and marks the current page out of date until you reselect a page; this
            default remains the fallback.
          </p>
        </div>
      </ReadOnlyFieldset>

      <section className="panel wide-panel live-shortcuts">
        <div className="panel-heading">
          <div>
            <h2>Keyboard shortcuts</h2>
            <p className="muted">
              These work from the control window unless you are typing in an input, textarea or
              select. Change the configurable keys in <em>Settings → Keyboard shortcuts</em>.
            </p>
          </div>
        </div>
        <div className="help-shortcuts">
          {SHORTCUT_LABELS.map(({ action, label, hint }) => (
            <div key={action} className="help-shortcut" title={hint}>
              <div>
                <strong>{label}</strong>
                <span className="muted">{hint}</span>
              </div>
              <kbd>{formatShortcut(shortcuts[action])}</kbd>
            </div>
          ))}
          <div
            className="help-shortcut"
            title="Jump to the first page labelled Verse 1–9 (or v1–v9)"
          >
            <div>
              <strong>Jump to verse</strong>
              <span className="muted">Jump to the first page labelled Verse 1–9 (or v1–v9)</span>
            </div>
            <kbd>1 – 9</kbd>
          </div>
        </div>
      </section>
    </div>
  );
}
