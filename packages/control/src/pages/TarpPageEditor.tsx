import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import type {
  BackgroundAsset,
  ImageAsset,
  TarpBackground,
  TarpObject,
  TarpObjectKind,
  TarpObjectPlacement,
  TarpPage,
  TarpPresentationDetail,
  TarpTheme,
  TarpView,
} from "@sm/shared";
import { api, ApiError } from "../api";

type ViewKey = "normal" | "lowerthird";

const DEFAULT_FONT = '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `tarp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function backgroundStyle(background: TarpBackground): CSSProperties {
  if (background.type === "color") return { background: background.color };
  if (background.type === "gradient") {
    return {
      background: `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})`,
    };
  }
  return {
    backgroundImage: `url(/display/images/file?path=${encodeURIComponent(background.path)})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
}

function placement(
  view: ViewKey,
  kind: TarpObjectKind,
  content = "",
): TarpObjectPlacement {
  const textual = kind !== "image";
  return {
    x: view === "normal" ? 0.1 : 0.04,
    y: view === "normal" ? 0.16 : 0.18,
    width: textual ? (view === "normal" ? 0.55 : 0.45) : view === "normal" ? 0.4 : 0.3,
    height: textual ? (view === "normal" ? 0.24 : 0.5) : view === "normal" ? 0.35 : 0.55,
    rotation: 0,
    opacity: 1,
    fontSize: textual ? (view === "normal" ? 0.075 : 0.12) : null,
    fontWeight: null,
    textAlign: "left",
    fit: "contain",
    color: null,
    fontFamily: null,
    animations: [],
  };
}

function markdownHtml(content: string): string {
  return DOMPurify.sanitize(marked.parse(content, { async: false }) as string, {
    USE_PROFILES: { html: true },
  });
}

function objectStyle(
  object: TarpObject,
  view: ViewKey,
  page: TarpPage,
  presentation: TarpPresentationDetail,
  theme: TarpTheme | undefined,
): CSSProperties {
  const place = object[view];
  const viewData = page[view];
  return {
    left: `${place.x * 100}%`,
    top: `${place.y * 100}%`,
    width: `${place.width * 100}%`,
    height: `${place.height * 100}%`,
    transform: `rotate(${place.rotation}deg)`,
    opacity: place.opacity,
    color: place.color ?? viewData.textColor ?? theme?.textColor ?? "#ffffff",
    fontFamily: place.fontFamily ?? viewData.fontFamily ?? theme?.fontFamily ?? DEFAULT_FONT,
    fontSize: place.fontSize ? `${place.fontSize * 100}cqh` : undefined,
    fontWeight: place.fontWeight ?? undefined,
    textAlign: place.textAlign,
  };
}

export default function TarpPageEditor({
  page,
  presentation,
  themes,
  images,
  backgrounds,
  notify,
  onSaved,
  onDirtyChange,
}: {
  page: TarpPage;
  presentation: TarpPresentationDetail;
  themes: TarpTheme[];
  images: ImageAsset[];
  backgrounds: BackgroundAsset[];
  notify: (text: string, kind?: "info" | "error") => void;
  onSaved: (page: TarpPage) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<TarpPage>(() => clone(page));
  const [view, setView] = useState<ViewKey>("normal");
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const dragRef = useRef<{
    mode: "move" | "resize";
    view: ViewKey;
    objectId: string;
    startX: number;
    startY: number;
    start: TarpObjectPlacement;
    canvas: DOMRect;
  } | null>(null);

  useEffect(() => {
    setDraft(clone(page));
    setSelectedObjectId(null);
    setDirty(false);
  }, [page.id]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  const theme = themes.find(
    (item) => item.id === (draft.themeId ?? presentation.themeId),
  );
  const selectedObject = draft[view].objects.find((object) => object.id === selectedObjectId);

  function updateDraft(next: TarpPage) {
    setDraft(next);
    setDirty(true);
  }

  function updateView(viewKey: ViewKey, updater: (current: TarpView) => TarpView) {
    const next = clone(draft);
    next[viewKey] = updater(next[viewKey]);
    updateDraft(next);
  }

  function updateObject(objectId: string, updater: (object: TarpObject) => void) {
    const next = clone(draft);
    for (const viewKey of ["normal", "lowerthird"] as const) {
      const object = next[viewKey].objects.find((item) => item.id === objectId);
      if (object) updater(object);
    }
    updateDraft(next);
  }

  function updatePlacement(
    viewKey: ViewKey,
    objectId: string,
    patch: Partial<TarpObjectPlacement>,
  ) {
    const next = clone(draft);
    const object = next[viewKey].objects.find((item) => item.id === objectId);
    if (!object) return;
    object[viewKey] = { ...object[viewKey], ...patch };
    updateDraft(next);
  }

  function addObject(kind: "text" | "markdown" | "image") {
    const id = newId();
    const content =
      kind === "text"
        ? "New text"
        : kind === "markdown"
          ? "# New heading\n\nMarkdown **text**"
          : images[0]?.path ?? "";
    const object: TarpObject = {
      id,
      kind,
      content,
      locked: false,
      visible: true,
      normal: placement("normal", kind, content),
      lowerthird: placement("lowerthird", kind, content),
    };
    const next = clone(draft);
    next.normal.objects.push(clone(object));
    next.lowerthird.objects.push(clone(object));
    updateDraft(next);
    setView("normal");
    setSelectedObjectId(id);
  }

  function removeObject(objectId: string) {
    const next = clone(draft);
    next.normal.objects = next.normal.objects.filter((object) => object.id !== objectId);
    next.lowerthird.objects = next.lowerthird.objects.filter((object) => object.id !== objectId);
    updateDraft(next);
    if (selectedObjectId === objectId) setSelectedObjectId(null);
  }

  function moveLayer(objectId: string, direction: -1 | 1) {
    const next = clone(draft);
    const objects = next[view].objects;
    const index = objects.findIndex((object) => object.id === objectId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= objects.length) return;
    const [object] = objects.splice(index, 1);
    objects.splice(target, 0, object);
    updateDraft(next);
  }

  function startDrag(
    event: ReactPointerEvent<HTMLElement>,
    mode: "move" | "resize",
    viewKey: ViewKey,
    object: TarpObject,
  ) {
    if (object.locked) return;
    event.preventDefault();
    event.stopPropagation();
    const canvas = event.currentTarget.closest(".tarp-canvas") as HTMLElement | null;
    if (!canvas) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is unavailable for synthetic or older pointer events.
    }
    dragRef.current = {
      mode,
      view: viewKey,
      objectId: object.id,
      startX: event.clientX,
      startY: event.clientY,
      start: { ...object[viewKey] },
      canvas: canvas.getBoundingClientRect(),
    };
    setView(viewKey);
    setSelectedObjectId(object.id);
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (event.clientX - drag.startX) / drag.canvas.width;
    const dy = (event.clientY - drag.startY) / drag.canvas.height;
    if (drag.mode === "move") {
      updatePlacement(drag.view, drag.objectId, {
        x: round(clamp(drag.start.x + dx, -1, 2)),
        y: round(clamp(drag.start.y + dy, -1, 2)),
      });
    } else {
      updatePlacement(drag.view, drag.objectId, {
        width: round(clamp(drag.start.width + dx, 0.02, 2)),
        height: round(clamp(drag.start.height + dy, 0.02, 2)),
      });
    }
  }

  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function savePage() {
    setSaving(true);
    try {
      const result = await api.updateTarpPage(draft.id, {
        name: draft.name,
        themeId: draft.themeId,
        startFromPrevious: draft.startFromPrevious,
        transition: draft.transition,
        normal: draft.normal,
        lowerthird: draft.lowerthird,
      });
      setDraft(clone(result.page));
      setDirty(false);
      onSaved(result.page);
      notify("Tarp page saved");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save Tarp page", "error");
    } finally {
      setSaving(false);
    }
  }

  function renderObject(object: TarpObject, viewKey: ViewKey) {
    const place = object[viewKey];
    const style = objectStyle(object, viewKey, draft, presentation, theme);
    const selected = view === viewKey && selectedObjectId === object.id;
    return (
      <div
        key={object.id}
        className={`tarp-object ${selected ? "selected" : ""} ${object.visible ? "" : "hidden"} ${
          object.locked ? "locked" : ""
        }`}
        style={style}
        onPointerDown={(event) => startDrag(event, "move", viewKey, object)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={(event) => {
          event.stopPropagation();
          setSelectedObjectId(object.id);
          setView(viewKey);
        }}
        title={`${
          object.kind === "text" ? "Text" : object.kind === "markdown" ? "Markdown" : "Image"
        } object${object.locked ? " (locked)" : ""}`}
      >
        {object.kind === "text" ? (
          <div className="tarp-object-text" style={{ whiteSpace: "pre-wrap" }}>
            {object.content || " "}
          </div>
        ) : object.kind === "markdown" ? (
          <div
            className="tarp-object-markdown"
            dangerouslySetInnerHTML={{ __html: markdownHtml(object.content || "") }}
          />
        ) : object.content ? (
          <img
            src={`/display/images/file?path=${encodeURIComponent(object.content)}`}
            alt=""
            draggable={false}
            style={{ objectFit: place.fit }}
          />
        ) : (
          <span className="tarp-object-empty">No image</span>
        )}
        {selected && !object.locked && (
          <span
            className="tarp-resize-handle"
            onPointerDown={(event) => startDrag(event, "resize", viewKey, object)}
            title="Drag to resize this object"
          />
        )}
      </div>
    );
  }

  return (
    <div className="tarp-page-editor">
      <div className="tarp-page-toolbar">
        <div>
          <h3>{draft.name}</h3>
          <span className="muted">
            Page {draft.position + 1} · {presentation.aspect} normal · lower-third overlay
            {dirty ? " · unsaved changes" : ""}
          </span>
        </div>
        <div className="button-row">
          <button
            className="button ghost small"
            onClick={() => {
              setDraft(clone(page));
              setDirty(false);
              setSelectedObjectId(null);
            }}
            disabled={!dirty || saving}
            title="Discard unsaved changes to this page"
          >
            Reset
          </button>
          <button
            className="button primary small"
            onClick={savePage}
            disabled={saving || !dirty}
            title="Save both views of this Tarp page"
          >
            {saving ? "Saving…" : "Save page"}
          </button>
        </div>
      </div>

      <div className="tarp-page-settings">
        <label>
          Page name
          <input
            value={draft.name}
            onChange={(event) => {
              const next = clone(draft);
              next.name = event.target.value;
              updateDraft(next);
            }}
          />
        </label>
        <label>
          Page theme
          <select
            value={draft.themeId ?? ""}
            onChange={(event) => {
              const next = clone(draft);
              next.themeId = event.target.value || null;
              updateDraft(next);
            }}
          >
            <option value="">Inherit presentation theme</option>
            {themes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Normal background
          <select
            value={draft.normal.backgroundId ?? ""}
            onChange={(event) =>
              updateView("normal", (current) => ({
                ...current,
                backgroundId: event.target.value || null,
              }))
            }
          >
            <option value="">Use theme / no background</option>
            {backgrounds.map((background) => (
              <option key={background.id} value={background.id}>
                {background.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lower-third background
          <select
            value={draft.lowerthird.backgroundId ?? ""}
            onChange={(event) =>
              updateView("lowerthird", (current) => ({
                ...current,
                backgroundId: event.target.value || null,
              }))
            }
          >
            <option value="">Use theme / no background</option>
            {backgrounds.map((background) => (
              <option key={background.id} value={background.id}>
                {background.name}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.startFromPrevious}
            onChange={(event) => {
              const next = clone(draft);
              next.startFromPrevious = event.target.checked;
              updateDraft(next);
            }}
          />
          Use previous page as starting point
        </label>
      </div>

      <div className="tarp-editor-toolbar">
        <div className="button-row">
          <button
            className="button"
            onClick={() => addObject("text")}
            title="Add a text box to both views"
          >
            + Text
          </button>
          <button
            className="button"
            onClick={() => addObject("markdown")}
            title="Add a Markdown block to both views"
          >
            + Markdown
          </button>
          <button
            className="button"
            onClick={() => addObject("image")}
            title="Add an image to both views"
          >
            + Image
          </button>
        </div>
        <div className="tarp-view-tabs">
          {(["normal", "lowerthird"] as const).map((viewKey) => (
            <button
              key={viewKey}
              className={`preview-view-button ${view === viewKey ? "active" : ""}`}
              onClick={() => setView(viewKey)}
              title={`Edit the ${viewKey === "normal" ? "normal" : "lower-third"} view`}
            >
              {viewKey === "normal" ? "Normal" : "Lower third"}
            </button>
          ))}
        </div>
      </div>

      <div className="tarp-canvases">
        {(["normal", "lowerthird"] as const).map((viewKey) => {
          const viewData = draft[viewKey];
          const libraryBackground = backgrounds.find(
            (background) => background.id === viewData.backgroundId,
          );
          const background = viewData.background ?? theme?.background ?? {
            type: "color" as const,
            color: "#0b1220",
          };
          return (
            <section
              key={viewKey}
              className={`tarp-view-panel ${view === viewKey ? "active" : ""}`}
              onPointerDown={() => setView(viewKey)}
            >
              <header>
                <span>{viewKey === "normal" ? "Normal" : "Lower third"}</span>
                <span className="muted">{viewKey === "normal" ? presentation.aspect : "16:3"}</span>
              </header>
              <div
                className={`tarp-canvas tarp-canvas-${viewKey}`}
                style={{
                  ...(libraryBackground ? {} : backgroundStyle(background)),
                  aspectRatio: viewKey === "normal" ? presentation.aspect.replace(":", " / ") : "16 / 3",
                  color: viewData.textColor ?? theme?.textColor ?? "#ffffff",
                  fontFamily: viewData.fontFamily ?? theme?.fontFamily ?? DEFAULT_FONT,
                }}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) {
                    setView(viewKey);
                    setSelectedObjectId(null);
                  }
                }}
              >
                {libraryBackground && (
                  <div
                    className="tarp-canvas-background"
                    dangerouslySetInnerHTML={{ __html: libraryBackground.render }}
                  />
                )}
                <span className="tarp-canvas-label">
                  {viewKey === "normal" ? "NORMAL VIEW" : "LOWER THIRD"}
                </span>
                {viewData.objects.map((object) => renderObject(object, viewKey))}
              </div>
            </section>
          );
        })}
      </div>

      {selectedObject && (
        <div className="tarp-inspector panel">
          <div className="panel-heading">
            <h3>Object settings · {view === "normal" ? "normal" : "lower third"}</h3>
            <div className="button-row">
              <button
                className="button ghost small"
                onClick={() => moveLayer(selectedObject.id, 1)}
                disabled={
                  draft[view].objects.findIndex((object) => object.id === selectedObject.id) >=
                  draft[view].objects.length - 1
                }
                title="Bring this object forward in this view"
              >
                Forward
              </button>
              <button
                className="button ghost small"
                onClick={() => moveLayer(selectedObject.id, -1)}
                disabled={
                  draft[view].objects.findIndex((object) => object.id === selectedObject.id) <= 0
                }
                title="Send this object backward in this view"
              >
                Back
              </button>
              <button
                className="button ghost small danger-text"
                onClick={() => removeObject(selectedObject.id)}
                title="Remove this object from both views"
              >
                Delete
              </button>
            </div>
          </div>

          <div className="tarp-inspector-grid">
            {selectedObject.kind !== "image" ? (
              <label className="grow">
                {selectedObject.kind === "markdown" ? "Markdown" : "Text"}
                <textarea
                  rows={selectedObject.kind === "markdown" ? 6 : 4}
                  value={selectedObject.content}
                  onChange={(event) =>
                    updateObject(selectedObject.id, (object) => {
                      object.content = event.target.value;
                    })
                  }
                />
              </label>
            ) : (
              <label className="grow">
                Image
                {images.length ? (
                  <select
                    value={selectedObject.content}
                    onChange={(event) =>
                      updateObject(selectedObject.id, (object) => {
                        object.content = event.target.value;
                      })
                    }
                  >
                    <option value="">Choose an image…</option>
                    {images.map((image) => (
                      <option key={image.path} value={image.path}>
                        {image.path}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={selectedObject.content}
                    onChange={(event) =>
                      updateObject(selectedObject.id, (object) => {
                        object.content = event.target.value;
                      })
                    }
                    placeholder="library/path/image.png"
                  />
                )}
              </label>
            )}

            <label className="checkbox">
              <input
                type="checkbox"
                checked={selectedObject.visible}
                onChange={(event) =>
                  updateObject(selectedObject.id, (object) => {
                    object.visible = event.target.checked;
                  })
                }
              />
              Visible
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={selectedObject.locked}
                onChange={(event) =>
                  updateObject(selectedObject.id, (object) => {
                    object.locked = event.target.checked;
                  })
                }
              />
              Locked
            </label>

            {(["x", "y", "width", "height", "rotation", "opacity"] as const).map((field) => (
              <label key={field}>
                {field === "x" || field === "y"
                  ? field.toUpperCase()
                  : field === "width" || field === "height"
                    ? field[0].toUpperCase() + field.slice(1)
                    : field[0].toUpperCase() + field.slice(1)}
                <input
                  type="number"
                  step={field === "opacity" ? 0.05 : 0.01}
                  min={field === "opacity" ? 0 : field === "rotation" ? -360 : 0}
                  max={field === "opacity" ? 1 : field === "rotation" ? 360 : 2}
                  value={selectedObject[view][field] ?? 0}
                  onChange={(event) =>
                    updatePlacement(view, selectedObject.id, {
                      [field]: Number(event.target.value) || 0,
                    })
                  }
                />
              </label>
            ))}

            {selectedObject.kind !== "image" && (
              <>
                <label>
                  Text size
                  <input
                    type="number"
                    min={0.005}
                    max={0.5}
                    step={0.005}
                    value={selectedObject[view].fontSize ?? 0.06}
                    onChange={(event) =>
                      updatePlacement(view, selectedObject.id, {
                        fontSize: Number(event.target.value) || 0.06,
                      })
                    }
                  />
                </label>
                <label>
                  Weight
                  <input
                    type="number"
                    min={100}
                    max={900}
                    step={100}
                    value={selectedObject[view].fontWeight ?? 400}
                    onChange={(event) =>
                      updatePlacement(view, selectedObject.id, {
                        fontWeight: Number(event.target.value) || 400,
                      })
                    }
                  />
                </label>
                <label>
                  Alignment
                  <select
                    value={selectedObject[view].textAlign}
                    onChange={(event) =>
                      updatePlacement(view, selectedObject.id, {
                        textAlign: event.target.value as TarpObjectPlacement["textAlign"],
                      })
                    }
                  >
                    <option value="left">Left</option>
                    <option value="center">Centre</option>
                    <option value="right">Right</option>
                  </select>
                </label>
                <label>
                  Colour
                  <input
                    type="color"
                    value={selectedObject[view].color ?? "#ffffff"}
                    onChange={(event) =>
                      updatePlacement(view, selectedObject.id, { color: event.target.value })
                    }
                  />
                </label>
              </>
            )}

            {selectedObject.kind === "image" && (
              <label>
                Image fit
                <select
                  value={selectedObject[view].fit}
                  onChange={(event) =>
                    updatePlacement(view, selectedObject.id, {
                      fit: event.target.value as "contain" | "cover",
                    })
                  }
                >
                  <option value="contain">Contain</option>
                  <option value="cover">Cover</option>
                </select>
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
