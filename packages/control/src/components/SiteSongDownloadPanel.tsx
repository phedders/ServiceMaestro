import { useEffect, useState } from "react";
import type {
  SiteScraperProviderSummary,
  SiteScraperSearchResult,
  SongResourceKind,
} from "@sm/shared";
import { api, ApiError } from "../api";

const KIND_LABELS: Record<SongResourceKind, string> = {
  songpro: "SongPro",
  chord: "ChordPro",
  lead: "Lead PDF",
  vocal: "Vocal PDF",
  lyrics: "Lyrics",
};

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SiteSongDownloadPanel({
  notify,
}: {
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [providers, setProviders] = useState<SiteScraperProviderSummary[]>([]);
  const [providerId, setProviderId] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SiteScraperSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

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
            Search {provider.label} and download lyrics, ChordPro, lead-sheet and vocal files.
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
                      {song.availableKinds.map((kind) => (
                        <button
                          key={kind}
                          className="button ghost small"
                          onClick={() => void download(song, [kind])}
                          disabled={downloading !== null}
                          title={`Download ${KIND_LABELS[kind]} for “${song.title}”`}
                        >
                          {downloading === `${song.songNumber}:${kind}` ? "Downloading…" : KIND_LABELS[kind]}
                        </button>
                      ))}
                      {allKinds.length > 1 && (
                        <button
                          className="button primary small"
                          onClick={() => void download(song, allKinds)}
                          disabled={downloading !== null}
                          title={`Download all available files for “${song.title}” as a ZIP`}
                        >
                          {downloading === `${song.songNumber}:${allKinds.join(",")}`
                            ? "Downloading…"
                            : "All files"}
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
    </section>
  );
}
