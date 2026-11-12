import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { SongSheetFont } from "@sm/shared";
import { db } from "./db.js";
import { getAppSettings } from "./settings.js";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const BOTTOM_MARGIN = 48;
const HEADER_SIZE = 9;
const COLUMN_GAP = 22;
const SONG_GAP = 16;

const PDF_FONTS: Record<
  SongSheetFont,
  { regular: StandardFonts; bold: StandardFonts; italic: StandardFonts }
> = {
  Helvetica: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
  },
  TimesRoman: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic,
  },
  Courier: {
    regular: StandardFonts.Courier,
    bold: StandardFonts.CourierBold,
    italic: StandardFonts.CourierOblique,
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
  item_title: string;
  item_content: string | null;
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
  title: string;
  author: string | null;
  copyright: string | null;
  ccli: string | null;
  lines: string[];
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

export function songSheetLines(lyrics: string): string[] {
  const lines: string[] = [];
  for (const raw of lyrics.replace(/\r\n?/g, "\n").split("\n")) {
    const line = plainLyricLine(raw);
    if (!line) {
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }
    lines.push(line);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
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

function printedDate(serviceDate: string, serviceTime: string | null): string {
  const match = serviceDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return serviceDate;
  const [, year, month, day] = match;
  const name = MONTHS[Number(month) - 1] ?? month;
  return `${Number(day)} ${name} ${year}${serviceTime ? ` · ${serviceTime}` : ""}`;
}

function safeFilename(name: string, serviceDate: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "service";
  return `${base}-${serviceDate}-songs.pdf`;
}

function loadSongs(setlistId: string): { setlist: SetlistRow; songs: SongForPdf[] } {
  const setlist = db
    .prepare("SELECT id, name, service_date, service_time FROM setlists WHERE id = ?")
    .get(setlistId) as SetlistRow | undefined;
  if (!setlist) throw new Error("Set list not found");
  const rows = db
    .prepare(
      `SELECT i.title AS item_title, i.content AS item_content,
              s.title AS song_title, s.author, s.copyright, s.ccli, s.lyrics
       FROM setlist_items i
       LEFT JOIN songs s ON s.id = i.song_id
       WHERE i.setlist_id = ? AND i.kind = 'song'
       ORDER BY i.position ASC, i.rowid ASC`,
    )
    .all(setlistId) as SongSheetRow[];
  return {
    setlist,
    songs: rows.map((row) => ({
      title: (row.item_title || row.song_title || "Song").trim(),
      author: row.author,
      copyright: row.copyright,
      ccli: row.ccli,
      lines: songSheetLines(row.item_content ?? row.lyrics ?? ""),
    })),
  };
}

export interface SongSheetOptions {
  fontSize?: number;
  columns?: number;
}

export async function buildSongSheetPdf(
  setlistId: string,
  options: SongSheetOptions = {},
): Promise<{ buffer: Buffer; filename: string }> {
  const { setlist, songs } = loadSongs(setlistId);
  if (!songs.length) throw new Error("This set list has no songs");
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
  const titleSize = baseSize + 7;
  const titleLineHeight = titleSize * 1.22;
  const authorSize = Math.max(8.5, baseSize * 0.72);
  const lineHeight = baseSize * 1.45;
  const paragraphGap = baseSize * 0.6;
  const contentTop = PAGE_HEIGHT - MARGIN - 8;
  const contentWidth = PAGE_WIDTH - MARGIN * 2;
  const columnWidth = (contentWidth - COLUMN_GAP * (columnCount - 1)) / columnCount;
  const columnX = (index: number) => MARGIN + index * (columnWidth + COLUMN_GAP);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(fontChoice.regular);
  const bold = await pdf.embedFont(fontChoice.bold);
  const italic = await pdf.embedFont(fontChoice.italic);
  const date = printedDate(setlist.service_date, setlist.service_time);
  const dark = rgb(0.08, 0.1, 0.14);
  const muted = rgb(0.38, 0.42, 0.48);
  const rule = rgb(0.82, 0.84, 0.87);

  let page: PDFPage = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let column = 0;
  let y = contentTop;

  const pageHeader = (target: PDFPage) => {
    target.drawText(pdfSafe(`${setlist.name}  ·  ${date}`), {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN + 22,
      size: HEADER_SIZE,
      font,
      color: muted,
    });
    target.drawLine({
      start: { x: MARGIN, y: PAGE_HEIGHT - MARGIN + 12 },
      end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - MARGIN + 12 },
      thickness: 0.6,
      color: rule,
    });
  };
  pageHeader(page);

  const nextColumn = (continuationTitle?: string) => {
    if (column + 1 < columnCount) {
      column += 1;
    } else {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pageHeader(page);
      column = 0;
    }
    y = contentTop;
    if (continuationTitle) {
      page.drawText(pdfSafe(`${continuationTitle} (continued)`), {
        x: columnX(column),
        y,
        size: authorSize,
        font: italic,
        color: muted,
      });
      y -= authorSize + 8;
    }
  };

  const ensureSpace = (height: number, continuationTitle?: string) => {
    if (y - height < BOTTOM_MARGIN) nextColumn(continuationTitle);
  };

  for (const song of songs) {
    const titleLines = wrapLine(pdfSafe(song.title), bold, titleSize, columnWidth);
    const byline = song.author ? `Words: ${song.author}` : "";
    const previewLyricLines = song.lines
      .filter(Boolean)
      .slice(0, 2)
      .flatMap((line) => wrapLine(pdfSafe(line), font, baseSize, columnWidth))
      .slice(0, 2).length;
    const required =
      titleLines.length * titleLineHeight +
      (byline ? authorSize + 8 : 0) +
      6 +
      previewLyricLines * lineHeight;
    ensureSpace(required);

    for (const line of titleLines) {
      page.drawText(line, {
        x: columnX(column),
        y,
        size: titleSize,
        font: bold,
        color: dark,
      });
      y -= titleLineHeight;
    }
    if (byline) {
      page.drawText(pdfSafe(byline), {
        x: columnX(column),
        y,
        size: authorSize,
        font: italic,
        color: muted,
      });
      y -= authorSize + 8;
    }
    y -= 6;

    for (const line of song.lines) {
      if (!line) {
        y = Math.max(BOTTOM_MARGIN, y - paragraphGap);
        continue;
      }
      const wrapped = wrapLine(pdfSafe(line), font, baseSize, columnWidth);
      for (const text of wrapped) {
        ensureSpace(lineHeight, song.title);
        page.drawText(text, {
          x: columnX(column),
          y,
          size: baseSize,
          font,
          color: dark,
        });
        y -= lineHeight;
      }
    }

    const attribution = [song.copyright, song.ccli ? `CCLI ${song.ccli}` : ""]
      .filter(Boolean)
      .join("  ·  ");
    if (attribution) {
      ensureSpace(authorSize + 12, song.title);
      y -= 6;
      page.drawText(pdfSafe(attribution), {
        x: columnX(column),
        y,
        size: Math.max(7.5, baseSize * 0.6),
        font,
        color: muted,
      });
      y -= authorSize;
    }
    y -= SONG_GAP;
  }

  const pages = pdf.getPages();
  pages.forEach((target, index) => {
    target.drawText(`${index + 1} / ${pages.length}`, {
      x: PAGE_WIDTH - MARGIN - 34,
      y: 24,
      size: 8,
      font,
      color: muted,
    });
  });

  return {
    buffer: Buffer.from(await pdf.save()),
    filename: safeFilename(setlist.name, setlist.service_date),
  };
}
