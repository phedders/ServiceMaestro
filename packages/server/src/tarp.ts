import { randomUUID } from "node:crypto";
import type {
  TarpAspect,
  TarpBackground,
  TarpPage,
  TarpPageTransition,
  TarpPresentationDetail,
  TarpPresentationSummary,
  TarpTheme,
  TarpView,
} from "@sm/shared";
import { db } from "./db.js";

interface ThemeRow {
  id: string;
  name: string;
  background_json: string;
  font_family: string;
  text_color: string;
  accent_color: string;
  created_at: string;
  updated_at: string;
}

interface PresentationRow {
  id: string;
  name: string;
  aspect: TarpAspect;
  theme_id: string | null;
  created_at: string;
  updated_at: string;
  page_count?: number;
}

interface PageRow {
  id: string;
  presentation_id: string;
  position: number;
  name: string;
  theme_id: string | null;
  start_from_previous: number;
  transition_json: string | null;
  normal_json: string;
  lowerthird_json: string;
  created_at: string;
  updated_at: string;
}

export interface TarpThemeInput {
  name: string;
  background: TarpBackground;
  fontFamily: string;
  textColor: string;
  accentColor: string;
}

export interface TarpPresentationInput {
  name: string;
  aspect: TarpAspect;
  themeId?: string | null;
}

export interface TarpPageInput {
  name?: string;
  themeId?: string | null;
  startFromPrevious?: boolean;
  transition?: TarpPageTransition | null;
  normal?: TarpView;
  lowerthird?: TarpView;
}

function now(): string {
  return new Date().toISOString();
}

function emptyView(): TarpView {
  return {
    background: null,
    backgroundId: null,
    fontFamily: null,
    textColor: null,
    objects: [],
  };
}

function normalizeView(view: TarpView): TarpView {
  return {
    ...emptyView(),
    ...view,
    backgroundId: view.backgroundId ?? null,
    objects: Array.isArray(view.objects) ? view.objects : [],
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapTheme(row: ThemeRow): TarpTheme {
  return {
    id: row.id,
    name: row.name,
    background: parseJson<TarpBackground>(row.background_json, { type: "color", color: "#0b1220" }),
    fontFamily: row.font_family,
    textColor: row.text_color,
    accentColor: row.accent_color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPage(row: PageRow): TarpPage {
  return {
    id: row.id,
    presentationId: row.presentation_id,
    position: row.position,
    name: row.name,
    themeId: row.theme_id,
    startFromPrevious: Boolean(row.start_from_previous),
    transition: parseJson<TarpPageTransition | null>(row.transition_json, null),
    normal: normalizeView(parseJson<TarpView>(row.normal_json, emptyView())),
    lowerthird: normalizeView(parseJson<TarpView>(row.lowerthird_json, emptyView())),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pageRows(presentationId: string): TarpPage[] {
  return (
    db
      .prepare("SELECT * FROM tarp_pages WHERE presentation_id = ? ORDER BY position, rowid")
      .all(presentationId) as PageRow[]
  ).map(mapPage);
}

function mapSummary(row: PresentationRow): TarpPresentationSummary {
  return {
    id: row.id,
    name: row.name,
    aspect: row.aspect,
    themeId: row.theme_id,
    pageCount: row.page_count ?? 0,
    updatedAt: row.updated_at,
  };
}

export function listTarpThemes(): TarpTheme[] {
  return (
    db.prepare("SELECT * FROM tarp_themes ORDER BY name COLLATE NOCASE").all() as ThemeRow[]
  ).map(mapTheme);
}

export function getTarpTheme(id: string): TarpTheme | null {
  const row = db.prepare("SELECT * FROM tarp_themes WHERE id = ?").get(id) as ThemeRow | undefined;
  return row ? mapTheme(row) : null;
}

export function createTarpTheme(input: TarpThemeInput): TarpTheme {
  const id = randomUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO tarp_themes
     (id, name, background_json, font_family, text_color, accent_color, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    JSON.stringify(input.background),
    input.fontFamily,
    input.textColor,
    input.accentColor,
    timestamp,
    timestamp,
  );
  return getTarpTheme(id)!;
}

export function updateTarpTheme(id: string, input: TarpThemeInput): TarpTheme | null {
  const existing = getTarpTheme(id);
  if (!existing) return null;
  db.prepare(
    `UPDATE tarp_themes SET name = ?, background_json = ?, font_family = ?, text_color = ?,
     accent_color = ?, updated_at = ? WHERE id = ?`,
  ).run(
    input.name,
    JSON.stringify(input.background),
    input.fontFamily,
    input.textColor,
    input.accentColor,
    now(),
    id,
  );
  return getTarpTheme(id);
}

export function deleteTarpTheme(id: string): boolean {
  return db.prepare("DELETE FROM tarp_themes WHERE id = ?").run(id).changes > 0;
}

export function listTarpPresentations(): TarpPresentationSummary[] {
  return (
    db
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM tarp_pages pg WHERE pg.presentation_id = p.id) AS page_count
         FROM tarp_presentations p
         ORDER BY p.updated_at DESC, p.name COLLATE NOCASE`,
      )
      .all() as PresentationRow[]
  ).map(mapSummary);
}

export function getTarpPresentation(id: string): TarpPresentationDetail | null {
  const row = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM tarp_pages pg WHERE pg.presentation_id = p.id) AS page_count
       FROM tarp_presentations p WHERE p.id = ?`,
    )
    .get(id) as PresentationRow | undefined;
  if (!row) return null;
  return {
    ...mapSummary(row),
    createdAt: row.created_at,
    pages: pageRows(id),
  };
}

function insertPage(presentationId: string, position: number, source?: TarpPage): TarpPage {
  const id = randomUUID();
  const timestamp = now();
  const normal: TarpView = source
    ? (JSON.parse(JSON.stringify(source.normal)) as TarpView)
    : emptyView();
  const lowerthird: TarpView = source
    ? (JSON.parse(JSON.stringify(source.lowerthird)) as TarpView)
    : emptyView();
  db.prepare(
    `INSERT INTO tarp_pages
     (id, presentation_id, position, name, theme_id, start_from_previous, transition_json,
      normal_json, lowerthird_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    presentationId,
    position,
    source ? `${source.name} copy` : `Page ${position + 1}`,
    source?.themeId ?? null,
    source ? 1 : 0,
    source?.transition ? JSON.stringify(source.transition) : null,
    JSON.stringify(normal),
    JSON.stringify(lowerthird),
    timestamp,
    timestamp,
  );
  return mapPage(db.prepare("SELECT * FROM tarp_pages WHERE id = ?").get(id) as PageRow);
}

export function createTarpPresentation(input: TarpPresentationInput): TarpPresentationDetail {
  const id = randomUUID();
  const timestamp = now();
  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO tarp_presentations (id, name, aspect, theme_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, input.name, input.aspect, input.themeId ?? null, timestamp, timestamp);
    insertPage(id, 0);
  });
  transaction();
  return getTarpPresentation(id)!;
}

export function updateTarpPresentation(
  id: string,
  input: Partial<TarpPresentationInput>,
): TarpPresentationDetail | null {
  const existing = getTarpPresentation(id);
  if (!existing) return null;
  db.prepare(
    `UPDATE tarp_presentations SET name = ?, aspect = ?, theme_id = ?, updated_at = ? WHERE id = ?`,
  ).run(
    input.name ?? existing.name,
    input.aspect ?? existing.aspect,
    input.themeId !== undefined ? input.themeId : existing.themeId,
    now(),
    id,
  );
  return getTarpPresentation(id);
}

export function deleteTarpPresentation(id: string): boolean {
  return db.prepare("DELETE FROM tarp_presentations WHERE id = ?").run(id).changes > 0;
}

export function addTarpPage(
  presentationId: string,
  sourcePageId?: string | null,
): TarpPresentationDetail | null {
  const presentation = getTarpPresentation(presentationId);
  if (!presentation) return null;
  const source = sourcePageId
    ? presentation.pages.find((page) => page.id === sourcePageId)
    : undefined;
  const position =
    presentation.pages.reduce((max, page) => Math.max(max, page.position), -1) + 1;
  const transaction = db.transaction(() => {
    insertPage(presentationId, position, source);
    db.prepare("UPDATE tarp_presentations SET updated_at = ? WHERE id = ?").run(now(), presentationId);
  });
  transaction();
  return getTarpPresentation(presentationId);
}

export function updateTarpPage(id: string, input: TarpPageInput): TarpPage | null {
  const row = db.prepare("SELECT * FROM tarp_pages WHERE id = ?").get(id) as PageRow | undefined;
  if (!row) return null;
  const existing = mapPage(row);
  const nextNormal = input.normal ?? existing.normal;
  const nextLowerThird = input.lowerthird ?? existing.lowerthird;
  db.prepare(
    `UPDATE tarp_pages SET name = ?, theme_id = ?, start_from_previous = ?, transition_json = ?,
     normal_json = ?, lowerthird_json = ?, updated_at = ? WHERE id = ?`,
  ).run(
    input.name ?? existing.name,
    input.themeId !== undefined ? input.themeId : existing.themeId,
    input.startFromPrevious !== undefined ? (input.startFromPrevious ? 1 : 0) : existing.startFromPrevious ? 1 : 0,
    input.transition !== undefined
      ? input.transition
        ? JSON.stringify(input.transition)
        : null
      : existing.transition
        ? JSON.stringify(existing.transition)
        : null,
    JSON.stringify(nextNormal),
    JSON.stringify(nextLowerThird),
    now(),
    id,
  );
  db.prepare("UPDATE tarp_presentations SET updated_at = ? WHERE id = ?").run(
    now(),
    existing.presentationId,
  );
  const updated = db.prepare("SELECT * FROM tarp_pages WHERE id = ?").get(id) as PageRow;
  return mapPage(updated);
}

export function deleteTarpPage(id: string): boolean {
  const row = db.prepare("SELECT presentation_id FROM tarp_pages WHERE id = ?").get(id) as
    | { presentation_id: string }
    | undefined;
  if (!row) return false;
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM tarp_pages WHERE id = ?").run(id);
    const remaining = db
      .prepare("SELECT id FROM tarp_pages WHERE presentation_id = ? ORDER BY position, rowid")
      .all(row.presentation_id) as Array<{ id: string }>;
    const renumber = db.prepare("UPDATE tarp_pages SET position = ? WHERE id = ?");
    remaining.forEach((page, index) => renumber.run(index, page.id));
    db.prepare("UPDATE tarp_presentations SET updated_at = ? WHERE id = ?").run(
      now(),
      row.presentation_id,
    );
  });
  transaction();
  return true;
}

export function reorderTarpPages(presentationId: string, pageIds: string[]): TarpPresentationDetail | null {
  const presentation = getTarpPresentation(presentationId);
  if (!presentation) return null;
  const valid = new Set(presentation.pages.map((page) => page.id));
  const ordered = pageIds.filter((id) => valid.has(id));
  for (const page of presentation.pages) {
    if (!ordered.includes(page.id)) ordered.push(page.id);
  }
  const transaction = db.transaction(() => {
    const update = db.prepare("UPDATE tarp_pages SET position = ? WHERE id = ?");
    ordered.forEach((pageId, index) => update.run(index, pageId));
    db.prepare("UPDATE tarp_presentations SET updated_at = ? WHERE id = ?").run(now(), presentationId);
  });
  transaction();
  return getTarpPresentation(presentationId);
}
