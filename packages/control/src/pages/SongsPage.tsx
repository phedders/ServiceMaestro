import { useEffect, useMemo, useState } from "react";
import type {
  LiveState,
  SetlistSummary,
  Song,
  SongAsset,
  SongImportDecision,
  SongImportReport,
  SongImportScan,
} from "@sm/shared";
import { api, ApiError } from "../api";
import { PageContentEditor } from "../components/PageContentEditor";
import { compactDate, pickCurrentSetlist } from "../service-date";

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

export default function SongsPage({
  live,
  onQuickSong,
  notify,
}: {
  live: LiveState;
  onQuickSong: (songId: string) => Promise<void>;
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
  const [importDecisions, setImportDecisions] = useState<
    Record<
      string,
      { action: "skip" | "replace" | "duplicate"; title: string; alternateTitles: string }
    >
  >({});
  const [assets, setAssets] = useState<SongAsset[]>([]);
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [assetKind, setAssetKind] = useState("score_pdf");
  const [assetTitle, setAssetTitle] = useState("");
  const [assetKey, setAssetKey] = useState("");
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [newOrderName, setNewOrderName] = useState("");
  const [newOrderText, setNewOrderText] = useState("");
  const [setlists, setSetlists] = useState<SetlistSummary[]>([]);
  const [targetSetlist, setTargetSetlist] = useState("");
  const [addingToSetlist, setAddingToSetlist] = useState(false);
  const [showingLive, setShowingLive] = useState(false);

  async function load() {
    const result = await api.songs();
    setSongs(result.songs);
  }

  useEffect(() => {
    load().catch(() => notify("Could not load songs", "error"));
  }, []);

  useEffect(() => {
    api
      .setlists()
      .then((result) => {
        setSetlists(result.setlists);
        const preferred =
          (live.setlistId && result.setlists.find((setlist) => setlist.id === live.setlistId)?.id) ||
          pickCurrentSetlist(result.setlists)?.id ||
          "";
        setTargetSetlist(preferred);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setAssets([]);
      return;
    }
    api
      .songAssets(selectedId)
      .then((result) => setAssets(result.assets))
      .catch(() => setAssets([]));
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return songs;
    return songs.filter((song) =>
      [song.title, song.alternateTitles, song.author, song.lyrics]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(q)),
    );
  }, [songs, search]);

  const selectedSong = songs.find((song) => song.id === selectedId) ?? null;
  const duplicateFiles = (scan?.files ?? []).filter((file) => file.duplicate);

  function updateImportDecision(
    path: string,
    patch: Partial<{ action: "skip" | "replace" | "duplicate"; title: string; alternateTitles: string }>,
  ) {
    setImportDecisions((current) => ({
      ...current,
      [path]: {
        action: current[path]?.action ?? "skip",
        title: current[path]?.title ?? "",
        alternateTitles: current[path]?.alternateTitles ?? "",
        ...patch,
      },
    }));
  }

  function skipAllDuplicates() {
    setImportDecisions(
      Object.fromEntries(
        duplicateFiles.map((file) => [
          file.path,
          {
            action: "skip" as const,
            title: file.title,
            alternateTitles: file.alternateTitles ?? "",
          },
        ]),
      ),
    );
    notify("All duplicate files set to skip");
  }

  async function addToSetlist() {
    if (!selectedId || !targetSetlist) return;
    setAddingToSetlist(true);
    try {
      await api.addItem(targetSetlist, { kind: "song", songId: selectedId });
      const target = setlists.find((setlist) => setlist.id === targetSetlist);
      notify(
        target
          ? `Added “${selectedSong?.title ?? form.title}” to “${target.name}”`
          : "Song added to the current set list",
      );
      setSetlists((current) =>
        current.map((setlist) =>
          setlist.id === targetSetlist
            ? { ...setlist, itemCount: setlist.itemCount + 1 }
            : setlist,
        ),
      );
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not add song to set list", "error");
    } finally {
      setAddingToSetlist(false);
    }
  }

  async function showInLive() {
    if (!selectedId) return;
    setShowingLive(true);
    try {
      await onQuickSong(selectedId);
    } finally {
      setShowingLive(false);
    }
  }

  async function addVerseOrder() {
    if (!selectedId || !newOrderName.trim() || !newOrderText.trim()) return;
    try {
      await api.createVerseOrder(selectedId, {
        name: newOrderName.trim(),
        order: newOrderText.trim(),
      });
      setNewOrderName("");
      setNewOrderText("");
      await load();
      notify("Verse order saved");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save verse order", "error");
    }
  }

  async function removeVerseOrder(id: string) {
    if (!selectedId || !confirm("Delete this saved verse order?")) return;
    try {
      await api.deleteVerseOrder(selectedId, id);
      await load();
      notify("Verse order removed");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not remove verse order", "error");
    }
  }

  function select(song: Song) {
    setSelectedId(song.id);
    setNewOrderName("");
    setNewOrderText("");
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
  }

  function newSong() {
    setSelectedId(null);
    setNewOrderName("");
    setNewOrderText("");
    setForm({ ...EMPTY });
  }

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        alternateTitles: form.alternateTitles.trim() || null,
        author: form.author.trim() || null,
        copyright: form.copyright.trim() || null,
        ccli: form.ccli.trim() || null,
        key: form.key.trim() || null,
        verseOrder: form.verseOrder.trim() || null,
        lyricsMarkdown: form.lyricsMarkdown,
        lyrics: form.lyrics,
      };
      const result = selectedId
        ? await api.updateSong(selectedId, payload)
        : await api.createSong(payload);
      await load();
      setSelectedId(result.song.id);
      setForm((current) => ({ ...current, lyrics: result.song.lyrics }));
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

  async function uploadAsset() {
    if (!selectedId || !assetFile) return;
    setUploadingAsset(true);
    try {
      const result = await api.uploadAsset(selectedId, assetFile, {
        kind: assetKind,
        title: assetTitle.trim() || undefined,
        key: assetKey.trim() || form.key || undefined,
      });
      setAssets((current) => [...current, result.asset]);
      setAssetFile(null);
      setAssetTitle("");
      notify("Asset uploaded");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not upload asset", "error");
    } finally {
      setUploadingAsset(false);
    }
  }

  async function removeAsset(asset: SongAsset) {
    if (!confirm(`Remove “${asset.title}”?`)) return;
    try {
      await api.deleteAsset(asset.id);
      setAssets((current) => current.filter((candidate) => candidate.id !== asset.id));
      notify("Asset removed");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not remove asset", "error");
    }
  }

  async function scanFolder() {
    setScanning(true);
    setImportReport(null);
    try {
      const result = await api.scanImports();
      setScan(result);
      setImportDecisions(
        Object.fromEntries(
          result.files
            .filter((file) => file.duplicate)
            .map((file) => [
              file.path,
              {
                action: "skip" as const,
                title: file.title,
                alternateTitles: file.alternateTitles ?? "",
              },
            ]),
        ),
      );
      const duplicates = result.files.filter((file) => file.duplicate).length;
      notify(
        `Found ${result.files.length} importable files${duplicates ? ` · ${duplicates} duplicate${duplicates === 1 ? "" : "s"} to review` : ""}`,
      );
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not scan songs folder", "error");
    } finally {
      setScanning(false);
    }
  }

  async function importAll() {
    setImporting(true);
    try {
      const decisions: SongImportDecision[] = (scan?.files ?? [])
        .filter((file) => file.duplicate)
        .map((file) => {
          const decision = importDecisions[file.path] ?? {
            action: "skip" as const,
            title: file.title,
            alternateTitles: file.alternateTitles ?? "",
          };
          return decision.action === "duplicate"
            ? {
                path: file.path,
                action: decision.action,
                title: decision.title.trim() || file.title,
                alternateTitles: decision.alternateTitles.trim() || null,
              }
            : { path: file.path, action: decision.action };
        });
      const result = await api.applyImports(decisions);
      setImportReport(result);
      await load();
      notify(
        `Imported ${result.imported}, replaced ${result.replaced}, duplicated ${result.duplicated}, skipped ${result.skipped.length}`,
      );
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
          <button
            className="button primary small"
            onClick={newSong}
            title="Start a new song in the editor"
          >
            New
          </button>
        </div>
        <input
          className="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search title, alternative titles, author or lyrics…"
        />
        <div className="song-list">
          {filtered.map((song) => (
            <button
              key={song.id}
              className={`song-row ${song.id === selectedId ? "current" : ""}`}
              onClick={() => select(song)}
              title={`Edit “${song.title}”`}
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
              <button
                className="button ghost danger-text"
                onClick={remove}
                title="Delete this song from the shared song library"
              >
                Delete
              </button>
            )}
            <button
              className="button primary"
              onClick={save}
              disabled={saving || !form.title.trim()}
              title={
                !form.title.trim()
                  ? "Enter a song title first"
                  : "Save this song to the shared song library"
              }
            >
              {saving ? "Saving…" : "Save song"}
            </button>
          </div>
        </div>

        <div className="meta-grid">
          <label className="grow">
            Title
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label className="grow">
            Alternative titles
            <input
              value={form.alternateTitles}
              onChange={(event) => setForm({ ...form, alternateTitles: event.target.value })}
              placeholder="Other names, separated by commas or new lines"
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
          <label className="grow">
            Verse order
            <input
              value={form.verseOrder}
              onChange={(event) => setForm({ ...form, verseOrder: event.target.value })}
              placeholder="e.g. V1 C V2 C B C"
            />
          </label>
        </div>

        <div className="song-use-panel">
          <div className="panel-heading">
            <div>
              <h3>Use this song</h3>
              <p className="muted">
                Add the saved song to a set list, or show it immediately without changing the set list.
              </p>
            </div>
          </div>
          <div className="song-use-actions">
            <label>
              Current set list
              <select
                value={targetSetlist}
                onChange={(event) => setTargetSetlist(event.target.value)}
              >
                {!setlists.length && <option value="">No set lists yet</option>}
                {setlists.map((setlist) => (
                  <option key={setlist.id} value={setlist.id}>
                    {setlist.name} — {compactDate(setlist.serviceDate)}
                    {setlist.serviceTime ? ` ${setlist.serviceTime}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="button-row">
              <button
                className="button"
                onClick={addToSetlist}
                disabled={!selectedId || !targetSetlist || addingToSetlist}
                title={!selectedId ? "Save the song first" : "Add this song to the selected set list"}
              >
                {addingToSetlist ? "Adding…" : "Add to current setlist"}
              </button>
              <button
                className="button primary"
                onClick={showInLive}
                disabled={!selectedId || live.status === "idle" || showingLive}
                title={
                  live.status === "idle"
                    ? "Start a live session first"
                    : "Show this song immediately without changing the set list"
                }
              >
                {showingLive ? "Showing…" : "Add to live session"}
              </button>
            </div>
          </div>
          <p className="hint">
            {!selectedId
              ? "Save the song first to add or display it."
              : live.status === "idle"
                ? "Start a live session to display the song immediately."
                : "“Add to live session” displays the song now and is not saved to the set list."}
          </p>
        </div>

        <div className="verse-orders-panel">
          <div className="panel-heading">
            <div>
              <h3>Saved verse orders</h3>
              <p className="muted">
                Name alternative arrangements (for example “Short” or “Full”) and choose one when the
                song is added to a set list.
              </p>
            </div>
          </div>
          {selectedId ? (
            <>
              <div className="verse-order-list">
                {selectedSong?.verseOrders.map((entry) => (
                  <div key={entry.id} className="verse-order-row">
                    <strong>{entry.name}</strong>
                    <code>{entry.order}</code>
                    <button
                      className="button ghost small danger-text"
                      onClick={() => removeVerseOrder(entry.id)}
                      title={`Delete saved verse order “${entry.name}”`}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {!selectedSong?.verseOrders.length && (
                  <p className="muted">No saved verse orders yet; the default above is used.</p>
                )}
              </div>
              <div className="verse-order-add">
                <input
                  value={newOrderName}
                  onChange={(event) => setNewOrderName(event.target.value)}
                  placeholder="Name, e.g. Short"
                />
                <input
                  value={newOrderText}
                  onChange={(event) => setNewOrderText(event.target.value)}
                  placeholder="Order, e.g. V1 C V2 C"
                />
                <button
                  className="button"
                  onClick={addVerseOrder}
                  disabled={!newOrderName.trim() || !newOrderText.trim()}
                  title="Save this named verse order on the song"
                >
                  Add verse order
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Save the song first, then add named verse orders.</p>
          )}
        </div>

        <label className="checkbox markdown-field">
          <input
            type="checkbox"
            checked={form.lyricsMarkdown}
            onChange={(event) => setForm({ ...form, lyricsMarkdown: event.target.checked })}
          />
          <span>
            Enable inline Markdown styling in song lyrics
            <small>
              Supports <code>**bold**</code>, <code>*italic*</code>, <code>~~strike~~</code> and{" "}
              <code>==highlight==</code> on lower-third/centered two-thirds. Stage and chords ignore the styling.
            </small>
          </span>
        </label>

        <div className="lyrics-field">
          <span className="field-label">Lyrics and chords</span>
          <PageContentEditor
            value={form.lyrics}
            onChange={(lyrics) => setForm({ ...form, lyrics })}
            rows={12}
            placeholder={`[Verse 1]\nA[C]mazing grace, how [G]sweet the sound\nThat saved a [D]wretch like [A]me\n\n[Chorus]\n…`}
          />
        </div>
        <p className="hint">
          Put chords in square brackets before the syllable: <code>a[C]mazing</code>. Blank lines separate
          sections. A line like <code>[Verse 1]</code> becomes a section label. If Markdown styling is
          enabled, tags are applied on lower-third/centered two-thirds but ignored on stage/chords.
        </p>

        <div className="assets-panel">
          <div className="panel-heading">
            <h3>Files for musicians</h3>
            <span className="muted">{assets.length} attached</span>
          </div>
          {selectedId ? (
            <>
              <div className="asset-upload">
                <input
                  type="file"
                  accept=".pdf,.txt,.png,.jpg,.jpeg,.webp,.cho,.crd,.chordpro"
                  onChange={(event) => setAssetFile(event.target.files?.[0] ?? null)}
                />
                <select value={assetKind} onChange={(event) => setAssetKind(event.target.value)}>
                  <option value="score_pdf">Score PDF</option>
                  <option value="guitar_tab">Guitar tab</option>
                  <option value="chordpro">ChordPro file</option>
                  <option value="lyrics">Lyrics file</option>
                  <option value="image">Image</option>
                </select>
                <input
                  value={assetKey}
                  onChange={(event) => setAssetKey(event.target.value)}
                  placeholder={form.key || "Key"}
                />
                <input
                  value={assetTitle}
                  onChange={(event) => setAssetTitle(event.target.value)}
                  placeholder="Title (optional)"
                />
                <button
                  className="button primary"
                  onClick={uploadAsset}
                  disabled={!assetFile || uploadingAsset}
                  title={
                    assetFile
                      ? "Upload this score, tab or lyrics file to the song"
                      : "Choose a file before uploading"
                  }
                >
                  {uploadingAsset ? "Uploading…" : "Upload"}
                </button>
              </div>
              <div className="asset-list">
                {assets.map((asset) => (
                  <div key={asset.id} className="asset-row">
                    <span className={`badge ${asset.kind}`}>{asset.kind.replace("_", " ")}</span>
                    <div>
                      <strong>{asset.title}</strong>
                      <span className="muted">
                        {asset.key ? `${asset.key} · ` : ""}
                        {(asset.bytes / 1024).toFixed(0)} KB
                      </span>
                    </div>
                    <div className="button-row">
                      <a
                        className="button ghost small"
                        href={`/api/assets/${asset.id}/file`}
                        target="_blank"
                        rel="noreferrer"
                        title={`Open “${asset.title}” in a new tab`}
                      >
                        Open
                      </a>
                      <button
                        className="button ghost small danger-text"
                        onClick={() => removeAsset(asset)}
                        title={`Remove “${asset.title}” from this song`}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                {!assets.length && <p className="muted">No score or tab files yet.</p>}
              </div>
            </>
          ) : (
            <p className="muted">Save the song first, then attach PDF scores or tabs.</p>
          )}
        </div>
      </section>
      </div>

      <section className="panel import-panel">
        <div className="panel-heading">
          <div>
            <h2>Import from folder</h2>
            <p className="muted">
              Scans OpenLP XML, ChordPro and plain-text files. Duplicate CCLI/title matches are shown
              for review; choose skip, replace or import as a separate song.
            </p>
          </div>
          <div className="button-row">
            <button
              className="button"
              onClick={scanFolder}
              disabled={scanning}
              title="Scan the configured folder for importable song files"
            >
              {scanning ? "Scanning…" : "Scan folder"}
            </button>
            <button
              className="button primary"
              onClick={importAll}
              disabled={importing || !scan?.files.length}
              title="Import all scanned songs using the duplicate decisions"
            >
              {importing ? "Importing…" : "Import all"}
            </button>
          </div>
        </div>

        {scan && (
          <p className="hint">
            {scan.files.length} files in <code>{scan.root}</code>
            {scan.errors.length ? ` · ${scan.errors.length} errors` : ""}
            {scan.skipped ? ` · ${scan.skipped} empty` : ""}
            {duplicateFiles.length ? ` · ${duplicateFiles.length} duplicates to review` : ""}
          </p>
        )}

        {duplicateFiles.length > 0 && (
          <div className="import-duplicates">
            <div className="panel-heading">
              <div>
                <h3>Duplicate review</h3>
                <p className="muted">
                  The imported file matches an existing song by CCLI or title. Choose what to do
                  before importing.
                </p>
              </div>
              <div className="button-row">
                <span className="muted">{duplicateFiles.length}</span>
                <button
                  className="button ghost small"
                  onClick={skipAllDuplicates}
                  title="Skip every duplicate in this import"
                >
                  Skip all
                </button>
              </div>
            </div>
            {duplicateFiles.map((file) => {
              const decision = importDecisions[file.path] ?? {
                action: "skip" as const,
                title: file.title,
                alternateTitles: file.alternateTitles ?? "",
              };
              return (
                <div key={file.path} className="import-duplicate">
                  <div className="import-duplicate-head">
                    <div>
                      <strong>{file.title}</strong>
                      <span className="muted">
                        matches “{file.duplicate?.title}” by{" "}
                        {file.duplicate?.reason === "ccli" ? "CCLI" : "title"} · {file.path}
                      </span>
                    </div>
                    <select
                      value={decision.action}
                      onChange={(event) =>
                        updateImportDecision(file.path, {
                          action: event.target.value as "skip" | "replace" | "duplicate",
                        })
                      }
                    >
                      <option value="skip">Skip</option>
                      <option value="replace">Replace existing song</option>
                      <option value="duplicate">Import as duplicate</option>
                    </select>
                  </div>
                  {decision.action === "duplicate" && (
                    <div className="import-duplicate-fields">
                      <label>
                        New title
                        <input
                          value={decision.title}
                          onChange={(event) =>
                            updateImportDecision(file.path, { title: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Alternative titles
                        <input
                          value={decision.alternateTitles}
                          onChange={(event) =>
                            updateImportDecision(file.path, {
                              alternateTitles: event.target.value,
                            })
                          }
                          placeholder="Optional, comma or newline separated"
                        />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
                {file.duplicate && (
                  <span className="import-duplicate-badge" title={`Matches “${file.duplicate.title}”`}>
                    duplicate
                  </span>
                )}
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
              Imported {importReport.imported}, updated {importReport.updated}, replaced{" "}
              {importReport.replaced}, duplicated {importReport.duplicated}
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
