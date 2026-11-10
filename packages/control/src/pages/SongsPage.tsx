import { useEffect, useMemo, useState } from "react";
import type { Song, SongImportReport, SongImportScan } from "@wlm/shared";
import { api, ApiError } from "../api";

const EMPTY = {
  title: "",
  author: "",
  copyright: "",
  ccli: "",
  key: "",
  lyrics: "",
};

export default function SongsPage({
  notify,
}: {
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [scan, setScan] = useState<SongImportScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<SongImportReport | null>(null);

  async function load() {
    const result = await api.songs();
    setSongs(result.songs);
  }

  useEffect(() => {
    load().catch(() => notify("Could not load songs", "error"));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter((song) =>
      [song.title, song.author, song.lyrics].filter(Boolean).some((value) => value!.toLowerCase().includes(q)),
    );
  }, [songs, search]);

  function select(song: Song) {
    setSelectedId(song.id);
    setForm({
      title: song.title,
      author: song.author ?? "",
      copyright: song.copyright ?? "",
      ccli: song.ccli ?? "",
      key: song.key ?? "",
      lyrics: song.lyrics,
    });
  }

  function newSong() {
    setSelectedId(null);
    setForm({ ...EMPTY });
  }

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        author: form.author.trim() || null,
        copyright: form.copyright.trim() || null,
        ccli: form.ccli.trim() || null,
        key: form.key.trim() || null,
        lyrics: form.lyrics,
      };
      const result = selectedId
        ? await api.updateSong(selectedId, payload)
        : await api.createSong(payload);
      await load();
      setSelectedId(result.song.id);
      notify(selectedId ? "Song saved" : "Song created");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save song", "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selectedId || !confirm("Delete this song?")) return;
    try {
      await api.deleteSong(selectedId);
      newSong();
      await load();
      notify("Song deleted");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not delete song", "error");
    }
  }

  async function scanFolder() {
    setScanning(true);
    setImportReport(null);
    try {
      const result = await api.scanImports();
      setScan(result);
      notify(`Found ${result.files.length} importable files`);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not scan songs folder", "error");
    } finally {
      setScanning(false);
    }
  }

  async function importAll() {
    setImporting(true);
    try {
      const result = await api.applyImports();
      setImportReport(result);
      await load();
      notify(`Imported ${result.imported}, updated ${result.updated}`);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Import failed", "error");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="songs-page">
      <div className="two-column songs-layout">
        <aside className="panel list-panel">
        <div className="panel-heading">
          <h2>Songs</h2>
          <button className="button primary small" onClick={newSong}>
            New
          </button>
        </div>
        <input
          className="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search title, author or lyrics…"
        />
        <div className="song-list">
          {filtered.map((song) => (
            <button
              key={song.id}
              className={`song-row ${song.id === selectedId ? "current" : ""}`}
              onClick={() => select(song)}
            >
              <strong>{song.title}</strong>
              <span>
                {song.author || "Unknown author"}
                {song.key ? ` · ${song.key}` : ""}
              </span>
            </button>
          ))}
          {!filtered.length && <p className="muted">No songs found.</p>}
        </div>
      </aside>

      <section className="panel editor-panel">
        <div className="panel-heading">
          <h2>{selectedId ? "Edit song" : "New song"}</h2>
          <div className="button-row">
            {selectedId && (
              <button className="button ghost danger-text" onClick={remove}>
                Delete
              </button>
            )}
            <button className="button primary" onClick={save} disabled={saving || !form.title.trim()}>
              {saving ? "Saving…" : "Save song"}
            </button>
          </div>
        </div>

        <div className="meta-grid">
          <label className="grow">
            Title
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label>
            Key
            <input
              value={form.key}
              onChange={(event) => setForm({ ...form, key: event.target.value })}
              placeholder="G"
            />
          </label>
          <label>
            Author
            <input value={form.author} onChange={(event) => setForm({ ...form, author: event.target.value })} />
          </label>
          <label>
            CCLI
            <input value={form.ccli} onChange={(event) => setForm({ ...form, ccli: event.target.value })} />
          </label>
          <label className="grow">
            Copyright
            <input
              value={form.copyright}
              onChange={(event) => setForm({ ...form, copyright: event.target.value })}
            />
          </label>
        </div>

        <label className="lyrics-field">
          Lyrics and chords
          <textarea
            value={form.lyrics}
            onChange={(event) => setForm({ ...form, lyrics: event.target.value })}
            rows={20}
            spellCheck={false}
            placeholder={`[Verse 1]\nA[C]mazing grace, how [G]sweet the sound\nThat saved a [D]wretch like [A]me\n\n[Chorus]\n…`}
          />
        </label>
        <p className="hint">
          Put chords in square brackets before the syllable: <code>a[C]mazing</code>. Blank lines separate
          sections. A line like <code>[Verse 1]</code> becomes a section label.
        </p>
      </section>
      </div>

      <section className="panel import-panel">
        <div className="panel-heading">
          <div>
            <h2>Import from folder</h2>
            <p className="muted">
              Scans OpenLP XML, ChordPro and plain-text files. Duplicate CCLI/title entries are skipped.
            </p>
          </div>
          <div className="button-row">
            <button className="button" onClick={scanFolder} disabled={scanning}>
              {scanning ? "Scanning…" : "Scan folder"}
            </button>
            <button className="button primary" onClick={importAll} disabled={importing || !scan?.files.length}>
              {importing ? "Importing…" : "Import all"}
            </button>
          </div>
        </div>

        {scan && (
          <p className="hint">
            {scan.files.length} files in <code>{scan.root}</code>
            {scan.errors.length ? ` · ${scan.errors.length} errors` : ""}
            {scan.skipped ? ` · ${scan.skipped} empty` : ""}
          </p>
        )}

        {scan && scan.files.length > 0 && (
          <div className="import-list">
            {scan.files.map((file) => (
              <div key={file.path} className="import-row">
                <span className={`badge ${file.format}`}>{file.format}</span>
                <div>
                  <strong>{file.title}</strong>
                  <span className="muted">
                    {file.author ? `${file.author} · ` : ""}
                    {file.path}
                  </span>
                </div>
                {file.warnings.length > 0 && (
                  <span className="import-warning" title={file.warnings.join("\n")}>
                    {file.warnings.length} warning{file.warnings.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {scan && !scan.files.length && <p className="muted">No importable files found.</p>}

        {scan && scan.errors.length > 0 && (
          <details className="import-errors">
            <summary>{scan.errors.length} parse errors</summary>
            <ul>
              {scan.errors.map((error) => (
                <li key={error.path}>
                  <code>{error.path}</code> — {error.error}
                </li>
              ))}
            </ul>
          </details>
        )}

        {importReport && (
          <div className="import-report">
            <strong>
              Imported {importReport.imported}, updated {importReport.updated}
            </strong>
            {importReport.skipped.length > 0 && (
              <details>
                <summary>{importReport.skipped.length} skipped</summary>
                <ul>
                  {importReport.skipped.map((item) => (
                    <li key={item.path}>
                      <code>{item.path}</code> — {item.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
