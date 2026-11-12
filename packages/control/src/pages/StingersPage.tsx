import { useEffect, useState } from "react";
import type { StingerAsset } from "@sm/shared";
import { api, ApiError } from "../api";
import { ReadOnlyFieldset, usePageAccess } from "../page-access";

export default function StingersPage({
  notify,
}: {
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const { canWrite } = usePageAccess();
  const [stingers, setStingers] = useState<StingerAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [durationMs, setDurationMs] = useState(1200);

  async function load() {
    const result = await api.stingers();
    setStingers(result.stingers);
  }

  useEffect(() => {
    load()
      .catch((error) =>
        notify(error instanceof ApiError ? error.message : "Could not load stingers", "error"),
      )
      .finally(() => setLoading(false));
  }, []);

  async function uploadStinger() {
    if (!file || !canWrite) return;
    setUploading(true);
    try {
      const uploaded = await api.uploadImage(file, "stingers");
      await api.createStinger({
        name: name.trim() || uploaded.image.name,
        kind: "image",
        imagePath: uploaded.image.path,
        durationMs,
      });
      setName("");
      setFile(null);
      await load();
      notify("Image stinger added");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not add stinger", "error");
    } finally {
      setUploading(false);
    }
  }

  async function remove(stinger: StingerAsset) {
    if (!canWrite || !confirm(`Delete stinger “${stinger.name}”?`)) return;
    try {
      await api.deleteStinger(stinger.id);
      await load();
      notify("Stinger deleted");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not delete stinger", "error");
    }
  }

  if (loading) return <div className="panel">Loading stingers…</div>;

  return (
    <div className="backgrounds-page">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Transition stingers</h2>
            <p className="muted">
              Transparent animated overlays that cover the old page and reveal the new one. Set a
              default on the set list, then override it per item or per page.
            </p>
          </div>
        </div>
      </section>

      <ReadOnlyFieldset className="panel">
        <div className="panel-heading">
          <div>
            <h2>Add image stinger</h2>
            <p className="muted">
              PNG, GIF, WebP, AVIF or SVG with transparency. Animated files play automatically.
            </p>
          </div>
        </div>
        <div className="stinger-upload">
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Stinger name (optional)"
          />
          <label>
            Duration (ms)
            <input
              type="number"
              min={200}
              max={10000}
              step={50}
              value={durationMs}
              onChange={(event) =>
                setDurationMs(Math.max(200, Math.min(10000, Number(event.target.value) || 1200)))
              }
            />
          </label>
          <button
            className="button"
            onClick={uploadStinger}
            disabled={!file || uploading}
            title="Upload this image as a transparent stinger"
          >
            {uploading ? "Uploading…" : "Add image stinger"}
          </button>
        </div>
      </ReadOnlyFieldset>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Stinger library</h2>
            <p className="muted">{stingers.length} stingers · checkerboard shows transparency</p>
          </div>
        </div>
        <div className="stinger-grid">
          {stingers.map((stinger) => (
            <article key={stinger.id} className="background-card">
              <div
                className="stinger-preview"
                dangerouslySetInnerHTML={{ __html: stinger.render }}
              />
              <div className="background-card-body">
                <div>
                  <strong>{stinger.name}</strong>
                  <span className="muted">
                    {stinger.kind.toUpperCase()}
                    {stinger.preset ? ` · ${stinger.preset}` : ""} · {stinger.durationMs} ms
                  </span>
                </div>
                <div className="button-row">
                  <button
                    className="button ghost small danger-text"
                    onClick={() => remove(stinger)}
                    disabled={!canWrite}
                    title={
                      canWrite
                        ? `Delete “${stinger.name}”`
                        : "Read-only access to stingers"
                    }
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
