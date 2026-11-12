import { useEffect, useState } from "react";
import type {
  SiteScraperProviderSummary,
  SiteScraperSearchResult,
  SongResourceKind,
} from "@sm/shared";
import { api, ApiError } from "../api";
import { usePageAccess } from "../page-access";
import { EyeIcon } from "./Icons";
import { SongLyricsDialog } from "./SongLyricsDialog";
import { downloadBlob, SITE_KIND_LABELS as KIND_LABELS } from "../site-download";

export function SiteSongDownloadPanel({
  notify,
  onImported,
}: {
  notify: (text: string, kind?: "info" | "error") => void;
  onImported?: () => void;
}) {
  const { canWrite } = usePageAccess();
  const [providers, setProviders] = useState<SiteScraperProviderSummary[]>([]);
  const [providerId, setProviderId] = useState("");
  const [query, setQuery] = useState("");
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

  const provider = providers.find((entry) => entry.id === providerId) ?? providers[0] ?? null;

  useEffect(() => {
    api
      .siteScrapingProviders()
      .then((result) => {
        setProviders(result.providers);
        setProviderId(result.providers[0]?.id ?? "");
      })
      .catch(() => setProviders([]));
  }, []);

  async function search() {
    if (!provider || !query.trim()) return;
    setSearching(true);
    try {
      const result = await api.siteScraperSearch(provider.id, query.trim());
      setResults(result.results);
      if (!result.results.length) notify("No matching songs found");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not search the song site", "error");
    } finally {
      setSearching(false);
    }
  }

  async function previewLyrics(song: SiteScraperSearchResult) {
    if (!provider) return;
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
    if (!provider) return;
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
    if (!provider || !canWrite) return;
    setImporting(song.songNumber);
    try {
      const result = await api.siteScraperImport(provider.id, song, song.availableKinds);
      notify(
        result.created
          ? `Imported “${result.song.title}” with ${result.files.length} file${result.files.length === 1 ? "" : "s"}`
          : `Updated “${result.song.title}” with ${result.files.length} file${result.files.length === 1 ? "" : "s"}`,
      );
      onImported?.();
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not import the song", "error");
    } finally {
      setImporting(null);
    }
  }

  if (!provider) return null;

  const sourceLabel =
    provider.activeSource === "user"
      ? `Using your credentials${provider.userUsername ? ` (${provider.userUsername})` : ""}`
      : provider.activeSource === "server"
        ? "Using server credentials"
        : "No credentials configured";

  return (
    <section className="panel site-song-download-panel">
      <div className="panel-heading">
        <div>
          <h2>Song site downloads</h2>
          <p className="muted">
            Search {provider.label} and download lyrics, ChordPro, lead-sheet and vocal files. Import into Service Maestro attaches them to the local song.
          </p>
        </div>
        <span className={`badge ${provider.activeSource ? "imported" : "error"}`}>{sourceLabel}</span>
      </div>

      {!provider.activeSource ? (
        <p className="hint">
          Add your song-site credentials in <strong>Settings → My account</strong>, or configure
          server-level credentials in <code>config.yaml</code>.
        </p>
      ) : (
        <>
          <div className="inline-field">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void search();
              }}
              placeholder="Search by song title, author or CCLI number…"
            />
            <button
              className="button primary"
              onClick={() => void search()}
              disabled={searching || !query.trim()}
              title="Search the song site"
            >
              {searching ? "Searching…" : "Search"}
            </button>
          </div>

          {results.length > 0 && (
            <div className="site-song-results">
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
                          title={`Download ${KIND_LABELS[kind]} for “${song.title}”`}
                        >
                          {downloading === `${song.songNumber}:${kind}` ? "Downloading…" : `Download ${KIND_LABELS[kind]}`}
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
                            : "Download all to computer"}
                        </button>
                      )}
                      {allKinds.length > 0 && (
                        <button
                          className="button primary small"
                          onClick={() => void importAll(song)}
                          disabled={!canWrite || downloading !== null || importing !== null}
                          title={
                            canWrite
                              ? `Import all available files for “${song.title}” into Service Maestro`
                              : "Read-only access to songs"
                          }
                        >
                          {importing === song.songNumber ? "Importing…" : "Import into Service Maestro"}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {!results.length && !searching && (
            <p className="hint">
              Downloads use the signed-in site session from your credentials. For SongSelect, choose
              <strong> ChordPro</strong> for chord downloads; lead and vocal files are PDFs.
            </p>
          )}
        </>
      )}

      <SongLyricsDialog song={lyricsPreview} onClose={() => setLyricsPreview(null)} />
    </section>
  );
}
