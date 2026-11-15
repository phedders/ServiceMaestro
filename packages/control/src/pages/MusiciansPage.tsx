import { useEffect, useMemo, useState } from "react";
import {
  parseImageListContent,
  type SetlistDetail,
  type SetlistItem,
  type SetlistSummary,
  type Song,
  type SongAsset,
} from "@sm/shared";
import { api, ApiError } from "../api";
import { PdfViewer } from "../components/PdfViewer";
import { compactDate, pickCurrentSetlist } from "../service-date";

function TextAsset({ assetId }: { assetId: string }) {
  const [text, setText] = useState("Loading…");
  useEffect(() => {
    fetch(`/api/assets/${assetId}/file`, { credentials: "include" })
      .then((response) => response.text())
      .then(setText)
      .catch(() => setText("Could not load file"));
  }, [assetId]);
  return <pre className="text-asset">{text}</pre>;
}

function AssetViewer({ asset }: { asset: SongAsset }) {
  if (asset.mime === "application/pdf" || asset.format === "pdf") {
    return <PdfViewer assetId={asset.id} title={asset.title} />;
  }
  if (asset.mime.startsWith("image/")) {
    return <img className="image-asset" src={`/api/assets/${asset.id}/file`} alt={asset.title} />;
  }
  return <TextAsset assetId={asset.id} />;
}

function serviceLabel(setlist: SetlistSummary): string {
  return `${compactDate(setlist.serviceDate)}${setlist.serviceTime ? ` · ${setlist.serviceTime}` : ""}`;
}

function SongFiles({
  assets,
  selectedAsset,
  onSelect,
}: {
  assets: SongAsset[];
  selectedAsset: string;
  onSelect: (assetId: string) => void;
}) {
  const current = assets.find((asset) => asset.id === selectedAsset);
  if (!assets.length) {
    return <p className="muted">No score, ChordPro file or tab attached to this song.</p>;
  }
  return (
    <div className="musician-score">
      <div className="panel-heading">
        <h3>Scores &amp; tabs</h3>
        <div className="asset-tabs">
          {assets.map((asset) => (
            <button
              key={asset.id}
              className={`button small ${asset.id === selectedAsset ? "primary" : "ghost"}`}
              onClick={() => onSelect(asset.id)}
              title={`View ${asset.kind.replace("_", " ")} “${asset.title}”`}
            >
              {asset.title || asset.kind.replace("_", " ")}
              {asset.key ? ` · ${asset.key}` : ""}
            </button>
          ))}
        </div>
      </div>
      {current ? <AssetViewer asset={current} /> : <p className="muted">Choose a file to view.</p>}
    </div>
  );
}

export default function MusiciansPage({
  notify,
}: {
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [setlists, setSetlists] = useState<SetlistSummary[]>([]);
  const [selectedSetlist, setSelectedSetlist] = useState("");
  const [detail, setDetail] = useState<SetlistDetail | null>(null);
  const [selectedItem, setSelectedItem] = useState("");
  const [assets, setAssets] = useState<Record<string, SongAsset[]>>({});
  const [songs, setSongs] = useState<Record<string, Song>>({});
  const [selectedAsset, setSelectedAsset] = useState("");
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"setlist" | "songs">("setlist");
  const [allSongs, setAllSongs] = useState<Song[]>([]);
  const [allSongsLoading, setAllSongsLoading] = useState(false);
  const [allSongsLoaded, setAllSongsLoaded] = useState(false);
  const [songSearch, setSongSearch] = useState("");
  const [selectedSongId, setSelectedSongId] = useState("");
  const [allSongAssets, setAllSongAssets] = useState<Record<string, SongAsset[]>>({});
  const [loadingAllSongAssets, setLoadingAllSongAssets] = useState<Record<string, boolean>>({});
  const [selectedAllAsset, setSelectedAllAsset] = useState("");

  useEffect(() => {
    api
      .setlists()
      .then((result) => {
        setSetlists(result.setlists);
        const preferred = pickCurrentSetlist(result.setlists)?.id ?? result.setlists[0]?.id ?? "";
        setSelectedSetlist(preferred);
      })
      .catch((error) => notify(error instanceof ApiError ? error.message : "Could not load set lists", "error"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedSetlist) return;
    setDetail(null);
    setSelectedItem("");
    setSelectedAsset("");
    setAssets({});
    setSongs({});
    api
      .setlist(selectedSetlist)
      .then(async (result) => {
        setDetail(result.setlist);
        const songItems = result.setlist.items.filter((item) => item.kind === "song" && item.songId);
        const songIds = [...new Set(songItems.map((item) => item.songId!))];
        const entries = await Promise.all(
          songIds.map(async (songId) => {
            try {
              const [assetResult, songResult] = await Promise.all([
                api.songAssets(songId),
                api.song(songId),
              ]);
              return [songId, assetResult.assets, songResult.song] as const;
            } catch {
              return [songId, [] as SongAsset[], null] as const;
            }
          }),
        );
        const next: Record<string, SongAsset[]> = {};
        const nextSongs: Record<string, Song> = {};
        for (const [songId, list, song] of entries) {
          next[songId] = list;
          if (song) nextSongs[songId] = song;
        }
        setAssets(next);
        setSongs(nextSongs);
        const first = result.setlist.items[0];
        if (first) {
          setSelectedItem(first.id);
          const firstSong = result.setlist.items.find((item) => item.kind === "song" && item.songId);
          if (firstSong?.songId) setSelectedAsset(next[firstSong.songId]?.[0]?.id ?? "");
        }
      })
      .catch((error) => notify(error instanceof ApiError ? error.message : "Could not load service", "error"));
  }, [selectedSetlist]);

  useEffect(() => {
    if (viewMode !== "songs" || allSongsLoaded) return;
    setAllSongsLoading(true);
    const pageSize = 500;
    const loadAll = async () => {
      const found = new Map<string, Song>();
      for (let offset = 0; offset < 20_000; offset += pageSize) {
        const result = await api.songs("", { limit: pageSize, offset });
        for (const song of result.songs) found.set(song.id, song);
        if (result.songs.length < pageSize) break;
      }
      return [...found.values()];
    };
    loadAll()
      .then((result) => {
        setAllSongs(result);
        setAllSongsLoaded(true);
        setSelectedSongId((current) => current || result[0]?.id || "");
      })
      .catch((error) => {
        setAllSongsLoaded(true);
        notify(error instanceof ApiError ? error.message : "Could not load songs", "error");
      })
      .finally(() => setAllSongsLoading(false));
  }, [viewMode, allSongsLoaded]);

  useEffect(() => {
    if (viewMode !== "songs" || !selectedSongId) return;
    if (allSongAssets[selectedSongId] || loadingAllSongAssets[selectedSongId]) return;
    setLoadingAllSongAssets((current) => ({ ...current, [selectedSongId]: true }));
    api
      .songAssets(selectedSongId)
      .then((result) =>
        setAllSongAssets((current) => ({ ...current, [selectedSongId]: result.assets })),
      )
      .catch((error) => {
        setAllSongAssets((current) => ({ ...current, [selectedSongId]: [] }));
        notify(error instanceof ApiError ? error.message : "Could not load song files", "error");
      })
      .finally(() =>
        setLoadingAllSongAssets((current) => ({ ...current, [selectedSongId]: false })),
      );
  }, [viewMode, selectedSongId, allSongAssets, loadingAllSongAssets]);

  useEffect(() => {
    if (viewMode !== "songs" || !selectedSongId) return;
    const list = allSongAssets[selectedSongId] ?? [];
    if (list.some((asset) => asset.id === selectedAllAsset)) return;
    setSelectedAllAsset(list[0]?.id ?? "");
  }, [viewMode, selectedSongId, allSongAssets, selectedAllAsset]);

  const selected = useMemo(
    () => detail?.items.find((item) => item.id === selectedItem) ?? null,
    [detail, selectedItem],
  );
  const selectedSongAssets = selected?.songId ? assets[selected.songId] ?? [] : [];
  const selectedAllSong = useMemo(
    () => allSongs.find((song) => song.id === selectedSongId) ?? null,
    [allSongs, selectedSongId],
  );
  const selectedAllSongAssets = selectedSongId ? allSongAssets[selectedSongId] ?? [] : [];
  const filteredAllSongs = useMemo(() => {
    const query = songSearch.trim().toLowerCase();
    if (!query) return allSongs;
    return allSongs.filter((song) =>
      [song.title, song.alternateTitles ?? "", song.author ?? "", song.ccli ?? ""].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [allSongs, songSearch]);

  function selectAllSong(song: Song) {
    setSelectedSongId(song.id);
    setSelectedAllAsset("");
  }

  function selectItem(item: SetlistItem) {
    setSelectedItem(item.id);
    if (item.songId) {
      setSelectedAsset(assets[item.songId]?.[0]?.id ?? "");
    } else {
      setSelectedAsset("");
    }
  }

  if (loading) return <div className="panel">Loading services…</div>;

  return (
    <div className="musicians-page musicians-standalone-page">
      <section className="panel musicians-toolbar">
        <div>
          <h2>{viewMode === "setlist" ? "Service set lists" : "All songs"}</h2>
          <p className="muted">
            {viewMode === "setlist"
              ? "Open a service to view its songs, lyrics, scores and tabs."
              : "Browse the song library for lyrics, scores and tabs."}{" "}
            This view is read-only and never changes the live session.
          </p>
          <div className="segmented-buttons musicians-view-toggle" role="group" aria-label="Musicians view">
            <button
              type="button"
              className={`button ghost small ${viewMode === "setlist" ? "active" : ""}`}
              aria-pressed={viewMode === "setlist"}
              onClick={() => setViewMode("setlist")}
            >
              By setlist
            </button>
            <button
              type="button"
              className={`button ghost small ${viewMode === "songs" ? "active" : ""}`}
              aria-pressed={viewMode === "songs"}
              onClick={() => setViewMode("songs")}
            >
              All songs
            </button>
          </div>
        </div>
        {viewMode === "setlist" ? (
          <label>
            Service
            <select value={selectedSetlist} onChange={(event) => setSelectedSetlist(event.target.value)}>
              {setlists.map((setlist) => (
                <option key={setlist.id} value={setlist.id}>
                  {setlist.name} — {serviceLabel(setlist)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Search songs
            <input
              type="search"
              value={songSearch}
              onChange={(event) => setSongSearch(event.target.value)}
              placeholder="Title, author, CCLI…"
            />
          </label>
        )}
      </section>

      {viewMode === "setlist" ? (
        <section className="panel musicians-viewer">
          {detail ? (
            <>
              <div className="panel-heading">
                <div>
                  <h2>{detail.name}</h2>
                  <p className="muted">
                    {serviceLabel(detail)} · {detail.items.length} item
                    {detail.items.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>

              <div className="musician-items">
                {detail.items.map((item) => {
                  const songAssets = item.songId ? assets[item.songId] ?? [] : [];
                  const song = item.songId ? songs[item.songId] : undefined;
                  const key = item.keyOverride ?? song?.key ?? null;
                  const isSelected = item.id === selectedItem;
                  return (
                    <article key={item.id} className={`musician-item ${isSelected ? "selected" : ""}`}>
                      <button
                        className="musician-item-head"
                        onClick={() => selectItem(item)}
                        title={`Show lyrics, scores and tabs for “${item.title}”`}
                      >
                        <span className={`item-icon ${item.kind}`}>
                          {item.kind === "song"
                            ? "♫"
                            : item.kind === "image_list"
                              ? "▦"
                              : item.kind === "tarp"
                                ? "✦"
                                : "T"}
                        </span>
                        <span>
                          <strong>{item.title}</strong>
                          <span className="muted">
                            {item.kind === "song"
                              ? "Song"
                              : item.kind === "image_list"
                                ? "Image list"
                                : item.kind === "tarp"
                                  ? "Tarp"
                                  : "Text"}
                            {key ? ` · key ${key}` : ""}
                            {item.transpose ? ` · transpose ${item.transpose > 0 ? "+" : ""}${item.transpose}` : ""}
                            {songAssets.length ? ` · ${songAssets.length} file${songAssets.length === 1 ? "" : "s"}` : ""}
                          </span>
                          {item.notes && <span className="musician-notes">{item.notes}</span>}
                        </span>
                      </button>

                      {isSelected && (
                        <div className="musician-item-body">
                          {item.kind === "song" ? (
                            <>
                              {item.content != null && (
                                <span className="local-badge">Set-list lyrics</span>
                              )}
                              <pre className="lyrics-view">
                                {item.content ?? song?.lyrics ?? "Lyrics are not available for this song."}
                              </pre>
                              <SongFiles
                                assets={songAssets}
                                selectedAsset={selectedAsset}
                                onSelect={setSelectedAsset}
                              />
                            </>
                          ) : item.kind === "image_list" ? (
                            <p className="muted">
                              {parseImageListContent(item.content)?.images.length ?? 0} images in this
                              image list. View it on a display.
                            </p>
                          ) : item.kind === "tarp" ? (
                            <p className="muted">Tarp presentation. View it on a display.</p>
                          ) : (
                            <pre className="lyrics-view">{item.content}</pre>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="muted">Choose a service to open it.</p>
          )}
        </section>
      ) : (
        <div className="musicians-grid">
          <aside className="panel musicians-songs musicians-setlists" data-key-list>
            <div className="panel-heading">
              <h3>All songs</h3>
              <span className="muted">
                {songSearch ? `${filteredAllSongs.length} / ${allSongs.length}` : allSongs.length}
              </span>
            </div>
            {allSongsLoading || !allSongsLoaded ? (
              <p className="muted">Loading songs…</p>
            ) : (
              <>
                {filteredAllSongs.map((song) => (
                  <button
                    key={song.id}
                    data-key-list-item
                    className={`musician-song ${song.id === selectedSongId ? "current" : ""}`}
                    onClick={() => selectAllSong(song)}
                    title={`Open “${song.title}”`}
                  >
                    <strong>{song.title}</strong>
                    <span>
                      {[
                        song.author,
                        song.key ? `key ${song.key}` : "",
                        allSongAssets[song.id]?.length
                          ? `${allSongAssets[song.id].length} file${
                              allSongAssets[song.id].length === 1 ? "" : "s"
                            }`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Song"}
                    </span>
                  </button>
                ))}
                {!filteredAllSongs.length && (
                  <p className="muted">
                    {songSearch ? `No songs match “${songSearch}”.` : "No songs in the library."}
                  </p>
                )}
              </>
            )}
          </aside>

          <section className="panel musicians-viewer">
            {selectedAllSong ? (
              <>
                <div className="panel-heading">
                  <div>
                    <h2>{selectedAllSong.title}</h2>
                    <p className="muted">
                      {[
                        selectedAllSong.author,
                        selectedAllSong.ccli ? `CCLI ${selectedAllSong.ccli}` : "",
                        selectedAllSong.key ? `key ${selectedAllSong.key}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Song"}
                    </p>
                  </div>
                </div>
                <pre className="lyrics-view">
                  {selectedAllSong.lyrics || "Lyrics are not available for this song."}
                </pre>
                {loadingAllSongAssets[selectedSongId] ? (
                  <p className="muted">Loading scores and tabs…</p>
                ) : (
                  <SongFiles
                    assets={selectedAllSongAssets}
                    selectedAsset={selectedAllAsset}
                    onSelect={setSelectedAllAsset}
                  />
                )}
              </>
            ) : (
              <p className="muted">Choose a song to open it.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
