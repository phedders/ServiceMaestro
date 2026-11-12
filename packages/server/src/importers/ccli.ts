import { addDefaultVerseTags } from "../lyrics.js";
import { bareSectionLabel } from "../section-labels.js";
import type { ImportedSong } from "./index.js";

const LEGAL_LINE =
  /(?:©|copyright|ccli\s*(?:song|licen[cs]e)|songselect|all rights reserved|for use solely)/i;
const SEPARATOR_LINE = /^\s*(?:\/\/+|\\+|\*{3,}|-{3,}|={3,})\s*$/;

function cleanFilename(filename: string): string {
  return filename
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(?:txt|lyrics?)$/i, "")
    .replace(/_\d+-zeilig$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sectionFromLine(line: string): { label: string; rest: string } | null {
  const bracketed = line.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
  if (bracketed) {
    const label = bareSectionLabel(bracketed[1]);
    if (label) return { label, rest: bracketed[2] };
  }
  const bare = bareSectionLabel(line);
  return bare ? { label: bare, rest: "" } : null;
}

function ccliNumber(value: string): string | null {
  return value.match(/CCLI\s*(?:Song\s*#?|Licen[cs]e\s*#?)?\s*(\d+)/i)?.[1] ?? null;
}

export function parseCcliText(filename: string, content: string): ImportedSong {
  const warnings: string[] = [];
  const lines = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const firstSection = lines.findIndex((line) => sectionFromLine(line) !== null);
  const lyricStart = firstSection >= 0 ? firstSection : 0;

  const titleLines = lines
    .slice(0, lyricStart)
    .map((line) => line.trim())
    .filter(Boolean);
  let title =
    titleLines.find((line) => !LEGAL_LINE.test(line))?.replace(/^(?:title|song)\s*:\s*/i, "") ||
    cleanFilename(filename);

  let metaStart = lines.length;
  for (let index = lyricStart; index < lines.length; index += 1) {
    if (!LEGAL_LINE.test(lines[index])) continue;
    metaStart = index;
    while (metaStart > lyricStart) {
      const previous = lines[metaStart - 1]?.trim() ?? "";
      if (!previous || sectionFromLine(previous) || SEPARATOR_LINE.test(previous)) break;
      metaStart -= 1;
    }
    break;
  }

  const footer = lines
    .slice(metaStart)
    .map((line) => line.trim())
    .filter(Boolean);
  const ccli = ccliNumber(footer.join(" "));
  const copyright =
    footer.find((line) => /©|copyright/i.test(line)) ??
    footer.find((line) => /all rights reserved/i.test(line)) ??
    null;
  const author =
    footer
      .filter((line) => !LEGAL_LINE.test(line) && !/^ccli\b/i.test(line))
      .filter((line) => !/^\d+$/.test(line))
      .join(", ") || null;

  const output: string[] = [];
  const pushBlank = () => {
    if (output.length && output[output.length - 1] !== "") output.push("");
  };
  const hasSections = lines
    .slice(lyricStart, metaStart)
    .some((line) => sectionFromLine(line) !== null);
  for (let index = lyricStart; index < metaStart; index += 1) {
    const line = lines[index].replace(/\s+$/, "");
    if (!line.trim()) {
      if (!hasSections) pushBlank();
      continue;
    }
    if (SEPARATOR_LINE.test(line)) {
      if (!hasSections) pushBlank();
      continue;
    }
    const section = sectionFromLine(line);
    if (section) {
      pushBlank();
      output.push(`[${section.label}]`);
      if (section.rest.trim()) output.push(section.rest.trim());
      continue;
    }
    output.push(line.trim());
  }

  let lyrics = output
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!lyrics) warnings.push("No lyric content found after removing CCLI metadata");
  if (firstSection < 0) warnings.push("No CCLI section labels found; imported as plain lyrics");
  lyrics = addDefaultVerseTags(lyrics);

  return {
    format: "text",
    title: title || cleanFilename(filename),
    alternateTitles: null,
    author,
    copyright,
    ccli,
    key: null,
    lyrics,
    warnings,
  };
}
