import { useEffect, useState } from "react";
import type { SongDuplicateCandidate, SongDuplicateGroup } from "@sm/shared";
import { api, ApiError } from "../api";
import { DiffIcon, EyeIcon } from "../components/Icons";
import { SongLyricsDialog } from "../components/SongLyricsDialog";
import { diffLyrics } from "../song-diff";

function songMeta(song: SongDuplicateCandidate): string {
  return [song.author, song.ccli ? `CCLI ${song.ccli}` : "", song.key ? `Key ${song.key}` : ""]
    .filter(Boolean)
    .join(" · ");
}

const METADATA_FIELDS: Array<{
  label: string;
  value: (song: SongDuplicateCandidate) => string;
}> = [
  { label: "Title", value: (song) => song.title },
  { label: "Author", value: (song) => song.author ?? "" },
  { label: "CCLI", value: (song) => song.ccli ?? "" },
  { label: "Key", value: (song) => song.key ?? "" },
  { label: "Alternate titles", value: (song) => song.alternateTitles ?? "" },
];

function compareSongs(reference: SongDuplicateCandidate, candidate: SongDuplicateCandidate) {
  const metadata: Array<[string, string, string]> = METADATA_FIELDS.map((field) => [
    field.label,
    field.value(reference),
    field.value(candidate),
  ]);
  const changedFields = metadata
    .filter(([, current, next]) => current !== next)
    .map(([label]) => label);
  const diff = diffLyrics(reference.lyrics, candidate.lyrics);
  const changedLines = diff.filter((line) => line.type !== "same").length;
  return { metadata, changedFields, changedLines, diff };
}

function DifferenceSummary({
  changedFields,
  changedLines,
}: {
  changedFields: string[];
  changedLines: number;
}) {
  return (
    <span className="dedupe-diff-note">
      {changedFields.length ? (
        <>
          <span className="dedupe-diff-label">Metadata differs</span>
          {changedFields.map((field) => (
            <span className="dedupe-diff-chip" key={field}>
              {field}
            </span>
          ))}
        </>
      ) : (
        <span className="dedupe-same">Metadata identical</span>
      )}
      <span className="dedupe-diff-separator" aria-hidden="true">
        ·
      </span>
      {changedLines ? (
        <span className="dedupe-diff-chip lyrics">
          {changedLines} lyric line{changedLines === 1 ? " differs" : "s differ"}
        </span>
      ) : (
        <span className="dedupe-same">Lyrics identical</span>
      )}
    </span>
  );
}

function DuplicateDiffDialog({
  reference,
  candidate,
  onClose,
}: {
  reference: SongDuplicateCandidate;
  candidate: SongDuplicateCandidate;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const { metadata, changedFields, changedLines, diff } = compareSongs(reference, candidate);

  return (
    <div
      className="alt-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="alt-modal dedupe-diff-modal" role="dialog" aria-modal="true">
        <div className="alt-modal-heading">
          <div>
            <h3>Compare duplicate versions</h3>
            <p className="muted">
              {reference.title} · compared with {candidate.title}
            </p>
          </div>
          <button className="button ghost small" onClick={onClose} title="Close the comparison">
            Close
          </button>
        </div>
        <DifferenceSummary changedFields={changedFields} changedLines={changedLines} />
        <div className="alt-diff">
          <table className="alt-diff-meta">
            <thead>
              <tr>
                <th></th>
                <th>Reference</th>
                <th>Compared version</th>
              </tr>
            </thead>
            <tbody>
              {metadata.map(([label, current, next]) => (
                <tr key={label}>
                  <th>{label}</th>
                  <td className={current !== next ? "diff-changed" : ""}>{current || "—"}</td>
                  <td className={current !== next ? "diff-changed" : ""}>{next || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {changedLines === 0 ? (
            <p className="muted">Lyrics are identical.</p>
          ) : (
            <div className="alt-diff-lines">
              <div className="alt-diff-summary">
                {changedLines} changed or reordered lyric{" "}
                {changedLines === 1 ? "line" : "lines"}
              </div>
              {diff.map((line, index) => (
                <div
                  key={`${index}-${line.type}`}
                  className={`alt-diff-line ${line.type}`}
                >
                  <span className="alt-diff-marker" aria-hidden="true">
                    {line.type === "removed" ? "−" : line.type === "added" ? "+" : " "}
                  </span>
                  <span>{line.text || " "}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DeDupePage({
  notify,
}: {
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [groups, setGroups] = useState<SongDuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<{ id: string; action: "prefer" | "delete" } | null>(null);
  const [lyricsSong, setLyricsSong] = useState<SongDuplicateCandidate | null>(null);
  const [comparison, setComparison] = useState<{
    reference: SongDuplicateCandidate;
    candidate: SongDuplicateCandidate;
  } | null>(null);

  async function loadDuplicates() {
    setLoading(true);
    try {
      const result = await api.songDuplicates();
      setGroups(result.groups);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not scan for duplicates", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDuplicates();
  }, []);

  async function prefer(group: SongDuplicateGroup, song: SongDuplicateCandidate) {
    setWorking({ id: song.id, action: "prefer" });
    try {
      await api.setSongPriority(song.id, 1);
      await Promise.all(
        group.songs
          .filter((other) => other.id !== song.id && other.priority !== 0)
          .map((other) => api.setSongPriority(other.id, 0)),
      );
      notify(`“${song.title}” is now the preferred version`);
      await loadDuplicates();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not set the preferred version", "error");
    } finally {
      setWorking(null);
    }
  }

  async function remove(song: SongDuplicateCandidate) {
    if (!window.confirm(`Delete “${song.title}”? This removes the song from the library.`)) {
      return;
    }
    setWorking({ id: song.id, action: "delete" });
    try {
      await api.deleteSong(song.id);
      notify(`Deleted “${song.title}”`);
      await loadDuplicates();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not delete the song", "error");
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="dedupe-page">
      <section className="panel dedupe-panel">
        <div className="dedupe-heading">
          <div>
            <h2>Duplicate songs</h2>
            <p className="muted">
              Songs with matching titles, CCLI numbers or identical lyrics. Preview lyrics,
              inspect the differences, choose a preferred version or delete duplicates.
            </p>
          </div>
          <button
            className="button ghost"
            onClick={() => void loadDuplicates()}
            disabled={loading}
            title="Scan the song library again for duplicates"
          >
            {loading ? "Scanning…" : "Scan again"}
          </button>
        </div>

        {loading && !groups.length && <p className="muted">Scanning the song library…</p>}
        {!loading && !groups.length && (
          <div className="dedupe-empty">
            <strong>No duplicates found</strong>
            <p className="muted">
              The library has no songs with matching titles, CCLI numbers or identical lyrics.
            </p>
          </div>
        )}

        <div className="dedupe-groups">
          {groups.map((group) => {
            const reference = group.songs[0];
            return (
              <article className="dedupe-group" key={group.id}>
                <header className="dedupe-group-heading">
                  <div>
                    <h3>
                      {group.songs.length} possible duplicate{group.songs.length === 1 ? "" : "s"}
                    </h3>
                    <p className="dedupe-reasons">{group.reasons.join(" · ")}</p>
                  </div>
                </header>
                <div className="dedupe-songs">
                  {group.songs.map((song) => {
                    const preferred = song.priority > 0;
                    const savingPriority = working?.id === song.id && working.action === "prefer";
                    const deleting = working?.id === song.id && working.action === "delete";
                    const comparison =
                      song.id === reference.id ? null : compareSongs(reference, song);
                    return (
                      <div
                        className={`dedupe-song ${preferred ? "is-preferred" : ""}`}
                        key={song.id}
                      >
                        <div className="dedupe-song-main">
                          <div className="dedupe-song-title">
                            <strong>{song.title}</strong>
                            {preferred && <span className="badge preferred">Preferred</span>}
                          </div>
                          <span className="muted">{songMeta(song) || "No song details"}</span>
                          {song.alternateTitles && (
                            <span className="alt-alias">Also known as: {song.alternateTitles}</span>
                          )}
                          {comparison ? (
                            <DifferenceSummary
                              changedFields={comparison.changedFields}
                              changedLines={comparison.changedLines}
                            />
                          ) : (
                            <span className="dedupe-diff-note">
                              <span className="dedupe-diff-label">Reference version</span>
                              <span className="dedupe-same">used for comparisons</span>
                            </span>
                          )}
                        </div>
                        <div className="dedupe-song-actions">
                          <button
                            type="button"
                            className="button ghost small icon-button"
                            onClick={() => setLyricsSong(song)}
                            title={`Preview all lyrics for “${song.title}”`}
                            aria-label={`Preview lyrics for ${song.title}`}
                          >
                            <EyeIcon />
                          </button>
                          <button
                            type="button"
                            className="button ghost small icon-button"
                            onClick={() =>
                              setComparison({ reference, candidate: song })
                            }
                            disabled={song.id === reference.id}
                            title={
                              song.id === reference.id
                                ? "This is the reference version"
                                : `Compare “${song.title}” with “${reference.title}”`
                            }
                            aria-label={`Compare ${song.title} with ${reference.title}`}
                          >
                            <DiffIcon />
                          </button>
                          <button
                            type="button"
                            className={`button small ${preferred ? "ghost" : "primary"}`}
                            onClick={() => void prefer(group, song)}
                            disabled={preferred || working !== null}
                            title={
                              preferred
                                ? "This version already has the higher priority"
                                : `Make “${song.title}” the higher priority version`
                            }
                          >
                            {preferred ? "Preferred" : savingPriority ? "Saving…" : "Higher priority"}
                          </button>
                          <button
                            type="button"
                            className="button danger small"
                            onClick={() => void remove(song)}
                            disabled={working !== null}
                            title={`Delete “${song.title}” from the song library`}
                          >
                            {deleting ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <SongLyricsDialog song={lyricsSong} onClose={() => setLyricsSong(null)} />
      {comparison && (
        <DuplicateDiffDialog
          reference={comparison.reference}
          candidate={comparison.candidate}
          onClose={() => setComparison(null)}
        />
      )}
    </div>
  );
}
