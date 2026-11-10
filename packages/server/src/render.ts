import type { LivePage } from "@wlm/shared";
import { marked } from "marked";
import rst2html from "rst2html";
import sanitizeHtml from "sanitize-html";
import { parse as parseYaml } from "yaml";

export interface RenderItem {
  kind: "song" | "text";
  title: string;
  lyrics?: string | null;
  content?: string | null;
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
const SECTION_RE =
  /^\s*\[(verse|chorus|bridge|intro|outro|tag|ending|pre[- ]?chorus|interlude|instrumental)[^\]]*\]\s*$/i;

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
    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      flush();
      pendingSection = sectionMatch[0].replace(/^\[|\]$/g, "");
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

const RICH_PAGE_BREAK = /<!--\s*page\s*-->|<hr\b[^>]*class=["'][^"']*page-break[^"']*["'][^>]*>/gi;

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
  if (/^[A-G](?:#|b)?[A-Za-z0-9+#°øsusmajmin()/.-]*$/.test(value)) return value;
  return null;
}

export function renderLine(text: string, semitones: number): string {
  let out = "";
  let last = 0;
  const re = /\[([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    out += escapeHtml(text.slice(last, match.index));
    const token = match[1].trim();
    const chord = chordToken(token);
    if (chord) {
      const shown = escapeHtml(transposeChord(chord, semitones));
      out += `<span class="chord" data-chord="${shown}">${shown}</span>`;
    } else {
      out += escapeHtml(`[${token}]`);
    }
    last = match.index + match[0].length;
  }
  out += escapeHtml(text.slice(last));
  return out;
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
  if (key === "i" || key === "intro") aliases.add("intro");
  if (key === "t" || key === "turnaround") aliases.add("turnaround");
  if (key === "e" || key === "ending" || key === "end") aliases.add("ending");
  if (key === "o" || key === "outro") aliases.add("outro");
  if (["int", "instr", "inst", "instrumental"].includes(key)) {
    aliases.add("int");
    aliases.add("instrumental");
  }
  return [...aliases];
}

function orderBlocks(blocks: Block[], verseOrder: string | null | undefined): Block[] {
  const tokens = (verseOrder ?? "").split(/\s+/).filter(Boolean);
  if (!tokens.length) return blocks;

  const exact = new Map<string, Block>();
  const alias = new Map<string, Block>();
  for (const block of blocks) {
    if (!block.section) continue;
    exact.set(normalize(block.section), block);
    for (const key of sectionAliases(block.section)) {
      if (!alias.has(key)) alias.set(key, block);
    }
  }

  const ordered: Block[] = [];
  const used = new Set<Block>();
  for (const token of tokens) {
    const normalized = normalize(token);
    const block = exact.get(normalized) ?? alias.get(normalized);
    if (!block) continue;
    ordered.push(block);
    used.add(block);
  }
  for (const block of blocks) {
    if (!used.has(block)) ordered.push(block);
  }
  return ordered.length ? ordered : blocks;
}

function chunkBlock(block: Block, maxLines: number): Block[] {
  const chunks: Line[][] = [];
  for (let i = 0; i < block.lines.length; i += maxLines) {
    chunks.push(block.lines.slice(i, i + maxLines));
  }
  if (!chunks.length) return [];
  return chunks.map((lines, index) => ({
    section: index === 0 ? block.section : null,
    lines,
    hardBreakAfter: index === chunks.length - 1 ? block.hardBreakAfter : false,
  }));
}

export function buildPages(item: RenderItem, liveTranspose = 0): LivePage[] {
  const base = item.transpose || 0;
  const keyShift = keyDelta(item.key ?? null, item.keyOverride ?? null);
  const semitones = base + liveTranspose + keyShift;
  const maxLines = Math.max(1, item.maxLines || 4);
  let blocks: Block[];
  if (item.kind === "text") {
    const parsed = parseTextContent(item.content ?? "");
    if (parsed.format !== "text") {
      const chunks = parsed.body
        .split(RICH_PAGE_BREAK)
        .map((chunk) => chunk.trim())
        .filter(Boolean);
      return chunks.map((chunk, index) => ({
        index,
        section: null,
        html: `<div class="text-html">${renderRichText(chunk, parsed.format)}</div>`,
      }));
    }
    blocks = parseText(parsed.body);
  } else {
    blocks = parseSong(item.lyrics ?? "");
  }
  const orderedBlocks = item.kind === "song" ? orderBlocks(blocks, item.verseOrder) : blocks;

  const pages: Block[] = [];
  for (const block of orderedBlocks) {
    const chunks = chunkBlock(block, maxLines);
    pages.push(...chunks);
    if (block.hardBreakAfter && pages.length) {
      // hard breaks are represented by the block split itself
    }
  }

  return pages.map((block, index) => {
    const lines = block.lines
      .map((line) => `<div class="line">${renderLine(line.text, semitones)}</div>`)
      .join("");
    const label = block.section
      ? `<div class="section-label">${escapeHtml(block.section)}</div>`
      : "";
    return {
      index,
      section: block.section,
      html: `<div class="slide-inner">${label}${lines}</div>`,
    };
  });
}
