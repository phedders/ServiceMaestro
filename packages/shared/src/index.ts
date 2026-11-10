import { z } from "zod";

export type Role = "admin" | "editor" | "operator" | "musician" | "viewer";

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
}

export interface Song {
  id: string;
  title: string;
  author: string | null;
  copyright: string | null;
  ccli: string | null;
  key: string | null;
  lyrics: string;
  verseOrder: string | null;
  sourceFormat: string | null;
  sourcePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ItemKind = "song" | "text";

export interface SetlistItem {
  id: string;
  position: number;
  kind: ItemKind;
  songId: string | null;
  title: string;
  content: string | null;
  keyOverride: string | null;
  transpose: number;
  maxLines: number;
  verseOrder: string | null;
  notes: string | null;
}

export interface SetlistSummary {
  id: string;
  name: string;
  serviceDate: string;
  serviceTime: string | null;
  notes: string | null;
  itemCount: number;
  updatedAt: string;
}

export interface SetlistDetail extends SetlistSummary {
  items: SetlistItem[];
}

export interface SetlistRevisionInfo {
  id: string;
  setlistId: string;
  revisionNo: number;
  itemCount: number;
  createdAt: string;
  createdBy: string | null;
}

export type LiveApplyMode = "after-current" | "now";

export interface SetlistImportPreview {
  fileName: string;
  selfContained: boolean;
  name: string;
  serviceDate: string;
  serviceTime: string | null;
  itemCount: number;
  songCount: number;
  textCount: number;
  songs: Array<{
    title: string;
    matched: boolean;
    matchTitle: string | null;
    ccli: string | null;
  }>;
}

export interface SetlistImportReport {
  setlistId: string;
  setlistName: string;
  importedItems: number;
  songsCreated: number;
  songsMatched: number;
  assetsImported: number;
  skipped: Array<{ title: string; reason: string }>;
}

export interface LiveItemSummary {
  index: number;
  kind: ItemKind;
  title: string;
  notes: string | null;
}

export interface LivePage {
  index: number;
  section: string | null;
  html: string;
}

export interface DisplayTemplate {
  html: string;
  css: string;
}

export interface DisplayConfig {
  fontFamily: string;
  textColor: string;
  textScale: number;
  maxLines: number;
}

export interface LiveState {
  sessionId: string;
  setlistId: string | null;
  setlistName: string;
  status: "idle" | "live" | "rehearsal" | "ended";
  itemIndex: number;
  pageIndex: number;
  pageCount: number;
  mode: "song" | "text" | "blank" | "idle";
  title: string;
  blank: boolean;
  maxLines: number;
  transpose: number;
  footer: string;
  pages: LivePage[];
  items: LiveItemSummary[];
  templates?: Record<string, DisplayTemplate>;
  displayConfig?: DisplayConfig;
  queuedItemIndex?: number | null;
  queuedTitle?: string | null;
  queuedPages?: LivePage[];
  version: number;
  updatedAt: string;
  pendingUpdate: boolean;
  pendingRevision: number | null;
}

export interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
}

export interface WidgetConfig {
  type: string;
  props?: Record<string, unknown>;
}

export interface DashboardLayout {
  version: 1;
  layouts: {
    lg: LayoutItem[];
    md?: LayoutItem[];
    sm?: LayoutItem[];
  };
  widgets: Record<string, WidgetConfig>;
}

export interface SongImportPreview {
  path: string;
  bytes: number;
  format: "openlp" | "chordpro" | "text";
  title: string;
  author: string | null;
  copyright: string | null;
  ccli: string | null;
  key: string | null;
  lyrics: string;
  warnings: string[];
}

export interface SongImportScan {
  root: string;
  files: SongImportPreview[];
  errors: Array<{ path: string; error: string }>;
  skipped: number;
}

export interface SongImportReport {
  imported: number;
  updated: number;
  skipped: Array<{ path: string; reason: string }>;
  errors: Array<{ path: string; error: string }>;
  songs: Array<{ id: string; title: string; path: string }>;
}

export interface BibleTranslationInfo {
  code: string;
  name: string;
  schema: "mybible" | "bibledb" | "json";
  books: number;
  verses: number;
  copyright: string | null;
}

export interface BibleBook {
  number: number;
  name: string;
  chapters: number;
}

export interface BibleVerse {
  number: number;
  text: string;
}

export interface BiblePassage {
  translation: string;
  translationName: string;
  book: number;
  bookName: string;
  chapter: number;
  from: number;
  to: number;
  verses: BibleVerse[];
}

export type SongAssetKind = "score_pdf" | "guitar_tab" | "chordpro" | "lyrics" | "image";

export interface SongAsset {
  id: string;
  songId: string;
  kind: SongAssetKind;
  title: string;
  key: string | null;
  format: string;
  mime: string;
  bytes: number;
  sha256: string;
  pages: number | null;
  source: string | null;
  createdAt: string;
  createdBy: string | null;
}

/* ------------------------------------------------------------------ */
/* Validation schemas                                                  */
/* ------------------------------------------------------------------ */

export const loginSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
});

export const songInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(300).optional().nullable(),
  copyright: z.string().trim().max(500).optional().nullable(),
  ccli: z.string().trim().max(50).optional().nullable(),
  key: z.string().trim().max(10).optional().nullable(),
  lyrics: z.string().max(200_000),
  verseOrder: z.string().trim().max(1000).optional().nullable(),
});

export const setlistInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  serviceTime: z.string().trim().max(10).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const setlistItemInputSchema = z.object({
  kind: z.enum(["song", "text"]),
  songId: z.string().optional().nullable(),
  title: z.string().trim().max(300).optional(),
  content: z.string().max(200_000).optional().nullable(),
  keyOverride: z.string().trim().max(10).optional().nullable(),
  transpose: z.number().int().min(-24).max(24).optional(),
  maxLines: z.number().int().min(1).max(30).optional(),
  verseOrder: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const setlistItemPatchSchema = setlistItemInputSchema.partial().omit({ kind: true, songId: true });

export const reorderSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
});

export const liveCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("next") }),
  z.object({ type: z.literal("prev") }),
  z.object({ type: z.literal("page"), delta: z.number().int().min(-50).max(50) }),
  z.object({ type: z.literal("goto"), itemIndex: z.number().int().min(0).optional(), pageIndex: z.number().int().min(0).optional() }),
  z.object({ type: z.literal("queueItem"), itemIndex: z.number().int().min(0) }),
  z.object({ type: z.literal("blank"), value: z.boolean().optional() }),
  z.object({ type: z.literal("transpose"), delta: z.number().int().min(-12).max(12) }),
  z.object({ type: z.literal("maxLines"), value: z.number().int().min(1).max(30) }),
  z.object({ type: z.literal("footer"), text: z.string().max(500) }),
]);

export const quickTextSchema = z.object({
  text: z.string().min(1).max(50_000),
  mode: z.enum(["direct", "setlist"]).default("direct"),
});

export const startSessionSchema = z.object({
  setlistId: z.string().min(1),
  status: z.enum(["live", "rehearsal"]).default("live"),
});

export const liveApplySchema = z
  .object({
    mode: z.enum(["after-current", "now"]).default("after-current"),
    setlistId: z.string().min(1).optional(),
    revisionId: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.setlistId || value.revisionId), {
    message: "setlistId or revisionId is required",
  });

const layoutItemSchema = z.object({
  i: z.string().min(1).max(100),
  x: z.number().int().min(0).max(200),
  y: z.number().int().min(0).max(5000),
  w: z.number().int().min(1).max(200),
  h: z.number().int().min(1).max(200),
  minW: z.number().int().min(1).max(200).optional(),
  minH: z.number().int().min(1).max(200).optional(),
  maxW: z.number().int().min(1).max(200).optional(),
  maxH: z.number().int().min(1).max(200).optional(),
  static: z.boolean().optional(),
});

export const displayConfigSchema = z.object({
  fontFamily: z.string().trim().min(1).max(200),
  textColor: z.string().trim().regex(/^#[0-9a-f]{6}$/i),
  textScale: z.number().min(0.5).max(2.5),
  maxLines: z.number().int().min(1).max(30),
});

export const dashboardLayoutSchema = z.object({  version: z.literal(1),
  layouts: z.object({
    lg: z.array(layoutItemSchema).max(100),
    md: z.array(layoutItemSchema).max(100).optional(),
    sm: z.array(layoutItemSchema).max(100).optional(),
  }),
  widgets: z.record(
    z.string().min(1).max(100),
    z.object({
      type: z.string().min(1).max(80),
      props: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});
