import { useEffect } from "react";

export interface LyricsSong {
  title: string;
  author?: string | null;
  copyright?: string | null;
  ccli?: string | null;
  key?: string | null;
  alternateTitles?: string | null;
  lyrics: string;
}

export function SongLyricsDialog({
  song,
  onClose,
}: {
  song: LyricsSong | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!song) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [song, onClose]);

  if (!song) return null;

  const details = [
    song.author,
    song.ccli ? `CCLI ${song.ccli}` : "",
    song.key ? `Key ${song.key}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="alt-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="alt-modal lyrics-preview-modal" role="dialog" aria-modal="true">
        <div className="alt-modal-heading">
          <div>
            <h3>{song.title}</h3>
            <p className="muted">{details || "Song lyrics"}</p>
            {song.alternateTitles && (
              <p className="hint">Also known as: {song.alternateTitles}</p>
            )}
          </div>
          <button className="button ghost small" onClick={onClose} title="Close the lyrics preview">
            Close
          </button>
        </div>
        <pre className="lyrics-preview-body">{song.lyrics}</pre>
        {song.copyright && <p className="hint lyrics-preview-copyright">{song.copyright}</p>}
      </div>
    </div>
  );
}
