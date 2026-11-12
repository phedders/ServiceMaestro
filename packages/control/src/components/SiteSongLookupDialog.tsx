import { useEffect, useState } from "react";
import type {
  SiteScraperProviderSummary,
  SiteScraperSearchResult,
  SongResourceKind,
} from "@sm/shared";
import { api, ApiError } from "../api";
import { EyeIcon } from "./Icons";
import { SongLyricsDialog } from "./SongLyricsDialog";
import { downloadBlob, SITE_KIND_LABELS } from "../site-download";

export function SiteSongLookupDialog({
  provider,
  initialQuery,
  notify,
  onClose,
}: {
  provider: SiteScraperProviderSummary;
  initialQuery: string;
  notify: (text: string, kind?: "info" | "error") => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SiteScraperSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [lyricsLoadingId, setLyricsLoadingId] = useState<string | null>(null);
  const [lyricsPreview, setLyricsPreview] = useState<{
    title: string;
    author: string | null;
    ccli: string | null;
    lyrics: string;
  } | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (initialQuery.trim()) void search(initialQuery);
  }, [initialQuery]);

  async function search(value = query) {
    if (!value.trim()) return;
    setSearching(true);
    try {
      const result = await api.siteScraperSearch(provider.id, value.trim());
      setResults(result.results);
      setSearched(true);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not search SongSelect", "error");
    } finally {
      setSearching(false);
    }
  }

  async function previewLyrics(song: SiteScraperSearchResult) {
    setLyricsLoadingId(song.songNumber);
    try {
      const result = await api.siteScraperLyrics(provider.id, song);
      setLyricsPreview({
        title: song.title,
        author: song.authors.join(", ") || null,
        ccli: song.songNumber,
        lyrics: result.lyrics,
      });
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not load the lyrics", "error");
    } finally {
      setLyricsLoadingId(null);
    }
  }

  async function download(song: SiteScraperSearchResult, kinds: SongResourceKind[]) {
    const key = `${song.songNumber}:${kinds.join(",")}`;
    setDownloading(key);
    try {
      const result = await api.siteScraperDownload(provider.id, song, kinds);
      downloadBlob(result.blob, result.filename);
      notify(`Downloaded ${result.filename}`);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not download the files", "error");
    } finally {
      setDownloading(null);
    }
  }

  async function importAll(song: SiteScraperSearchResult) {
    setImporting(song.songNumber);
    try {
      const result = await api.siteScraperImport(provider.id, song, song.availableKinds);
      notify(
        result.created
          ? `Imported “${result.song.title}” with ${result.files.length} file${result.files.length === 1 ? "" : "s"}`
          : `Updated “${result.song.title}” with ${result.files.length} file${result.files.length === 1 ? "" : "s"}`,
      );
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not import the song", "error");
    } finally {
      setImporting(null);
    }
  }

  return (
    <>
    <div
      className="alt-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="alt-modal site-lookup-modal" role="dialog" aria-modal="true">
        <div className="alt-modal-heading">
          <div>
            <h3>Lookup song in SongSelect</h3>
            <p className="muted">Search and download files to add this song to your library.</p>
          </div>
          <button className="button ghost small" onClick={onClose} title="Close the lookup">
            Close
          </button>
        </div>

        <div className="inline-field">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void search();
            }}
            placeholder="Song title, author or CCLI number…"
            autoFocus
          />
          <button
            className="button primary"
            onClick={() => void search()}
            disabled={searching || !query.trim()}
            title="Search SongSelect"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>

        {searching && <p className="muted">Searching {provider.label}…</p>}
        {!searching && searched && !results.length && (
          <p className="muted">No matching songs found. Try a shorter or different search.</p>
        )}

        <div className="site-song-results site-lookup-results">
          {results.map((song) => {
            const allKinds = song.availableKinds;
            return (
              <article className="site-song-result" key={`${song.songNumber}:${song.slug}`}>
                <div className="site-song-result-main">
                  <strong>{song.title}</strong>
                  <span className="muted">
                    {song.authors.length ? song.authors.join(" · ") : "Unknown author"} · CCLI{" "}
                    {song.songNumber}
                  </span>
                </div>
                <div className="button-row">
                  <button
                    className="button ghost small icon-button"
                    onClick={() => void previewLyrics(song)}
                    disabled={lyricsLoadingId !== null}
                    title={`Preview lyrics for “${song.title}”`}
                    aria-label={`Preview lyrics for ${song.title}`}
                  >
                    {lyricsLoadingId === song.songNumber ? "…" : <EyeIcon />}
                  </button>
                  {song.availableKinds.map((kind) => (
                    <button
                      key={kind}
                      className="button ghost small"
                      onClick={() => void download(song, [kind])}
                      disabled={downloading !== null || importing !== null}
                      title={`Download ${SITE_KIND_LABELS[kind]} for “${song.title}”`}
                    >
                      {downloading === `${song.songNumber}:${kind}`
                        ? "Downloading…"
                        : SITE_KIND_LABELS[kind]}
                    </button>
                  ))}
                  {allKinds.length > 1 && (
                    <button
                      className="button ghost small"
                      onClick={() => void download(song, allKinds)}
                      disabled={downloading !== null || importing !== null}
                      title={`Download all available files for “${song.title}” as a ZIP`}
                    >
                      {downloading === `${song.songNumber}:${allKinds.join(",")}`
                        ? "Downloading…"
                        : "All files"}
                    </button>
                  )}
                  {allKinds.length > 0 && (
                    <button
                      className="button primary small"
                      onClick={() => void importAll(song)}
                      disabled={downloading !== null || importing !== null}
                      title={`Import all available files for “${song.title}” into Service Maestro`}
                    >
                      {importing === song.songNumber ? "Importing…" : "Import all"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <p className="hint">
          For SongSelect, <strong>ChordPro</strong> is the chord download; lead and vocal files are
          PDFs. <strong>Import all</strong> saves the files to the song library; they appear in the
          musician view when the song is used in a set list.
        </p>
      </div>
    </div>
    <SongLyricsDialog song={lyricsPreview} onClose={() => setLyricsPreview(null)} />
    </>
  );
}
