import { randomUUID } from "node:crypto";
import {
  formatBibleVerses,
  inferServiceTimeFromText,
  type BibleBook,
  type BibleLayout,
  type ChurchSuiteBibleReading,
  type ChurchSuiteExistingSetlist,
  type ChurchSuiteImportReport,
  type ChurchSuiteItemPreview,
  type ChurchSuitePlanPreview,
  type ChurchSuitePlanSummary,
  type ChurchSuiteSyncChange,
  type ChurchSuiteSyncFieldChange,
  type ChurchSuiteSyncPreview,
  type ChurchSuiteSyncSummary,
} from "@sm/shared";
import { getBooks, getPassage, listTranslations } from "./bible.js";
import {
  applyBiblePartRange,
  parseBibleReferences,
  type ParsedBibleReference,
} from "./bible-reference.js";
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

export interface ChurchsuiteImportOptions {
  mode?: "create" | "sync";
  name?: string;
  serviceDate?: string;
  serviceTime?: string | null;
  songSelections?: Record<string, string>;
  bibleLayouts?: Record<string, BibleLayout>;
  includeSkipped?: number[];
}

interface ExistingSetlistRow {
  id: string;
  name: string;
  service_date: string;
  service_time: string | null;
  updated_at: string;
  notes: string | null;
  item_count: number;
}

export interface ChurchsuiteSetlistItemRow {
  id: string;
  position: number;
  kind: "song" | "text" | "image" | "image_list" | "tarp";
  song_id: string | null;
  title: string;
  content: string | null;
  content_source: string | null;
  text_format: string | null;
  text_align: string | null;
  key_override: string | null;
  transpose: number;
  max_lines: number;
  verse_order: string | null;
  notes: string | null;
  churchsuite_item_id: number | null;
  churchsuite_snapshot: string | null;
}

export interface ChurchsuiteDesiredItem {
  planItemId: number;
  sequence: number;
  kind: "song" | "text";
  songId: string | null;
  title: string;
  content: string | null;
  contentSource: "text" | "bible";
  textFormat: "text" | null;
  textAlign: "left" | null;
  keyOverride: string | null;
  notes: string | null;
  bibleLayout: BibleLayout | null;
  snapshot: string;
}

interface DesiredItemsResult {
  items: ChurchsuiteDesiredItem[];
  songsMatched: number;
  placeholders: number;
  emptyItems: number;
  skipped: number;
}

interface SyncAnalysis {
  changes: ChurchSuiteSyncChange[];
  summary: ChurchSuiteSyncSummary;
  matches: Map<number, ChurchsuiteSetlistItemRow>;
  removedRows: ChurchsuiteSetlistItemRow[];
  manualRows: ChurchsuiteSetlistItemRow[];
}

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

export function readingsForItem(
  item: ChurchsuitePlanItem,
  typeName: string,
): ChurchSuiteBibleReading[] {
  if (!normalize(typeName).includes("reading")) return [];
  const translation =
    listTranslations().find(
      (entry) => entry.code === getAppSettings().defaultBibleTranslation,
    ) ?? listTranslations()[0];
  if (!translation) return [];
  const books = getBooks(translation.code);
  if (!books?.length) return [];
  const bookByName = new Map<string, BibleBook>(
    books.map((book) => [normalizeBookName(book.name), book]),
  );
  const readings: ChurchSuiteBibleReading[] = [];
  const seen = new Set<string>();
  for (const text of readingTexts(item)) {
    for (const parsed of parseBibleReferences(text)) {
      const book = bookByName.get(normalizeBookName(parsed.bookName));
      if (!book) continue;
      const passage = getPassage(
        translation.code,
        book.number,
        parsed.chapter,
        parsed.from ?? undefined,
        parsed.to ?? undefined,
      );
      if (!passage) continue;
      const fromLabel = `${passage.from}${parsed.fromPart ?? ""}`;
      const toLabel = `${passage.to}${parsed.toPart ?? ""}`;
      const hasRange = passage.to !== passage.from || Boolean(parsed.toPart);
      const reference = `${passage.bookName} ${passage.chapter}${
        parsed.from ? `:${fromLabel}${hasRange ? `–${toLabel}` : ""}` : ""
      }`;
      const key = `${reference}|${translation.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const previewVerses = applyBiblePartRange(
        passage.verses,
        parsed.fromPart,
        parsed.toPart,
      );
      const preview = previewVerses
        .slice(0, 2)
        .map((verse) => `${verse.number} ${verse.text}`)
        .join(" ")
        .slice(0, 240);
      readings.push({
        reference,
        translation: passage.translation,
        translationName: passage.translationName,
        book: passage.book,
        bookName: passage.bookName,
        chapter: passage.chapter,
        from: passage.from,
        to: passage.to,
        fromPart: parsed.fromPart,
        toPart: parsed.toPart,
        verseCount: passage.verses.length,
        summary: `${reference} · ${passage.verses.length} verse${
          passage.verses.length === 1 ? "" : "s"
        } · ${passage.translationName}`,
        preview,
      });
    }
  }
  return readings;
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
    .flatMap((item, index) => {
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
      const base = {
        order: item.order ?? index + 1,
        typeId: item.type_id ?? null,
        typeName,
        name: item.name?.trim() || "",
        isSong,
        key,
        author,
        notes,
        duration: item.duration ?? null,
        matchedSong: matched
          ? { id: matched.id, title: matched.title, key: matched.key }
          : null,
        matchCandidates: matches.map(matchSummary),
        action,
      };
      const readings = readingsForItem(item, typeName);
      if (readings.length > 1) {
        return readings.map((reading, readingIndex) => ({
          ...base,
          // Keep the original plan-item id on the first reading so existing
          // linked set-list items still match during a later sync.
          id:
            readingIndex === 0
              ? item.id
              : -(Math.abs(item.id) * 1000 + readingIndex),
          order: base.order + readingIndex / 100,
          reading,
        }));
      }
      return [{ ...base, id: item.id, reading: readings[0] ?? null }];
    });

  const planSummary: ChurchSuitePlanSummary = {
    id: plan.id,
    identifier: plan.identifier ?? null,
    name: plan.name?.trim() || `ChurchSuite plan ${plan.id}`,
    date: plan.date ?? "",
    time: plan.time ?? null,
    status: plan.status ?? "unknown",
  };
  const existing = findChurchsuiteSetlist(plan.id, planSummary.identifier);

  return {
    plan: planSummary,
    items: previewItems,
    existingSetlist: existing ? existingSummary(existing) : null,
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

const EXISTING_SETLIST_SELECT = `
  SELECT s.id, s.name, s.service_date, s.service_time, s.updated_at, s.notes,
         (SELECT COUNT(*) FROM setlist_items i WHERE i.setlist_id = s.id) AS item_count
  FROM setlists s
  WHERE s.archived_at IS NULL`;

function findChurchsuiteSetlist(
  planId: number,
  identifier?: string | null,
): ExistingSetlistRow | undefined {
  const linked = db
    .prepare(
      `${EXISTING_SETLIST_SELECT} AND s.churchsuite_plan_id = ? ORDER BY s.updated_at DESC LIMIT 1`,
    )
    .get(planId) as ExistingSetlistRow | undefined;
  if (linked) return linked;

  // Set lists imported before plan IDs were stored keep the plan reference in
  // their notes. Match that fallback once, then future syncs use the column.
  const legacy = db
    .prepare(
      `${EXISTING_SETLIST_SELECT} AND s.notes LIKE 'Imported from ChurchSuite plan %' ORDER BY s.updated_at DESC`,
    )
    .all() as ExistingSetlistRow[];
  return legacy.find((row) => {
    const reference = row.notes?.match(/\(([^()]*)\)\s*$/)?.[1]?.trim();
    return reference === String(planId) || Boolean(identifier && reference === identifier);
  });
}

function existingSummary(row: ExistingSetlistRow): ChurchSuiteExistingSetlist {
  return {
    id: row.id,
    name: row.name,
    serviceDate: row.service_date,
    serviceTime: row.service_time,
    updatedAt: row.updated_at,
    itemCount: Number(row.item_count ?? 0),
  };
}

function setlistItemRows(setlistId: string): ChurchsuiteSetlistItemRow[] {
  return db
    .prepare("SELECT * FROM setlist_items WHERE setlist_id = ? ORDER BY position ASC, rowid ASC")
    .all(setlistId) as ChurchsuiteSetlistItemRow[];
}

interface ChurchsuiteItemSnapshot {
  name: string | null;
  reading: string | null;
  layout: BibleLayout | null;
}

function parseItemSnapshot(value: string | null): ChurchsuiteItemSnapshot | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ChurchsuiteItemSnapshot> | null;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      name: typeof parsed.name === "string" ? parsed.name : null,
      reading: typeof parsed.reading === "string" ? parsed.reading : null,
      layout:
        parsed.layout === "paragraph" || parsed.layout === "verses"
          ? parsed.layout
          : null,
    };
  } catch {
    return null;
  }
}

function inferBibleLayout(row: ChurchsuiteSetlistItemRow): BibleLayout | null {
  if (row.content_source !== "bible") return null;
  const lines = (row.content ?? "").split("\n");
  return lines.length > 2 ? "verses" : "paragraph";
}

/**
 * A set-list page sync has no import form values. Reuse the choices already
 * stored on the linked items, but only while the underlying plan item is
 * unchanged, so a new ChurchSuite song or reading still updates normally.
 */
function withExistingChoices(
  preview: ChurchSuitePlanPreview,
  rows: ChurchsuiteSetlistItemRow[],
  input: ChurchsuiteImportOptions,
): ChurchsuiteImportOptions {
  const byPlanItem = new Map(
    rows
      .filter((row) => row.churchsuite_item_id != null)
      .map((row) => [row.churchsuite_item_id as number, row]),
  );
  const songSelections: Record<string, string> = {};
  const bibleLayouts: Record<string, BibleLayout> = {};
  for (const item of preview.items) {
    const row = byPlanItem.get(item.id);
    if (!row) continue;
    const snapshot = parseItemSnapshot(row.churchsuite_snapshot);
    const samePlanItem = !snapshot || snapshot.name === null || snapshot.name === (item.name || null);
    if (item.isSong && row.song_id && samePlanItem) {
      const song = db
        .prepare("SELECT id FROM songs WHERE id = ? AND archived_at IS NULL")
        .get(row.song_id) as { id: string } | undefined;
      if (song) songSelections[String(item.id)] = row.song_id;
    }
    if (item.reading) {
      const layout = snapshot?.layout ?? inferBibleLayout(row);
      const sameReading = !snapshot || snapshot.reading === item.reading.reference;
      if (layout && sameReading) bibleLayouts[String(item.id)] = layout;
    }
  }
  return {
    ...input,
    songSelections: { ...songSelections, ...(input.songSelections ?? {}) },
    bibleLayouts: { ...bibleLayouts, ...(input.bibleLayouts ?? {}) },
  };
}

function importMeta(
  preview: ChurchSuitePlanPreview,
  input: ChurchsuiteImportOptions,
): { name: string; serviceDate: string; serviceTime: string | null; notes: string } {
  const serviceDate = input.serviceDate || preview.plan.date;
  if (!serviceDate) throw new Error("ChurchSuite plan has no service date");
  const serviceTime =
    input.serviceTime !== undefined
      ? input.serviceTime || null
      : inferServiceTimeFromText(preview.plan.name) ??
        (preview.plan.time ? preview.plan.time.slice(0, 5) : null);
  const name =
    input.name?.trim() ||
    `${compactDate(serviceDate)}-${preview.plan.name}`.slice(0, 200);
  return {
    name,
    serviceDate,
    serviceTime,
    notes: `Imported from ChurchSuite plan ${preview.plan.name} (${preview.plan.identifier ?? preview.plan.id})`,
  };
}

export function buildDesiredSetlistItems(
  preview: ChurchSuitePlanPreview,
  input: ChurchsuiteImportOptions = {},
): DesiredItemsResult {
  const includedSkipped = new Set(input.includeSkipped ?? []);
  const findSong = db.prepare("SELECT id, title FROM songs WHERE id = ?");
  const items: ChurchsuiteDesiredItem[] = [];
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
    const desired: ChurchsuiteDesiredItem = {
      planItemId: item.id,
      sequence: items.length,
      kind: "text",
      songId: null,
      title: item.name || item.typeName || "ChurchSuite item",
      content: placeholderContent(item),
      contentSource: "text",
      textFormat: "text",
      textAlign: "left",
      keyOverride: item.key,
      notes: item.notes,
      bibleLayout: null,
      snapshot: "",
    };

    let bibleLayout: BibleLayout | null = null;
    if (selectedSong && item.isSong) {
      Object.assign(desired, {
        kind: "song",
        songId: selectedSong.id,
        title: selectedSong.title,
        content: null,
        contentSource: "text",
        textFormat: null,
        textAlign: null,
      });
      songsMatched += 1;
    } else if (item.action === "song" && item.matchedSong) {
      Object.assign(desired, {
        kind: "song",
        songId: item.matchedSong.id,
        title: item.matchedSong.title,
        content: null,
        contentSource: "text",
        textFormat: null,
        textAlign: null,
      });
      songsMatched += 1;
    } else if (item.reading) {
      const layout = input.bibleLayouts?.[String(item.id)] ?? "verses";
      bibleLayout = layout;
      const passage = getPassage(
        item.reading.translation,
        item.reading.book,
        item.reading.chapter,
        item.reading.from,
        item.reading.to,
      );
      if (passage) {
        const verses = applyBiblePartRange(
          passage.verses,
          item.reading.fromPart,
          item.reading.toPart,
        );
        Object.assign(desired, {
          title: item.reading.reference,
          content: `${item.reading.reference} (${item.reading.translationName})\n${formatBibleVerses(
            verses,
            layout,
            { verseNumbers: layout === "paragraph" },
          )}`,
          contentSource: "bible",
        });
        placeholders += 1;
      } else {
        desired.content = placeholderContent(item);
        placeholders += 1;
      }
    } else if (item.action === "empty") {
      desired.content = "";
      desired.notes = item.notes || placeholderContent(item);
      emptyItems += 1;
    } else {
      placeholders += 1;
    }

    desired.bibleLayout = bibleLayout;
    desired.snapshot = JSON.stringify({
      name: item.name?.trim() || null,
      reading: item.reading?.reference ?? null,
      layout: bibleLayout,
    });
    items.push(desired);
  }

  return { items, songsMatched, placeholders, emptyItems, skipped };
}

function nonEmpty(value: string | null): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function changeValue(value: string | null, limit = 320): string | null {
  const text = nonEmpty(value);
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function describeDesired(item: ChurchsuiteDesiredItem): string {
  if (item.kind === "song") return item.songId ? "Matched local song" : "Song placeholder";
  if (item.contentSource === "bible") return "Bible reading";
  return item.content ? "Text placeholder" : "Empty item";
}

function matchExistingItems(
  desired: ChurchsuiteDesiredItem[],
  rows: ChurchsuiteSetlistItemRow[],
): {
  matches: Map<number, ChurchsuiteSetlistItemRow>;
  removedRows: ChurchsuiteSetlistItemRow[];
  manualRows: ChurchsuiteSetlistItemRow[];
} {
  const used = new Set<string>();
  const matches = new Map<number, ChurchsuiteSetlistItemRow>();
  const desiredIds = new Set(desired.map((item) => item.planItemId));

  for (const item of desired) {
    const row = rows.find(
      (candidate) =>
        !used.has(candidate.id) && candidate.churchsuite_item_id === item.planItemId,
    );
    if (row) {
      matches.set(item.planItemId, row);
      used.add(row.id);
    }
  }

  for (const item of desired) {
    if (matches.has(item.planItemId)) continue;
    let row =
      item.kind === "song" && item.songId
        ? rows.find(
            (candidate) =>
              !used.has(candidate.id) &&
              candidate.churchsuite_item_id == null &&
              candidate.kind === "song" &&
              candidate.song_id === item.songId,
          )
        : undefined;
    if (!row) {
      row = rows.find(
        (candidate) =>
          !used.has(candidate.id) &&
          candidate.churchsuite_item_id == null &&
          candidate.kind === item.kind &&
          normalize(candidate.title) === normalize(item.title),
      );
    }
    if (!row) {
      const candidate = rows[item.sequence];
      if (
        candidate &&
        !used.has(candidate.id) &&
        candidate.churchsuite_item_id == null &&
        candidate.kind === item.kind
      ) {
        row = candidate;
      }
    }
    if (row) {
      matches.set(item.planItemId, row);
      used.add(row.id);
    }
  }

  const removedRows = rows.filter(
    (row) =>
      !used.has(row.id) &&
      row.churchsuite_item_id != null &&
      !desiredIds.has(row.churchsuite_item_id),
  );
  const removedIds = new Set(removedRows.map((row) => row.id));
  const manualRows = rows.filter((row) => !used.has(row.id) && !removedIds.has(row.id));
  return { matches, removedRows, manualRows };
}

export function analyseChurchsuiteSync(
  desired: ChurchsuiteDesiredItem[],
  existing: ChurchSuiteExistingSetlist,
  rows: ChurchsuiteSetlistItemRow[],
  meta: { name: string; serviceDate: string; serviceTime: string | null },
): SyncAnalysis {
  const { matches, removedRows, manualRows } = matchExistingItems(desired, rows);
  const changes: ChurchSuiteSyncChange[] = [];
  let updated = 0;
  let unchanged = 0;

  const setlistFields: ChurchSuiteSyncFieldChange[] = [];
  if (existing.name !== meta.name) {
    setlistFields.push({ label: "Name", before: existing.name, after: meta.name });
  }
  if (existing.serviceDate !== meta.serviceDate) {
    setlistFields.push({
      label: "Service date",
      before: existing.serviceDate,
      after: meta.serviceDate,
    });
  }
  if ((existing.serviceTime ?? null) !== (meta.serviceTime ?? null)) {
    setlistFields.push({
      label: "Service time",
      before: existing.serviceTime,
      after: meta.serviceTime,
    });
  }
  if (setlistFields.length) {
    changes.push({
      kind: "setlist",
      title: "Set list details",
      detail: `“${existing.name}”`,
      fields: setlistFields,
    });
  }

  for (const item of desired) {
    const row = matches.get(item.planItemId);
    if (!row) {
      changes.push({
        kind: "added",
        title: item.title,
        detail: describeDesired(item),
        fields: [],
      });
      continue;
    }
    const fields: ChurchSuiteSyncFieldChange[] = [];
    if (row.kind !== item.kind) {
      fields.push({ label: "Item type", before: row.kind, after: item.kind });
    }
    if (row.song_id !== item.songId) {
      fields.push({
        label: "Song",
        before: row.song_id ? row.title : null,
        after: item.songId ? item.title : null,
      });
    } else if (row.title !== item.title) {
      fields.push({ label: "Title", before: row.title, after: item.title });
    }
    if ((row.content ?? null) !== (item.content ?? null)) {
      fields.push({
        label: "Content",
        before: changeValue(row.content),
        after: changeValue(item.content),
      });
    }
    if ((row.content_source ?? "text") !== item.contentSource) {
      fields.push({
        label: "Content source",
        before: row.content_source ?? "text",
        after: item.contentSource,
      });
    }
    if ((row.text_format ?? null) !== item.textFormat) {
      fields.push({ label: "Format", before: row.text_format, after: item.textFormat });
    }
    if ((row.text_align ?? null) !== item.textAlign) {
      fields.push({ label: "Alignment", before: row.text_align, after: item.textAlign });
    }
    if ((row.key_override ?? null) !== (item.keyOverride ?? null)) {
      fields.push({ label: "Key", before: row.key_override, after: item.keyOverride });
    }
    if (item.bibleLayout) {
      const existingLayout =
        parseItemSnapshot(row.churchsuite_snapshot)?.layout ?? inferBibleLayout(row);
      if (existingLayout !== item.bibleLayout) {
        fields.push({
          label: "Bible layout",
          before: existingLayout,
          after: item.bibleLayout,
        });
      }
    }
    if ((row.notes ?? null) !== (item.notes ?? null)) {
      fields.push({
        label: "Notes",
        before: changeValue(row.notes),
        after: changeValue(item.notes),
      });
    }
    if (row.position !== item.sequence) {
      fields.push({
        label: "Position",
        before: String(row.position + 1),
        after: String(item.sequence + 1),
      });
    }
    if (fields.length) {
      updated += 1;
      changes.push({
        kind: "updated",
        title: item.title,
        detail: describeDesired(item),
        fields,
      });
    } else {
      unchanged += 1;
    }
  }

  for (const row of removedRows) {
    changes.push({
      kind: "removed",
      title: row.title,
      detail: "No longer in the ChurchSuite plan",
      fields: [],
    });
  }

  return {
    changes,
    summary: {
      added: changes.filter((change) => change.kind === "added").length,
      updated,
      removed: removedRows.length,
      unchanged,
      manual: manualRows.length,
    },
    matches,
    removedRows,
    manualRows,
  };
}

function insertSetlistItem(
  setlistId: string,
  item: ChurchsuiteDesiredItem,
  position: number,
): void {
  db.prepare(
    `INSERT INTO setlist_items
     (id, setlist_id, position, kind, song_id, title, content, content_source,
      text_format, text_align, key_override, transpose, max_lines, verse_order, notes,
      churchsuite_item_id, churchsuite_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    setlistId,
    position,
    item.kind,
    item.songId,
    item.title,
    item.content,
    item.contentSource,
    item.textFormat,
    item.textAlign,
    item.keyOverride,
    0,
    4,
    null,
    item.notes,
    item.planItemId,
    item.snapshot || null,
  );
}

export async function importChurchsuitePlan(
  planId: number,
  input: ChurchsuiteImportOptions = {},
): Promise<{ report: ChurchSuiteImportReport; setlist: unknown }> {
  const preview = await previewChurchsuitePlan(planId);
  const desired = buildDesiredSetlistItems(preview, input);
  if (!desired.items.length) throw new Error("This plan has no importable items");

  const id = randomUUID();
  const now = new Date().toISOString();
  const meta = importMeta(preview, input);

  db.prepare(
    `INSERT INTO setlists
       (id, name, service_date, service_time, notes, churchsuite_plan_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    meta.name,
    meta.serviceDate,
    meta.serviceTime,
    meta.notes,
    planId,
    now,
    now,
  );

  for (const item of desired.items) insertSetlistItem(id, item, item.sequence);
  db.prepare("UPDATE setlists SET updated_at = ? WHERE id = ?").run(now, id);
  await saveSetlistToGit(id).catch(() => undefined);
  const setlist = db.prepare("SELECT * FROM setlists WHERE id = ?").get(id);
  return {
    report: {
      setlistId: id,
      setlistName: meta.name,
      mode: "created",
      itemCount: desired.items.length,
      songsMatched: desired.songsMatched,
      placeholders: desired.placeholders,
      emptyItems: desired.emptyItems,
      skipped: desired.skipped,
      added: desired.items.length,
      updated: 0,
      removed: 0,
      unchanged: 0,
      manual: 0,
    },
    setlist,
  };
}

export async function previewChurchsuiteSync(
  planId: number,
  input: ChurchsuiteImportOptions = {},
): Promise<ChurchSuiteSyncPreview> {
  const preview = await previewChurchsuitePlan(planId);
  if (!preview.existingSetlist) {
    throw new Error("This ChurchSuite plan has no existing set list");
  }
  const rows = setlistItemRows(preview.existingSetlist.id);
  const desired = buildDesiredSetlistItems(
    preview,
    withExistingChoices(preview, rows, input),
  );
  if (!desired.items.length) throw new Error("This plan has no importable items");
  const meta = importMeta(preview, input);
  const analysis = analyseChurchsuiteSync(
    desired.items,
    preview.existingSetlist,
    rows,
    meta,
  );
  return {
    existingSetlist: preview.existingSetlist,
    changes: analysis.changes,
    summary: analysis.summary,
  };
}

export async function syncChurchsuitePlan(
  planId: number,
  input: ChurchsuiteImportOptions = {},
): Promise<{ report: ChurchSuiteImportReport; setlist: unknown }> {
  const preview = await previewChurchsuitePlan(planId);
  return applyChurchsuiteSync(preview, input);
}

export async function applyChurchsuiteSync(
  preview: ChurchSuitePlanPreview,
  input: ChurchsuiteImportOptions = {},
): Promise<{ report: ChurchSuiteImportReport; setlist: unknown }> {
  if (!preview.existingSetlist) {
    throw new Error("This ChurchSuite plan has no existing set list");
  }
  const existing = preview.existingSetlist;
  const rows = setlistItemRows(existing.id);
  const desired = buildDesiredSetlistItems(
    preview,
    withExistingChoices(preview, rows, input),
  );
  if (!desired.items.length) throw new Error("This plan has no importable items");
  const meta = importMeta(preview, input);
  const analysis = analyseChurchsuiteSync(desired.items, existing, rows, meta);
  const now = new Date().toISOString();

  const updateItem = db.prepare(
    `UPDATE setlist_items
     SET position = ?, kind = ?, song_id = ?, title = ?, content = ?,
         content_source = ?, text_format = ?, text_align = ?, key_override = ?,
         notes = ?, churchsuite_item_id = ?, churchsuite_snapshot = ?
     WHERE id = ? AND setlist_id = ?`,
  );
  db.transaction(() => {
    db.prepare(
      `UPDATE setlists
       SET name = ?, service_date = ?, service_time = ?, notes = ?,
           churchsuite_plan_id = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      meta.name,
      meta.serviceDate,
      meta.serviceTime,
      meta.notes,
      preview.plan.id,
      now,
      existing.id,
    );

    const removeItem = db.prepare("DELETE FROM setlist_items WHERE id = ? AND setlist_id = ?");
    for (const row of analysis.removedRows) removeItem.run(row.id, existing.id);

    for (const item of desired.items) {
      const row = analysis.matches.get(item.planItemId);
      if (row) {
        updateItem.run(
          item.sequence,
          item.kind,
          item.songId,
          item.title,
          item.content,
          item.contentSource,
          item.textFormat,
          item.textAlign,
          item.keyOverride,
          item.notes,
          item.planItemId,
          item.snapshot || null,
          row.id,
          existing.id,
        );
      } else {
        insertSetlistItem(existing.id, item, item.sequence);
      }
    }

    const updatePosition = db.prepare(
      "UPDATE setlist_items SET position = ? WHERE id = ? AND setlist_id = ?",
    );
    analysis.manualRows.forEach((row, index) => {
      updatePosition.run(desired.items.length + index, row.id, existing.id);
    });
  })();

  await saveSetlistToGit(existing.id).catch(() => undefined);
  const setlist = db.prepare("SELECT * FROM setlists WHERE id = ?").get(existing.id);
  return {
    report: {
      setlistId: existing.id,
      setlistName: meta.name,
      mode: "updated",
      itemCount: desired.items.length,
      songsMatched: desired.songsMatched,
      placeholders: desired.placeholders,
      emptyItems: desired.emptyItems,
      skipped: desired.skipped,
      added: analysis.summary.added,
      updated: analysis.summary.updated,
      removed: analysis.summary.removed,
      unchanged: analysis.summary.unchanged,
      manual: analysis.summary.manual,
    },
    setlist,
  };
}
