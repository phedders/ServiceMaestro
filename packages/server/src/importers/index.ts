import { addDefaultVerseTags } from "../lyrics.js";
import { bareSectionLabel } from "../section-labels.js";

export type ImportFormat = "openlp" | "chordpro" | "text";

export interface ImportedSong {
  format: ImportFormat;
  title: string;
  alternateTitles: string | null;
  author: string | null;
  copyright: string | null;
  ccli: string | null;
  key: string | null;
  lyrics: string;
  warnings: string[];
}

export interface SongFilePreview extends ImportedSong {
  path: string;
  bytes: number;
  duplicate?: {
    songId: string;
    title: string;
    reason: "ccli" | "title";
  } | null;
  sourceMatch?: {
    songId: string;
    title: string;
  } | null;
}

const CHORD_DIRECTIVE = /^\s*\{([a-zA-Z0-9_-]+)\s*(?::\s*([^}]*))?\}\s*$/;
const SECTION_LABEL =
  /^(v(?:erse)?\s*\d*[a-z]?|c(?:h?orus)?\s*\d*[a-z]?|b(?:ridge)?\s*\d*[a-z]?|(?:intro|int|instr|inst|instrumental|outro|ending|end|tag|turnaround|turn|interlude|pre[- ]?chorus|prechorus|pc|p|t|i|o|e)\s*\d*[a-z]?)$/i;
const LEGAL_LINE =
  /^(ccli\s*(song|licen[cs]e)|for use solely with the songselect|note:\s*reproduction|©|copyright|\(c\)|all rights reserved)/i;

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

function cleanText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function baseTitle(filename: string): string {
  return filename
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(xml|txt|cho|chordpro|crd)$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function first(values: string[] | undefined): string | null {
  const value = values?.find((candidate) => candidate.trim());
  return value ? cleanText(value) : null;
}

function normaliseLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function labelAliases(value: string): string[] {
  const key = normaliseLabel(value);
  const aliases = new Set([key]);
  const verse = key.match(/^v(?:erse)?(\d*)([a-z]?)$/);
  if (verse) {
    const suffix = `${verse[1] ?? ""}${verse[2] ?? ""}`.replace(/^$/, "");
    aliases.add(`v${suffix}`);
    aliases.add(`verse${suffix}`);
    if (!suffix) aliases.add("verse");
  }
  const chorus = key.match(/^c(?:h?orus)?(\d*)([a-z]?)$/);
  if (chorus) {
    const suffix = `${chorus[1] ?? ""}${chorus[2] ?? ""}`.replace(/^$/, "");
    aliases.add(`c${suffix}`);
    aliases.add(`chorus${suffix}`);
    if (!suffix) aliases.add("chorus");
  }
  const bridge = key.match(/^b(?:ridge)?(\d*)([a-z]?)$/);
  if (bridge) {
    const suffix = `${bridge[1] ?? ""}${bridge[2] ?? ""}`.replace(/^$/, "");
    aliases.add(`b${suffix}`);
    aliases.add(`bridge${suffix}`);
    if (!suffix) aliases.add("bridge");
  }
  if (key === "prechorus" || key === "pc") {
    aliases.add("p");
    aliases.add("prechorus");
    aliases.add("pc");
  }
  if (key === "i" || key === "intro") aliases.add("intro");
  if (key === "t" || key === "turnaround" || key === "turn") aliases.add("turnaround");
  if (key === "e" || key === "ending" || key === "end") aliases.add("ending");
  if (key === "o" || key === "outro") aliases.add("outro");
  if (["int", "instr", "inst", "instrumental"].includes(key)) {
    aliases.add("int");
    aliases.add("instr");
    aliases.add("inst");
    aliases.add("instrumental");
  }
  if (["pre", "pch", "prechorus"].includes(key)) {
    aliases.add("prechorus");
    aliases.add("pc");
    aliases.add("p");
  }
  return [...aliases];
}

function isSectionLabel(value: string, orderTokens: string[]): boolean {
  if (bareSectionLabel(value) || SECTION_LABEL.test(value.trim())) return true;
  const key = normaliseLabel(value);
  return orderTokens.some((token) => normaliseLabel(token) === key);
}

/* ------------------------------------------------------------------ */
/* OpenLP / OpenLyrics                                                  */
/* ------------------------------------------------------------------ */

function friendlyLabel(name: string): string {
  const key = name.trim();
  if (/^v\d+/i.test(key)) return `Verse ${key.replace(/^v/i, "")}`;
  if (/^c\d+/i.test(key)) return `Chorus ${key.replace(/^c/i, "")}`;
  if (/^b\d+/i.test(key)) return `Bridge ${key.replace(/^b/i, "")}`;
  if (/^e\d+/i.test(key)) return `Ending ${key.replace(/^e/i, "")}`;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function parseOpenLp(filename: string, content: string): ImportedSong {
  const warnings: string[] = [];
  const properties = content.match(/<properties>([\s\S]*?)<\/properties>/i)?.[1] ?? "";
  const titles = [...properties.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map((m) => cleanText(m[1]));
  const authors = [...properties.matchAll(/<author[^>]*>([\s\S]*?)<\/author>/gi)].map((m) => cleanText(m[1]));
  const copyrights = [...properties.matchAll(/<copyright[^>]*>([\s\S]*?)<\/copyright>/gi)].map((m) => cleanText(m[1]));
  const ccliMatch = properties.match(/<ccli[^>]*>([\s\S]*?)<\/ccli>/i);
  const keyMatch = properties.match(/<key[^>]*>([\s\S]*?)<\/key>/i);
  const verseOrder = cleanText(properties.match(/<verseOrder[^>]*>([\s\S]*?)<\/verseOrder>/i)?.[1] ?? "");

  const verses = [...content.matchAll(/<verse\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/verse>/gi)].map(
    (match) => {
      const raw = match[2];
      const linesMatch = raw.match(/<lines[^>]*>([\s\S]*?)<\/lines>/i);
      const body = linesMatch ? linesMatch[1] : raw;
      const lines = body
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(?:line|p|div)>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .split("\n")
        .map((line) => decodeEntities(line).replace(/\s+$/, ""))
        .filter((line) => line.trim());
      return { name: match[1], label: friendlyLabel(match[1]), lines };
    },
  );

  if (!verses.length) warnings.push("No <verse> elements found");
  if (/<chords>/i.test(content)) warnings.push("OpenLyrics chord markup is not imported yet");

  const byName = new Map(verses.map((verse) => [verse.name.toLowerCase(), verse]));
  const ordered: typeof verses = [];
  if (verseOrder) {
    for (const token of verseOrder.split(/\s+/).filter(Boolean)) {
      const verse = byName.get(token.toLowerCase());
      if (verse) ordered.push(verse);
      else warnings.push(`verseOrder references unknown section "${token}"`);
    }
    for (const verse of verses) {
      if (!ordered.includes(verse)) ordered.push(verse);
    }
  } else {
    ordered.push(...verses);
  }

  const lyrics = ordered
    .map((verse) => `[${verse.label}]\n${verse.lines.join("\n")}`)
    .join("\n\n");

  return {
    format: "openlp",
    title: first(titles) ?? baseTitle(filename),
    alternateTitles: titles.length > 1 ? titles.slice(1).join(", ") : null,
    author: authors.length ? authors.join(", ") : null,
    copyright: first(copyrights),
    ccli: ccliMatch ? cleanText(ccliMatch[1]) || null : null,
    key: keyMatch ? cleanText(keyMatch[1]) || null : null,
    lyrics,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* ChordPro                                                             */
/* ------------------------------------------------------------------ */

interface ChordProBlock {
  label: string | null;
  lines: string[];
}

function removeBarMarkers(line: string): string {
  return line
    .replace(/\[\s*\|+\s*:?\s*\]/g, " ")
    .replace(/\[\s*:\s*\|+\s*\]/g, " ")
    .replace(/\[\s*\|\s*\]/g, " ")
    .replace(/\[\s*%\s*\]/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+$/, "");
}

function isLegalLine(line: string): boolean {
  return LEGAL_LINE.test(line.trim());
}

export function parseChordPro(filename: string, content: string): ImportedSong {
  const warnings: string[] = [];
  const metadata = new Map<string, string[]>();
  const addMeta = (key: string, value: string) => {
    const k = key.toLowerCase();
    const list = metadata.get(k) ?? [];
    list.push(value.trim());
    metadata.set(k, list);
  };

  const orderTokens = (() => {
    const values: string[] = [];
    for (const raw of content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n")) {
      const directive = raw.match(CHORD_DIRECTIVE);
      if (!directive) continue;
      const key = directive[1].toLowerCase();
      if (
        ["verse_order", "verse-order", "verse_order2", "verse_oder", "verse_order_fuse"].includes(key) &&
        directive[2]?.trim()
      ) {
        values.push(directive[2].trim());
      }
    }
    return values.join(" ").split(/\s+/).filter(Boolean);
  })();

  const blocks: ChordProBlock[] = [];
  let current: ChordProBlock = { label: null, lines: [] };
  let inTab = false;

  const flush = () => {
    if (current.lines.length) blocks.push(current);
    current = { label: null, lines: [] };
  };

  const startSection = (label: string | null) => {
    flush();
    current = { label, lines: [] };
  };

  for (const rawLine of content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    const directive = line.match(CHORD_DIRECTIVE);
    if (directive) {
      const key = directive[1].toLowerCase();
      const value = directive[2]?.trim() ?? "";
      if (key === "comment") {
        if (value && isSectionLabel(value, orderTokens)) startSection(value);
        continue;
      }
      if (["start_of_chorus", "soc", "start_of_verse", "sov", "start_of_bridge", "sob"].includes(key)) {
        const label =
          key.includes("chorus") || key === "soc"
            ? "Chorus"
            : key.includes("bridge") || key === "sob"
              ? "Bridge"
              : "Verse";
        startSection(label);
        continue;
      }
      if (key.startsWith("end_of_")) {
        flush();
        continue;
      }
      if (key === "start_of_tab") {
        inTab = true;
        flush();
        continue;
      }
      if (key === "end_of_tab") {
        inTab = false;
        continue;
      }
      if (key === "new_page" || key === "column_break") continue;
      addMeta(key, value);
      continue;
    }
    if (inTab) continue;
    if (!line.trim()) continue;
    if (isLegalLine(line)) continue;
    const cleaned = removeBarMarkers(line);
    if (!cleaned.trim()) continue;
    const inlineSection = bareSectionLabel(cleaned);
    if (inlineSection) {
      startSection(inlineSection);
      continue;
    }
    current.lines.push(cleaned);
  }
  flush();

  if (!blocks.length) warnings.push("No lyric lines found");
  if (!first(metadata.get("title"))) warnings.push("No {title} directive");

  const order = (
    metadata.get("verse_order") ??
    metadata.get("verse-order") ??
    metadata.get("verse_order2") ??
    metadata.get("verse_oder") ??
    metadata.get("verse_order_fuse") ??
    []
  )
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);

  const blockIndex = new Map<string, number>();
  const aliasIndex = new Map<string, number>();
  blocks.forEach((block, index) => {
    if (!block.label) return;
    blockIndex.set(normaliseLabel(block.label), index);
    for (const alias of labelAliases(block.label)) {
      if (!aliasIndex.has(alias)) aliasIndex.set(alias, index);
    }
  });

  let orderedBlocks: ChordProBlock[];
  if (order.length && blocks.some((block) => block.label)) {
    orderedBlocks = [];
    const used = new Set<number>();
    for (const token of order) {
      const normalized = normaliseLabel(token);
      let index = blockIndex.get(normalized);
      if (index === undefined) index = aliasIndex.get(normalized);
      if (index === undefined) {
        warnings.push(`verse_order references unknown section "${token}"`);
        continue;
      }
      orderedBlocks.push(blocks[index]);
      used.add(index);
    }
    blocks.forEach((block, index) => {
      if (!used.has(index) && block.lines.length) orderedBlocks.push(block);
    });
  } else {
    orderedBlocks = blocks;
  }

  const lyrics = orderedBlocks
    .map((block) => {
      const label = block.label ? `[${block.label}]\n` : "";
      return `${label}${block.lines.join("\n")}`;
    })
    .join("\n\n")
    .trim();

  const ccli = first(metadata.get("ccli"))?.match(/\d+/)?.[0] ?? null;
  const authors = [...(metadata.get("artist") ?? []), ...(metadata.get("composer") ?? [])];
  const author = authors.filter(Boolean).join(", ") || null;

  return {
    format: "chordpro",
    title: first(metadata.get("title")) ?? baseTitle(filename),
    alternateTitles:
      [...(metadata.get("alternate_title") ?? []), ...(metadata.get("alt_title") ?? [])]
        .filter(Boolean)
        .join(", ") || null,
    author,
    copyright: first(metadata.get("copyright")),
    ccli,
    key: first(metadata.get("key")),
    lyrics,
    warnings: [...new Set(warnings)],
  };
}

/* ------------------------------------------------------------------ */
/* Plain text                                                           */
/* ------------------------------------------------------------------ */

function stripHtml(value: string): string {
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

export function parsePlainText(filename: string, content: string): ImportedSong {
  const warnings: string[] = [];
  let text = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const hasHtml = /<(?:p|div|br|html|body|span)\b/i.test(text);
  if (hasHtml) {
    warnings.push("HTML content was converted to plain text");
    text = stripHtml(text);
  }

  const lines = text.split("\n");
  let title = baseTitle(filename);

  for (let index = 0; index < Math.min(lines.length, 4); index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const explicit = line.match(/^(?:title|song)\s*:\s*(.+)$/i);
    if (explicit) {
      title = explicit[1].trim();
      lines.splice(index, 1);
      break;
    }
    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
      lines.splice(index, 1);
      break;
    }
    const nextBlank = lines[index + 1] !== undefined && !lines[index + 1].trim();
    if (index === 0 && nextBlank && line.length <= 80 && !/\[[A-G]/.test(line)) {
      title = line;
      lines.splice(0, 2);
    }
    break;
  }

  const lyrics = lines
    .map((line) => {
      const label = bareSectionLabel(line);
      return label ? `[${label}]` : line;
    })
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
  if (!lyrics.trim()) warnings.push("No lyric content found");

  return {
    format: "text",
    title: title || baseTitle(filename),
    alternateTitles: null,
    author: null,
    copyright: null,
    ccli: null,
    key: null,
    lyrics,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Detection                                                            */
/* ------------------------------------------------------------------ */

export function detectFormat(filename: string, content: string): ImportFormat {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "xml" || /<song\b/i.test(content)) return "openlp";
  if (["cho", "chordpro", "crd"].includes(extension)) return "chordpro";
  if (/\{\s*(title|artist|key|verse_order)\s*:/i.test(content)) return "chordpro";
  return "text";
}

export function parseSongFile(filename: string, content: string): ImportedSong {
  const format = detectFormat(filename, content);
  const song =
    format === "openlp"
      ? parseOpenLp(filename, content)
      : format === "chordpro"
        ? parseChordPro(filename, content)
        : parsePlainText(filename, content);
  return { ...song, lyrics: addDefaultVerseTags(song.lyrics) };
}
