import { useEffect, useState } from "react";
import {
  DEFAULT_DISPLAY_OUTPUTS,
  DISPLAY_OUTPUT_TEMPLATES,
  type DisplayClockPosition,
  type DisplayOutput,
  type DisplayOutputEntry,
  type DisplayOutputScope,
  type DisplayOutputTemplate,
  type DisplayViewLink,
} from "@sm/shared";
import { api, ApiError } from "../api";
import { ReadOnlyFieldset, usePageAccess } from "../page-access";

const TEMPLATE_LABELS: Record<DisplayOutputTemplate, string> = {
  main: "Lower-third template",
  two_thirds: "Two-thirds template",
  full: "Full-screen template",
  stage: "Stage template",
  chords: "Chords template",
};

const FADE_LABELS = {
  none: "No fade",
  text: "Fade text only",
  template: "Fade whole output",
} as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function blankOutput(): DisplayOutput {
  const base = clone(
    DEFAULT_DISPLAY_OUTPUTS.find((output) => output.id === "full") ?? DEFAULT_DISPLAY_OUTPUTS[0],
  );
  return {
    ...base,
    id: `output-${Date.now().toString(36)}`,
    label: "New output",
    description: "",
    aliases: [],
    enabled: true,
  };
}

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: string): number | null {
  return value.trim() === "" ? null : numberValue(value, 0);
}

export default function OutputsPage({
  notify,
  onChanged,
}: {
  notify: (text: string, kind?: "info" | "error") => void;
  onChanged: () => void;
}) {
  const { canWrite } = usePageAccess();
  const [outputs, setOutputs] = useState<DisplayOutputEntry[]>([]);
  const [views, setViews] = useState<DisplayViewLink[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DisplayOutput | null>(null);
  const [creatingScope, setCreatingScope] = useState<DisplayOutputScope | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  function select(entry: DisplayOutputEntry) {
    setSelectedId(entry.id);
    setCreatingScope(null);
    setDraft(clone(entry));
  }

  async function load() {
    setLoading(true);
    try {
      const [result, viewResult] = await Promise.all([api.outputs(), api.displayViews()]);
      setOutputs(result.outputs);
      setViews(viewResult.views);
      if (selectedId) {
        const current = result.outputs.find((entry) => entry.id === selectedId);
        if (current) setDraft(clone(current));
        else if (result.outputs[0]) select(result.outputs[0]);
      } else if (result.outputs[0]) {
        select(result.outputs[0]);
      }
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not load outputs", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function beginNew(scope: DisplayOutputScope) {
    setSelectedId(null);
    setCreatingScope(scope);
    setDraft(blankOutput());
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const result = selectedId
        ? await api.updateOutput(selectedId, draft)
        : await api.createOutput(draft, creatingScope ?? "shared");
      setOutputs(result.outputs);
      setSelectedId(result.output.id);
      setCreatingScope(null);
      setDraft(clone(result.output));
      const viewResult = await api.displayViews();
      setViews(viewResult.views);
      onChanged();
      notify(selectedId ? "Output saved" : "Output created");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save output", "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selectedId) return;
    const entry = outputs.find((output) => output.id === selectedId);
    if (!entry) return;
    if (
      !confirm(
        `Delete output “${entry.label}”? ${
          entry.scope === "shared"
            ? "This is a shared output and will be removed for every instance that syncs this settings file."
            : "This local output will be removed from this server only."
        }`,
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const result = await api.deleteOutput(selectedId);
      setOutputs(result.outputs);
      setSelectedId(null);
      setCreatingScope(null);
      setDraft(null);
      if (result.outputs[0]) select(result.outputs[0]);
      const viewResult = await api.displayViews();
      setViews(viewResult.views);
      onChanged();
      notify("Output deleted");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not delete output", "error");
    } finally {
      setSaving(false);
    }
  }

  function setField<K extends keyof DisplayOutput>(key: K, value: DisplayOutput[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function setLayout<K extends keyof DisplayOutput["layout"]>(
    key: K,
    value: DisplayOutput["layout"][K],
  ) {
    setDraft((current) =>
      current ? { ...current, layout: { ...current.layout, [key]: value } } : current,
    );
  }

  function setPanel<K extends keyof DisplayOutput["panel"]>(
    key: K,
    value: DisplayOutput["panel"][K],
  ) {
    setDraft((current) =>
      current ? { ...current, panel: { ...current.panel, [key]: value } } : current,
    );
  }

  function setText<K extends keyof DisplayOutput["text"]>(
    key: K,
    value: DisplayOutput["text"][K],
  ) {
    setDraft((current) =>
      current ? { ...current, text: { ...current.text, [key]: value } } : current,
    );
  }

  function setContent<K extends keyof DisplayOutput["content"]>(
    key: K,
    value: DisplayOutput["content"][K],
  ) {
    setDraft((current) =>
      current ? { ...current, content: { ...current.content, [key]: value } } : current,
    );
  }

  function setImage<K extends keyof DisplayOutput["image"]>(
    key: K,
    value: DisplayOutput["image"][K],
  ) {
    setDraft((current) =>
      current ? { ...current, image: { ...current.image, [key]: value } } : current,
    );
  }

  function setClock<K extends keyof DisplayOutput["clock"]>(
    key: K,
    value: DisplayOutput["clock"][K],
  ) {
    setDraft((current) =>
      current ? { ...current, clock: { ...current.clock, [key]: value } } : current,
    );
  }

  function clockStyleValue(clock: DisplayOutput["clock"]): "analog" | "digital24" | "digital12" {
    if (clock.mode === "analog") return "analog";
    return clock.hour12 ? "digital12" : "digital24";
  }

  function setClockStyle(value: "analog" | "digital24" | "digital12") {
    setDraft((current) =>
      current
        ? {
            ...current,
            clock: {
              ...current.clock,
              mode: value === "analog" ? "analog" : "digital",
              hour12: value === "digital12",
            },
          }
        : current,
    );
  }

  const selectedEntry = outputs.find((entry) => entry.id === selectedId) ?? null;
  const scope: DisplayOutputScope | null = selectedEntry?.scope ?? creatingScope;
  const preview = selectedEntry
    ? views.find((view) => view.kind !== "app" && view.id === selectedEntry.id)
    : null;

  if (loading) return <div className="panel">Loading outputs…</div>;

  return (
    <div className="two-column outputs-layout">
      <aside className="panel list-panel">
        <div className="panel-heading">
          <div>
            <h2>Outputs</h2>
            <p className="muted">Shared defaults plus local extras.</p>
          </div>
        </div>
        <div className="button-row outputs-new-actions">
          <button
            className="button primary small"
            onClick={() => beginNew("shared")}
            disabled={!canWrite}
            title="Create an output shared through settings/shared.json"
          >
            New shared
          </button>
          <button
            className="button ghost small"
            onClick={() => beginNew("local")}
            disabled={!canWrite}
            title="Create an output only on this server"
          >
            New local
          </button>
        </div>
        <div className="output-list">
          {outputs.map((entry) => (
            <button
              key={entry.id}
              className={`output-list-item ${entry.id === selectedId ? "current" : ""}`}
              onClick={() => select(entry)}
              title={`Edit output “${entry.label}”`}
            >
              <span>
                <strong>{entry.label}</strong>
                <span className="muted">
                  {entry.id} · {TEMPLATE_LABELS[entry.template]}
                </span>
              </span>
              <span className={`badge ${entry.scope === "shared" ? "imported" : "skipped"}`}>
                {entry.scope}
              </span>
            </button>
          ))}
          {!outputs.length && <p className="muted">No outputs configured.</p>}
        </div>
      </aside>

      {draft ? (
        <ReadOnlyFieldset className="panel editor-panel">
          <div className="panel-heading">
            <div>
              <h2>{selectedId ? draft.label : "New output"}</h2>
              <p className="muted">
                {scope === "shared"
                  ? "Shared output — saved in settings/shared.json and used by every synced instance."
                  : "Local output — stored only on this server."}
              </p>
            </div>
            <div className="button-row">
              {preview && (
                <a
                  className="button ghost small"
                  href={preview.url}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open the ${preview.label} output`}
                >
                  Open output
                </a>
              )}
              {selectedId && (
                <button
                  className="button ghost danger-text"
                  onClick={() => void remove()}
                  disabled={!canWrite || saving}
                  title="Delete this output"
                >
                  Delete
                </button>
              )}
              <button
                className="button primary"
                onClick={() => void save()}
                disabled={!canWrite || saving}
                title="Save this output definition"
              >
                {saving ? "Saving…" : "Save output"}
              </button>
            </div>
          </div>

          <section className="output-form-section">
            <h3>Identity</h3>
            <div className="output-form-grid">
              <label>
                ID / URL slug
                <input
                  value={draft.id}
                  disabled={Boolean(selectedId)}
                  onChange={(event) =>
                    setField("id", event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))
                  }
                  placeholder="e.g. lowerthird"
                />
              </label>
              <label className="grow">
                Label
                <input value={draft.label} onChange={(event) => setField("label", event.target.value)} />
              </label>
              <label>
                Template
                <select
                  value={draft.template}
                  onChange={(event) =>
                    setField("template", event.target.value as DisplayOutputTemplate)
                  }
                >
                  {DISPLAY_OUTPUT_TEMPLATES.map((template) => (
                    <option key={template} value={template}>
                      {TEMPLATE_LABELS[template]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grow output-span-2">
                Description
                <input
                  value={draft.description}
                  onChange={(event) => setField("description", event.target.value)}
                  placeholder="Shown in the Outputs list"
                />
              </label>
              <label>
                Aliases
                <input
                  value={draft.aliases.join(", ")}
                  onChange={(event) =>
                    setField(
                      "aliases",
                      event.target.value
                        .split(",")
                        .map((alias) => alias.trim().toLowerCase())
                        .filter(Boolean),
                    )
                  }
                  placeholder="old names, comma separated"
                />
              </label>
              <label className="checkbox output-checkbox">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => setField("enabled", event.target.checked)}
                />
                Enabled
              </label>
            </div>
            <p className="hint">
              Template controls the underlying page structure. Changing it requires reloading an
              already-open output.
            </p>
          </section>

          <section className="output-form-section">
            <h3>Fade and background</h3>
            <div className="output-form-grid">
              <label>
                Fade
                <select
                  value={draft.fade}
                  onChange={(event) =>
                    setField("fade", event.target.value as DisplayOutput["fade"])
                  }
                >
                  {Object.entries(FADE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Fade duration (ms)
                <input
                  type="number"
                  min={0}
                  max={2000}
                  value={draft.fadeDurationMs}
                  onChange={(event) =>
                    setField("fadeDurationMs", numberValue(event.target.value, 240))
                  }
                />
              </label>
              <label>
                Background colour
                <input
                  type="color"
                  value={draft.background}
                  onChange={(event) => setField("background", event.target.value)}
                />
              </label>
              <label>
                Background alpha · {Math.round(draft.backgroundAlpha * 100)}%
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={draft.backgroundAlpha * 100}
                  onChange={(event) =>
                    setField("backgroundAlpha", Number(event.target.value) / 100)
                  }
                />
              </label>
            </div>
          </section>

          <section className="output-form-section">
            <h3>Layout and size</h3>
            <div className="output-form-grid">
              <label>
                Horizontal alignment
                <select
                  value={draft.layout.align}
                  onChange={(event) =>
                    setLayout("align", event.target.value as DisplayOutput["layout"]["align"])
                  }
                >
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                </select>
              </label>
              <label>
                Vertical alignment
                <select
                  value={draft.layout.verticalAlign}
                  onChange={(event) =>
                    setLayout(
                      "verticalAlign",
                      event.target.value as DisplayOutput["layout"]["verticalAlign"],
                    )
                  }
                >
                  <option value="start">Top</option>
                  <option value="center">Centre</option>
                  <option value="end">Bottom</option>
                </select>
              </label>
              <label>
                Text alignment
                <select
                  value={draft.layout.textAlign}
                  onChange={(event) =>
                    setLayout(
                      "textAlign",
                      event.target.value as DisplayOutput["layout"]["textAlign"],
                    )
                  }
                >
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                  <option value="right">Right</option>
                </select>
              </label>
              <label>
                Side padding (vw)
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={draft.layout.paddingX}
                  onChange={(event) => setLayout("paddingX", numberValue(event.target.value, 0))}
                />
              </label>
              <label>
                Top padding (vh)
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={draft.layout.paddingTop}
                  onChange={(event) => setLayout("paddingTop", numberValue(event.target.value, 0))}
                />
              </label>
              <label>
                Bottom padding (vh)
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={draft.layout.paddingBottom}
                  onChange={(event) =>
                    setLayout("paddingBottom", numberValue(event.target.value, 0))
                  }
                />
              </label>
              <label>
                Content max width (%)
                <input
                  type="number"
                  min={10}
                  max={100}
                  value={draft.layout.maxWidthPercent}
                  onChange={(event) =>
                    setLayout("maxWidthPercent", numberValue(event.target.value, 100))
                  }
                />
              </label>
              <label>
                Content max height (%)
                <input
                  type="number"
                  min={10}
                  max={100}
                  value={draft.layout.maxHeightPercent}
                  onChange={(event) =>
                    setLayout("maxHeightPercent", numberValue(event.target.value, 100))
                  }
                />
              </label>
            </div>
          </section>

          <section className="output-form-section">
            <h3>Lower-third panel</h3>
            <div className="output-form-grid">
              <label className="checkbox output-checkbox">
                <input
                  type="checkbox"
                  checked={draft.panel.enabled}
                  onChange={(event) => setPanel("enabled", event.target.checked)}
                />
                Draw panel
              </label>
              <label>
                Panel colour
                <input
                  type="color"
                  value={draft.panel.color}
                  onChange={(event) => setPanel("color", event.target.value)}
                />
              </label>
              <label>
                Panel alpha · {Math.round(draft.panel.alpha * 100)}%
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={draft.panel.alpha * 100}
                  onChange={(event) => setPanel("alpha", Number(event.target.value) / 100)}
                />
              </label>
              <label>
                Horizontal padding (px)
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={draft.panel.paddingX}
                  onChange={(event) => setPanel("paddingX", numberValue(event.target.value, 0))}
                />
              </label>
              <label>
                Vertical padding (px)
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={draft.panel.paddingY}
                  onChange={(event) => setPanel("paddingY", numberValue(event.target.value, 0))}
                />
              </label>
              <label>
                Corner radius (px)
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.panel.radius}
                  onChange={(event) => setPanel("radius", numberValue(event.target.value, 0))}
                />
              </label>
              <label>
                Panel max width (%)
                <input
                  type="number"
                  min={10}
                  max={100}
                  value={draft.panel.maxWidthPercent}
                  onChange={(event) =>
                    setPanel("maxWidthPercent", numberValue(event.target.value, 100))
                  }
                />
              </label>
              <label>
                Panel max height (%)
                <input
                  type="number"
                  min={10}
                  max={100}
                  value={draft.panel.maxHeightPercent}
                  onChange={(event) =>
                    setPanel("maxHeightPercent", numberValue(event.target.value, 100))
                  }
                />
              </label>
              <label className="checkbox output-checkbox">
                <input
                  type="checkbox"
                  checked={draft.panel.border}
                  onChange={(event) => setPanel("border", event.target.checked)}
                />
                Panel border
              </label>
            </div>
          </section>

          <section className="output-form-section">
            <h3>Text</h3>
            <div className="output-form-grid">
              <label className="grow">
                Font family override
                <input
                  value={draft.text.fontFamily ?? ""}
                  onChange={(event) => setText("fontFamily", event.target.value.trim() || null)}
                  placeholder="Inherit global font"
                />
              </label>
              <label>
                Text colour override
                <input
                  type="text"
                  value={draft.text.textColor ?? ""}
                  onChange={(event) => setText("textColor", event.target.value.trim() || null)}
                  placeholder="#ffffff (inherit)"
                />
              </label>
              <label>
                Text scale × {draft.text.scale.toFixed(2)}
                <input
                  type="range"
                  min={50}
                  max={250}
                  value={draft.text.scale * 100}
                  onChange={(event) => setText("scale", Number(event.target.value) / 100)}
                />
              </label>
              <label>
                Line height
                <input
                  type="number"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={draft.text.lineHeight}
                  onChange={(event) => setText("lineHeight", numberValue(event.target.value, 1))}
                />
              </label>
            </div>
          </section>

          <section className="output-form-section">
            <h3>Content</h3>
            <div className="output-form-grid">
              <label>
                Pages
                <select
                  value={draft.content.pages}
                  onChange={(event) =>
                    setContent(
                      "pages",
                      event.target.value as DisplayOutput["content"]["pages"],
                    )
                  }
                >
                  <option value="current">Current page only</option>
                  <option value="upcoming">Current and upcoming pages</option>
                </select>
              </label>
              <div className="output-check-grid output-span-2">
                {(
                  [
                    ["showMeta", "Meta/title"],
                    ["showFooter", "Footer"],
                    ["showChords", "Chords"],
                    ["showSectionLabels", "Section labels"],
                    ["showSplitWords", "Split-word joins"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="checkbox output-checkbox">
                    <input
                      type="checkbox"
                      checked={draft.content[key]}
                      onChange={(event) => setContent(key, event.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </section>

          <section className="output-form-section">
            <h3>Clock overlay</h3>
            <div className="output-form-grid">
              <label className="checkbox output-checkbox">
                <input
                  type="checkbox"
                  checked={draft.clock.enabled}
                  onChange={(event) => setClock("enabled", event.target.checked)}
                />
                Show clock
              </label>
              <label>
                Clock style
                <select
                  value={clockStyleValue(draft.clock)}
                  onChange={(event) =>
                    setClockStyle(
                      event.target.value as "analog" | "digital24" | "digital12",
                    )
                  }
                >
                  <option value="analog">Analogue (no numbers)</option>
                  <option value="digital24">Digital 24-hour</option>
                  <option value="digital12">Digital 12-hour</option>
                </select>
              </label>
              <label>
                Size (vw)
                <input
                  type="number"
                  min={1}
                  max={30}
                  step={0.5}
                  value={draft.clock.size}
                  onChange={(event) => setClock("size", numberValue(event.target.value, 8))}
                />
              </label>
              <label>
                Position
                <select
                  value={draft.clock.position}
                  onChange={(event) =>
                    setClock("position", event.target.value as DisplayClockPosition)
                  }
                >
                  <option value="top-left">Top left</option>
                  <option value="top-center">Top centre</option>
                  <option value="top-right">Top right</option>
                  <option value="center-left">Centre left</option>
                  <option value="center">Centre</option>
                  <option value="center-right">Centre right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="bottom-center">Bottom centre</option>
                  <option value="bottom-right">Bottom right</option>
                </select>
              </label>
              <label>
                Text colour
                <input
                  type="color"
                  value={draft.clock.color}
                  onChange={(event) => setClock("color", event.target.value)}
                />
              </label>
              <label className="checkbox output-checkbox">
                <input
                  type="checkbox"
                  checked={draft.clock.shadow}
                  onChange={(event) => setClock("shadow", event.target.checked)}
                />
                Shadow / highlight
              </label>
              <label className="checkbox output-checkbox">
                <input
                  type="checkbox"
                  checked={draft.clock.seconds}
                  onChange={(event) => setClock("seconds", event.target.checked)}
                />
                {draft.clock.mode === "analog" ? "Second hand" : "Show seconds"}
              </label>
              {draft.clock.mode === "digital" && (
                <label className="grow">
                  Font family override
                  <input
                    value={draft.clock.fontFamily ?? ""}
                    onChange={(event) =>
                      setClock("fontFamily", event.target.value.trim() || null)
                    }
                    placeholder="Inherit global font"
                  />
                </label>
              )}
            </div>
            <p className="hint">
              The clock is an overlay on this output, independent of the live content. It is useful
              on a stage/confidence monitor where the speaker needs the time while lyrics are blank
              or changing.
            </p>
          </section>

          <section className="output-form-section">
            <h3>Images</h3>
            <div className="output-form-grid">
              <label>
                Image max height (%)
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={draft.image.maxHeightPercent ?? ""}
                  onChange={(event) => setImage("maxHeightPercent", nullableNumber(event.target.value))}
                  placeholder="Inherit"
                />
              </label>
              <label>
                Image padding (px)
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={draft.image.padding ?? ""}
                  onChange={(event) => setImage("padding", nullableNumber(event.target.value))}
                  placeholder="Inherit"
                />
              </label>
            </div>
            <p className="hint">
              Blank image values inherit the global display settings; the lower-third defaults to
              its own image height and padding.
            </p>
          </section>
        </ReadOnlyFieldset>
      ) : (
        <section className="panel empty-state">Create an output to get started.</section>
      )}
    </div>
  );
}
