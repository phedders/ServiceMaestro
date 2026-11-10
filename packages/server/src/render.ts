import type { LivePage } from "@wlm/shared";

export interface RenderItem {
  kind: "song" | "text";
  title: string;
  lyrics?: string | null;
  content?: string | null;
  key?: string | null;
  keyOverride?: string | null;
  transpose: number;
  maxLines: number;
}

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_INDEX: Record<string, number> = {
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
  const blocks =
    item.kind === "song" ? parseSong(item.lyrics ?? "") : parseText(item.content ?? "");

  const pages: Block[] = [];
  for (const block of blocks) {
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
