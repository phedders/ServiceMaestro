import { bareSectionLabel } from "./section-labels.js";

const BRACKETED_SECTION = /^\s*\[([^\]]+)\]\s*$/;

/**
 * Adds [V1], [V2], ... section tags to a song that has no section headings.
 * Stanzas are separated by blank lines. Songs that already contain any
 * bracketed or recognised bare section heading are left untouched.
 */
export function addDefaultVerseTags(lyrics: string): string {
  const text = lyrics.replace(/\r\n?/g, "\n").trim();
  if (!text) return lyrics;
  const lines = text.split("\n");
  if (
    lines.some((line) => {
      const bracketed = line.match(BRACKETED_SECTION);
      return (
        (bracketed && bareSectionLabel(bracketed[1]) !== null) ||
        bareSectionLabel(line) !== null
      );
    })
  ) {
    return lyrics;
  }

  const stanzas: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (current.length) {
        stanzas.push(current);
        current = [];
      }
      continue;
    }
    current.push(line.replace(/\s+$/, ""));
  }
  if (current.length) stanzas.push(current);

  return stanzas
    .map((stanza, index) => `[V${index + 1}]\n${stanza.join("\n")}`)
    .join("\n\n");
}
