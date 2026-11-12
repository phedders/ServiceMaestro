import { useEffect, useState } from "react";
import {
  songHasChords,
  songLinesDifferingApartFromSplits,
  songLyricsWithoutChords,
  type SongDuplicateCandidate,
  type SongDuplicateGroup,
} from "@sm/shared";
import { api, ApiError } from "../api";
import { usePageAccess } from "../page-access";
import { DiffIcon, EyeIcon } from "../components/Icons";
import { SongEditDialog } from "../components/SongEditDialog";
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
  const diffWithoutChords = diffLyrics(
    songLyricsWithoutChords(reference.lyrics),
    songLyricsWithoutChords(candidate.lyrics),
  );
  const changedLinesWithoutChords = diffWithoutChords.filter(
    (line) => line.type !== "same",
  ).length;
  const changedLinesApartFromSplits = songLinesDifferingApartFromSplits(
    reference.lyrics,
    candidate.lyrics,
  );
  return {
    metadata,
    changedFields,
    changedLines,
    changedLinesWithoutChords,
    changedLinesApartFromSplits,
    diff,
    diffWithoutChords,
    referenceHasChords: songHasChords(reference.lyrics),
    candidateHasChords: songHasChords(candidate.lyrics),
  };
}

function DifferenceSummary({
  changedFields,
  changedLines,
  changedLinesWithoutChords,
  changedLinesApartFromSplits,
  onShowDiff,
}: {
  changedFields: string[];
  changedLines: number;
  changedLinesWithoutChords: number;
  changedLinesApartFromSplits: number;
  onShowDiff?: () => void;
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
        onShowDiff ? (
          <button
            type="button"
            className="dedupe-diff-chip lyrics dedupe-diff-chip-button"
            onClick={onShowDiff}
            title="Open the lyric difference"
          >
            {changedLines} lyric line{changedLines === 1 ? " differs" : "s differ"}
          </button>
        ) : (
          <span className="dedupe-diff-chip lyrics">
            {changedLines} lyric line{changedLines === 1 ? " differs" : "s differ"}
          </span>
        )
      ) : (
        <span className="dedupe-same">Lyrics identical</span>
      )}
      <span
        className={`dedupe-diff-chip chordless ${changedLinesWithoutChords === 0 ? "same" : ""}`}
        title="Line count after ignoring chord symbols and section labels"
      >
        {changedLinesWithoutChords} line
        {changedLinesWithoutChords === 1 ? " differs" : "s differ"} without chords
      </span>
      <span
        className={`dedupe-diff-chip splits ${changedLinesApartFromSplits === 0 ? "same" : ""}`}
        title="Word-level estimate ignoring chord symbols, section labels, word splits and line breaks"
      >
        {changedLinesApartFromSplits} line
        {changedLinesApartFromSplits === 1 ? " differs" : "s differ"} apart from word/line
        splits
      </span>
    </span>
  );
}

function DuplicateDiffDialog({
  reference,
  candidate,
  candidatePreferred,
  busy,
  onPrefer,
  onMarkDifferent,
  onEditReference,
  onEditCandidate,
  onClose,
}: {
  reference: SongDuplicateCandidate;
  candidate: SongDuplicateCandidate;
  candidatePreferred: boolean;
  busy: boolean;
  onPrefer: () => void;
  onMarkDifferent: () => void;
  onEditReference: () => void;
  onEditCandidate: () => void;
  onClose: () => void;
}) {
  const { canWrite } = usePageAccess();
  const [withoutChords, setWithoutChords] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const {
    metadata,
    changedFields,
    changedLines,
    changedLinesWithoutChords,
    changedLinesApartFromSplits,
    diff,
    diffWithoutChords,
    referenceHasChords,
    candidateHasChords,
  } = compareSongs(reference, candidate);
  const displayedDiff = withoutChords ? diffWithoutChords : diff;
  const displayedChangedLines = withoutChords ? changedLinesWithoutChords : changedLines;

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
              {reference.title}
              {referenceHasChords ? " · chords" : ""} · compared with {candidate.title}
              {candidateHasChords ? " · chords" : ""}
            </p>
          </div>
          <div className="button-row">
            <button
              type="button"
              className={`button small ${candidatePreferred ? "ghost" : "primary"}`}
              onClick={onPrefer}
              disabled={!canWrite || candidatePreferred || busy}
              title={
                !canWrite
                  ? "Read-only access to songs"
                  : candidatePreferred
                    ? "This version already has the higher priority"
                    : `Make “${candidate.title}” the higher priority version`
              }
            >
              {candidatePreferred ? "Preferred" : "Higher priority"}
            </button>
            <button
              type="button"
              className="button ghost small"
              onClick={onMarkDifferent}
              disabled={!canWrite || busy}
              title={
                canWrite
                  ? "Mark these two versions as different songs so they stop appearing as duplicates"
                  : "Read-only access to songs"
              }
            >
              Mark as Different
            </button>
            <button
              type="button"
              className={`button small ${withoutChords ? "primary" : "ghost"}`}
              onClick={() => setWithoutChords((current) => !current)}
              title={
                withoutChords
                  ? "Show the lyrics exactly as stored, including chord symbols"
                  : "Hide chord symbols and section labels in the lyric comparison"
              }
            >
              {withoutChords ? "Show diff with chords" : "Show diff without chords"}
            </button>
            <button className="button ghost small" onClick={onClose} title="Close the comparison">
              Close
            </button>
          </div>
        </div>
        <DifferenceSummary
          changedFields={changedFields}
          changedLines={changedLines}
          changedLinesWithoutChords={changedLinesWithoutChords}
          changedLinesApartFromSplits={changedLinesApartFromSplits}
        />
        <p className="hint dedupe-diff-mode-note">
          {withoutChords
            ? "Chord symbols and section labels are hidden in this lyric comparison."
            : "Showing lyrics exactly as stored. Use the button above to ignore chords."}
        </p>
        <div className="alt-diff">
          <table className="alt-diff-meta">
            <thead>
              <tr>
                <th></th>
                <th>
                  <span className="dedupe-diff-heading">
                    <span>Reference</span>
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={onEditReference}
                      disabled={!canWrite || busy}
                      title={
                        canWrite ? `Edit “${reference.title}”` : "Read-only access to songs"
                      }
                    >
                      Edit
                    </button>
                  </span>
                </th>
                <th>
                  <span className="dedupe-diff-heading">
                    <span>Compared version</span>
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={onEditCandidate}
                      disabled={!canWrite || busy}
                      title={
                        canWrite ? `Edit “${candidate.title}”` : "Read-only access to songs"
                      }
                    >
                      Edit
                    </button>
                  </span>
                </th>
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
          {displayedChangedLines === 0 ? (
            <p className="muted">
              {withoutChords ? "Lyrics are identical without chords." : "Lyrics are identical."}
            </p>
          ) : (
            <div className="alt-diff-lines">
              <div className="alt-diff-summary">
                {displayedChangedLines} changed or reordered lyric{" "}
                {displayedChangedLines === 1 ? "line" : "lines"}
                {withoutChords ? " without chords" : ""}
              </div>
              {displayedDiff.map((line, index) => (
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
  const { canWrite } = usePageAccess();
  const [groups, setGroups] = useState<SongDuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<{
    id: string;
    action: "prefer" | "delete" | "different";
  } | null>(null);
  const [lyricsSong, setLyricsSong] = useState<SongDuplicateCandidate | null>(null);
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<{
    group: SongDuplicateGroup;
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

  async function prefer(group: SongDuplicateGroup, song: SongDuplicateCandidate): Promise<boolean> {
    if (!canWrite) return false;
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
      return true;
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not set the preferred version", "error");
      return false;
    } finally {
      setWorking(null);
    }
  }

  async function markDifferent(
    first: SongDuplicateCandidate,
    second: SongDuplicateCandidate,
  ): Promise<boolean> {
    if (
      !canWrite ||
      !window.confirm(
        `Mark “${first.title}” and “${second.title}” as different songs? They will stop appearing as duplicates.`,
      )
    ) {
      return false;
    }
    setWorking({ id: second.id, action: "different" });
    try {
      await api.markSongsDifferent(first.id, second.id);
      notify(`Marked “${first.title}” and “${second.title}” as different songs`);
      await loadDuplicates();
      return true;
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not mark the songs as different", "error");
      return false;
    } finally {
      setWorking(null);
    }
  }

  async function remove(song: SongDuplicateCandidate) {
    if (
      !canWrite ||
      !window.confirm(`Delete “${song.title}”? This removes the song from the library.`)
    ) {
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

  async function preferFromDialog() {
    if (!comparison) return;
    if (await prefer(comparison.group, comparison.candidate)) setComparison(null);
  }

  async function markDifferentFromDialog() {
    if (!comparison) return;
    if (await markDifferent(comparison.reference, comparison.candidate)) setComparison(null);
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
                    const markingDifferent =
                      working?.id === song.id && working.action === "different";
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
                            {songHasChords(song.lyrics) && (
                              <span
                                className="badge chords"
                                title="This version contains embedded chord symbols"
                              >
                                Chords
                              </span>
                            )}
                          </div>
                          <span className="muted">{songMeta(song) || "No song details"}</span>
                          {song.alternateTitles && (
                            <span className="alt-alias">Also known as: {song.alternateTitles}</span>
                          )}
                          {comparison ? (
                            <DifferenceSummary
                              changedFields={comparison.changedFields}
                              changedLines={comparison.changedLines}
                              changedLinesWithoutChords={comparison.changedLinesWithoutChords}
                              changedLinesApartFromSplits={
                                comparison.changedLinesApartFromSplits
                              }
                              onShowDiff={() =>
                                setComparison({ group, reference, candidate: song })
                              }
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
                              setComparison({ group, reference, candidate: song })
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
                            className="button ghost small"
                            onClick={() => setEditingSongId(song.id)}
                            disabled={!canWrite}
                            title={
                              canWrite
                                ? `Edit “${song.title}” metadata and lyrics`
                                : "Read-only access to songs"
                            }
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={`button small ${preferred ? "ghost" : "primary"}`}
                            onClick={() => void prefer(group, song)}
                            disabled={!canWrite || preferred || working !== null}
                            title={
                              !canWrite
                                ? "Read-only access to songs"
                                : preferred
                                ? "This version already has the higher priority"
                                : `Make “${song.title}” the higher priority version`
                            }
                          >
                            {preferred ? "Preferred" : savingPriority ? "Saving…" : "Higher priority"}
                          </button>
                          {song.id !== reference.id && (
                            <button
                              type="button"
                              className="button ghost small"
                              onClick={() => void markDifferent(reference, song)}
                              disabled={!canWrite || working !== null}
                              title={
                                canWrite
                                  ? "Mark these two versions as different songs so they stop appearing as duplicates"
                                  : "Read-only access to songs"
                              }
                            >
                              {markingDifferent ? "Saving…" : "Mark as Different"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="button danger small"
                            onClick={() => void remove(song)}
                            disabled={!canWrite || working !== null}
                            title={
                              canWrite
                                ? `Delete “${song.title}” from the song library`
                                : "Read-only access to songs"
                            }
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
          candidatePreferred={comparison.candidate.priority > 0}
          busy={working !== null}
          onPrefer={() => void preferFromDialog()}
          onMarkDifferent={() => void markDifferentFromDialog()}
          onEditReference={() => {
            setComparison(null);
            setEditingSongId(comparison.reference.id);
          }}
          onEditCandidate={() => {
            setComparison(null);
            setEditingSongId(comparison.candidate.id);
          }}
          onClose={() => setComparison(null)}
        />
      )}
      {editingSongId && (
        <SongEditDialog
          songId={editingSongId}
          notify={notify}
          onClose={() => setEditingSongId(null)}
          onSaved={() => {
            setEditingSongId(null);
            void loadDuplicates();
          }}
        />
      )}
    </div>
  );
}
