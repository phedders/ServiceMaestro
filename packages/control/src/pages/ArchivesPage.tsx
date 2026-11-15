import { useEffect, useState } from "react";
import type { ArchivesData, PublicUser } from "@sm/shared";
import { api, ApiError } from "../api";
import { compactDate, compactDateTime } from "../service-date";

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export default function ArchivesPage({
  user,
  notify,
}: {
  user: PublicUser;
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [archives, setArchives] = useState<ArchivesData>({ songs: [], setlists: [] });
  const [selectedSongs, setSelectedSongs] = useState<Set<string>>(() => new Set());
  const [selectedSetlists, setSelectedSetlists] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"songs" | "setlists" | null>(null);

  const canSongs = user.role === "admin" || user.permissions.songs === true;
  const canSetlists = user.role === "admin" || user.permissions.setlists === true;

  async function load() {
    setLoading(true);
    try {
      const result = await api.archives();
      setArchives(result);
      setSelectedSongs((current) => {
        const ids = new Set(result.songs.map((song) => song.id));
        return new Set([...current].filter((id) => ids.has(id)));
      });
      setSelectedSetlists((current) => {
        const ids = new Set(result.setlists.map((setlist) => setlist.id));
        return new Set([...current].filter((id) => ids.has(id)));
      });
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not load archives", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function restore(kind: "songs" | "setlists") {
    const ids = kind === "songs" ? [...selectedSongs] : [...selectedSetlists];
    if (!ids.length) return;
    setBusy(kind);
    try {
      const result =
        kind === "songs"
          ? await api.restoreArchivedSongs(ids)
          : await api.restoreArchivedSetlists(ids);
      notify(
        `Restored ${result.restored} archived ${kind === "songs" ? "song" : "set list"}${
          result.restored === 1 ? "" : "s"
        }`,
      );
      if (kind === "songs") setSelectedSongs(new Set());
      else setSelectedSetlists(new Set());
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not restore archived items", "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove(kind: "songs" | "setlists") {
    const ids = kind === "songs" ? [...selectedSongs] : [...selectedSetlists];
    if (!ids.length) return;
    const label = kind === "songs" ? "song" : "set list";
    if (!confirm(`Permanently delete ${ids.length} archived ${label}${ids.length === 1 ? "" : "s"}?`)) {
      return;
    }
    setBusy(kind);
    try {
      const result =
        kind === "songs"
          ? await api.deleteArchivedSongs(ids)
          : await api.deleteArchivedSetlists(ids);
      notify(
        `Deleted ${result.deleted} archived ${label}${result.deleted === 1 ? "" : "s"}`,
      );
      if (kind === "songs") setSelectedSongs(new Set());
      else setSelectedSetlists(new Set());
      await load();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not delete archived items", "error");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="panel">Loading archives…</div>;

  return (
    <div className="archives-page">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Archived set lists</h2>
            <p className="muted">
              Archived set lists are hidden from planning, live-session and selection lists.
              Restoring returns them to those lists.
            </p>
          </div>
          <div className="button-row">
            <button
              className="button ghost small"
              onClick={() => void restore("setlists")}
              disabled={!canSetlists || !selectedSetlists.size || busy !== null}
              title="Restore the selected archived set lists"
            >
              Restore selected
            </button>
            <button
              className="button danger small"
              onClick={() => void remove("setlists")}
              disabled={!canSetlists || !selectedSetlists.size || busy !== null}
              title="Permanently delete the selected archived set lists"
            >
              Delete selected
            </button>
          </div>
        </div>
        {archives.setlists.length ? (
          <div className="archive-table-wrap">
            <table className="archive-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={
                        archives.setlists.length > 0 &&
                        selectedSetlists.size === archives.setlists.length
                      }
                      onChange={(event) =>
                        setSelectedSetlists(
                          event.target.checked
                            ? new Set(archives.setlists.map((setlist) => setlist.id))
                            : new Set(),
                        )
                      }
                      aria-label="Select all archived set lists"
                    />
                  </th>
                  <th>Set list</th>
                  <th>Service</th>
                  <th>Items</th>
                  <th>Archived</th>
                </tr>
              </thead>
              <tbody>
                {archives.setlists.map((setlist) => (
                  <tr key={setlist.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedSetlists.has(setlist.id)}
                        onChange={() =>
                          setSelectedSetlists((current) => toggle(current, setlist.id))
                        }
                        aria-label={`Select ${setlist.name}`}
                      />
                    </td>
                    <td>
                      <strong>{setlist.name}</strong>
                    </td>
                    <td>
                      {compactDate(setlist.serviceDate)}
                      {setlist.serviceTime ? ` · ${setlist.serviceTime}` : ""}
                    </td>
                    <td>{setlist.itemCount}</td>
                    <td>{compactDateTime(setlist.archivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No archived set lists.</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Archived songs</h2>
            <p className="muted">
              Archived songs stay available to existing set-list items and can be restored here.
            </p>
          </div>
          <div className="button-row">
            <button
              className="button ghost small"
              onClick={() => void restore("songs")}
              disabled={!canSongs || !selectedSongs.size || busy !== null}
              title="Restore the selected archived songs"
            >
              Restore selected
            </button>
            <button
              className="button danger small"
              onClick={() => void remove("songs")}
              disabled={!canSongs || !selectedSongs.size || busy !== null}
              title="Permanently delete the selected archived songs"
            >
              Delete selected
            </button>
          </div>
        </div>
        {archives.songs.length ? (
          <div className="archive-table-wrap">
            <table className="archive-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={
                        archives.songs.length > 0 && selectedSongs.size === archives.songs.length
                      }
                      onChange={(event) =>
                        setSelectedSongs(
                          event.target.checked
                            ? new Set(archives.songs.map((song) => song.id))
                            : new Set(),
                        )
                      }
                      aria-label="Select all archived songs"
                    />
                  </th>
                  <th>Song</th>
                  <th>Author</th>
                  <th>CCLI</th>
                  <th>Key</th>
                  <th>Archived</th>
                </tr>
              </thead>
              <tbody>
                {archives.songs.map((song) => (
                  <tr key={song.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedSongs.has(song.id)}
                        onChange={() => setSelectedSongs((current) => toggle(current, song.id))}
                        aria-label={`Select ${song.title}`}
                      />
                    </td>
                    <td>
                      <strong>{song.title}</strong>
                    </td>
                    <td>{song.author || "—"}</td>
                    <td>{song.ccli || "—"}</td>
                    <td>{song.key || "—"}</td>
                    <td>{compactDateTime(song.archivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No archived songs.</p>
        )}
      </section>

      {!canSongs && !canSetlists && (
        <p className="hint">You need write access to Songs or Set lists to restore or delete archived items.</p>
      )}
    </div>
  );
}
