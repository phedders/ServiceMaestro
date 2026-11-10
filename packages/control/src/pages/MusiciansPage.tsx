import { useEffect, useMemo, useState } from "react";
import type { LiveState, SetlistDetail, SetlistSummary, SongAsset } from "@wlm/shared";
import { api, ApiError } from "../api";
import { PdfViewer } from "../components/PdfViewer";

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

export default function MusiciansPage({
  live,
  notify,
}: {
  live: LiveState;
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [setlists, setSetlists] = useState<SetlistSummary[]>([]);
  const [selectedSetlist, setSelectedSetlist] = useState("");
  const [detail, setDetail] = useState<SetlistDetail | null>(null);
  const [assets, setAssets] = useState<Record<string, SongAsset[]>>({});
  const [selectedSong, setSelectedSong] = useState("");
  const [selectedAsset, setSelectedAsset] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .setlists()
      .then((result) => {
        setSetlists(result.setlists);
        const preferred =
          (live.setlistId && result.setlists.find((item) => item.id === live.setlistId)?.id) ||
          result.setlists[0]?.id ||
          "";
        setSelectedSetlist(preferred);
      })
      .catch((error) => notify(error instanceof ApiError ? error.message : "Could not load set lists", "error"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedSetlist) return;
    api
      .setlist(selectedSetlist)
      .then(async (result) => {
        setDetail(result.setlist);
        const songs = result.setlist.items.filter((item) => item.kind === "song" && item.songId);
        const entries = await Promise.all(
          songs.map(async (item) => {
            const response = await api.songAssets(item.songId!);
            return [item.songId!, response.assets] as const;
          }),
        );
        const next: Record<string, SongAsset[]> = {};
        for (const [songId, list] of entries) next[songId] = list;
        setAssets(next);
        const firstSong = songs[0]?.songId ?? "";
        const firstWithAssets = songs.find((item) => (next[item.songId!] ?? []).length > 0)?.songId;
        const selected = firstWithAssets ?? firstSong;
        setSelectedSong(selected);
        setSelectedAsset(next[selected]?.[0]?.id ?? "");
      })
      .catch((error) => notify(error instanceof ApiError ? error.message : "Could not load service", "error"));
  }, [selectedSetlist]);

  const songs = useMemo(
    () =>
      (detail?.items ?? [])
        .filter((item) => item.kind === "song" && item.songId)
        .map((item) => ({
          songId: item.songId!,
          title: item.title,
          key: item.keyOverride,
          assets: assets[item.songId!] ?? [],
        })),
    [detail, assets],
  );

  const currentSong = songs.find((song) => song.songId === selectedSong);
  const currentAsset = (assets[selectedSong] ?? []).find((asset) => asset.id === selectedAsset);

  if (loading) return <div className="panel">Loading service…</div>;

  return (
    <div className="musicians-page">
      <section className="panel musicians-toolbar">
        <div>
          <h2>Musician scores</h2>
          <p className="muted">Scores, ChordPro and tabs attached to the songs in this service.</p>
        </div>
        <label>
          Service
          <select value={selectedSetlist} onChange={(event) => setSelectedSetlist(event.target.value)}>
            {setlists.map((setlist) => (
              <option key={setlist.id} value={setlist.id}>
                {setlist.name} — {setlist.serviceDate}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="musicians-grid">
        <aside className="panel musicians-songs">
          <div className="panel-heading">
            <h3>Songs</h3>
            <span className="muted">{songs.length}</span>
          </div>
          {songs.map((song) => (
            <button
              key={song.songId}
              className={`musician-song ${song.songId === selectedSong ? "current" : ""}`}
              onClick={() => {
                setSelectedSong(song.songId);
                setSelectedAsset(song.assets[0]?.id ?? "");
              }}
            >
              <strong>{song.title}</strong>
              <span>
                {song.key ? `${song.key} · ` : ""}
                {song.assets.length} file{song.assets.length === 1 ? "" : "s"}
              </span>
            </button>
          ))}
          {!songs.length && <p className="muted">No songs in this service.</p>}
        </aside>

        <section className="panel musicians-viewer">
          <div className="panel-heading">
            <div>
              <h2>{currentSong?.title ?? "Scores"}</h2>
              <p className="muted">
                {currentSong?.assets.length
                  ? `${currentSong.assets.length} attached file${currentSong.assets.length === 1 ? "" : "s"}`
                  : "No score or tab attached"}
              </p>
            </div>
            <div className="asset-tabs">
              {(currentSong?.assets ?? []).map((asset) => (
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
            <div className="empty-state">
              <p className="muted">Attach a score PDF or tab from the Songs page.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
