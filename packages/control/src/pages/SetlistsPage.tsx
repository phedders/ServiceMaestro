import { useEffect, useState } from "react";
import type { LiveState, SetlistDetail, SetlistItem, SetlistSummary, Song } from "@wlm/shared";
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
  const [notes, setNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setKeyOverride(item.keyOverride ?? "");
    setTranspose(item.transpose);
    setMaxLines(item.maxLines);
    setNotes(item.notes ?? "");
  }, [item]);

  async function save() {
    setSaving(true);
    try {
      await onSave({
        keyOverride: keyOverride || null,
        transpose: Number(transpose) || 0,
        maxLines: Number(maxLines) || 4,
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
  onStarted,
  notify,
}: {
  onStarted: (state: LiveState) => void;
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [setlists, setSetlists] = useState<SetlistSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SetlistDetail | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
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
      </aside>

      {detail ? (
        <section className="panel editor-panel">
          <div className="panel-heading">
            <h2>{detail.name}</h2>
            <button className="button primary" onClick={start}>
              Start live
            </button>
          </div>

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
                placeholder="Liturgy, notices, prayer…"
              />
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
