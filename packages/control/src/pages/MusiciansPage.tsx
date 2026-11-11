import { useEffect, useMemo, useState } from "react";
import type { SetlistDetail, SetlistItem, SetlistSummary, Song, SongAsset } from "@wlm/shared";
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

  const selected = useMemo(
    () => detail?.items.find((item) => item.id === selectedItem) ?? null,
    [detail, selectedItem],
  );
  const selectedSongAssets = selected?.songId ? assets[selected.songId] ?? [] : [];
  const currentAsset = selectedSongAssets.find((asset) => asset.id === selectedAsset);

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
          <h2>Service set lists</h2>
          <p className="muted">
            Open a service to view its songs, lyrics, scores and tabs. This view is read-only and never
            changes the live session.
          </p>
        </div>
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
      </section>

      <div className="musicians-grid">
        <aside className="panel musicians-songs musicians-setlists">
          <div className="panel-heading">
            <h3>Set lists</h3>
            <span className="muted">{setlists.length}</span>
          </div>
          {setlists.map((setlist) => (
            <button
              key={setlist.id}
              className={`musician-song ${setlist.id === selectedSetlist ? "current" : ""}`}
              onClick={() => setSelectedSetlist(setlist.id)}
            >
              <strong>{setlist.name}</strong>
              <span>
                {serviceLabel(setlist)} · {setlist.itemCount} item{setlist.itemCount === 1 ? "" : "s"}
              </span>
            </button>
          ))}
          {!setlists.length && <p className="muted">No set lists yet.</p>}
        </aside>

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
                      <button className="musician-item-head" onClick={() => selectItem(item)}>
                        <span className={`item-icon ${item.kind}`}>{item.kind === "song" ? "♫" : "T"}</span>
                        <span>
                          <strong>{item.title}</strong>
                          <span className="muted">
                            {item.kind === "song" ? "Song" : "Text"}
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
                              {songAssets.length > 0 && (
                                <div className="musician-score">
                                  <div className="panel-heading">
                                    <h3>Scores &amp; tabs</h3>
                                    <div className="asset-tabs">
                                      {songAssets.map((asset) => (
                                        <button
                                          key={asset.id}
                                          className={`button small ${asset.id === selectedAsset ? "primary" : "ghost"}`}
                                          onClick={() => setSelectedAsset(asset.id)}
                                        >
                                          {asset.kind.replace("_", " ")}
                                          {asset.key ? ` · ${asset.key}` : ""}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                  {currentAsset ? (
                                    <AssetViewer asset={currentAsset} />
                                  ) : (
                                    <p className="muted">Choose a file to view.</p>
                                  )}
                                </div>
                              )}
                              {!songAssets.length && (
                                <p className="muted">No score, ChordPro file or tab attached to this song.</p>
                              )}
                            </>
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
            <p className="muted">Choose a set list to open it.</p>
          )}
        </section>
      </div>
    </div>
  );
}
