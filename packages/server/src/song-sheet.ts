import fs from "node:fs";
import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  isSongChordToken,
  songHasChords,
  type SongSheetFont,
} from "@sm/shared";
import { db } from "./db.js";
import { getAsset, listAssets } from "./assets.js";
import { transposeChord } from "./render.js";
import { bareSectionLabel, bracketedSectionLabel } from "./section-labels.js";
import { getAppSettings } from "./settings.js";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const BOTTOM_MARGIN = 48;
const HEADER_SIZE = 9;
const COLUMN_GAP = 22;
const SONG_GAP = 16;

interface PageGeometry {
  width: number;
  height: number;
  margin: number;
  bottomMargin: number;
}

const PORTRAIT_GEOMETRY: PageGeometry = {
  width: PAGE_WIDTH,
  height: PAGE_HEIGHT,
  margin: MARGIN,
  bottomMargin: BOTTOM_MARGIN,
};

const LANDSCAPE_GEOMETRY: PageGeometry = {
  width: PAGE_HEIGHT,
  height: PAGE_WIDTH,
  margin: MARGIN,
  bottomMargin: BOTTOM_MARGIN,
};

const BOOKLET_CONTENT_GEOMETRY: PageGeometry = {
  width: PAGE_HEIGHT / 2,
  height: PAGE_WIDTH,
  margin: 32,
  bottomMargin: 32,
};

const PDF_FONTS: Record<
  SongSheetFont,
  {
    regular: StandardFonts;
    bold: StandardFonts;
    italic: StandardFonts;
    boldItalic: StandardFonts;
  }
> = {
  Helvetica: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    boldItalic: StandardFonts.HelveticaBoldOblique,
  },
  TimesRoman: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic,
    boldItalic: StandardFonts.TimesRomanBoldItalic,
  },
  Courier: {
    regular: StandardFonts.Courier,
    bold: StandardFonts.CourierBold,
    italic: StandardFonts.CourierOblique,
    boldItalic: StandardFonts.CourierBoldOblique,
  },
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface SongSheetRow {
  item_id: string;
  song_id: string | null;
  item_title: string;
  item_content: string | null;
  item_transpose: number;
  song_title: string | null;
  author: string | null;
  copyright: string | null;
  ccli: string | null;
  lyrics: string | null;
}

interface SetlistRow {
  id: string;
  name: string;
  service_date: string;
  service_time: string | null;
}

interface SongForPdf {
  itemId: string;
  songId: string | null;
  title: string;
  author: string | null;
  copyright: string | null;
  ccli: string | null;
  transpose: number;
  lyrics: string;
  layout: SongSheetLine[];
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'");
}

function plainLyricLine(value: string): string {
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/==(.*?)==/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/^#{1,6}\s+/, "")
      .replace(/\s+/g, " "),
  ).trim();
}

export interface SongSheetLine {
  text: string;
  section: string | null;
  isChorus: boolean;
  placeholder: boolean;
}

export function isChorusSectionLabel(value: string): boolean {
  const compact = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return compact.startsWith("chorus") || /^c\d*$/.test(compact);
}

function sectionLabelForRaw(value: string): string | null {
  const bracketed = value.match(/^\s*\[([^\]]+)\]\s*$/);
  if (bracketed) {
    const token = bracketed[1].trim();
    if (isSongChordToken(token)) return null;
    return bracketedSectionLabel(token);
  }
  return bareSectionLabel(value);
}

function collapseRepeatedChoruses(lines: SongSheetLine[]): SongSheetLine[] {
  const result: SongSheetLine[] = [];
  const seen = new Set<string>();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.section || !line.isChorus) {
      result.push(line);
      index += 1;
      continue;
    }

    result.push(line);
    let end = index + 1;
    const body: SongSheetLine[] = [];
    while (end < lines.length && !lines[end].section) {
      body.push(lines[end]);
      end += 1;
    }
    const key = body
      .map((entry) => entry.text.trim())
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    if (key && seen.has(key)) {
      result.push({
        text: "<CHORUS>",
        section: null,
        isChorus: true,
        placeholder: true,
      });
    } else {
      if (key) seen.add(key);
      result.push(...body);
    }
    index = end;
  }
  return result;
}

export function songSheetLayout(lyrics: string): SongSheetLine[] {
  const lines: SongSheetLine[] = [];
  let currentChorus = false;
  for (const raw of lyrics.replace(/\r\n?/g, "\n").split("\n")) {
    const section = sectionLabelForRaw(raw);
    if (section) {
      currentChorus = isChorusSectionLabel(section);
      lines.push({
        text: "",
        section,
        isChorus: currentChorus,
        placeholder: false,
      });
      continue;
    }
    const text = plainLyricLine(raw);
    if (!text) {
      const previous = lines[lines.length - 1];
      if (previous && (previous.text || previous.section)) {
        lines.push({
          text: "",
          section: null,
          isChorus: currentChorus,
          placeholder: false,
        });
      }
      continue;
    }
    lines.push({
      text,
      section: null,
      isChorus: currentChorus,
      placeholder: false,
    });
  }
  while (lines.length && !lines[lines.length - 1].text && !lines[lines.length - 1].section) {
    lines.pop();
  }
  return collapseRepeatedChoruses(lines);
}

export function songSheetLines(lyrics: string): string[] {
  return songSheetLayout(lyrics)
    .filter((line) => !line.section)
    .map((line) => line.text);
}

function pdfSafe(value: string): string {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ")
    .replace(/[^\u0000-\u00ff]/g, "?");
}

function wrapLine(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  if (!text) return [""];
  const fits = (value: string) => font.widthOfTextAtSize(value, size) <= maxWidth;
  if (fits(text)) return [text];

  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = "";
    if (fits(word)) {
      current = word;
      continue;
    }
    let fragment = "";
    for (const character of word) {
      const next = fragment + character;
      if (fits(next)) {
        fragment = next;
      } else {
        if (fragment) lines.push(fragment);
        fragment = character;
      }
    }
    current = fragment;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function plainChordSegment(value: string): string {
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/==(.*?)==/g, "$1")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/^#{1,6}\s+/, ""),
  ).replace(/[ \t]+/g, " ");
}

export interface ChordSheetLine {
  text: string;
  chords: Array<{ index: number; chord: string }>;
  section: string | null;
}

/** Parse ChordPro-style lyrics into text, positioned chord marks and section labels. */
export function chordSheetLines(lyrics: string): ChordSheetLine[] {
  const lines: ChordSheetLine[] = [];
  for (const raw of lyrics.replace(/\r\n?/g, "\n").split("\n")) {
    const section = sectionLabelForRaw(raw);
    if (section) {
      lines.push({ text: "", chords: [], section });
      continue;
    }

    let text = "";
    const chords: Array<{ index: number; chord: string }> = [];
    let last = 0;
    const re = /\[([^\]]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(raw))) {
      text += plainChordSegment(raw.slice(last, match.index));
      const token = match[1].trim();
      if (isSongChordToken(token)) {
        chords.push({ index: text.length, chord: token });
      } else {
        text += `[${token}]`;
      }
      last = match.index + match[0].length;
    }
    text += plainChordSegment(raw.slice(last));
    text = text.replace(/[ \t]+$/, "");

    if (!text && !chords.length) {
      const previous = lines[lines.length - 1];
      if (previous && (previous.text || previous.chords.length || previous.section)) {
        lines.push({ text: "", chords: [], section: null });
      }
      continue;
    }
    lines.push({ text, chords, section: null });
  }
  while (lines.length && !lines[lines.length - 1].text && !lines[lines.length - 1].chords.length) {
    if (!lines[lines.length - 1].section) lines.pop();
    else break;
  }
  return lines;
}

function collapseRepeatedChordChoruses(lines: ChordSheetLine[]): ChordSheetLine[] {
  const result: ChordSheetLine[] = [];
  const seen = new Set<string>();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.section || !isChorusSectionLabel(line.section)) {
      result.push(line);
      index += 1;
      continue;
    }

    result.push(line);
    let end = index + 1;
    const body: ChordSheetLine[] = [];
    while (end < lines.length && !lines[end].section) {
      body.push(lines[end]);
      end += 1;
    }
    const key = body
      .filter((entry) => entry.text || entry.chords.length)
      .map(
        (entry) =>
          `${entry.text.trim()}|${entry.chords
            .map((mark) => `${mark.index}:${mark.chord}`)
            .join(",")}`,
      )
      .join("\n")
      .toLowerCase();
    if (key && seen.has(key)) {
      result.push({ text: "<CHORUS>", chords: [], section: null });
    } else {
      if (key) seen.add(key);
      result.push(...body);
    }
    index = end;
  }
  return result;
}

/**
 * Wrap text while retaining each wrapped row's start offset, so chord marks
 * can be placed above the correct word.
 */
function wrapTextWithOffsets(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): Array<{ text: string; start: number }> {
  if (!text) return [];
  const fits = (value: string) => font.widthOfTextAtSize(value, size) <= maxWidth;
  if (fits(text)) return [{ text, start: 0 }];

  const rows: Array<{ text: string; start: number }> = [];
  let start = 0;
  while (start < text.length) {
    let end = start;
    let lastSpace = -1;
    while (end < text.length) {
      if (text[end] === " ") lastSpace = end;
      if (!fits(text.slice(start, end + 1))) break;
      end += 1;
    }
    if (end >= text.length) {
      rows.push({ text: text.slice(start), start });
      break;
    }
    if (end === start) end += 1;
    const breakAt = lastSpace > start ? lastSpace : end;
    rows.push({ text: text.slice(start, breakAt).trimEnd(), start });
    start = breakAt;
    while (text[start] === " ") start += 1;
  }
  return rows.length ? rows : [{ text, start: 0 }];
}

function printedDate(serviceDate: string, serviceTime: string | null): string {
  const match = serviceDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return serviceDate;
  const [, year, month, day] = match;
  const name = MONTHS[Number(month) - 1] ?? month;
  return `${Number(day)} ${name} ${year}${serviceTime ? ` · ${serviceTime}` : ""}`;
}

function safeFilename(
  name: string,
  serviceDate: string,
  kind = "songs",
  extension = "pdf",
): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "service";
  return `${base}-${serviceDate}-${kind}.${extension}`;
}

function loadSongs(setlistId: string): { setlist: SetlistRow; songs: SongForPdf[] } {
  const setlist = db
    .prepare("SELECT id, name, service_date, service_time FROM setlists WHERE id = ?")
    .get(setlistId) as SetlistRow | undefined;
  if (!setlist) throw new Error("Set list not found");
  const rows = db
    .prepare(
      `SELECT i.id AS item_id, i.song_id, i.title AS item_title,
              i.content AS item_content, i.transpose AS item_transpose,
              s.title AS song_title, s.author, s.copyright, s.ccli, s.lyrics
       FROM setlist_items i
       LEFT JOIN songs s ON s.id = i.song_id
       WHERE i.setlist_id = ? AND i.kind = 'song'
       ORDER BY i.position ASC, i.rowid ASC`,
    )
    .all(setlistId) as SongSheetRow[];
  return {
    setlist,
    songs: rows.map((row) => {
      const lyrics = row.item_content ?? row.lyrics ?? "";
      return {
        itemId: row.item_id,
        songId: row.song_id,
        title: (row.item_title || row.song_title || "Song").trim(),
        author: row.author,
        copyright: row.copyright,
        ccli: row.ccli,
        transpose: row.item_transpose ?? 0,
        lyrics,
        layout: songSheetLayout(lyrics),
      };
    }),
  };
}

export interface SongSheetOptions {
  fontSize?: number;
  columns?: number;
  pageNumbers?: boolean;
  boldText?: boolean;
  chorusItalic?: boolean;
  orientation?: "portrait" | "landscape" | "booklet";
}

export interface ChordSheetOptions extends Omit<SongSheetOptions, "orientation"> {
  orientation?: "portrait" | "landscape";
  chordsOnly?: boolean;
}

export type SongSheetFormat = "pdf" | "docx" | "odf";

async function buildSongSheetPdfFromSongs(
  setlist: SetlistRow,
  songs: SongForPdf[],
  options: SongSheetOptions = {},
  geometry: PageGeometry = PORTRAIT_GEOMETRY,
): Promise<{ buffer: Buffer; filename: string }> {
  if (!songs.length) throw new Error("This set list has no songs");
  const pageWidth = geometry.width;
  const pageHeight = geometry.height;
  const margin = geometry.margin;
  const bottomMargin = geometry.bottomMargin;
  const settings = getAppSettings();
  const baseSize = Math.max(
    8,
    Math.min(28, Math.round(options.fontSize ?? settings.songSheetFontSize)),
  );
  const columnCount = Math.max(
    1,
    Math.min(3, Math.round(options.columns ?? settings.songSheetColumns)),
  );
  const fontChoice = PDF_FONTS[settings.songSheetFontFamily];
  const boldText = options.boldText !== false;
  const chorusItalic = options.chorusItalic !== false;
  const pageTitleSize = baseSize * 1.4;
  const songTitleSize = baseSize * 1.2;
  const songTitleLineHeight = songTitleSize * 1.18;
  const metadataSize = 8;
  const lineHeight = baseSize * 1.45;
  const paragraphGap = baseSize * 0.6;
  const contentWidth = pageWidth - margin * 2;
  const columnWidth = (contentWidth - COLUMN_GAP * (columnCount - 1)) / columnCount;
  const columnX = (index: number) => margin + index * (columnWidth + COLUMN_GAP);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(fontChoice.regular);
  const bold = await pdf.embedFont(fontChoice.bold);
  const italic = await pdf.embedFont(fontChoice.italic);
  const boldItalic = await pdf.embedFont(fontChoice.boldItalic);
  const headingFont = boldText ? bold : font;
  const headerTitleLines = wrapLine(pdfSafe(setlist.name), headingFont, pageTitleSize, contentWidth);
  const headerTitleTop = pageHeight - 28;
  const headerTitleLineHeight = pageTitleSize * 1.12;
  const headerMetaBaseline =
    headerTitleTop - headerTitleLines.length * headerTitleLineHeight - 2;
  const headerRuleY = headerMetaBaseline - 9;
  const contentTop = headerRuleY - 16;
  const date = printedDate(setlist.service_date, setlist.service_time);
  const metadataFont = boldText ? bold : font;
  const dark = rgb(0.08, 0.1, 0.14);
  const muted = rgb(0.38, 0.42, 0.48);
  const rule = rgb(0.82, 0.84, 0.87);

  let page: PDFPage = pdf.addPage([pageWidth, pageHeight]);
  let column = 0;
  let y = contentTop;

  const pageHeader = (target: PDFPage) => {
    let headerY = headerTitleTop;
    for (const line of headerTitleLines) {
      target.drawText(line, {
        x: margin,
        y: headerY,
        size: pageTitleSize,
        font: headingFont,
        color: dark,
      });
      headerY -= headerTitleLineHeight;
    }
    target.drawText(pdfSafe(date), {
      x: margin,
      y: headerMetaBaseline,
      size: HEADER_SIZE,
      font: metadataFont,
      color: muted,
    });
    target.drawLine({
      start: { x: margin, y: headerRuleY },
      end: { x: pageWidth - margin, y: headerRuleY },
      thickness: 0.6,
      color: rule,
    });
  };
  pageHeader(page);

  const nextColumn = (continuationTitle?: string) => {
    if (column + 1 < columnCount) {
      column += 1;
    } else {
      page = pdf.addPage([pageWidth, pageHeight]);
      pageHeader(page);
      column = 0;
    }
    y = contentTop;
    if (continuationTitle) {
      page.drawText(pdfSafe(`${continuationTitle} (continued)`), {
        x: columnX(column),
        y,
        size: metadataSize,
        font: italic,
        color: muted,
      });
      y -= metadataSize + 8;
    }
  };

  const ensureSpace = (height: number, continuationTitle?: string) => {
    if (y - height < bottomMargin) nextColumn(continuationTitle);
  };

  for (const song of songs) {
    const titleLines = wrapLine(pdfSafe(song.title), headingFont, songTitleSize, columnWidth);
    const byline = song.author ? `Words: ${song.author}` : "";
    const previewLines = song.layout.filter((line) => !line.section && line.text).slice(0, 2);
    const previewLyricLines = previewLines
      .flatMap((line) => wrapLine(pdfSafe(line.text), boldText ? bold : font, baseSize, columnWidth))
      .slice(0, 2).length;
    const required =
      titleLines.length * songTitleLineHeight +
      (byline ? metadataSize + 8 : 0) +
      6 +
      previewLyricLines * lineHeight;
    ensureSpace(required);

    for (const line of titleLines) {
      page.drawText(line, {
        x: columnX(column),
        y,
        size: songTitleSize,
        font: headingFont,
        color: dark,
      });
      y -= songTitleLineHeight;
    }
    if (byline) {
      page.drawText(pdfSafe(byline), {
        x: columnX(column),
        y,
        size: metadataSize,
        font: metadataFont,
        color: muted,
      });
      y -= metadataSize + 8;
    }
    y -= 6;

    for (const line of song.layout) {
      if (line.section) continue;
      if (!line.text) {
        y = Math.max(bottomMargin, y - paragraphGap);
        continue;
      }
      const chorus = line.isChorus && chorusItalic;
      const bodyFont = chorus ? (boldText ? boldItalic : italic) : boldText ? bold : font;
      const wrapped = wrapLine(pdfSafe(line.text), bodyFont, baseSize, columnWidth);
      for (const text of wrapped) {
        ensureSpace(lineHeight, song.title);
        page.drawText(text, {
          x: columnX(column),
          y,
          size: baseSize,
          font: bodyFont,
          color: dark,
        });
        y -= lineHeight;
      }
    }

    const attribution = [song.copyright, song.ccli ? `CCLI ${song.ccli}` : ""]
      .filter(Boolean)
      .join("  ·  ");
    if (attribution) {
      ensureSpace(metadataSize + 12, song.title);
      y -= 6;
      page.drawText(pdfSafe(attribution), {
        x: columnX(column),
        y,
        size: metadataSize,
        font: metadataFont,
        color: muted,
      });
      y -= metadataSize;
    }
    y -= SONG_GAP;
  }

  if (options.pageNumbers !== false) {
    const pages = pdf.getPages();
    pages.forEach((target, index) => {
      target.drawText(`${index + 1} / ${pages.length}`, {
        x: pageWidth - margin - 34,
        y: 24,
        size: 8,
        font: metadataFont,
        color: muted,
      });
    });
  }

  return {
    buffer: Buffer.from(await pdf.save()),
    filename: safeFilename(setlist.name, setlist.service_date),
  };
}

export function bookletPageOrder(pageCount: number): Array<[number, number]> {
  const totalPages = Math.max(4, Math.ceil(pageCount / 4) * 4);
  const sides: Array<[number, number]> = [];
  for (let sheet = 0; sheet < totalPages / 4; sheet += 1) {
    sides.push([totalPages - 1 - sheet * 2, sheet * 2]);
    sides.push([sheet * 2 + 1, totalPages - 2 - sheet * 2]);
  }
  return sides;
}

async function buildBookletSongSheetPdf(
  setlist: SetlistRow,
  songs: SongForPdf[],
  options: SongSheetOptions,
): Promise<{ buffer: Buffer; filename: string }> {
  const content = await buildSongSheetPdfFromSongs(
    setlist,
    songs,
    { ...options, orientation: "portrait" },
    BOOKLET_CONTENT_GEOMETRY,
  );
  const contentPdf = await PDFDocument.load(content.buffer);
  const contentPageCount = contentPdf.getPageCount();
  const order = bookletPageOrder(contentPageCount);
  const pdf = await PDFDocument.create();
  const embedded = await pdf.embedPages(contentPdf.getPages());
  const sheetWidth = LANDSCAPE_GEOMETRY.width;
  const sheetHeight = LANDSCAPE_GEOMETRY.height;
  const halfWidth = sheetWidth / 2;
  const place = (side: PDFPage, pageIndex: number, x: number) => {
    if (pageIndex >= contentPageCount) return;
    side.drawPage(embedded[pageIndex], {
      x,
      y: 0,
      width: halfWidth,
      height: sheetHeight,
    });
  };
  for (const [left, right] of order) {
    const side = pdf.addPage([sheetWidth, sheetHeight]);
    place(side, left, 0);
    place(side, right, halfWidth);
  }

  return {
    buffer: Buffer.from(await pdf.save()),
    filename: safeFilename(setlist.name, setlist.service_date, "songs-booklet"),
  };
}

export async function buildSongSheetPdf(
  setlistId: string,
  options: SongSheetOptions = {},
): Promise<{ buffer: Buffer; filename: string }> {
  const { setlist, songs } = loadSongs(setlistId);
  if (options.orientation === "booklet") {
    return buildBookletSongSheetPdf(setlist, songs, options);
  }
  return buildSongSheetPdfFromSongs(
    setlist,
    songs,
    options,
    options.orientation === "landscape" ? LANDSCAPE_GEOMETRY : PORTRAIT_GEOMETRY,
  );
}

export type SetlistMediaType = "vocal" | "lead" | "score" | "tab";

function mediaAssetFor(songId: string | null, mediaType: SetlistMediaType) {
  if (!songId) return null;
  return (
    listAssets(songId).find((asset) => {
      if (mediaType === "vocal") {
        return asset.kind === "score_pdf" && /vocal/i.test(asset.title);
      }
      if (mediaType === "lead") {
        return asset.kind === "score_pdf" && /lead/i.test(asset.title);
      }
      if (mediaType === "score") {
        return asset.kind === "score_pdf" && !/vocal|lead/i.test(asset.title);
      }
      return asset.kind === "guitar_tab";
    }) ?? null
  );
}

/**
 * Merge the chosen PDF media type across a set list. Songs without a matching
 * file (or with a non-PDF file) fall back to their normal lyric pages.
 */
export async function buildMediaSheetPdf(
  setlistId: string,
  mediaType: SetlistMediaType,
  options: SongSheetOptions = {},
): Promise<{ buffer: Buffer; filename: string }> {
  const { setlist, songs } = loadSongs(setlistId);
  if (!songs.length) throw new Error("This set list has no songs");
  const pdf = await PDFDocument.create();
  for (const song of songs) {
    let copied = false;
    const asset = mediaAssetFor(song.songId, mediaType);
    if (asset && (asset.mime === "application/pdf" || asset.format === "pdf")) {
      const found = getAsset(asset.id);
      if (found) {
        try {
          const source = await PDFDocument.load(fs.readFileSync(found.absolutePath));
          const pages = await pdf.copyPages(source, source.getPageIndices());
          for (const page of pages) pdf.addPage(page);
          copied = true;
        } catch {
          // Corrupt or unreadable files fall back to the lyric sheet.
        }
      }
    }
    if (copied) continue;
    const fallback = await buildSongSheetPdfFromSongs(setlist, [song], {
      ...options,
      pageNumbers: false,
    });
    const source = await PDFDocument.load(fallback.buffer);
    const pages = await pdf.copyPages(source, source.getPageIndices());
    for (const page of pages) pdf.addPage(page);
  }
  if (!pdf.getPageCount()) throw new Error("No pages could be generated");
  return {
    buffer: Buffer.from(await pdf.save()),
    filename: safeFilename(setlist.name, setlist.service_date, mediaType),
  };
}

/**
 * Printable chord charts for musicians. Keeps chord symbols and section
 * labels, applies each set-list item's transpose value, and can omit songs
 * without chords. Supports portrait and landscape pages.
 */
export async function buildChordSheetPdf(
  setlistId: string,
  options: ChordSheetOptions = {},
): Promise<{ buffer: Buffer; filename: string }> {
  const { setlist, songs } = loadSongs(setlistId);
  const chordsOnly = options.chordsOnly !== false;
  const chordSongs = chordsOnly ? songs.filter((song) => songHasChords(song.lyrics)) : songs;
  if (!chordSongs.length) {
    throw new Error(
      chordsOnly ? "This set list has no songs with chords" : "This set list has no songs",
    );
  }
  const settings = getAppSettings();
  const baseSize = Math.max(
    8,
    Math.min(28, Math.round(options.fontSize ?? settings.songSheetFontSize)),
  );
  const columnCount = Math.max(
    1,
    Math.min(3, Math.round(options.columns ?? settings.songSheetColumns)),
  );
  const landscape = options.orientation === "landscape";
  const pageWidth = landscape ? PAGE_HEIGHT : PAGE_WIDTH;
  const pageHeight = landscape ? PAGE_WIDTH : PAGE_HEIGHT;
  const fontChoice = PDF_FONTS[settings.songSheetFontFamily];
  const boldText = options.boldText !== false;
  const chorusItalic = options.chorusItalic !== false;
  const pageTitleSize = baseSize * 1.4;
  const songTitleSize = baseSize * 1.2;
  const songTitleLineHeight = songTitleSize * 1.18;
  const metadataSize = 8;
  const lineHeight = baseSize * 1.45;
  const chordSize = Math.max(7.5, baseSize * 0.72);
  const chordLineHeight = chordSize * 1.3;
  const chordGap = Math.max(4, chordSize * 0.4);
  const sectionSize = Math.max(8.5, baseSize * 0.72);
  const paragraphGap = baseSize * 0.6;
  const contentWidth = pageWidth - MARGIN * 2;
  const columnWidth = (contentWidth - COLUMN_GAP * (columnCount - 1)) / columnCount;
  const columnX = (index: number) => MARGIN + index * (columnWidth + COLUMN_GAP);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(fontChoice.regular);
  const bold = await pdf.embedFont(fontChoice.bold);
  const italic = await pdf.embedFont(fontChoice.italic);
  const boldItalic = await pdf.embedFont(fontChoice.boldItalic);
  const headingFont = boldText ? bold : font;
  const headerTitleLines = wrapLine(pdfSafe(setlist.name), headingFont, pageTitleSize, contentWidth);
  const headerTitleTop = pageHeight - 28;
  const headerTitleLineHeight = pageTitleSize * 1.12;
  const headerMetaBaseline =
    headerTitleTop - headerTitleLines.length * headerTitleLineHeight - 2;
  const headerRuleY = headerMetaBaseline - 9;
  const contentTop = headerRuleY - 16;
  const date = printedDate(setlist.service_date, setlist.service_time);
  const metadataFont = boldText ? bold : font;
  const dark = rgb(0.08, 0.1, 0.14);
  const muted = rgb(0.38, 0.42, 0.48);
  const rule = rgb(0.82, 0.84, 0.87);

  let page: PDFPage = pdf.addPage([pageWidth, pageHeight]);
  let column = 0;
  let y = contentTop;

  const pageHeader = (target: PDFPage) => {
    let headerY = headerTitleTop;
    for (const line of headerTitleLines) {
      target.drawText(line, {
        x: MARGIN,
        y: headerY,
        size: pageTitleSize,
        font: headingFont,
        color: dark,
      });
      headerY -= headerTitleLineHeight;
    }
    target.drawText(pdfSafe(`${date}  ·  Chords`), {
      x: MARGIN,
      y: headerMetaBaseline,
      size: HEADER_SIZE,
      font: metadataFont,
      color: muted,
    });
    target.drawLine({
      start: { x: MARGIN, y: headerRuleY },
      end: { x: pageWidth - MARGIN, y: headerRuleY },
      thickness: 0.6,
      color: rule,
    });
  };
  pageHeader(page);

  const nextColumn = (continuationTitle?: string) => {
    if (column + 1 < columnCount) {
      column += 1;
    } else {
      page = pdf.addPage([pageWidth, pageHeight]);
      pageHeader(page);
      column = 0;
    }
    y = contentTop;
    if (continuationTitle) {
      page.drawText(pdfSafe(`${continuationTitle} (continued)`), {
        x: columnX(column),
        y,
        size: metadataSize,
        font: italic,
        color: muted,
      });
      y -= metadataSize + 8;
    }
  };

  const ensureSpace = (height: number, continuationTitle?: string) => {
    if (y - height < BOTTOM_MARGIN) nextColumn(continuationTitle);
  };

  for (const song of chordSongs) {
    const lines = collapseRepeatedChordChoruses(chordSheetLines(song.lyrics));
    const titleLines = wrapLine(pdfSafe(song.title), headingFont, songTitleSize, columnWidth);
    const byline = song.author ? `Words: ${song.author}` : "";
    const firstContent = lines.find((line) => line.text || line.chords.length || line.section);
    const previewHeight = firstContent
      ? (firstContent.chords.length ? chordLineHeight : 0) +
        (firstContent.text ? lineHeight : firstContent.section ? sectionSize + 6 : 0)
      : 0;
    const required =
      titleLines.length * songTitleLineHeight +
      (byline ? metadataSize + 8 : 0) +
      6 +
      previewHeight;
    ensureSpace(required);

    for (const line of titleLines) {
      page.drawText(line, {
        x: columnX(column),
        y,
        size: songTitleSize,
        font: headingFont,
        color: dark,
      });
      y -= songTitleLineHeight;
    }
    if (byline) {
      page.drawText(pdfSafe(byline), {
        x: columnX(column),
        y,
        size: metadataSize,
        font: metadataFont,
        color: muted,
      });
      y -= metadataSize + 8;
    }
    y -= 6;

    let currentChorus = false;
    for (const line of lines) {
      if (!line.text && !line.chords.length && !line.section) {
        y = Math.max(BOTTOM_MARGIN, y - paragraphGap);
        continue;
      }

      if (line.section) {
        currentChorus = isChorusSectionLabel(line.section);
        ensureSpace(sectionSize + 6, song.title);
        page.drawText(pdfSafe(line.section), {
          x: columnX(column),
          y,
          size: sectionSize,
          font: headingFont,
          color: muted,
        });
        y -= sectionSize + 6;
        continue;
      }

      if (!line.text && line.chords.length) {
        ensureSpace(chordLineHeight, song.title);
        let chordX = columnX(column);
        for (const mark of line.chords) {
          const value = pdfSafe(transposeChord(mark.chord, song.transpose));
          page.drawText(value, {
            x: chordX,
            y,
            size: chordSize,
            font: headingFont,
            color: dark,
          });
          chordX += headingFont.widthOfTextAtSize(value, chordSize) + chordGap;
        }
        y -= chordLineHeight;
        continue;
      }

      const chorus = currentChorus && chorusItalic;
      const bodyFont = chorus ? (boldText ? boldItalic : italic) : boldText ? bold : font;
      const rows = wrapTextWithOffsets(line.text, bodyFont, baseSize, columnWidth);
      for (const row of rows) {
        const rowEnd = row.start + row.text.length;
        const rowChords = line.chords.filter(
          (mark) => mark.index >= row.start && mark.index <= rowEnd,
        );
        ensureSpace((rowChords.length ? chordLineHeight : 0) + lineHeight, song.title);
        if (rowChords.length) {
          let lastChordX = -Infinity;
          for (const mark of rowChords) {
            const offset = Math.max(0, Math.min(row.text.length, mark.index - row.start));
            const value = pdfSafe(transposeChord(mark.chord, song.transpose));
            const x = Math.max(
              columnX(column) + bodyFont.widthOfTextAtSize(row.text.slice(0, offset), baseSize),
              lastChordX + chordGap,
            );
            page.drawText(value, {
              x,
              y,
              size: chordSize,
              font: headingFont,
              color: dark,
            });
            lastChordX = x + headingFont.widthOfTextAtSize(value, chordSize);
          }
          y -= chordLineHeight;
        }
        page.drawText(pdfSafe(row.text), {
          x: columnX(column),
          y,
          size: baseSize,
          font: bodyFont,
          color: dark,
        });
        y -= lineHeight;
      }
    }

    const attribution = [song.copyright, song.ccli ? `CCLI ${song.ccli}` : ""]
      .filter(Boolean)
      .join("  ·  ");
    if (attribution) {
      ensureSpace(metadataSize + 12, song.title);
      y -= 6;
      page.drawText(pdfSafe(attribution), {
        x: columnX(column),
        y,
        size: metadataSize,
        font: metadataFont,
        color: muted,
      });
      y -= metadataSize;
    }
    y -= SONG_GAP;
  }

  const pages = pdf.getPages();
  pages.forEach((target, index) => {
    target.drawText(`${index + 1} / ${pages.length}`, {
      x: pageWidth - MARGIN - 34,
      y: 24,
      size: 8,
      font: metadataFont,
      color: muted,
    });
  });

  return {
    buffer: Buffer.from(await pdf.save()),
    filename: safeFilename(setlist.name, setlist.service_date, "chords"),
  };
}

/* -------------------------------------------------------------------------
 * ODF / DOCX output
 * ---------------------------------------------------------------------- */

const DOC_FONTS: Record<SongSheetFont, string> = {
  Helvetica: "Arial",
  TimesRoman: "Times New Roman",
  Courier: "Courier New",
};

type PrintBlockKind =
  | "pageTitle"
  | "pageMeta"
  | "songTitle"
  | "metadata"
  | "body"
  | "chorus"
  | "section"
  | "chord"
  | "chordText"
  | "chorusChordText"
  | "blank";

interface PrintWriter {
  paragraph(kind: PrintBlockKind, text: string): void;
}

interface SheetPrintContext {
  setlist: SetlistRow;
  songs: SongForPdf[];
  baseSize: number;
  columns: number;
  landscape: boolean;
  boldText: boolean;
  chorusItalic: boolean;
  fontFamily: string;
}

function sheetPrintContext(
  setlist: SetlistRow,
  songs: SongForPdf[],
  options: SongSheetOptions,
  chordMode: boolean,
): SheetPrintContext {
  const settings = getAppSettings();
  const baseSize = Math.max(
    8,
    Math.min(28, Math.round(options.fontSize ?? settings.songSheetFontSize)),
  );
  const columns = Math.max(
    1,
    Math.min(3, Math.round(options.columns ?? settings.songSheetColumns)),
  );
  return {
    setlist,
    songs,
    baseSize,
    columns,
    landscape: options.orientation === "landscape",
    boldText: options.boldText !== false,
    chorusItalic: options.chorusItalic !== false,
    fontFamily: DOC_FONTS[settings.songSheetFontFamily],
  };
}

function writeSongWords(writer: PrintWriter, context: SheetPrintContext): void {
  const { setlist, songs, chorusItalic } = context;
  writer.paragraph("pageTitle", setlist.name);
  writer.paragraph(
    "pageMeta",
    printedDate(setlist.service_date, setlist.service_time),
  );

  for (const song of songs) {
    writer.paragraph("songTitle", song.title);
    if (song.author) writer.paragraph("metadata", `Words: ${song.author}`);
    for (const line of song.layout) {
      if (line.section) continue;
      if (!line.text) {
        writer.paragraph("blank", "");
        continue;
      }
      writer.paragraph(
        line.isChorus && chorusItalic ? "chorus" : "body",
        line.text,
      );
    }
    const attribution = [song.copyright, song.ccli ? `CCLI ${song.ccli}` : ""]
      .filter(Boolean)
      .join("  ·  ");
    if (attribution) writer.paragraph("metadata", attribution);
    writer.paragraph("blank", "");
  }
}

function wrapCharacters(
  text: string,
  maxChars: number,
): Array<{ text: string; start: number }> {
  if (!text) return [];
  const rows: Array<{ text: string; start: number }> = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + Math.max(1, maxChars));
    if (end < text.length) {
      const space = text.lastIndexOf(" ", end);
      if (space > start) end = space;
    }
    rows.push({ text: text.slice(start, end).trimEnd(), start });
    start = end;
    while (text[start] === " ") start += 1;
  }
  return rows;
}

function wrappedChordRows(
  line: ChordSheetLine,
  maxChars: number,
): Array<{ text: string; chords: Array<{ index: number; chord: string }> }> {
  if (!line.text) return [{ text: "", chords: line.chords }];
  return wrapCharacters(line.text, maxChars).map((row) => {
    const end = row.start + row.text.length;
    return {
      text: row.text,
      chords: line.chords
        .filter((mark) => mark.index >= row.start && mark.index <= end)
        .map((mark) => ({ index: mark.index - row.start, chord: mark.chord })),
    };
  });
}

function chordLineText(
  row: { text: string; chords: Array<{ index: number; chord: string }> },
  transpose: number,
): string {
  let result = "";
  for (const mark of [...row.chords].sort((a, b) => a.index - b.index)) {
    const value = transposeChord(mark.chord, transpose);
    if (mark.index > result.length) {
      result += " ".repeat(mark.index - result.length);
    } else if (result.length > 0) {
      result += " ";
    }
    result += value;
  }
  return result.trimEnd();
}

function writeChordChart(writer: PrintWriter, context: SheetPrintContext): void {
  const { setlist, songs, baseSize, chorusItalic } = context;
  const contentWidth = (context.landscape ? 841.89 : 595.28) - MARGIN * 2;
  const maxChars = Math.max(20, Math.floor(contentWidth / (baseSize * 0.6)));
  writer.paragraph("pageTitle", setlist.name);
  writer.paragraph(
    "pageMeta",
    `${printedDate(setlist.service_date, setlist.service_time)}  ·  Chords`,
  );

  for (const song of songs) {
    writer.paragraph("songTitle", song.title);
    if (song.author) writer.paragraph("metadata", `Words: ${song.author}`);
    let currentChorus = false;
    for (const line of collapseRepeatedChordChoruses(chordSheetLines(song.lyrics))) {
      if (!line.text && !line.chords.length && !line.section) {
        writer.paragraph("blank", "");
        continue;
      }
      if (line.section) {
        currentChorus = isChorusSectionLabel(line.section);
        writer.paragraph("section", line.section);
        continue;
      }
      for (const row of wrappedChordRows(line, maxChars)) {
        if (row.chords.length) writer.paragraph("chord", chordLineText(row, song.transpose));
        if (row.text) {
          writer.paragraph(
            currentChorus && chorusItalic ? "chorusChordText" : "chordText",
            row.text,
          );
        }
      }
    }
    const attribution = [song.copyright, song.ccli ? `CCLI ${song.ccli}` : ""]
      .filter(Boolean)
      .join("  ·  ");
    if (attribution) writer.paragraph("metadata", attribution);
    writer.paragraph("blank", "");
  }
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function docxRun(
  text: string,
  style: {
    size: number;
    bold: boolean;
    italic: boolean;
    font: string;
    color?: string;
  },
): string {
  const properties = [
    `<w:rFonts w:ascii="${xmlEscape(style.font)}" w:hAnsi="${xmlEscape(style.font)}" w:cs="${xmlEscape(style.font)}"/>`,
    style.bold ? "<w:b/><w:bCs/>" : "",
    style.italic ? "<w:i/><w:iCs/>" : "",
    `<w:sz w:val="${Math.round(style.size * 2)}"/><w:szCs w:val="${Math.round(style.size * 2)}"/>`,
    style.color ? `<w:color w:val="${style.color}"/>` : "",
  ].join("");
  return `<w:r><w:rPr>${properties}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function docxParagraph(
  text: string,
  style: {
    size: number;
    bold: boolean;
    italic: boolean;
    font: string;
    color?: string;
    after?: number;
    before?: number;
    keepNext?: boolean;
  },
): string {
  const spacing = [
    `<w:spacing w:before="${Math.round((style.before ?? 0) * 20)}"`,
    `w:after="${Math.round((style.after ?? 0) * 20)}"`,
    'w:line="276" w:lineRule="auto"/>',
  ].join(" ");
  const properties = [
    style.keepNext ? "<w:keepNext/>" : "",
    "<w:widowControl/>",
    spacing,
  ].join("");
  const run = text ? docxRun(text, style) : "";
  return `<w:p><w:pPr>${properties}</w:pPr>${run}</w:p>`;
}

function docxStyle(
  kind: PrintBlockKind,
  context: SheetPrintContext,
): {
  size: number;
  bold: boolean;
  italic: boolean;
  font: string;
  color?: string;
  after?: number;
  before?: number;
  keepNext?: boolean;
} {
  const { baseSize, boldText, chorusItalic, fontFamily } = context;
  const sectionSize = Math.max(8.5, baseSize * 0.72);
  switch (kind) {
    case "pageTitle":
      return { size: baseSize * 1.4, bold: boldText, italic: false, font: fontFamily, after: 3, keepNext: true };
    case "pageMeta":
      return { size: HEADER_SIZE, bold: boldText, italic: false, font: fontFamily, color: "666666", after: 10, keepNext: true };
    case "songTitle":
      return { size: baseSize * 1.2, bold: boldText, italic: false, font: fontFamily, before: 10, after: 1, keepNext: true };
    case "metadata":
      return { size: 8, bold: boldText, italic: false, font: fontFamily, color: "666666", after: 2 };
    case "chorus":
      return { size: baseSize, bold: boldText, italic: chorusItalic, font: fontFamily };
    case "section":
      return { size: sectionSize, bold: boldText, italic: false, font: fontFamily, color: "666666", before: 4, after: 1, keepNext: true };
    case "chord":
      return { size: baseSize, bold: boldText, italic: false, font: "Courier New", after: 0, keepNext: true };
    case "chorusChordText":
      return { size: baseSize, bold: boldText, italic: chorusItalic, font: "Courier New", after: 0 };
    case "chordText":
      return { size: baseSize, bold: boldText, italic: false, font: "Courier New", after: 0 };
    case "blank":
      return { size: baseSize, bold: false, italic: false, font: fontFamily, after: 4 };
    default:
      return { size: baseSize, bold: boldText, italic: false, font: fontFamily };
  }
}

function buildDocx(
  context: SheetPrintContext,
  chordMode: boolean,
): Buffer {
  const paragraphs: string[] = [];
  const writer: PrintWriter = {
    paragraph(kind, text) {
      paragraphs.push(docxParagraph(text, docxStyle(kind, context)));
    },
  };
  if (chordMode) writeChordChart(writer, context);
  else writeSongWords(writer, context);

  const pageWidth = context.landscape ? 16838 : 11906;
  const pageHeight = context.landscape ? 11906 : 16838;
  const columns =
    context.columns > 1 ? `<w:cols w:num="${context.columns}" w:space="360"/>` : "";
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${paragraphs.join("")}<w:sectPr><w:pgSz w:w="${pageWidth}" w:h="${pageHeight}"/><w:pgMar w:top="864" w:right="864" w:bottom="864" w:left="864" w:header="480" w:footer="480" w:gutter="0"/>${columns}</w:sectPr></w:body>
</w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  return Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(rootRels),
      "word/document.xml": strToU8(documentXml),
    }),
  );
}

function odfText(value: string): string {
  return value
    .split(/( +)/)
    .map((part) => {
      if (!part) return "";
      if (/^ +$/.test(part)) {
        return part.length === 1
          ? " "
          : `<text:s text:c="${part.length}"/>`;
      }
      return xmlEscape(part);
    })
    .join("");
}

function odfStyleXml(
  name: string,
  properties: {
    size: number;
    bold: boolean;
    italic: boolean;
    font: string;
    color?: string;
    after?: number;
    before?: number;
  },
): string {
  return `<style:style style:name="${name}" style:family="paragraph"><style:paragraph-properties fo:margin-top="${(properties.before ?? 0) / 72}in" fo:margin-bottom="${(properties.after ?? 0) / 72}in"/><style:text-properties style:font-name="${xmlEscape(properties.font)}" fo:font-size="${properties.size}pt" fo:font-weight="${properties.bold ? "bold" : "normal"}" fo:font-style="${properties.italic ? "italic" : "normal"}"${properties.color ? ` fo:color="#${properties.color}"` : ""}/></style:style>`;
}

function buildOdf(
  context: SheetPrintContext,
  chordMode: boolean,
): Buffer {
  const paragraphs: string[] = [];
  const styleNames: Record<PrintBlockKind, string> = {
    pageTitle: "PPageTitle",
    pageMeta: "PPageMeta",
    songTitle: "PSongTitle",
    metadata: "PMetadata",
    body: "PBody",
    chorus: "PChorus",
    section: "PSection",
    chord: "PChord",
    chordText: "PChordText",
    chorusChordText: "PChorusChordText",
    blank: "PBlank",
  };
  const writer: PrintWriter = {
    paragraph(kind, text) {
      paragraphs.push(
        `<text:p text:style-name="${styleNames[kind]}">${text ? odfText(text) : ""}</text:p>`,
      );
    },
  };
  if (chordMode) writeChordChart(writer, context);
  else writeSongWords(writer, context);

  const styles: Record<PrintBlockKind, ReturnType<typeof docxStyle>> = {
    pageTitle: docxStyle("pageTitle", context),
    pageMeta: docxStyle("pageMeta", context),
    songTitle: docxStyle("songTitle", context),
    metadata: docxStyle("metadata", context),
    body: docxStyle("body", context),
    chorus: docxStyle("chorus", context),
    section: docxStyle("section", context),
    chord: docxStyle("chord", context),
    chordText: docxStyle("chordText", context),
    chorusChordText: docxStyle("chorusChordText", context),
    blank: docxStyle("blank", context),
  };
  const automaticStyles = (Object.keys(styles) as PrintBlockKind[])
    .map((kind) => odfStyleXml(styleNames[kind], styles[kind]))
    .join("");
  const fontFaces = [...new Set([context.fontFamily, "Courier New"])]
    .map(
      (font) =>
        `<style:font-face style:name="${xmlEscape(font)}" svg:font-family="${xmlEscape(font)}"/>`,
    )
    .join("");
  const pageWidth = context.landscape ? 11.69 : 8.27;
  const pageHeight = context.landscape ? 8.27 : 11.69;
  const columnXml =
    context.columns > 1
      ? `<style:columns fo:column-count="${context.columns}" fo:column-gap="0.2in"/>`
      : "";
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3">
<office:automatic-styles>${automaticStyles}</office:automatic-styles>
<office:body><office:text>${paragraphs.join("")}</office:text></office:body>
</office:document-content>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3">
<office:font-face-decls>${fontFaces}</office:font-face-decls>
<office:styles><style:style style:name="Standard" style:family="paragraph" style:class="text"/><style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.08in"/><style:text-properties style:font-name="${xmlEscape(context.fontFamily)}" fo:font-size="${context.baseSize}pt"/></style:default-style></office:styles>
<office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${pageWidth}in" fo:page-height="${pageHeight}in" style:print-orientation="${context.landscape ? "landscape" : "portrait"}" fo:margin-top="0.6in" fo:margin-bottom="0.6in" fo:margin-left="0.6in" fo:margin-right="0.6in">${columnXml}</style:page-layout-properties></style:page-layout></office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>
</office:document-styles>`;
  const metaXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3"><office:meta><dc:title>${xmlEscape(context.setlist.name)}</dc:title><meta:generator>Service Maestro</meta:generator></office:meta></office:document-meta>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;
  return Buffer.from(
    zipSync({
      mimetype: [
        strToU8("application/vnd.oasis.opendocument.text"),
        { level: 0 },
      ],
      "content.xml": strToU8(contentXml),
      "styles.xml": strToU8(stylesXml),
      "meta.xml": strToU8(metaXml),
      "META-INF/manifest.xml": strToU8(manifest),
    }),
  );
}

export interface SongSheetDocumentResult {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

export async function buildSongSheetDocument(
  setlistId: string,
  format: SongSheetFormat,
  options: SongSheetOptions = {},
): Promise<SongSheetDocumentResult> {
  if (format === "pdf") {
    const result = await buildSongSheetPdf(setlistId, options);
    return { ...result, contentType: "application/pdf" };
  }
  const { setlist, songs } = loadSongs(setlistId);
  if (!songs.length) throw new Error("This set list has no songs");
  const context = sheetPrintContext(setlist, songs, options, false);
  if (format === "docx") {
    return {
      buffer: buildDocx(context, false),
      filename: safeFilename(setlist.name, setlist.service_date, "songs", "docx"),
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }
  return {
    buffer: buildOdf(context, false),
    filename: safeFilename(setlist.name, setlist.service_date, "songs", "odf"),
    contentType: "application/vnd.oasis.opendocument.text",
  };
}

export async function buildChordSheetDocument(
  setlistId: string,
  format: SongSheetFormat,
  options: ChordSheetOptions = {},
): Promise<SongSheetDocumentResult> {
  if (format === "pdf") {
    const result = await buildChordSheetPdf(setlistId, options);
    return { ...result, contentType: "application/pdf" };
  }
  const { setlist, songs } = loadSongs(setlistId);
  const chordsOnly = options.chordsOnly !== false;
  const chordSongs = chordsOnly ? songs.filter((song) => songHasChords(song.lyrics)) : songs;
  if (!chordSongs.length) {
    throw new Error(
      chordsOnly ? "This set list has no songs with chords" : "This set list has no songs",
    );
  }
  const context = sheetPrintContext(setlist, chordSongs, options, true);
  if (format === "docx") {
    return {
      buffer: buildDocx(context, true),
      filename: safeFilename(setlist.name, setlist.service_date, "chords", "docx"),
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  }
  return {
    buffer: buildOdf(context, true),
    filename: safeFilename(setlist.name, setlist.service_date, "chords", "odf"),
    contentType: "application/vnd.oasis.opendocument.text",
  };
}
