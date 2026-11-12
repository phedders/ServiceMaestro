import type { SongResourceKind } from "@sm/shared";

export const SITE_KIND_LABELS: Record<SongResourceKind, string> = {
  songpro: "SongPro",
  chord: "ChordPro",
  lead: "Lead PDF",
  vocal: "Vocal PDF",
  lyrics: "Lyrics",
};

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
