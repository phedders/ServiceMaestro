import { randomUUID } from "node:crypto";
import {
  formatBibleVerses,
  type BibleBook,
  type BibleLayout,
  type ChurchSuiteBibleReading,
  type ChurchSuiteImportReport,
  type ChurchSuiteItemPreview,
  type ChurchSuitePlanPreview,
  type ChurchSuitePlanSummary,
} from "@sm/shared";
import { getBooks, getPassage, listTranslations } from "./bible.js";
import { db } from "./db.js";
import { getChurchsuitePlan, listChurchsuitePlanItems, listChurchsuiteTypes } from "./churchsuite.js";
import { saveSetlistToGit } from "./git-store.js";
import { getAppSettings } from "./settings.js";
import {
  findSongMatches,
  matchSummary,
  type MatchingSongRow,
} from "./song-matching.js";

interface ChurchsuitePlan {
  id: number;
  identifier?: string | null;
  name?: string | null;
  date?: string | null;
  time?: string | null;
  status?: string | null;
}

interface ChurchsuiteQuestion {
  name?: string;
  value?: string | null;
}

interface ChurchsuitePlanItem {
  id: number;
  order?: number | null;
  type?: string | null;
  type_id?: number | null;
  name?: string | null;
  arrangement_id?: number | null;
  duration?: number | null;
  time_start?: string | null;
  comment?: string | null;
  notes?: unknown;
  question_responses?: ChurchsuiteQuestion[] | null;
}

type LocalSong = MatchingSongRow;

function compactDate(value: string): string {
  const match = value.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : value;
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeBookName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^psalm$/, "psalms")
    .replace(/^song of songs$/, "song of solomon")
    .replace(/^revelation of john$/, "revelation");
}

interface ParsedBibleReference {
  bookName: string;
  chapter: number;
  from: number | null;
  to: number | null;
}

function parseBibleReference(value: string): ParsedBibleReference | null {
  const cleaned = value
    .replace(/^reading\s*:\s*/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  const match = cleaned.match(
    /^((?:[1-3]\s*)?[A-Za-z][A-Za-z .'-]*?)\s+(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?)?$/,
  );
  if (!match) return null;
  const chapter = Number(match[2]);
  if (!Number.isInteger(chapter) || chapter <= 0) return null;
  const from = match[3] ? Number(match[3]) : null;
  const to = match[4] ? Number(match[4]) : from;
  return {
    bookName: match[1].trim(),
    chapter,
    from: from && from > 0 ? from : null,
    to: to && to > 0 ? to : null,
  };
}

function readingTexts(item: ChurchsuitePlanItem): string[] {
  return [
    item.name,
    item.comment,
    notesText(item.notes),
    ...(item.question_responses ?? []).map((response) => response.value),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function readingForItem(
  item: ChurchsuitePlanItem,
  typeName: string,
): ChurchSuiteBibleReading | null {
  if (!normalize(typeName).includes("reading")) return null;
  const translation =
    listTranslations().find(
      (entry) => entry.code === getAppSettings().defaultBibleTranslation,
    ) ?? listTranslations()[0];
  if (!translation) return null;
  const books = getBooks(translation.code);
  if (!books?.length) return null;
  const bookByName = new Map<string, BibleBook>(
    books.map((book) => [normalizeBookName(book.name), book]),
  );
  let parsed: ParsedBibleReference | null = null;
  for (const text of readingTexts(item)) {
    parsed = parseBibleReference(text);
    if (parsed && bookByName.has(normalizeBookName(parsed.bookName))) break;
    parsed = null;
  }
  if (!parsed) return null;
  const book = bookByName.get(normalizeBookName(parsed.bookName));
  if (!book) return null;
  const passage = getPassage(
    translation.code,
    book.number,
    parsed.chapter,
    parsed.from ?? undefined,
    parsed.to ?? undefined,
  );
  if (!passage) return null;
  const reference = `${passage.bookName} ${passage.chapter}${
    parsed.from ? `:${passage.from}${passage.to !== passage.from ? `–${passage.to}` : ""}` : ""
  }`;
  const preview = passage.verses
    .slice(0, 2)
    .map((verse) => `${verse.number} ${verse.text}`)
    .join(" ")
    .slice(0, 240);
  return {
    reference,
    translation: passage.translation,
    translationName: passage.translationName,
    book: passage.book,
    bookName: passage.bookName,
    chapter: passage.chapter,
    from: passage.from,
    to: passage.to,
    verseCount: passage.verses.length,
    summary: `${reference} · ${passage.verses.length} verse${
      passage.verses.length === 1 ? "" : "s"
    } · ${passage.translationName}`,
    preview,
  };
}

function notesText(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : entry && typeof entry === "object"
            ? String((entry as Record<string, unknown>).note ?? "")
            : "",
      )
      .filter(Boolean);
    return parts.length ? parts.join("\n") : null;
  }
  if (typeof value === "object") {
    const note = (value as Record<string, unknown>).note;
    return typeof note === "string" ? note : null;
  }
  return null;
}

function responseValue(item: ChurchsuitePlanItem, name: string): string | null {
  const response = item.question_responses?.find(
    (entry) => entry.name?.toLowerCase() === name.toLowerCase(),
  );
  const value = response?.value?.trim();
  return value || null;
}

function localSongs(): LocalSong[] {
  return db
    .prepare("SELECT * FROM songs WHERE archived_at IS NULL")
    .all() as LocalSong[];
}

function itemAction(
  item: ChurchsuitePlanItem,
  isSong: boolean,
  matched: LocalSong | null,
  emptyType: boolean,
): ChurchSuiteItemPreview["action"] {
  if (!item.name?.trim()) return "skip";
  if (emptyType) return "empty";
  if (matched) return "song";
  if (isSong) return "placeholder";
  return "placeholder";
}

export async function previewChurchsuitePlan(planId: number): Promise<ChurchSuitePlanPreview> {
  const [rawPlan, rawItems, types] = await Promise.all([
    getChurchsuitePlan(planId),
    listChurchsuitePlanItems([planId]),
    listChurchsuiteTypes(),
  ]);
  const plan = rawPlan as ChurchsuitePlan;
  const items = (rawItems as { data?: ChurchsuitePlanItem[] }).data ?? [];
  const typeNames = new Map(types.map((type) => [type.id, type]));
  const songs = localSongs();
  const emptyTypes = new Set(
    getAppSettings().churchsuiteEmptyTypes.map((name) => normalize(name)),
  );

  const previewItems: ChurchSuiteItemPreview[] = items
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((item, index) => {
      const type = item.type_id != null ? typeNames.get(item.type_id) : undefined;
      const typeName = type?.name ?? (item.type === "song" ? "Song" : "Item");
      const isSong =
        Boolean(item.arrangement_id) ||
        Boolean(type?.ccli_tracking) ||
        typeName.toLowerCase().includes("worship");
      const key = responseValue(item, "Key");
      const author = responseValue(item, "Artist/Author");
      const notes = notesText(item.notes);
      const matches = isSong && item.name ? findSongMatches(item.name, songs, 8) : [];
      const matched = matches[0]?.song ?? null;
      const emptyType = emptyTypes.has(normalize(typeName));
      const action = itemAction(item, isSong, matched, emptyType);
      return {
        id: item.id,
        order: item.order ?? index + 1,
        typeId: item.type_id ?? null,
        typeName,
        name: item.name?.trim() || "",
        isSong,
        key,
        author,
        notes,
        duration: item.duration ?? null,
        reading: readingForItem(item, typeName),
        matchedSong: matched
          ? { id: matched.id, title: matched.title, key: matched.key }
          : null,
        matchCandidates: matches.map(matchSummary),
        action,
      };
    });

  return {
    plan: {
      id: plan.id,
      identifier: plan.identifier ?? null,
      name: plan.name?.trim() || `ChurchSuite plan ${plan.id}`,
      date: plan.date ?? "",
      time: plan.time ?? null,
      status: plan.status ?? "unknown",
    },
    items: previewItems,
    songCount: previewItems.filter((item) => item.isSong).length,
    matchedCount: previewItems.filter((item) => item.matchedSong).length,
    placeholderCount: previewItems.filter((item) => item.action === "placeholder").length,
    emptyCount: previewItems.filter((item) => item.action === "empty").length,
  };
}

function placeholderContent(item: ChurchSuiteItemPreview): string {
  const lines = [item.typeName];
  if (item.isSong && !item.matchedSong) lines.push("No local song match.");
  if (item.author) lines.push(`Author: ${item.author}`);
  if (item.key) lines.push(`Key: ${item.key}`);
  if (item.notes) lines.push(item.notes);
  return lines.filter(Boolean).join("\n");
}

export async function importChurchsuitePlan(
  planId: number,
  input: {
    name?: string;
    serviceDate?: string;
    serviceTime?: string | null;
    songSelections?: Record<string, string>;
    bibleLayouts?: Record<string, BibleLayout>;
    includeSkipped?: number[];
  } = {},
): Promise<{ report: ChurchSuiteImportReport; setlist: unknown }> {
  const preview = await previewChurchsuitePlan(planId);
  const includedSkipped = new Set(input.includeSkipped ?? []);
  if (
    !preview.items.some(
      (item) => item.action !== "skip" || includedSkipped.has(item.id),
    )
  ) {
    throw new Error("This plan has no importable items");
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const serviceDate = input.serviceDate || preview.plan.date;
  if (!serviceDate) throw new Error("ChurchSuite plan has no service date");
  const serviceTime =
    input.serviceTime !== undefined
      ? input.serviceTime || null
      : preview.plan.time
        ? preview.plan.time.slice(0, 5)
        : null;
  const name =
    input.name?.trim() ||
    `${compactDate(serviceDate)}-${preview.plan.name}`.slice(0, 200);

  db.prepare(
    `INSERT INTO setlists (id, name, service_date, service_time, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    serviceDate,
    serviceTime,
    `Imported from ChurchSuite plan ${preview.plan.name} (${preview.plan.identifier ?? planId})`,
    now,
    now,
  );

  const insert = db.prepare(
    `INSERT INTO setlist_items
     (id, setlist_id, position, kind, song_id, title, content, content_source,
      text_format, text_align, key_override, transpose, max_lines, verse_order, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const findSong = db.prepare("SELECT id, title FROM songs WHERE id = ?");

  let position = 0;
  let songsMatched = 0;
  let placeholders = 0;
  let emptyItems = 0;
  let skipped = 0;
  for (const item of preview.items) {
    if (item.action === "skip" && !includedSkipped.has(item.id)) {
      skipped += 1;
      continue;
    }
    const selectedId = input.songSelections?.[String(item.id)];
    const selectedSong = selectedId
      ? (findSong.get(selectedId) as { id: string; title: string } | undefined)
      : undefined;
    if (selectedSong && item.isSong) {
      insert.run(
        randomUUID(),
        id,
        position,
        "song",
        selectedSong.id,
        selectedSong.title,
        null,
        "text",
        null,
        null,
        item.key,
        0,
        4,
        null,
        item.notes,
      );
      songsMatched += 1;
    } else if (item.action === "song" && item.matchedSong) {
      insert.run(
        randomUUID(),
        id,
        position,
        "song",
        item.matchedSong.id,
        item.matchedSong.title,
        null,
        "text",
        null,
        null,
        item.key,
        0,
        4,
        null,
        item.notes,
      );
      songsMatched += 1;
    } else if (item.reading) {
      const layout = input.bibleLayouts?.[String(item.id)] ?? "verses";
      const passage = getPassage(
        item.reading.translation,
        item.reading.book,
        item.reading.chapter,
        item.reading.from,
        item.reading.to,
      );
      if (passage) {
        insert.run(
          randomUUID(),
          id,
          position,
          "text",
          null,
          item.reading.reference,
          `${item.reading.reference} (${item.reading.translationName})\n${formatBibleVerses(
            passage.verses,
            layout,
          )}`,
          "bible",
          "text",
          "left",
          null,
          0,
          4,
          null,
          item.notes,
        );
        placeholders += 1;
      } else {
        insert.run(
          randomUUID(),
          id,
          position,
          "text",
          null,
          item.name || item.typeName || "ChurchSuite item",
          placeholderContent(item),
          "text",
          "text",
          "left",
          null,
          0,
          4,
          null,
          item.notes,
        );
        placeholders += 1;
      }
    } else if (item.action === "empty") {
      insert.run(
        randomUUID(),
        id,
        position,
        "text",
        null,
        item.name || item.typeName || "ChurchSuite item",
        "",
        "text",
        "text",
        "left",
        null,
        0,
        4,
        null,
        item.notes || placeholderContent(item),
      );
      emptyItems += 1;
    } else {
      insert.run(
        randomUUID(),
        id,
        position,
        "text",
        null,
        item.name || item.typeName || "ChurchSuite item",
        placeholderContent(item),
        "text",
        "text",
        "left",
        null,
        0,
        4,
        null,
        item.notes,
      );
      placeholders += 1;
    }
    position += 1;
  }

  db.prepare("UPDATE setlists SET updated_at = ? WHERE id = ?").run(now, id);
  await saveSetlistToGit(id).catch(() => undefined);
  const setlist = db.prepare("SELECT * FROM setlists WHERE id = ?").get(id);
  return {
    report: {
      setlistId: id,
      setlistName: name,
      itemCount: position,
      songsMatched,
      placeholders,
      emptyItems,
      skipped,
    },
    setlist,
  };
}
