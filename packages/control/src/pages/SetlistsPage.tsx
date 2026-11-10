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
} from "@wlm/shared";
import { api, ApiError } from "../api";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function ItemRow({
  item,
  first,
  last,
  onMove,
  onDelete,
  onSave,
}: {
  item: SetlistItem;
  first: boolean;
  last: boolean;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [keyOverride, setKeyOverride] = useState(item.keyOverride ?? "");
  const [transpose, setTranspose] = useState(item.transpose);
  const [maxLines, setMaxLines] = useState(item.maxLines);
  const [verseOrder, setVerseOrder] = useState(item.verseOrder ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setKeyOverride(item.keyOverride ?? "");
    setTranspose(item.transpose);
    setMaxLines(item.maxLines);
    setVerseOrder(item.verseOrder ?? "");
    setNotes(item.notes ?? "");
  }, [item]);

  async function save() {
    setSaving(true);
    try {
      await onSave({
        keyOverride: keyOverride || null,
        transpose: Number(transpose) || 0,
        maxLines: Number(maxLines) || 4,
        verseOrder: verseOrder || null,
        notes: notes || null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="setlist-item">
      <div className="setlist-item-main">
        <span className={`item-icon ${item.kind}`}>{item.kind === "song" ? "♫" : "T"}</span>
        <div className="setlist-item-title">
          <strong>{item.title}</strong>
          <span className="muted">{item.kind === "song" ? "Song" : "Text"}</span>
        </div>
        <div className="setlist-item-actions">
          <button className="button ghost small" disabled={first} onClick={() => onMove(-1)}>
            ↑
          </button>
          <button className="button ghost small" disabled={last} onClick={() => onMove(1)}>
            ↓
          </button>
          <button className="button ghost small danger-text" onClick={onDelete}>
            Remove
          </button>
        </div>
      </div>
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
        <label>
          Lines/page
          <input
            type="number"
            min={1}
            max={30}
            value={maxLines}
            onChange={(event) => setMaxLines(Number(event.target.value))}
          />
        </label>
        <label>
          Verse order
          <input
            value={verseOrder}
            onChange={(event) => setVerseOrder(event.target.value)}
            placeholder="auto"
          />
        </label>
        <label className="grow">
          Notes
          <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional" />
        </label>
        <button className="button ghost small" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
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
    try {
      const result = await api.addItem(detail.id, {
        kind: "text",
        title: textTitle.trim() || "Text",
        content: textContent,
      });
      setDetail(result.setlist);
      setTextTitle("");
      setTextContent("");
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
                  <button className="button ghost" onClick={() => apply("now")} disabled={busy}>
                    Apply now
                  </button>
                  <button className="button primary" onClick={() => apply("after-current")} disabled={busy}>
                    Apply draft
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
                first={index === 0}
                last={index === detail.items.length - 1}
                onMove={(direction) => move(item, direction)}
                onDelete={async () => {
                  const result = await api.deleteItem(detail.id, item.id);
                  setDetail(result.setlist);
                  await loadList(detail.id);
                }}
                onSave={async (payload) => {
                  const result = await api.patchItem(detail.id, item.id, payload);
                  setDetail(result.setlist);
                  await loadList(detail.id);
                }}
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
              <textarea
                value={textContent}
                onChange={(event) => setTextContent(event.target.value)}
                rows={4}
                placeholder={"type: markdown\n# Welcome\n\n**Please stand** as we begin."}
              />
              <span className="hint">
                First line can be <code>type: markdown</code>, <code>type: html</code> or{" "}
                <code>type: rst</code>. Use <code>&lt;!-- page --&gt;</code> for a page break.
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
