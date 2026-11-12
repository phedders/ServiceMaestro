import { useEffect, useState } from "react";
import type { BackgroundAsset, BackgroundColors } from "@sm/shared";
import { api, ApiError } from "../api";

const DEFAULT_COLORS: BackgroundColors = {
  background: "#07111f",
  primary: "#4cc2ff",
  secondary: "#a78bfa",
  accent: "#fb7185",
};

export default function BackgroundsPage({
  notify,
}: {
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [backgrounds, setBackgrounds] = useState<BackgroundAsset[]>([]);
  const [colors, setColors] = useState<BackgroundColors>(DEFAULT_COLORS);
  const [loading, setLoading] = useState(true);
  const [savingColors, setSavingColors] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);

  async function load() {
    const result = await api.backgrounds();
    setBackgrounds(result.backgrounds);
    setColors(result.colors);
  }

  useEffect(() => {
    load()
      .catch((error) =>
        notify(error instanceof ApiError ? error.message : "Could not load backgrounds", "error"),
      )
      .finally(() => setLoading(false));
  }, []);

  async function saveColors() {
    setSavingColors(true);
    try {
      const result = await api.saveBackgroundColors(colors);
      setColors(result.colors);
      await load();
      notify("Background colour theme saved");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save colours", "error");
    } finally {
      setSavingColors(false);
    }
  }

  async function uploadBackground() {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await api.uploadImage(file, "backgrounds");
      await api.createBackground({
        name: name.trim() || uploaded.image.name,
        kind: "image",
        imagePath: uploaded.image.path,
        useGlobalColors: false,
        colors,
      });
      setName("");
      setFile(null);
      await load();
      notify("Image background added");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not add background", "error");
    } finally {
      setUploading(false);
    }
  }

  async function toggleGlobalColors(background: BackgroundAsset) {
    try {
      await api.updateBackground(background.id, {
        name: background.name,
        kind: background.kind,
        preset: background.preset,
        imagePath: background.imagePath,
        useGlobalColors: !background.useGlobalColors,
        colors: background.colors,
      });
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not update background", "error");
    }
  }

  async function remove(background: BackgroundAsset) {
    if (!confirm(`Delete background “${background.name}”?`)) return;
    try {
      await api.deleteBackground(background.id);
      await load();
      notify("Background deleted");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not delete background", "error");
    }
  }

  if (loading) return <div className="panel">Loading backgrounds…</div>;

  return (
    <div className="backgrounds-page">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Global background colours</h2>
            <p className="muted">
              Animated backgrounds can use these colours instead of their own preset palette. The
              global palette is shared through the set lists repository.
            </p>
          </div>
          <button
            className="button primary"
            onClick={saveColors}
            disabled={savingColors}
            title="Save the global background colour theme"
          >
            {savingColors ? "Saving…" : "Save colours"}
          </button>
        </div>
        <div className="background-colors-grid">
          {(
            [
              ["background", "Background"],
              ["primary", "Primary"],
              ["secondary", "Secondary"],
              ["accent", "Accent"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="color"
                value={colors[key]}
                onChange={(event) => setColors({ ...colors, [key]: event.target.value })}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Add image background</h2>
            <p className="muted">PNG, JPEG, GIF, WebP, AVIF or SVG. Animated GIF/WebP/SVG animate automatically.</p>
          </div>
        </div>
        <div className="background-upload">
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Background name (optional)"
          />
          <button
            className="button"
            onClick={uploadBackground}
            disabled={!file || uploading}
            title="Upload this image into the background library"
          >
            {uploading ? "Uploading…" : "Add image background"}
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Background library</h2>
            <p className="muted">{backgrounds.length} backgrounds</p>
          </div>
        </div>
        <div className="background-grid">
          {backgrounds.map((background) => (
            <article key={background.id} className="background-card">
              <div
                className="background-preview"
                dangerouslySetInnerHTML={{ __html: background.render }}
              />
              <div className="background-card-body">
                <div>
                  <strong>{background.name}</strong>
                  <span className="muted">
                    {background.kind.toUpperCase()}
                    {background.preset ? ` · ${background.preset}` : ""}
                    {background.useGlobalColors ? " · global colours" : ""}
                  </span>
                </div>
                <div className="button-row">
                  <button
                    className="button ghost small"
                    onClick={() => toggleGlobalColors(background)}
                    title={
                      background.useGlobalColors
                        ? "Use this background's own preset colours"
                        : "Use the global background colour theme"
                    }
                  >
                    {background.useGlobalColors ? "Use own colours" : "Use global colours"}
                  </button>
                  <button
                    className="button ghost small danger-text"
                    onClick={() => remove(background)}
                    title={`Delete “${background.name}”`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
