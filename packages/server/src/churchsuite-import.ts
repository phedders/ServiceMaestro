import { randomUUID } from "node:crypto";
import type {
  ChurchSuiteImportReport,
  ChurchSuiteItemPreview,
  ChurchSuitePlanPreview,
  ChurchSuitePlanSummary,
} from "@sm/shared";
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
  return match ? `${match[1]}${match[2]}${match[3]}` : value;
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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
    .prepare("SELECT * FROM songs")
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
  } = {},
): Promise<{ report: ChurchSuiteImportReport; setlist: unknown }> {
  const preview = await previewChurchsuitePlan(planId);
  if (!preview.items.some((item) => item.action !== "skip")) {
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
     (id, setlist_id, position, kind, song_id, title, content, text_format, text_align,
      key_override, transpose, max_lines, verse_order, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let position = 0;
  let songsMatched = 0;
  let placeholders = 0;
  let emptyItems = 0;
  let skipped = 0;
  for (const item of preview.items) {
    if (item.action === "skip") {
      skipped += 1;
      continue;
    }
    if (item.action === "song" && item.matchedSong) {
      const selectedId = input.songSelections?.[String(item.id)];
      const selected = selectedId
        ? item.matchCandidates.find((candidate) => candidate.id === selectedId)
        : undefined;
      const chosen = selected ?? item.matchedSong;
      insert.run(
        randomUUID(),
        id,
        position,
        "song",
        chosen.id,
        chosen.title,
        null,
        null,
        null,
        item.key,
        0,
        4,
        null,
        item.notes,
      );
      songsMatched += 1;
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
