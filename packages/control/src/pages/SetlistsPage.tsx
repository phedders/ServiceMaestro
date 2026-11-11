import { useEffect, useState } from "react";
import type {
  LiveState,
  SetlistDetail,
  SetlistImportPreview,
  SetlistImportReport,
  SetlistItem,
  SetlistRevisionInfo,
  SetlistSummary,
  Song,
  TextFormat,
} from "@wlm/shared";
import { api, ApiError } from "../api";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function previewLines(item: SetlistItem, song: Song | undefined): string {
  let raw = item.kind === "song" ? (item.content ?? song?.lyrics ?? "") : (item.content ?? "");
  if (!raw.trim()) return "";
  raw = raw.replace(/\r/g, "");
  if (item.kind === "text") {
    raw = raw
      .replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "")
      .replace(/^\s*(?:type|format|mode)\s*:\s*(?:html|htm|markdown|md|rst|text|plain)\s*\n/i, "")
      .replace(/<[^>]+>/g, " ");
  }
  raw = raw.replace(/<!--[\s\S]*?-->/g, "");
  const lines = raw
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 6);
  const text = lines.join("\n");
  return text.length > 360 ? `${text.slice(0, 360)}…` : text;
}

function extractTextHeader(content: string): { format: TextFormat | null; content: string } {
  const firstLine = content.match(
    /^\s*(?:type|format|mode)\s*:\s*(html|htm|markdown|md|rst|restructuredtext|restructured|text|plain)\s*(?:\n|$)/i,
  );
  if (firstLine) {
    const raw = firstLine[1].toLowerCase();
    const format: TextFormat =
      raw === "html" || raw === "htm"
        ? "html"
        : raw === "markdown" || raw === "md"
          ? "markdown"
          : raw === "rst" || raw.startsWith("restructured")
            ? "rst"
            : "text";
    return { format, content: content.slice(firstLine[0].length) };
  }
  return { format: null, content };
}

function initialTextState(item: SetlistItem): { format: TextFormat; content: string } {
  if (item.kind !== "text") return { format: "text", content: item.content ?? "" };
  if (item.format) return { format: item.format, content: item.content ?? "" };
  const extracted = extractTextHeader(item.content ?? "");
  return {
    format: extracted.format ?? "markdown",
    content: extracted.format ? extracted.content : (item.content ?? ""),
  };
}

function ItemRow({
  item,
  song,
  first,
  last,
  dragging,
  dragOver,
  onMove,
  onDelete,
  onSave,
  onSaveInventory,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  notify,
}: {
  item: SetlistItem;
  song: Song | undefined;
  first: boolean;
  last: boolean;
  dragging: boolean;
  dragOver: boolean;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onSaveInventory: (payload: Record<string, unknown>) => Promise<void>;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const initial = initialTextState(item);
  const [content, setContent] = useState(
    item.kind === "song" ? item.content ?? song?.lyrics ?? "" : initial.content,
  );
  const [format, setFormat] = useState<TextFormat>(initial.format);
  const [keyOverride, setKeyOverride] = useState(item.keyOverride ?? "");
  const [transpose, setTranspose] = useState(item.transpose);
  const [verseOrder, setVerseOrder] = useState(item.verseOrder ?? "");
  const [verseOrderId, setVerseOrderId] = useState(
    song?.verseOrders.find((entry) => entry.order === item.verseOrder)?.id ?? "",
  );
  const [notes, setNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = initialTextState(item);
    setTitle(item.title);
    setFormat(next.format);
    setContent(item.kind === "song" ? item.content ?? song?.lyrics ?? "" : next.content);
    setKeyOverride(item.keyOverride ?? "");
    setTranspose(item.transpose);
    setVerseOrder(item.verseOrder ?? "");
    setVerseOrderId(
      song?.verseOrders.find((entry) => entry.order === item.verseOrder)?.id ?? "",
    );
    setNotes(item.notes ?? "");
  }, [item, song]);

  const displayTitle = item.title || song?.title || "Untitled";
  const localSongEdit =
    item.kind === "song" && (item.content != null || (song != null && item.title !== song.title));
  const preview = previewLines(item, song);

  function resetDraft() {
    const next = initialTextState(item);
    setTitle(item.title);
    setFormat(next.format);
    setContent(item.kind === "song" ? item.content ?? song?.lyrics ?? "" : next.content);
    setKeyOverride(item.keyOverride ?? "");
    setTranspose(item.transpose);
    setVerseOrder(item.verseOrder ?? "");
    setVerseOrderId(
      song?.verseOrders.find((entry) => entry.order === item.verseOrder)?.id ?? "",
    );
    setNotes(item.notes ?? "");
  }

  function closeEditor() {
    resetDraft();
    setEditing(false);
  }

  function toggleEditor() {
    if (editing) {
      resetDraft();
      setEditing(false);
    } else {
      setEditing(true);
    }
  }

  function payload(): Record<string, unknown> {
    const nextContent = content;
    return {
      title: title.trim() || (item.kind === "song" ? song?.title ?? displayTitle : "Text"),
      // Songs follow the inventory unless the lyrics were actually changed.
      content:
        item.kind === "song"
          ? song
            ? nextContent === song.lyrics
              ? null
              : nextContent
            : nextContent || null
          : nextContent,
      keyOverride: keyOverride || null,
      transpose: Number(transpose) || 0,
      verseOrder: verseOrder || null,
      notes: notes || null,
      ...(item.kind === "text" ? { format } : {}),
    };
  }

  async function saveLocal() {
    setSaving(true);
    try {
      await onSave(payload());
      setEditing(false);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save item", "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveInventory() {
    setSaving(true);
    try {
      await onSaveInventory(payload());
      setEditing(false);
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Could not save changes to the song library",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`setlist-item ${dragging ? "dragging" : ""} ${dragOver ? "drag-over" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      <div className="setlist-item-main">
        <span
          className="drag-handle"
          draggable
          title="Drag to reorder"
          aria-label="Drag to reorder"
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", item.id);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
        >
          ⠿
        </span>
        <span className={`item-icon ${item.kind}`}>{item.kind === "song" ? "♫" : "T"}</span>
        <button
          type="button"
          className="setlist-item-summary"
          onClick={toggleEditor}
          title={editing ? "Close editor" : "Click to edit"}
        >
          <span className="setlist-item-title-row">
            <strong>{displayTitle}</strong>
            {localSongEdit && <span className="local-badge">Local edit</span>}
          </span>
          <span className="muted">
            {item.kind === "song" ? "Song" : "Text"}
            {item.notes ? ` · ${item.notes}` : ""}
          </span>
          {!editing && preview && <span className="setlist-item-preview">{preview}</span>}
        </button>
        <div className="setlist-item-actions">
          <button className="button ghost small" disabled={first} onClick={() => onMove(-1)}>
            ↑
          </button>
          <button className="button ghost small" disabled={last} onClick={() => onMove(1)}>
            ↓
          </button>
          <button className="button ghost small" onClick={toggleEditor}>
            {editing ? "Done" : "Edit"}
          </button>
          <button className="button ghost small danger-text" onClick={onDelete}>
            Remove
          </button>
        </div>
      </div>

      {editing && (
        <div className="setlist-item-edit">
          <div className="setlist-item-edit-heading">
            <strong>{item.kind === "song" ? "Edit song for this set list" : "Edit text"}</strong>
            {item.kind === "song" && (
              <span className="muted">
                Changes stay in this set list unless you choose “Save to song library”.
              </span>
            )}
          </div>
          <label>
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          {item.kind === "text" && (
            <label>
              Text format
              <select
                value={format}
                onChange={(event) => setFormat(event.target.value as TextFormat)}
              >
                <option value="markdown">Markdown (default)</option>
                <option value="text">Plain text</option>
                <option value="html">HTML</option>
                <option value="rst">reStructuredText</option>
              </select>
            </label>
          )}
          <label>
            {item.kind === "song" ? "Lyrics" : "Text"}
            <textarea
              className="setlist-item-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={item.kind === "song" ? 12 : 8}
              placeholder={item.kind === "song" ? "Song lyrics and chords…" : "Text or rich text…"}
            />
          </label>
          <div className="setlist-item-settings">
            <label>
              Key
              <input
                value={keyOverride}
                placeholder="auto"
                onChange={(event) => setKeyOverride(event.target.value)}
              />
            </label>
            <label>
              Transpose
              <input
                type="number"
                min={-24}
                max={24}
                value={transpose}
                onChange={(event) => setTranspose(Number(event.target.value))}
              />
            </label>
            {item.kind === "song" && (song?.verseOrders.length ?? 0) > 0 && (
              <label>
                Saved verse order
                <select
                  value={verseOrderId}
                  onChange={(event) => {
                    setVerseOrderId(event.target.value);
                    const chosen = song?.verseOrders.find((entry) => entry.id === event.target.value);
                    setVerseOrder(chosen ? chosen.order : "");
                  }}
                >
                  <option value="">Song default</option>
                  {song?.verseOrders.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} — {entry.order}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Verse order
              <input
                value={verseOrder}
                onChange={(event) => {
                  setVerseOrder(event.target.value);
                  setVerseOrderId("");
                }}
                placeholder="auto"
              />
            </label>
            <label className="grow">
              Notes
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>
          <div className="setlist-item-edit-actions">
            <button className="button ghost" onClick={closeEditor}>
              Cancel
            </button>
            <button className="button" onClick={saveLocal} disabled={saving}>
              {saving ? "Saving…" : "Save local"}
            </button>
            {item.kind === "song" && item.songId && (
              <button className="button primary" onClick={saveInventory} disabled={saving}>
                {saving ? "Saving…" : "Save to song library"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SetlistsPage({
  live,
  onStarted,
  notify,
}: {
  live: LiveState;
  onStarted: (state: LiveState) => void;
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [setlists, setSetlists] = useState<SetlistSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SetlistDetail | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [revisions, setRevisions] = useState<SetlistRevisionInfo[]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<SetlistImportPreview | null>(null);
  const [importReport, setImportReport] = useState<SetlistImportReport | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState(today());
  const [newTime, setNewTime] = useState("");

  const [name, setName] = useState("");
  const [serviceDate, setServiceDate] = useState(today());
  const [serviceTime, setServiceTime] = useState("");
  const [notes, setNotes] = useState("");

  const [songToAdd, setSongToAdd] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [textFormat, setTextFormat] = useState<TextFormat>("markdown");

  async function loadList(select?: string) {
    const result = await api.setlists();
    setSetlists(result.setlists);
    const next = select ?? selectedId ?? result.setlists[0]?.id ?? null;
    setSelectedId(next);
    if (next) await loadDetail(next);
    else setDetail(null);
    setLoading(false);
  }

  async function loadDetail(id: string) {
    const result = await api.setlist(id);
    setDetail(result.setlist);
    setName(result.setlist.name);
    setServiceDate(result.setlist.serviceDate);
    setServiceTime(result.setlist.serviceTime ?? "");
    setNotes(result.setlist.notes ?? "");
    api
      .revisions(id)
      .then((revisionResult) => setRevisions(revisionResult.revisions))
      .catch(() => setRevisions([]));
  }

  useEffect(() => {
    loadList().catch((error) => {
      notify(error instanceof ApiError ? error.message : "Could not load set lists", "error");
      setLoading(false);
    });
    api.songs().then((result) => setSongs(result.songs)).catch(() => undefined);
  }, []);

  async function createSetlist() {
    try {
      const result = await api.createSetlist({
        name: newName.trim() || "New service",
        serviceDate: newDate,
        serviceTime: newTime || undefined,
      });
      setNewName("");
      await loadList(result.setlist.id);
      notify("Set list created");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not create set list", "error");
    }
  }

  async function saveMeta() {
    if (!detail) return;
    try {
      const result = await api.updateSetlist(detail.id, {
        name,
        serviceDate,
        serviceTime: serviceTime || null,
        notes: notes || null,
      });
      setDetail(result.setlist);
      await loadList(detail.id);
      notify("Set list saved");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save set list", "error");
    }
  }

  async function addSong() {
    if (!detail || !songToAdd) return;
    try {
      const result = await api.addItem(detail.id, { kind: "song", songId: songToAdd });
      setDetail(result.setlist);
      setSongToAdd("");
      await loadList(detail.id);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not add song", "error");
    }
  }

  async function addText() {
    if (!detail || !textContent.trim()) return;
    const extracted = extractTextHeader(textContent);
    try {
      const result = await api.addItem(detail.id, {
        kind: "text",
        title: textTitle.trim() || "Text",
        content: extracted.content,
        format: extracted.format ?? textFormat,
      });
      setDetail(result.setlist);
      setTextTitle("");
      setTextContent("");
      setTextFormat("markdown");
      await loadList(detail.id);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not add text", "error");
    }
  }

  async function move(item: SetlistItem, direction: -1 | 1) {
    if (!detail) return;
    const items = [...detail.items];
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    try {
      const result = await api.reorder(
        detail.id,
        items.map((candidate) => candidate.id),
      );
      setDetail(result.setlist);
      await loadList(detail.id);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not reorder", "error");
    }
  }

  async function dropItem(targetId: string) {
    const sourceId = dragId;
    setDragId(null);
    setDragOverId(null);
    if (!detail || !sourceId || sourceId === targetId) return;
    const items = [...detail.items];
    const from = items.findIndex((candidate) => candidate.id === sourceId);
    const to = items.findIndex((candidate) => candidate.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    try {
      const result = await api.reorder(
        detail.id,
        items.map((candidate) => candidate.id),
      );
      setDetail(result.setlist);
      await loadList(detail.id);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not reorder", "error");
    }
  }

  async function start() {
    if (!detail) return;
    try {
      const result = await api.startLive(detail.id, "live");
      onStarted(result.state);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not start session", "error");
    }
  }

  async function publish() {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await api.publish(detail.id);
      setRevisions((current) => [result.revision, ...current]);
      notify(`Published revision ${result.revision.revisionNo}`);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not publish", "error");
    } finally {
      setBusy(false);
    }
  }

  async function chooseImport(file: File | null) {
    setImportFile(file);
    setImportReport(null);
    setImportPreview(null);
    if (!file) return;
    setImporting(true);
    try {
      const result = await api.previewSetlistImport(file);
      setImportPreview(result.preview);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not read set list file", "error");
      setImportFile(null);
    } finally {
      setImporting(false);
    }
  }

  async function confirmImport() {
    if (!importFile) return;
    setImporting(true);
    try {
      const result = await api.importSetlist(importFile);
      setImportReport(result.report);
      setImportPreview(null);
      setImportFile(null);
      await loadList(result.report.setlistId);
      notify(`Imported “${result.report.setlistName}”`);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Import failed", "error");
    } finally {
      setImporting(false);
    }
  }

  async function apply(mode: "after-current" | "now") {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await api.applyLive({ setlistId: detail.id, mode });
      onStarted(result.state);
      const revs = await api.revisions(detail.id);
      setRevisions(revs.revisions);
      notify(
        mode === "now"
          ? "Draft applied immediately"
          : "Update queued — applies after the current item",
      );
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not apply draft", "error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="panel">Loading set lists…</div>;

  return (
    <div className="two-column">
      <aside className="panel list-panel">
        <div className="panel-heading">
          <h2>Set lists</h2>
          <span className="muted">{setlists.length}</span>
        </div>
        <div className="setlist-list">
          {setlists.map((setlist) => (
            <button
              key={setlist.id}
              className={`setlist-list-item ${setlist.id === selectedId ? "current" : ""}`}
              onClick={() => {
                setSelectedId(setlist.id);
                loadDetail(setlist.id).catch(() => undefined);
              }}
            >
              <strong>{setlist.name}</strong>
              <span>
                {setlist.serviceDate}
                {setlist.serviceTime ? ` · ${setlist.serviceTime}` : ""} · {setlist.itemCount} items
              </span>
            </button>
          ))}
          {!setlists.length && <p className="muted">No set lists yet.</p>}
        </div>
        <div className="new-setlist">
          <h3>New set list</h3>
          <label>
            Name
            <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Sunday AM" />
          </label>
          <div className="inline-fields">
            <label>
              Date
              <input type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} />
            </label>
            <label>
              Time
              <input type="time" value={newTime} onChange={(event) => setNewTime(event.target.value)} />
            </label>
          </div>
          <button className="button primary full" onClick={createSetlist}>
            Create
          </button>
        </div>

        <div className="transfer-panel">
          <h3>Share / backup</h3>
          {detail && (
            <div className="button-row">
              <a className="button ghost small" href={api.exportSetlistUrl(detail.id, "json")}>
                Export JSON
              </a>
              <a className="button ghost small" href={api.exportSetlistUrl(detail.id, "bundle")}>
                Export bundle
              </a>
            </div>
          )}
          <label className="button ghost full file-button">
            {importing ? "Reading…" : "Import set list file"}
            <input
              type="file"
              accept=".json,.zip,.wlm-setlist.json,.wlm-bundle.zip"
              hidden
              onChange={(event) => chooseImport(event.target.files?.[0] ?? null)}
            />
          </label>

          {importPreview && (
            <div className="import-preview-card">
              <strong>{importPreview.name}</strong>
              <span className="muted">
                {importPreview.serviceDate}
                {importPreview.serviceTime ? ` · ${importPreview.serviceTime}` : ""} · {importPreview.itemCount}{" "}
                items
              </span>
              <span className="muted">
                {importPreview.songCount} songs ({importPreview.songs.filter((song) => song.matched).length}{" "}
                matched), {importPreview.textCount} text
              </span>
              {!importPreview.selfContained && (
                <span className="hint">Reference file — unmatched songs import as text placeholders.</span>
              )}
              <div className="button-row">
                <button className="button ghost small" onClick={() => chooseImport(null)}>
                  Cancel
                </button>
                <button className="button primary small" onClick={confirmImport} disabled={importing}>
                  Import as new draft
                </button>
              </div>
            </div>
          )}

          {importReport && (
            <div className="import-preview-card">
              <strong>Imported “{importReport.setlistName}”</strong>
              <span className="muted">
                {importReport.importedItems} items · {importReport.songsMatched} matched ·{" "}
                {importReport.songsCreated} new songs · {importReport.assetsImported} assets
              </span>
              {importReport.skipped.length > 0 && (
                <details>
                  <summary>{importReport.skipped.length} skipped</summary>
                  <ul>
                    {importReport.skipped.map((item, index) => (
                      <li key={`${item.title}-${index}`}>
                        {item.title} — {item.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      </aside>

      {detail ? (
        <section className="panel editor-panel">
          <div className="panel-heading">
            <h2>{detail.name}</h2>
            <div className="button-row">
              <button className="button ghost" onClick={publish} disabled={busy}>
                Publish
              </button>
              {live.status !== "idle" && live.setlistId === detail.id ? (
                <>
                  <button className="button primary" onClick={() => apply("now")} disabled={busy}>
                    Send to live session
                  </button>
                  <button className="button ghost" onClick={() => apply("after-current")} disabled={busy}>
                    Queue after current
                  </button>
                </>
              ) : (
                <button className="button primary" onClick={start}>
                  Start live
                </button>
              )}
            </div>
          </div>

          {live.pendingUpdate && live.setlistId === detail.id && (
            <div className="banner">
              A published update is queued (revision {live.pendingRevision ?? "?"}); it will apply after the
              current item.
            </div>
          )}

          {revisions.length > 0 && (
            <details className="revision-list">
              <summary>{revisions.length} published revisions</summary>
              <ul>
                {revisions.map((revision) => (
                  <li key={revision.id}>
                    Revision {revision.revisionNo} · {revision.itemCount} items ·{" "}
                    {new Date(revision.createdAt).toLocaleString()}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="meta-grid">
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Date
              <input type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} />
            </label>
            <label>
              Time
              <input type="time" value={serviceTime} onChange={(event) => setServiceTime(event.target.value)} />
            </label>
            <label className="grow">
              Notes
              <input value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
            <button className="button ghost" onClick={saveMeta}>
              Save details
            </button>
          </div>

          <div className="items">
            {detail.items.map((item, index) => (
              <ItemRow
                key={item.id}
                item={item}
                song={songs.find((song) => song.id === item.songId)}
                first={index === 0}
                last={index === detail.items.length - 1}
                dragging={dragId === item.id}
                dragOver={dragOverId === item.id && dragId !== item.id}
                onDragStart={() => setDragId(item.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setDragOverId(null);
                }}
                onDragOver={() => setDragOverId(item.id)}
                onDrop={() => dropItem(item.id)}
                onMove={(direction) => move(item, direction)}
                onDelete={async () => {
                  try {
                    const result = await api.deleteItem(detail.id, item.id);
                    setDetail(result.setlist);
                    await loadList(detail.id);
                  } catch (error) {
                    notify(error instanceof ApiError ? error.message : "Could not remove item", "error");
                  }
                }}
                onSave={async (payload) => {
                  const result = await api.patchItem(detail.id, item.id, payload);
                  setDetail(result.setlist);
                  await loadList(detail.id);
                  notify("Saved to this set list");
                }}
                onSaveInventory={async (payload) => {
                  const result = await api.saveItemToInventory(detail.id, item.id, payload);
                  setDetail(result.setlist);
                  await loadList(detail.id);
                  api
                    .songs()
                    .then((songResult) => setSongs(songResult.songs))
                    .catch(() => undefined);
                  notify("Song library updated");
                }}
                notify={notify}
              />
            ))}
            {!detail.items.length && <p className="muted">Add a song or text item below.</p>}
          </div>

          <div className="add-grid">
            <div className="add-card">
              <h3>Add song</h3>
              <select value={songToAdd} onChange={(event) => setSongToAdd(event.target.value)}>
                <option value="">Choose a song…</option>
                {songs.map((song) => (
                  <option key={song.id} value={song.id}>
                    {song.title}
                    {song.author ? ` — ${song.author}` : ""}
                  </option>
                ))}
              </select>
              <button className="button" onClick={addSong} disabled={!songToAdd}>
                Add to set list
              </button>
            </div>
            <div className="add-card">
              <h3>Add text</h3>
              <input
                value={textTitle}
                onChange={(event) => setTextTitle(event.target.value)}
                placeholder="Title (optional)"
              />
              <select
                value={textFormat}
                onChange={(event) => setTextFormat(event.target.value as TextFormat)}
              >
                <option value="markdown">Markdown (default)</option>
                <option value="text">Plain text</option>
                <option value="html">HTML</option>
                <option value="rst">reStructuredText</option>
              </select>
              <textarea
                value={textContent}
                onChange={(event) => setTextContent(event.target.value)}
                rows={4}
                placeholder={"# Welcome\n\n**Please stand** as we begin."}
              />
              <span className="hint">
                A leading <code>format: markdown</code> header is moved into the format setting
                automatically. Use <code>&lt;!-- page --&gt;</code> for a page break.
              </span>
              <button className="button" onClick={addText} disabled={!textContent.trim()}>
                Add to set list
              </button>
            </div>
          </div>

          <button
            className="button danger-text"
            onClick={async () => {
              if (!confirm(`Delete “${detail.name}”?`)) return;
              await api.deleteSetlist(detail.id);
              setDetail(null);
              setSelectedId(null);
              const result = await api.setlists();
              setSetlists(result.setlists);
              if (result.setlists[0]) {
                setSelectedId(result.setlists[0].id);
                await loadDetail(result.setlists[0].id);
              }
            }}
          >
            Delete set list
          </button>
        </section>
      ) : (
        <section className="panel empty-state">Create a set list to get started.</section>
      )}
    </div>
  );
}
