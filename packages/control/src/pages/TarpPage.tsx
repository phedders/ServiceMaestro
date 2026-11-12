import { useEffect, useState, type CSSProperties } from "react";
import type {
  BackgroundAsset,
  ImageAsset,
  TarpAspect,
  TarpBackground,
  TarpPage as TarpPageModel,
  TarpPresentationDetail,
  TarpPresentationSummary,
  TarpTheme,
  TarpThemeInput,
} from "@sm/shared";
import { api, ApiError } from "../api";
import TarpPageEditor from "./TarpPageEditor";

const DEFAULT_FONT = '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif';

function emptyThemeInput(): TarpThemeInput {
  return {
    name: "New theme",
    background: { type: "color", color: "#0b1220" },
    fontFamily: DEFAULT_FONT,
    textColor: "#ffffff",
    accentColor: "#4cc2ff",
  };
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

export default function TarpPage({
  notify,
}: {
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [themes, setThemes] = useState<TarpTheme[]>([]);
  const [presentations, setPresentations] = useState<TarpPresentationSummary[]>([]);
  const [selected, setSelected] = useState<TarpPresentationDetail | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [pageDirty, setPageDirty] = useState(false);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [backgrounds, setBackgrounds] = useState<BackgroundAsset[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
  const [themeName, setThemeName] = useState(emptyThemeInput().name);
  const [backgroundType, setBackgroundType] = useState<TarpBackground["type"]>("color");
  const [backgroundColor, setbackgroundColor] = useState("#0b1220");
  const [gradientFrom, setGradientFrom] = useState("#0b1220");
  const [gradientTo, setGradientTo] = useState("#1d4ed8");
  const [backgroundImage, setBackgroundImage] = useState("");
  const [themeFont, setThemeFont] = useState(DEFAULT_FONT);
  const [themeTextColor, setThemeTextColor] = useState("#ffffff");
  const [themeAccentColor, setThemeAccentColor] = useState("#4cc2ff");
  const [themeSaving, setThemeSaving] = useState(false);

  const [newPresentationName, setNewPresentationName] = useState("");
  const [newPresentationAspect, setNewPresentationAspect] = useState<TarpAspect>("16:9");
  const [newPresentationTheme, setNewPresentationTheme] = useState("");
  const [creatingPresentation, setCreatingPresentation] = useState(false);

  const [presentationName, setPresentationName] = useState("");
  const [presentationAspect, setPresentationAspect] = useState<TarpAspect>("16:9");
  const [presentationTheme, setPresentationTheme] = useState("");
  const [presentationSaving, setPresentationSaving] = useState(false);

  async function loadThemes() {
    const result = await api.tarpThemes();
    setThemes(result.themes);
  }

  async function loadPresentations(selectId?: string) {
    const result = await api.tarpPresentations();
    setPresentations(result.presentations);
    const nextId =
      selectId ??
      (selected && result.presentations.some((item) => item.id === selected.id)
        ? selected.id
        : result.presentations[0]?.id);
    if (nextId) await selectPresentation(nextId);
    else setSelected(null);
  }

  useEffect(() => {
    Promise.all([loadThemes(), loadPresentations(), api.images(), api.backgrounds()])
      .then(([, , imageResult, backgroundResult]) => {
        setImages(imageResult.images);
        setBackgrounds(backgroundResult.backgrounds);
      })
      .catch((error) =>
        notify(error instanceof ApiError ? error.message : "Could not load Tarp data", "error"),
      )
      .finally(() => setLoading(false));
  }, []);

  async function selectPresentation(id: string) {
    try {
      const result = await api.tarpPresentation(id);
      setSelected(result.presentation);
      setPresentationName(result.presentation.name);
      setPresentationAspect(result.presentation.aspect);
      setPresentationTheme(result.presentation.themeId ?? "");
      setSelectedPageId((current) =>
        result.presentation.pages.some((page) => page.id === current)
          ? current
          : result.presentation.pages[0]?.id ?? null,
      );
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not load presentation", "error");
    }
  }

  function selectPage(id: string) {
    if (id === selectedPageId) return;
    if (pageDirty && !confirm("Discard unsaved changes to this Tarp page?")) return;
    setPageDirty(false);
    setSelectedPageId(id);
  }

  function openPresentation(id: string) {
    if (pageDirty && !confirm("Discard unsaved changes to this Tarp page?")) return;
    setPageDirty(false);
    void selectPresentation(id);
  }

  function resetThemeEditor() {
    const theme = emptyThemeInput();
    setEditingThemeId(null);
    setThemeName(theme.name);
    setBackgroundType("color");
    setbackgroundColor(theme.background.type === "color" ? theme.background.color : "#0b1220");
    setGradientFrom("#0b1220");
    setGradientTo("#1d4ed8");
    setBackgroundImage("");
    setThemeFont(theme.fontFamily);
    setThemeTextColor(theme.textColor);
    setThemeAccentColor(theme.accentColor);
  }

  function editTheme(theme: TarpTheme) {
    setEditingThemeId(theme.id);
    setThemeName(theme.name);
    setBackgroundType(theme.background.type);
    if (theme.background.type === "color") setbackgroundColor(theme.background.color);
    if (theme.background.type === "gradient") {
      setGradientFrom(theme.background.from);
      setGradientTo(theme.background.to);
    }
    if (theme.background.type === "image") setBackgroundImage(theme.background.path);
    setThemeFont(theme.fontFamily);
    setThemeTextColor(theme.textColor);
    setThemeAccentColor(theme.accentColor);
  }

  function themeInput(): TarpThemeInput {
    const background: TarpBackground =
      backgroundType === "color"
        ? { type: "color", color: backgroundColor }
        : backgroundType === "gradient"
          ? { type: "gradient", from: gradientFrom, to: gradientTo, angle: 180 }
          : { type: "image", path: backgroundImage.trim() };
    return {
      name: themeName.trim(),
      background,
      fontFamily: themeFont.trim(),
      textColor: themeTextColor,
      accentColor: themeAccentColor,
    };
  }

  async function saveTheme() {
    setThemeSaving(true);
    try {
      if (editingThemeId) {
        await api.updateTarpTheme(editingThemeId, themeInput());
        notify("Tarp theme saved");
      } else {
        const result = await api.createTarpTheme(themeInput());
        setEditingThemeId(result.theme.id);
        notify("Tarp theme created");
      }
      await loadThemes();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save Tarp theme", "error");
    } finally {
      setThemeSaving(false);
    }
  }

  async function removeTheme(theme: TarpTheme) {
    if (!confirm(`Delete Tarp theme “${theme.name}”?`)) return;
    try {
      await api.deleteTarpTheme(theme.id);
      if (editingThemeId === theme.id) resetThemeEditor();
      await loadThemes();
      await loadPresentations();
      notify("Tarp theme deleted");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not delete Tarp theme", "error");
    }
  }

  async function createPresentation() {
    if (!newPresentationName.trim()) return;
    setCreatingPresentation(true);
    try {
      const result = await api.createTarpPresentation({
        name: newPresentationName.trim(),
        aspect: newPresentationAspect,
        themeId: newPresentationTheme || null,
      });
      setNewPresentationName("");
      await loadPresentations(result.presentation.id);
      notify("Tarp presentation created");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not create presentation", "error");
    } finally {
      setCreatingPresentation(false);
    }
  }

  async function savePresentation() {
    if (!selected) return;
    setPresentationSaving(true);
    try {
      const result = await api.updateTarpPresentation(selected.id, {
        name: presentationName.trim() || selected.name,
        aspect: presentationAspect,
        themeId: presentationTheme || null,
      });
      setSelected(result.presentation);
      await loadPresentations(result.presentation.id);
      notify("Tarp presentation saved");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save presentation", "error");
    } finally {
      setPresentationSaving(false);
    }
  }

  async function removePresentation() {
    if (!selected || !confirm(`Delete Tarp presentation “${selected.name}”?`)) return;
    try {
      await api.deleteTarpPresentation(selected.id);
      setSelected(null);
      setSelectedPageId(null);
      await loadPresentations();
      notify("Tarp presentation deleted");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not delete presentation", "error");
    }
  }

  async function addPage() {
    if (!selected) return;
    if (pageDirty && !confirm("Discard unsaved changes to this Tarp page?")) return;
    setPageDirty(false);
    try {
      const result = await api.addTarpPage(selected.id);
      setSelected(result.presentation);
      setSelectedPageId(result.presentation.pages.at(-1)?.id ?? null);
      await loadPresentations(result.presentation.id);
      notify("Tarp page added");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not add page", "error");
    }
  }

  async function removePage(pageId: string) {
    if (!selected || !confirm("Delete this Tarp page?")) return;
    if (pageId === selectedPageId) setPageDirty(false);
    try {
      await api.deleteTarpPage(pageId);
      const result = await api.tarpPresentation(selected.id);
      setSelected(result.presentation);
      if (selectedPageId === pageId) setSelectedPageId(result.presentation.pages[0]?.id ?? null);
      await loadPresentations(result.presentation.id);
      notify("Tarp page deleted");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not delete page", "error");
    }
  }

  if (loading) return <div className="panel">Loading Tarp…</div>;

  const themeDraft = themeInput();
  const canSaveTheme =
    Boolean(themeName.trim()) &&
    Boolean(themeFont.trim()) &&
    (backgroundType !== "image" || Boolean(backgroundImage.trim()));
  const selectedPage =
    selected?.pages.find((page) => page.id === selectedPageId) ?? selected?.pages[0] ?? null;

  return (
    <div className="tarp-page">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Themes</h2>
            <p className="muted">
              Global colours, fonts and backgrounds for Tarp presentations. Pages can override these
              later.
            </p>
          </div>
          <button
            className="button ghost"
            onClick={resetThemeEditor}
            title="Start a new Tarp theme"
          >
            New theme
          </button>
        </div>

        <div className="tarp-grid">
          <div className="tarp-list">
            {themes.map((theme) => (
              <button
                key={theme.id}
                className={`tarp-list-item ${editingThemeId === theme.id ? "current" : ""}`}
                onClick={() => editTheme(theme)}
                title={`Edit Tarp theme “${theme.name}”`}
              >
                <span className="tarp-theme-swatch" style={backgroundStyle(theme.background)} />
                <span>
                  <strong>{theme.name}</strong>
                  <span className="muted">{theme.fontFamily}</span>
                </span>
              </button>
            ))}
            {!themes.length && <p className="muted">No themes yet.</p>}
          </div>

          <div className="tarp-editor">
            <div className="tarp-form-grid">
              <label className="grow">
                Name
                <input value={themeName} onChange={(event) => setThemeName(event.target.value)} />
              </label>
              <label>
                Background
                <select
                  value={backgroundType}
                  onChange={(event) =>
                    setBackgroundType(event.target.value as TarpBackground["type"])
                  }
                >
                  <option value="color">Colour</option>
                  <option value="gradient">Gradient</option>
                  <option value="image">Image</option>
                </select>
              </label>
              {backgroundType === "color" && (
                <label>
                  Background colour
                  <input
                    type="color"
                    value={backgroundColor}
                    onChange={(event) => setbackgroundColor(event.target.value)}
                  />
                </label>
              )}
              {backgroundType === "gradient" && (
                <>
                  <label>
                    Gradient from
                    <input
                      type="color"
                      value={gradientFrom}
                      onChange={(event) => setGradientFrom(event.target.value)}
                    />
                  </label>
                  <label>
                    Gradient to
                    <input
                      type="color"
                      value={gradientTo}
                      onChange={(event) => setGradientTo(event.target.value)}
                    />
                  </label>
                </>
              )}
              {backgroundType === "image" && (
                <label className="grow">
                  Background image path
                  <input
                    value={backgroundImage}
                    onChange={(event) => setBackgroundImage(event.target.value)}
                    placeholder="backgrounds/stage.jpg"
                  />
                </label>
              )}
              <label className="grow">
                Font family
                <input value={themeFont} onChange={(event) => setThemeFont(event.target.value)} />
              </label>
              <label>
                Text colour
                <input
                  type="color"
                  value={themeTextColor}
                  onChange={(event) => setThemeTextColor(event.target.value)}
                />
              </label>
              <label>
                Accent colour
                <input
                  type="color"
                  value={themeAccentColor}
                  onChange={(event) => setThemeAccentColor(event.target.value)}
                />
              </label>
            </div>
            <div className="tarp-theme-preview" style={backgroundStyle(themeDraft.background)}>
              <span style={{ color: themeDraft.textColor, fontFamily: themeDraft.fontFamily }}>
                Tarp theme preview
              </span>
              <small style={{ color: themeDraft.accentColor, fontFamily: themeDraft.fontFamily }}>
                {themeDraft.name}
              </small>
            </div>
            <div className="button-row">
              <button
                className="button primary"
                onClick={saveTheme}
                disabled={themeSaving || !canSaveTheme}
                title="Save this Tarp theme"
              >
                {themeSaving ? "Saving…" : editingThemeId ? "Save theme" : "Create theme"}
              </button>
              {editingThemeId && (
                <button
                  className="button ghost danger-text"
                  onClick={() => {
                    const theme = themes.find((item) => item.id === editingThemeId);
                    if (theme) void removeTheme(theme);
                  }}
                  title="Delete this Tarp theme"
                >
                  Delete theme
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Presentations</h2>
            <p className="muted">
              Create the presentation shell now; the dual-view page editor will build on these pages.
            </p>
          </div>
        </div>

        <div className="tarp-grid">
          <div className="tarp-list">
            {presentations.map((presentation) => (
              <button
                key={presentation.id}
                className={`tarp-list-item ${selected?.id === presentation.id ? "current" : ""}`}
                onClick={() => openPresentation(presentation.id)}
                title={`Open Tarp presentation “${presentation.name}”`}
              >
                <span className="tarp-presentation-icon">▧</span>
                <span>
                  <strong>{presentation.name}</strong>
                  <span className="muted">
                    {presentation.aspect === "flex" ? "Flex" : presentation.aspect} ·{" "}
                    {presentation.pageCount} page
                    {presentation.pageCount === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
            ))}
            {!presentations.length && <p className="muted">No presentations yet.</p>}
          </div>

          <div className="tarp-editor">
            <div className="tarp-create-row">
              <input
                value={newPresentationName}
                onChange={(event) => setNewPresentationName(event.target.value)}
                placeholder="New presentation name"
              />
              <select
                value={newPresentationAspect}
                onChange={(event) => setNewPresentationAspect(event.target.value as TarpAspect)}
              >
                <option value="16:9">16:9</option>
                <option value="16:10">16:10</option>
                <option value="flex">Flex · fill screen</option>
              </select>
              <select
                value={newPresentationTheme}
                onChange={(event) => setNewPresentationTheme(event.target.value)}
              >
                <option value="">No theme</option>
                {themes.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.name}
                  </option>
                ))}
              </select>
              <button
                className="button primary"
                onClick={createPresentation}
                disabled={!newPresentationName.trim() || creatingPresentation}
                title="Create a new Tarp presentation"
              >
                {creatingPresentation ? "Creating…" : "Create"}
              </button>
            </div>

            {selected && (
              <>
                <div className="tarp-form-grid">
                  <label className="grow">
                    Name
                    <input
                      value={presentationName}
                      onChange={(event) => setPresentationName(event.target.value)}
                    />
                  </label>
                  <label>
                    Aspect
                    <select
                      value={presentationAspect}
                      onChange={(event) =>
                        setPresentationAspect(event.target.value as TarpAspect)
                      }
                    >
                      <option value="16:9">16:9</option>
                      <option value="16:10">16:10</option>
                      <option value="flex">Flex · fill screen</option>
                    </select>
                  </label>
                  <label>
                    Theme
                    <select
                      value={presentationTheme}
                      onChange={(event) => setPresentationTheme(event.target.value)}
                    >
                      <option value="">No theme</option>
                      {themes.map((theme) => (
                        <option key={theme.id} value={theme.id}>
                          {theme.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="button-row">
                  <button
                    className="button"
                    onClick={savePresentation}
                    disabled={presentationSaving}
                    title="Save presentation name, aspect and theme"
                  >
                    {presentationSaving ? "Saving…" : "Save presentation"}
                  </button>
                  <button
                    className="button ghost"
                    onClick={addPage}
                    title="Add a blank page to this presentation"
                  >
                    Add page
                  </button>
                  <button
                    className="button ghost danger-text"
                    onClick={removePresentation}
                    title="Delete this Tarp presentation"
                  >
                    Delete presentation
                  </button>
                </div>
                <div className="tarp-page-list">
                  {selected.pages.map((page) => (
                    <div
                      key={page.id}
                      className={`tarp-page-row ${selectedPage?.id === page.id ? "current" : ""}`}
                    >
                      <button
                        type="button"
                        className="tarp-page-select"
                        onClick={() => selectPage(page.id)}
                        title={`Edit page “${page.name}”`}
                      >
                        <span className="tarp-page-number">{page.position + 1}</span>
                        <span>
                          <strong>{page.name}</strong>
                          <span className="muted">
                            {page.normal.objects.length} normal · {page.lowerthird.objects.length}{" "}
                            lower-third objects
                          </span>
                        </span>
                      </button>
                      <button
                        className="button ghost small danger-text"
                        onClick={() => removePage(page.id)}
                        title={`Delete page “${page.name}”`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                {selectedPage && (
                  <TarpPageEditor
                    key={selectedPage.id}
                    page={selectedPage}
                    presentation={selected}
                    themes={themes}
                    images={images}
                    backgrounds={backgrounds}
                    notify={notify}
                    onDirtyChange={setPageDirty}
                    onSaved={(saved: TarpPageModel) => {
                      setPageDirty(false);
                      setSelected((current) =>
                        current
                          ? {
                              ...current,
                              pages: current.pages.map((page) =>
                                page.id === saved.id ? saved : page,
                              ),
                            }
                          : current,
                      );
                      void loadPresentations(selected.id);
                    }}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
