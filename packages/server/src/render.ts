import {
  SMART_WRAP_MODULES,
  parseImageListContent,
  suggestSongPageId,
  type LivePage,
  type SmartWrapModule,
} from "@sm/shared";
import { marked } from "marked";
import rst2html from "rst2html";
import sanitizeHtml from "sanitize-html";
import { parse as parseYaml } from "yaml";
import { OUTPUT_TOKEN } from "./config.js";
import { bareSectionLabel, bracketedSectionLabel } from "./section-labels.js";

export interface RenderItem {
  kind: "song" | "text" | "image" | "image_list" | "tarp" | "presentation";
  title: string;
  lyrics?: string | null;
  content?: string | null;
  format?: TextFormat | null;
  textAlign?: "left" | "center";
  imageFit?: "scale" | "actual" | "crop" | "stretch";
  lyricsMarkdown?: boolean;
  contentSource?: "text" | "bible";
  key?: string | null;
  keyOverride?: string | null;
  transpose: number;
  maxLines: number;
  verseOrder?: string | null;
}

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];const NOTE_INDEX: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};
const CHORD_RE = /^([A-G](?:#|b)?)(.*)$/;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function transposeChord(chord: string, semitones: number): string {
  if (!semitones) return chord;
  return chord
    .split("/")
    .map((part) => {
      const match = part.match(CHORD_RE);
      if (!match) return part;
      const root = match[1];
      const suffix = match[2];
      const index = NOTE_INDEX[root];
      if (index === undefined) return part;
      const next = (index + semitones + 120) % 12;
      return NOTES[next] + suffix;
    })
    .join("/");
}

export function keyDelta(from: string | null | undefined, to: string | null | undefined): number {
  if (!from || !to) return 0;
  const a = NOTE_INDEX[from];
  const b = NOTE_INDEX[to];
  if (a === undefined || b === undefined) return 0;
  let delta = b - a;
  if (delta > 6) delta -= 12;
  if (delta < -6) delta += 12;
  return delta;
}

interface Line {
  text: string;
}

interface Block {
  section: string | null;
  lines: Line[];
  hardBreakAfter?: boolean;
}

function parseSong(lyrics: string): Block[] {
  const rawLines = lyrics.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let current: Block = { section: null, lines: [] };
  let pendingSection: string | null = null;

  const flush = () => {
    if (current.lines.length || current.section) blocks.push(current);
    current = { section: null, lines: [] };
  };

  for (const raw of rawLines) {
    const line = raw.replace(/\s+$/, "");
    const bracketed = line.match(/^\s*\[([^\]]+)\]\s*$/);
    const bracketedSection = bracketed ? bracketedSectionLabel(bracketed[1]) : null;
    if (bracketedSection) {
      flush();
      pendingSection = bracketedSection;
      continue;
    }
    const bareSection = bareSectionLabel(line);
    if (bareSection) {
      flush();
      pendingSection = bareSection;
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (!current.lines.length && pendingSection) {
      current.section = pendingSection;
      pendingSection = null;
    }
    current.lines.push({ text: line });
  }
  flush();

  return blocks.filter((b) => b.lines.length > 0);
}

function parseText(content: string): Block[] {
  const rawLines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let current: Block = { section: null, lines: [] };

  for (const raw of rawLines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      if (current.lines.length) {
        current.hardBreakAfter = true;
        blocks.push(current);
        current = { section: null, lines: [] };
      }
      continue;
    }
    current.lines.push({ text: line });
  }
  if (current.lines.length) blocks.push(current);
  return blocks;
}

export type TextFormat = "text" | "html" | "markdown" | "rst";

export interface ParsedTextContent {
  format: TextFormat;
  body: string;
  metadata: Record<string, unknown>;
}

function normalizeTextFormat(value: unknown): TextFormat {
  const key = String(value ?? "text").toLowerCase().replace(/[^a-z]/g, "");
  if (key === "html" || key === "htm") return "html";
  if (key === "markdown" || key === "md") return "markdown";
  if (key === "rst" || key === "restructuredtext" || key === "restructured") return "rst";
  return "text";
}

export function parseTextContent(content: string): ParsedTextContent {
  let body = content.replace(/\r\n?/g, "\n");
  let metadata: Record<string, unknown> = {};

  const frontMatter = body.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (frontMatter) {
    try {
      const parsed = parseYaml(frontMatter[1]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      // Malformed metadata is treated as normal text.
    }
    body = body.slice(frontMatter[0].length);
  } else {
    const firstLine = body.split("\n", 1)[0] ?? "";
    const match = firstLine.match(
      /^\s*(?:type|format|mode)\s*:\s*(html|htm|markdown|md|rst|restructuredtext|restructured|text|plain)\s*$/i,
    );
    if (match) {
      metadata = { type: match[1] };
      body = body.slice(firstLine.length).replace(/^\n/, "");
    }
  }

  const format = normalizeTextFormat(metadata.type ?? metadata.format ?? metadata.mode ?? "text");
  return { format, body, metadata };
}

/**
 * Remove a leading `format:`/`type:` header or YAML front matter from text.
 * Returns `null` when no explicit format metadata was present.
 */
export function extractTextFormat(content: string): { format: TextFormat | null; content: string } {
  let body = content.replace(/\r\n?/g, "\n");
  const frontMatter = body.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (frontMatter) {
    try {
      const parsed = parseYaml(frontMatter[1]);
      const value =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>).type ??
            (parsed as Record<string, unknown>).format ??
            (parsed as Record<string, unknown>).mode
          : undefined;
      if (value !== undefined) {
        return {
          format: normalizeTextFormat(value),
          content: body.slice(frontMatter[0].length),
        };
      }
    } catch {
      // Not valid metadata; leave the text alone.
    }
  }

  const firstLine = body.split("\n", 1)[0] ?? "";
  const match = firstLine.match(
    /^\s*(?:type|format|mode)\s*:\s*(html|htm|markdown|md|rst|restructuredtext|restructured|text|plain)\s*$/i,
  );
  if (match) {
    return {
      format: normalizeTextFormat(match[1]),
      content: body.slice(firstLine.length).replace(/^\n/, ""),
    };
  }
  return { format: null, content: body };
}

const PAGE_BREAK_RE = /<!--\s*-?\s*page\s*-?\s*-->|<hr\b[^>]*class=["'][^"']*page-break[^"']*["'][^>]*>/gi;

function sanitizeRichHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li", "blockquote", "pre", "code", "em", "strong", "b", "i", "u",
      "br", "hr", "a", "img", "table", "thead", "tbody", "tr", "th", "td",
      "sup", "sub", "dl", "dt", "dd",
    ],
    allowedAttributes: {
      "*": ["class", "style"],
      a: ["href", "title"],
      img: ["src", "alt", "title"],
    },
    allowedStyles: {
      "*": {
        "font-size": [/^\d+(?:\.\d+)?(?:%|px|em|rem|vw|vh|pt)$/],
        "font-weight": [/^(?:normal|bold|[1-9]00)$/],
        "font-style": [/^(?:normal|italic|oblique)$/],
        "text-decoration": [/^(?:none|underline|overline|line-through)$/],
        "text-align": [/^(?:left|right|center|justify)$/],
        "line-height": [/^\d+(?:\.\d+)?$/],
        color: [/^#[0-9a-f]{3,8}$/i, /^rgb\([^)]*\)$/i, /^[a-z]+$/i],
        "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgb\([^)]*\)$/i, /^[a-z]+$/i],
      },
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
  });
}

/**
 * Accept the common typo `<style="font-size=200%">big</style>` as an inline span.
 * Real `<style>` blocks remain disallowed and are removed by the sanitizer.
 */
function normalizeInlineStyleTags(html: string): string {
  return html.replace(
    /<style\s*=\s*(["'])([^"']*)\1\s*>([\s\S]*?)<\/style>/gi,
    (_match, _quote, css: string, content: string) =>
      `<span style="${css.replace(/=/g, ":")}">${content}</span>`,
  );
}

function renderRichText(body: string, format: TextFormat): string {
  try {
    if (format === "markdown") return sanitizeRichHtml(String(marked.parse(body)));
    if (format === "rst") return sanitizeRichHtml(rst2html(body));
    if (format === "html") return sanitizeRichHtml(normalizeInlineStyleTags(body));
  } catch {
    // Fall through to escaped text.
  }
  return body
    .split("\n")
    .map((line) => `<div class="line">${escapeHtml(line)}</div>`)
    .join("");
}


function chordToken(value: string): string | null {
  if (value === "|" || value === "||:" || value === ":||" || value === "||") return null;
  if (value === "N.C." || value === "NC") return value;
  // A bare dot is a chord continuation/hold marker in several ChordPro sources.
  if (value === ".") return value;
  if (/^[A-G](?:#|b)?[A-Za-z0-9+#°øsusmajmin()/.-]*$/.test(value)) return value;
  return null;
}

export interface LineRenderOptions {
  markdown?: boolean;
  splitWords?: boolean;
  bibleVerseNumbers?: boolean;
}

function applyInlineMarkdown(html: string): string {
  return html
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/==([^=]+)==/g, "<mark>$1</mark>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
}

function renderPlainTextSegment(value: string, bibleVerseNumbers = false): string {
  if (!bibleVerseNumbers) return escapeHtml(value);
  // Bible paragraph imports keep their verse numbers as lightweight markup.
  // Only the exact marker emitted by formatBibleVerses is allowed through.
  const parts: string[] = [];
  const re = /<sup class="sm-bible-verse">(\d{1,3})<\/sup>/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) {
    parts.push(escapeHtml(value.slice(last, match.index)));
    parts.push(`<sup class="sm-bible-verse">${match[1]}</sup>`);
    last = match.index + match[0].length;
  }
  parts.push(escapeHtml(value.slice(last)));
  return parts.join("");
}

const SPLIT_SENTINEL = "\uE000";

function wrapSplitMarkers(value: string): string {
  // SongSelect can place the split marker between words, after a chord, or
  // before a chord. Chord tokens are replaced by a non-space sentinel while
  // this runs, so a marker next to a chord is still treated as a syllable
  // split. Plain hyphens such as "well-known" are left alone.
  return value
    .replace(
      /(\s+)(?=(?:\uE000\s*)+-\s*)/g,
      '<span class="lyric-split">$1</span>',
    )
    .replace(
      /(?<=\S)(\s+-\s+)(?=\S)|(?<=\uE000)(\s*-\s*)(?=\S)|(?<=\S)(\s+-\s*)(?=\uE000)/g,
      (marker) => `<span class="lyric-split">${marker}</span>`,
    );
}

export function renderLine(
  text: string,
  semitones: number,
  options: LineRenderOptions = {},
): string {
  const parts: string[] = [];
  const chords: string[] = [];
  let last = 0;
  const re = /\[([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    parts.push(renderPlainTextSegment(text.slice(last, match.index), options.bibleVerseNumbers));
    const token = match[1].trim();
    const chord = chordToken(token);
    if (chord) {
      const shown = escapeHtml(transposeChord(chord, semitones));
      chords.push(`<span class="chord" data-chord="${shown}">${shown}</span>`);
      parts.push(SPLIT_SENTINEL);
    } else {
      parts.push(escapeHtml(`[${token}]`));
    }
    last = match.index + match[0].length;
  }
  parts.push(renderPlainTextSegment(text.slice(last), options.bibleVerseNumbers));
  let html = parts.join("");
  if (options.markdown) html = applyInlineMarkdown(html);
  if (options.splitWords) html = wrapSplitMarkers(html);
  let chordIndex = 0;
  return html.replace(/\uE000/g, () => chords[chordIndex++] ?? "");
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sectionAliases(label: string): string[] {
  const key = normalize(label);
  const aliases = new Set([key]);
  const verse = key.match(/^v(?:erse)?(\d*)([a-z]?)$/);
  if (verse) {
    aliases.add(`v${verse[1] ?? ""}${verse[2] ?? ""}`);
    aliases.add(`verse${verse[1] ?? ""}${verse[2] ?? ""}`);
  }
  const chorus = key.match(/^c(?:h?orus)?(\d*)([a-z]?)$/);
  if (chorus) {
    aliases.add(`c${chorus[1] ?? ""}${chorus[2] ?? ""}`);
    aliases.add(`chorus${chorus[1] ?? ""}${chorus[2] ?? ""}`);
  }
  const bridge = key.match(/^b(?:ridge)?(\d*)([a-z]?)$/);
  if (bridge) {
    aliases.add(`b${bridge[1] ?? ""}${bridge[2] ?? ""}`);
    aliases.add(`bridge${bridge[1] ?? ""}${bridge[2] ?? ""}`);
  }
  if (key === "prechorus" || key === "pc" || key === "pre") {
    aliases.add("prechorus");
    aliases.add("pc");
    aliases.add("p");
  }
  if (key === "i" || key === "intro" || key === "in") {
    aliases.add("i");
    aliases.add("in");
    aliases.add("intro");
  }
  if (key === "t" || key === "tr" || key === "turnaround" || key === "turn") {
    aliases.add("turnaround");
    aliases.add("tr");
  }
  if (key === "e" || key === "ending" || key === "end") aliases.add("ending");
  if (key === "o" || key === "outro" || key === "out") {
    aliases.add("o");
    aliases.add("out");
    aliases.add("outro");
  }
  if (["int", "instr", "inst", "instrumental"].includes(key)) {
    aliases.add("int");
    aliases.add("instrumental");
  }
  const compact = suggestSongPageId(label);
  if (compact) aliases.add(normalize(compact));
  return [...aliases];
}

function orderBlocks(blocks: Block[], verseOrder: string | null | undefined): Block[] {
  const tokens = (verseOrder ?? "").split(/\s+/).filter(Boolean);
  if (!tokens.length) return blocks;

  const exact = new Map<string, Block[]>();
  const alias = new Map<string, Block[]>();
  const addTo = (map: Map<string, Block[]>, key: string, block: Block) => {
    const list = map.get(key) ?? [];
    if (!list.includes(block)) list.push(block);
    map.set(key, list);
  };
  for (const block of blocks) {
    if (!block.section) continue;
    addTo(exact, normalize(block.section), block);
    for (const key of sectionAliases(block.section)) addTo(alias, key, block);
  }

  const ordered: Block[] = [];
  const used = new Set<Block>();
  for (const token of tokens) {
    const normalized = normalize(token);
    const candidates = exact.get(normalized) ?? alias.get(normalized);
    if (!candidates?.length) continue;
    // Prefer an unused copy when the same label occurs more than once. Falling
    // back to the first copy keeps repeated sections working when the lyrics
    // contain a single block for that label.
    const block = candidates.find((candidate) => !used.has(candidate)) ?? candidates[0];
    ordered.push(block);
    used.add(block);
  }
  for (const block of blocks) {
    if (!used.has(block)) ordered.push(block);
  }
  return ordered.length ? ordered : blocks;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface RenderOptions {
  maxLines?: number;
  maxWords?: number;
  smartPageSplits?: boolean;
  smartWrapMinWords?: number;
  smartWrapModules?: SmartWrapModule[];
  smartWrapModule?: SmartWrapModule;
  textScale?: number;
}

interface PaginationMetrics {
  maxLines: number;
  charsPerLine: number;
  autoLines: number;
}

function paginationMetrics(textScale: number, maxLines: number, smart: boolean): PaginationMetrics {
  // Estimate a 1920×1080 landscape frame with a ~4.2vw main/two-thirds font.
  const fontPx = 82 * clamp(textScale, 0.5, 2.5);
  const charsPerLine = clamp(Math.floor(1610 / (fontPx * 0.52)), 18, 110);
  const autoLines = clamp(Math.floor(780 / (fontPx * 1.2)), 1, 30);
  return {
    maxLines: smart ? Math.min(maxLines, autoLines) : maxLines,
    charsPerLine,
    autoLines,
  };
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function countWrapWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => /[a-z0-9]/i.test(token)).length;
}

const BIBLE_VERSE_MARKER_RE = /<sup class="sm-bible-verse">(\d{1,3})<\/sup>/g;
const BIBLE_VERSE_TOKEN_RE = /\uE100(\d{1,3})\uE101/g;

function protectBibleVerseMarkers(value: string): string {
  return value.replace(BIBLE_VERSE_MARKER_RE, (_match, number: string) => `\uE100${number}\uE101`);
}

function restoreBibleVerseMarkers(value: string): string {
  return value.replace(
    BIBLE_VERSE_TOKEN_RE,
    (_match, number: string) => `<sup class="sm-bible-verse">${number}</sup>`,
  );
}

function visibleTextLength(value: string): number {
  return value
    .replace(BIBLE_VERSE_MARKER_RE, "")
    .replace(BIBLE_VERSE_TOKEN_RE, "")
    .length;
}

function wrapWords(text: string, maxChars: number): string[] {
  const words = protectBibleVerseMarkers(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];

  // Keep SongSelect-style "sat - is - fied" sequences together so a line wrap
  // never separates the " - " marker from the following syllable.
  const units: string[] = [];
  for (let index = 0; index < words.length; ) {
    const word = words[index];
    // A Bible verse number is markup, so keep it with the first word of its
    // verse instead of wrapping it onto a line of its own.
    if (
      /^\uE100\d{1,3}\uE101$/.test(word) &&
      index + 1 < words.length
    ) {
      units.push(`${word} ${words[index + 1]}`);
      index += 2;
      continue;
    }
    if (index + 2 < words.length && words[index + 1] === "-") {
      let unit = words[index];
      index += 1;
      while (index + 1 < words.length && words[index] === "-") {
        unit += ` - ${words[index + 1]}`;
        index += 2;
      }
      units.push(unit);
    } else {
      units.push(words[index]);
      index += 1;
    }
  }

  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;
  for (const unit of units) {
    const unitWidth = visibleTextLength(unit);
    if (!current) {
      current = unit;
      currentWidth = unitWidth;
    } else if (currentWidth + 1 + unitWidth <= maxChars) {
      current += ` ${unit}`;
      currentWidth += 1 + unitWidth;
    } else {
      lines.push(current);
      current = unit;
      currentWidth = unitWidth;
    }
  }
  if (current) lines.push(current);
  return lines.map(restoreBibleVerseMarkers);
}

function paginateBlock(block: Block, options: RenderOptions): Block[] {
  const maxLines = Math.max(1, options.maxLines ?? 4);
  const maxWords = Math.max(1, options.maxWords ?? 90);
  const smart = options.smartPageSplits !== false;
  const metrics = paginationMetrics(options.textScale ?? 1, maxLines, smart);
  const smartWrapMinWords = clamp(Math.floor(options.smartWrapMinWords ?? 15), 1, 100);
  const smartWrapModules = options.smartWrapModules ?? [...SMART_WRAP_MODULES];
  const shouldSmartWrap =
    smartWrapModules.includes(options.smartWrapModule ?? "text");

  const pages: Block[] = [];
  let pageLines: string[] = [];
  let pageWords = 0;
  let section = block.section;

  const flush = () => {
    if (!pageLines.length) return;
    pages.push({
      section,
      lines: pageLines.map((text) => ({ text })),
      hardBreakAfter: false,
    });
    section = null;
    pageLines = [];
    pageWords = 0;
  };

  const addSegment = (segment: string) => {
    const words = countWords(segment);
    if (pageWords > 0 && pageWords + words > maxWords) flush();
    if (pageLines.length >= metrics.maxLines) flush();
    pageLines.push(segment);
    pageWords += words;
    if (pageWords >= maxWords) flush();
  };

  for (const line of block.lines) {
    const segments =
      shouldSmartWrap && countWrapWords(line.text) >= smartWrapMinWords
        ? wrapWords(line.text, metrics.charsPerLine)
        : [line.text];
    for (const segment of segments) addSegment(segment);
  }
  flush();
  return pages;
}

export function buildPages(
  item: RenderItem,
  liveTranspose = 0,
  options: RenderOptions = {},
): LivePage[] {
  const base = item.transpose || 0;
  const keyShift = keyDelta(item.key ?? null, item.keyOverride ?? null);
  const semitones = base + liveTranspose + keyShift;
  const maxLines = Math.max(1, options.maxLines ?? item.maxLines ?? 4);
  const renderOptions: RenderOptions = {
    ...options,
    maxLines,
    maxWords: Math.max(1, options.maxWords ?? 90),
    smartPageSplits: options.smartPageSplits !== false,
    smartWrapMinWords: Math.max(1, options.smartWrapMinWords ?? 15),
    smartWrapModules: options.smartWrapModules ?? [...SMART_WRAP_MODULES],
    smartWrapModule:
      item.kind === "song"
        ? "songs"
        : item.kind === "text" && item.contentSource === "bible"
          ? "bible"
          : "text",
    textScale: options.textScale ?? 1,
  };

  if (item.kind === "tarp") {
    // Tarp display rendering is the next Tarp implementation section.
    return [];
  }

  if (item.kind === "presentation") {
    const embedUrl = (item.content ?? "").trim();
    if (!/^https:\/\//i.test(embedUrl)) return [];
    return [
      {
        index: 0,
        section: null,
        html: `<iframe class="sm-presentation-frame" src="${escapeHtml(embedUrl)}" title="${escapeHtml(
          item.title || "Presentation",
        )}" allow="fullscreen; autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>`,
      },
    ];
  }

  if (item.kind === "image" || item.kind === "image_list") {
    const fit =
      item.imageFit === "actual" || item.imageFit === "crop" || item.imageFit === "stretch"
        ? item.imageFit
        : "scale";
    const imagePage = (relative: string, index: number, title: string): LivePage => {
      const url = `/display/images/file?path=${encodeURIComponent(relative)}&token=${encodeURIComponent(OUTPUT_TOKEN)}`;
      return {
        index,
        section: null,
        html: `<div class="slide-image fit-${fit}"><img src="${escapeHtml(url)}" alt="${escapeHtml(title)}" /></div>`,
      };
    };
    if (item.kind === "image") {
      const relative = (item.content ?? "").trim();
      return relative ? [imagePage(relative, 0, item.title)] : [{ index: 0, section: null, html: "" }];
    }
    const list = parseImageListContent(item.content);
    if (!list) return [{ index: 0, section: null, html: "" }];
    return list.images.map((relative, index) =>
      imagePage(relative, index, relative.split("/").pop() || item.title),
    );
  }

  let blocks: Block[];
  if (item.kind === "text") {
    const parsed = parseTextContent(item.content ?? "");
    const format = item.format ?? parsed.format;
    const align = item.textAlign === "center" ? "center" : "left";
    if (format !== "text") {
      const chunks = parsed.body
        .split(PAGE_BREAK_RE)
        .map((chunk) => chunk.trim())
        .filter(Boolean);
      return chunks.map((chunk, index) => ({
        index,
        section: null,
        html: `<div class="text-html" style="text-align:${align}">${renderRichText(chunk, format)}</div>`,
        source: chunk,
      }));
    }
    blocks = parsed.body
      .split(PAGE_BREAK_RE)
      .flatMap((segment) => parseText(segment));
  } else {
    blocks = (item.lyrics ?? "")
      .split(PAGE_BREAK_RE)
      .flatMap((segment) => orderBlocks(parseSong(segment), item.verseOrder));
  }

  const pages = blocks.flatMap((block) => paginateBlock(block, renderOptions));

  return pages.map((block, index) => {
    const lines = block.lines
      .map(
        (line) =>
          `<div class="line">${renderLine(line.text, semitones, {
            markdown: item.kind === "song" && Boolean(item.lyricsMarkdown),
            splitWords: item.kind === "song",
            bibleVerseNumbers: item.kind === "text" && item.contentSource === "bible",
          })}</div>`,
      )
      .join("");
    const label = block.section
      ? `<div class="section-label">${escapeHtml(block.section)}</div>`
      : "";
    const alignStyle =
      item.kind === "text"
        ? ` style="text-align:${item.textAlign === "center" ? "center" : "left"}"`
        : "";
    const sourceLines = block.lines.map((line) => line.text);
    const source =
      item.kind === "song" && block.section
        ? `[${block.section}]\n${sourceLines.join("\n")}`
        : sourceLines.join("\n");
    return {
      index,
      section: block.section,
      html: `<div class="slide-inner"${alignStyle}>${label}${lines}</div>`,
      source,
    };
  });
}

/**
 * Render one operator-edited page from its raw lyric/text source. The result
 * is deliberately kept to a single page: page overrides replace one page and
 * must not reflow the rest of the item.
 */
export function renderPageSource(
  item: RenderItem,
  source: string,
  liveTranspose = 0,
): { html: string; section: string | null } {
  const base = item.transpose || 0;
  const keyShift = keyDelta(item.key ?? null, item.keyOverride ?? null);
  const semitones = base + liveTranspose + keyShift;
  const align = item.textAlign === "center" ? "center" : "left";

  if (item.kind === "text") {
    const parsed = parseTextContent(item.content ?? "");
    const format = item.format ?? parsed.format;
    if (format !== "text") {
      return {
        section: null,
        html: `<div class="text-html" style="text-align:${align}">${renderRichText(source, format)}</div>`,
      };
    }
    const lines = parseText(source)
      .flatMap((block) => block.lines)
      .map(
        (line) =>
          `<div class="line">${renderLine(line.text, semitones, {
            markdown: false,
            splitWords: false,
            bibleVerseNumbers: item.contentSource === "bible",
          })}</div>`,
      )
      .join("");
    return {
      section: null,
      html: `<div class="slide-inner" style="text-align:${align}">${lines}</div>`,
    };
  }

  const blocks = parseSong(source);
  const section = blocks.find((block) => block.section)?.section ?? null;
  const lines = blocks
    .flatMap((block) => block.lines)
    .map(
      (line) =>
        `<div class="line">${renderLine(line.text, semitones, {
          markdown: Boolean(item.lyricsMarkdown),
          splitWords: true,
          bibleVerseNumbers: false,
        })}</div>`,
    )
    .join("");
  const label = section
    ? `<div class="section-label">${escapeHtml(section)}</div>`
    : "";
  return {
    section,
    html: `<div class="slide-inner">${label}${lines}</div>`,
  };
}
