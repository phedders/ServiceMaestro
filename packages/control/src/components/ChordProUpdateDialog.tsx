import { useEffect, useState } from "react";
import type {
  ChordProFilePreview,
  SiteScraperProviderSummary,
} from "@sm/shared";
import { api, ApiError } from "../api";
import { sideBySideDiff } from "../song-diff";

interface CurrentSongValues {
  title: string;
  alternateTitles: string;
  author: string;
  copyright: string;
  ccli: string;
  key: string;
  lyrics: string;
}

export function ChordProUpdateDialog({
  songId,
  current,
  provider,
  notify,
  onApply,
  onClose,
}: {
  songId: string;
  current: CurrentSongValues;
  provider: SiteScraperProviderSummary | null;
  notify: (text: string, kind?: "info" | "error") => void;
  onApply: (preview: ChordProFilePreview) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<ChordProFilePreview | null>(null);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState<"file" | "site" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function parseFile(file: File) {
    setLoading("file");
    setError("");
    setPreview(null);
    setSource("");
    try {
      const content = await file.text();
      const result = await api.parseChordProFile(file.name, content);
      setPreview(result.preview);
      setSource(file.name);
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : "Could not read the ChordPro file";
      setError(message);
      notify(message, "error");
    } finally {
      setLoading(null);
    }
  }

  async function fetchFromSongSelect() {
    if (!provider) return;
    setLoading("site");
    setError("");
    setPreview(null);
    setSource("");
    try {
      const result = await api.siteScraperChordProForSong(provider.id, songId);
      setPreview(result.preview);
      setSource(`${provider.label} · ${result.preview.filename}`);
    } catch (caught) {
      const message =
        caught instanceof ApiError ? caught.message : "Could not download the ChordPro file";
      setError(message);
      notify(message, "error");
    } finally {
      setLoading(null);
    }
  }

  const metadata = preview
    ? ([
        ["Title", current.title, preview.title || ""],
        ["Alternate titles", current.alternateTitles, preview.alternateTitles ?? ""],
        ["Author", current.author, preview.author ?? ""],
        ["CCLI", current.ccli, preview.ccli ?? ""],
        ["Key", current.key, preview.key ?? ""],
        ["Copyright", current.copyright, preview.copyright ?? ""],
      ] as Array<[string, string, string]>)
    : [];
  const rows = preview ? sideBySideDiff(current.lyrics, preview.lyrics) : [];

  return (
    <div
      className="alt-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="alt-modal chordpro-update-modal" role="dialog" aria-modal="true">
        <div className="alt-modal-heading">
          <div>
            <h3>Update from ChordPro</h3>
            <p className="muted">
              Compare the imported file with the current song before applying any changes.
            </p>
          </div>
          <div className="button-row">
            {preview && (
              <>
                <button className="button ghost small" onClick={onClose} title="Keep the current song">
                  Keep original
                </button>
                <button
                  className="button primary small"
                  onClick={() => {
                    onApply(preview);
                    onClose();
                  }}
                  title="Load the ChordPro values into the editor without saving yet"
                >
                  Use new version
                </button>
              </>
            )}
            <button className="button ghost small" onClick={onClose} title="Close without changing">
              Close
            </button>
          </div>
        </div>

        <div className="chordpro-update-sources">
          <label className="button ghost small file-button" title="Choose a downloaded ChordPro file">
            {loading === "file" ? "Reading…" : "Choose ChordPro file"}
            <input
              type="file"
              accept=".cho,.chordpro,.crd,.txt"
              hidden
              disabled={loading !== null}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void parseFile(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {provider && (
            <button
              type="button"
              className="button ghost small"
              onClick={() => void fetchFromSongSelect()}
              disabled={loading !== null}
              title={`Download the ChordPro file for this song from ${provider.label}`}
            >
              {loading === "site" ? "Downloading…" : "Download from SongSelect"}
            </button>
          )}
          {source && <span className="muted">Source: {source}</span>}
        </div>
        {!provider && (
          <p className="hint">
            No active SongSelect credentials were found. Download the ChordPro file from SongSelect
            and choose it here, or configure credentials in Settings.
          </p>
        )}

        {error && <p className="form-error">{error}</p>}
        {!preview && loading === null && !error && (
          <p className="muted">
            Choose a downloaded `.cho`/`.chordpro` file or fetch the ChordPro file from SongSelect.
          </p>
        )}

        {preview && (
          <>
            <table className="alt-diff-meta chordpro-preview-meta">
              <thead>
                <tr>
                  <th></th>
                  <th>Current</th>
                  <th>ChordPro</th>
                </tr>
              </thead>
              <tbody>
                {metadata.map(([label, before, after]) => (
                  <tr key={label}>
                    <th>{label}</th>
                    <td className={before !== after ? "diff-changed" : ""}>{before || "—"}</td>
                    <td className={before !== after ? "diff-changed" : ""}>{after || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="chordpro-side-by-side">
              <div className="chordpro-side-by-side-head">
                <span>Current lyrics</span>
                <span>ChordPro lyrics</span>
              </div>
              <div className="chordpro-side-by-side-body">
                {rows.map((row, index) => (
                  <div className="chordpro-side-by-side-row" key={index}>
                    <div className={`chordpro-side-by-side-cell ${row.left?.type ?? "empty"}`}>
                      {row.left?.text || " "}
                    </div>
                    <div className={`chordpro-side-by-side-cell ${row.right?.type ?? "empty"}`}>
                      {row.right?.text || " "}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {preview.warnings.length > 0 && (
              <p className="hint">Parser notes: {preview.warnings.join(" · ")}</p>
            )}
            <p className="hint">
              <strong>Use new version</strong> loads these values into the editor and clears the
              separate <strong>Verse order</strong> field, because the ChordPro file already contains
              its own arrangement. The song is not saved until you choose <strong>Save song</strong>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
