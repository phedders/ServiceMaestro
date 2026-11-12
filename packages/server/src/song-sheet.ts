import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { db } from "./db.js";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const BOTTOM_MARGIN = 48;
const TITLE_SIZE = 22;
const TITLE_LINE_HEIGHT = 27;
const AUTHOR_SIZE = 10.5;
const LYRICS_SIZE = 15;
const LYRICS_LINE_HEIGHT = 22;
const PARAGRAPH_GAP = 10;
const HEADER_SIZE = 9;

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
  return `${base}-${serviceDate.replace(/-/g, "")}-songs.pdf`;
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

export async function buildSongSheetPdf(
  setlistId: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const { setlist, songs } = loadSongs(setlistId);
  if (!songs.length) throw new Error("This set list has no songs");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const date = printedDate(setlist.service_date, setlist.service_time);
  const dark = rgb(0.08, 0.1, 0.14);
  const muted = rgb(0.38, 0.42, 0.48);
  const rule = rgb(0.82, 0.84, 0.87);

  const pageHeader = (page: PDFPage) => {
    page.drawText(pdfSafe(`${setlist.name}  ·  ${date}`), {
      x: MARGIN,
      y: PAGE_HEIGHT - MARGIN + 22,
      size: HEADER_SIZE,
      font,
      color: muted,
    });
    page.drawLine({
      start: { x: MARGIN, y: PAGE_HEIGHT - MARGIN + 12 },
      end: { x: PAGE_WIDTH - MARGIN, y: PAGE_HEIGHT - MARGIN + 12 },
      thickness: 0.6,
      color: rule,
    });
  };

  for (const song of songs) {
    let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pageHeader(page);
    let y = PAGE_HEIGHT - MARGIN - 8;
    const titleLines = wrapLine(pdfSafe(song.title), bold, TITLE_SIZE, PAGE_WIDTH - MARGIN * 2);
    for (const line of titleLines) {
      page.drawText(line, { x: MARGIN, y, size: TITLE_SIZE, font: bold, color: dark });
      y -= TITLE_LINE_HEIGHT;
    }
    const byline = song.author ? `Words: ${song.author}` : "";
    if (byline) {
      page.drawText(pdfSafe(byline), {
        x: MARGIN,
        y,
        size: AUTHOR_SIZE,
        font: italic,
        color: muted,
      });
      y -= 18;
    }
    y -= 12;

    const newLyricsPage = () => {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      pageHeader(page);
      y = PAGE_HEIGHT - MARGIN - 8;
      page.drawText(pdfSafe(`${song.title} (continued)`), {
        x: MARGIN,
        y,
        size: AUTHOR_SIZE,
        font: italic,
        color: muted,
      });
      y -= 24;
    };

    for (const line of song.lines) {
      if (!line) {
        y -= PARAGRAPH_GAP;
        continue;
      }
      const wrapped = wrapLine(pdfSafe(line), font, LYRICS_SIZE, PAGE_WIDTH - MARGIN * 2);
      for (const text of wrapped) {
        if (y - LYRICS_LINE_HEIGHT < BOTTOM_MARGIN) newLyricsPage();
        page.drawText(text, { x: MARGIN, y, size: LYRICS_SIZE, font, color: dark });
        y -= LYRICS_LINE_HEIGHT;
      }
    }

    const attribution = [song.copyright, song.ccli ? `CCLI ${song.ccli}` : ""]
      .filter(Boolean)
      .join("  ·  ");
    if (attribution) {
      if (y - 30 < BOTTOM_MARGIN) newLyricsPage();
      y -= 8;
      page.drawText(pdfSafe(attribution), {
        x: MARGIN,
        y,
        size: 9,
        font,
        color: muted,
      });
    }
  }

  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    page.drawText(`${index + 1} / ${pages.length}`, {
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
