import { useEffect, useState } from "react";
import type { Song } from "@sm/shared";
import { api, ApiError } from "../api";
import { PageContentEditor } from "./PageContentEditor";

const EMPTY = {
  title: "",
  alternateTitles: "",
  author: "",
  copyright: "",
  ccli: "",
  key: "",
  verseOrder: "",
  lyricsMarkdown: false,
  lyrics: "",
};

export function SongEditDialog({
  songId,
  notify,
  onSaved,
  onClose,
}: {
  songId: string;
  notify: (text: string, kind?: "info" | "error") => void;
  onSaved: (song: Song) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ ...EMPTY });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .song(songId)
      .then((result) => {
        if (cancelled) return;
        const song = result.song;
        setForm({
          title: song.title,
          alternateTitles: song.alternateTitles ?? "",
          author: song.author ?? "",
          copyright: song.copyright ?? "",
          ccli: song.ccli ?? "",
          key: song.key ?? "",
          verseOrder: song.verseOrder ?? "",
          lyricsMarkdown: song.lyricsMarkdown,
          lyrics: song.lyrics,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        notify(error instanceof ApiError ? error.message : "Could not load song", "error");
        onClose();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [songId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const result = await api.updateSong(songId, {
        title: form.title.trim(),
        alternateTitles: form.alternateTitles.trim() || null,
        author: form.author.trim() || null,
        copyright: form.copyright.trim() || null,
        ccli: form.ccli.trim() || null,
        key: form.key.trim() || null,
        verseOrder: form.verseOrder.trim() || null,
        lyricsMarkdown: form.lyricsMarkdown,
        lyrics: form.lyrics,
      });
      notify("Song saved");
      onSaved(result.song);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save song", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="alt-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="alt-modal song-edit-modal" role="dialog" aria-modal="true">
        <div className="alt-modal-heading">
          <div>
            <h3>Edit song</h3>
            <p className="muted">Quick metadata and lyric changes are saved to the shared library.</p>
          </div>
          <div className="button-row">
            <button className="button ghost small" onClick={onClose} title="Close without saving">
              Close
            </button>
            <button
              className="button primary small"
              onClick={() => void save()}
              disabled={loading || saving || !form.title.trim()}
              title={
                !form.title.trim()
                  ? "Enter a song title first"
                  : "Save these changes to the shared song library"
              }
            >
              {saving ? "Saving…" : "Save song"}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="muted">Loading song…</p>
        ) : (
          <>
            <div className="meta-grid">
              <label className="grow">
                Title
                <input
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  autoFocus
                />
              </label>
              <label className="grow">
                Alternative titles
                <input
                  value={form.alternateTitles}
                  onChange={(event) =>
                    setForm({ ...form, alternateTitles: event.target.value })
                  }
                  placeholder="Other names, separated by commas or new lines"
                />
              </label>
              <label>
                Author
                <input
                  value={form.author}
                  onChange={(event) => setForm({ ...form, author: event.target.value })}
                />
              </label>
              <label>
                CCLI
                <input
                  value={form.ccli}
                  onChange={(event) => setForm({ ...form, ccli: event.target.value })}
                />
              </label>
              <label>
                Key
                <input
                  value={form.key}
                  onChange={(event) => setForm({ ...form, key: event.target.value })}
                  placeholder="G"
                />
              </label>
              <label className="grow">
                Copyright
                <input
                  value={form.copyright}
                  onChange={(event) => setForm({ ...form, copyright: event.target.value })}
                />
              </label>
              <label className="grow">
                Verse order
                <input
                  value={form.verseOrder}
                  onChange={(event) => setForm({ ...form, verseOrder: event.target.value })}
                  placeholder="e.g. V1 C V2 C B C"
                />
              </label>
            </div>

            <label className="checkbox markdown-field">
              <input
                type="checkbox"
                checked={form.lyricsMarkdown}
                onChange={(event) =>
                  setForm({ ...form, lyricsMarkdown: event.target.checked })
                }
              />
              <span>
                Enable inline Markdown styling in song lyrics
                <small>
                  Supports <code>**bold**</code>, <code>*italic*</code>, <code>~~strike~~</code>{" "}
                  and <code>==highlight==</code>.
                </small>
              </span>
            </label>

            <div className="lyrics-field">
              <span className="field-label">Lyrics and chords</span>
              <PageContentEditor
                value={form.lyrics}
                onChange={(lyrics) => setForm({ ...form, lyrics })}
                rows={16}
                placeholder={`[Verse 1]\nA[C]mazing grace, how [G]sweet the sound\nThat saved a [D]wretch like [A]me`}
              />
            </div>
            <p className="hint">
              Chords go in square brackets before the syllable. A line such as{" "}
              <code>[Verse 1]</code> becomes a section label.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
