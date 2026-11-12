import { z } from "zod";

export type Role = "admin" | "editor" | "operator" | "musician" | "viewer";

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
}

export type TextFormat = "text" | "markdown" | "html" | "rst";

export interface SongVerseOrder {
  id: string;
  songId: string;
  name: string;
  order: string;
  createdAt: string;
  updatedAt: string;
}

export interface Song {
  id: string;
  title: string;
  alternateTitles: string | null;
  author: string | null;
  copyright: string | null;
  ccli: string | null;
  key: string | null;
  lyrics: string;
  verseOrder: string | null;
  lyricsMarkdown: boolean;
  verseOrders: SongVerseOrder[];
  sourceFormat: string | null;
  sourcePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ItemKind = "song" | "text" | "image" | "image_list" | "tarp";
export type ImageFit = "scale" | "actual" | "crop" | "stretch";

export type PlaybackMode = "single" | "loop" | "bounce";

function normalizePlaybackMode(mode: unknown, legacyLoop: unknown): PlaybackMode {
  if (mode === "single" || mode === "loop" || mode === "bounce") return mode;
  return legacyLoop === false ? "single" : "loop";
}

export function nextPlaybackPage(
  pageIndex: number,
  pageCount: number,
  mode: PlaybackMode,
  direction: 1 | -1,
): { pageIndex: number; direction: 1 | -1; done: boolean } {
  if (pageCount <= 1) return { pageIndex: 0, direction, done: true };
  if (mode === "single") {
    const next = pageIndex + 1;
    return next < pageCount
      ? { pageIndex: next, direction: 1, done: false }
      : { pageIndex, direction: 1, done: true };
  }
  if (mode === "loop") {
    return { pageIndex: (pageIndex + 1) % pageCount, direction: 1, done: false };
  }
  let nextDirection = direction;
  if (nextDirection === 1 && pageIndex >= pageCount - 1) nextDirection = -1;
  if (nextDirection === -1 && pageIndex <= 0) nextDirection = 1;
  const next = Math.max(0, Math.min(pageCount - 1, pageIndex + nextDirection));
  return { pageIndex: next, direction: nextDirection, done: false };
}

export interface ImageListContent {
  folder: string;
  images: string[];
  autoplay: boolean;
  mode: PlaybackMode;
  delaySeconds: number;
}

export function parseImageListContent(
  value: string | null | undefined,
): ImageListContent | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ImageListContent> & { loop?: unknown };
    const images = Array.isArray(parsed.images)
      ? parsed.images.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      : [];
    if (!images.length) return null;
    const delay = Number(parsed.delaySeconds);
    return {
      folder: typeof parsed.folder === "string" ? parsed.folder : "",
      images,
      autoplay: parsed.autoplay === true,
      mode: normalizePlaybackMode(parsed.mode, parsed.loop),
      delaySeconds: Number.isFinite(delay) ? Math.max(1, Math.min(300, delay)) : 6,
    };
  } catch {
    return null;
  }
}

export function serializeImageListContent(value: ImageListContent): string {
  return JSON.stringify({
    folder: value.folder,
    images: value.images,
    autoplay: value.autoplay,
    mode: value.mode,
    // Keep the legacy field for older bundles; new readers use `mode`.
    loop: value.mode !== "single",
    delaySeconds: Math.max(1, Math.min(300, value.delaySeconds || 6)),
  });
}

export interface TarpItemContent {
  presentationId: string;
  autoplay: boolean;
  mode: PlaybackMode;
  delaySeconds: number;
}

export function parseTarpItemContent(value: string | null | undefined): TarpItemContent | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<TarpItemContent> & { loop?: unknown };
    if (typeof parsed.presentationId !== "string" || !parsed.presentationId.trim()) return null;
    const delay = Number(parsed.delaySeconds);
    return {
      presentationId: parsed.presentationId,
      autoplay: parsed.autoplay === true,
      mode: normalizePlaybackMode(parsed.mode, parsed.loop),
      delaySeconds: Number.isFinite(delay) ? Math.max(1, Math.min(300, delay)) : 6,
    };
  } catch {
    return null;
  }
}

export function serializeTarpItemContent(value: TarpItemContent): string {
  return JSON.stringify({
    presentationId: value.presentationId,
    autoplay: value.autoplay,
    mode: value.mode,
    // Keep the legacy field for older bundles; new readers use `mode`.
    loop: value.mode !== "single",
    delaySeconds: Math.max(1, Math.min(300, value.delaySeconds || 6)),
  });
}

export interface SetlistItem {
  id: string;
  position: number;
  kind: ItemKind;
  songId: string | null;
  title: string;
  content: string | null;
  format: TextFormat | null;
  textAlign: "left" | "center";
  imageFit: ImageFit;
  contentSource: "text" | "bible";
  backgroundId: string | null;
  stingerId: string | null;
  stingerPageOverrides: Record<string, string>;
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
  backgroundId: string | null;
  stingerId: string | null;
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
  stinger?: StingerAsset | null;
}

export interface DisplayTemplate {
  html: string;
  css: string;
}

export const SMART_WRAP_MODULES = ["songs", "text", "bible"] as const;
export type SmartWrapModule = (typeof SMART_WRAP_MODULES)[number];

export interface DisplayConfig {
  fontFamily: string;
  textColor: string;
  textScale: number;
  maxLines: number;
  maxWords: number;
  smartPageSplits: boolean;
  smartWrapMinWords: number;
  smartWrapModules: SmartWrapModule[];
  lowerThirdImageMaxHeightPercent: number;
  lowerThirdImagePadding: number;
  lowerThirdFontFamily: string;
  lowerThirdTextScale: number;
}

export interface DisplayViewLink {
  id: string;
  label: string;
  url: string;
}

export type BackgroundKind = "image" | "css" | "svg";

/** Item-level override that explicitly suppresses the set-list background. */
export const NO_BACKGROUND_ID = "__none__";

/** Item/page override that explicitly suppresses the set-list stinger. */
export const NO_STINGER_ID = "__none__";

export type StingerKind = "svg" | "image";

export interface StingerAsset {
  id: string;
  name: string;
  kind: StingerKind;
  preset: string | null;
  imagePath: string | null;
  durationMs: number;
  render: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackgroundColors {
  background: string;
  primary: string;
  secondary: string;
  accent: string;
}

export interface BackgroundAsset {
  id: string;
  name: string;
  kind: BackgroundKind;
  preset: string | null;
  imagePath: string | null;
  useGlobalColors: boolean;
  colors: BackgroundColors;
  render: string;
  createdAt: string;
  updatedAt: string;
}

export type TarpAspect = "16:9" | "16:10" | "flex";
export type TarpObjectKind = "text" | "markdown" | "image";
export type TarpAnimationType =
  | "fade-in"
  | "fade-out"
  | "slide-in"
  | "move"
  | "scale"
  | "rotate";

export type TarpBackground =
  | { type: "color"; color: string }
  | { type: "gradient"; from: string; to: string; angle: number }
  | { type: "image"; path: string };

export interface TarpAnimation {
  id: string;
  type: TarpAnimationType;
  delayMs: number;
  durationMs: number;
  easing: string;
}

export interface TarpObjectPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  fontSize: number | null;
  fontWeight: number | null;
  textAlign: "left" | "center" | "right";
  fit: "contain" | "cover";
  color: string | null;
  fontFamily: string | null;
  animations: TarpAnimation[];
}

export interface TarpObject {
  id: string;
  kind: TarpObjectKind;
  content: string;
  locked: boolean;
  visible: boolean;
  normal: TarpObjectPlacement;
  lowerthird: TarpObjectPlacement;
}

export interface TarpView {
  background: TarpBackground | null;
  backgroundId: string | null;
  fontFamily: string | null;
  textColor: string | null;
  objects: TarpObject[];
}

export interface TarpPageTransition {
  type: "cut" | "fade" | "move";
  durationMs: number;
  easing: string;
  objectMode: "animate" | "migrate";
}

export interface TarpPage {
  id: string;
  presentationId: string;
  position: number;
  name: string;
  themeId: string | null;
  startFromPrevious: boolean;
  transition: TarpPageTransition | null;
  normal: TarpView;
  lowerthird: TarpView;
  createdAt: string;
  updatedAt: string;
}

export interface TarpTheme {
  id: string;
  name: string;
  background: TarpBackground;
  fontFamily: string;
  textColor: string;
  accentColor: string;
  createdAt: string;
  updatedAt: string;
}

export interface TarpPresentationSummary {
  id: string;
  name: string;
  aspect: TarpAspect;
  themeId: string | null;
  pageCount: number;
  updatedAt: string;
}

export interface TarpPresentationDetail extends TarpPresentationSummary {
  pages: TarpPage[];
  createdAt: string;
}

export interface FontOption {
  id: string;
  label: string;
  family: string;
  source: "built-in" | "google";
  cssUrl: string | null;
  importedAt: string | null;
}

export const DEFAULT_CHURCHSUITE_EMPTY_TYPES = [
  "Welcome",
  "Misc",
  "Countdown",
  "Prayers",
  "Announcement",
];

export interface AppSettings {
  pageNavigation: "stop" | "next-item";
  churchsuiteEmptyTypes: string[];
  defaultBibleTranslation: string | null;
}

export interface GitSettings {
  autoSave: boolean;
  autoPush: boolean;
  pullIntervalSeconds: number;
  mergeMode: "ff-only" | "merge";
}

export interface GitRepositoryStatus {
  name: string;
  path: string;
  remote: string | null;
  branch: string;
  optional: boolean;
  lfs: string;
  autoSave: boolean;
  autoPush: boolean;
  lastPullAt: string | null;
  lastPushAt: string | null;
  localCommit: string | null;
  error: string | null;
}

export interface GitStatus {
  enabled: boolean;
  autoSave: boolean;
  autoPush: boolean;
  pullIntervalSeconds: number;
  mergeMode: "ff-only" | "merge";
  repositories: GitRepositoryStatus[];
}

export interface ChurchSuitePlanSummary {
  id: number;
  identifier: string | null;
  name: string;
  date: string;
  time: string | null;
  status: string;
}

export interface SongMatchSummary {
  id: string;
  title: string;
  alternateTitles: string | null;
  author: string | null;
  copyright: string | null;
  ccli: string | null;
  key: string | null;
  firstLines: string;
  score: number;
  reasons: string[];
}

export interface SongAlternative extends SongMatchSummary {
  lyrics: string;
  lyricsMarkdown: boolean;
}

export interface ChurchSuiteItemPreview {
  id: number;
  order: number;
  typeId: number | null;
  typeName: string;
  name: string;
  isSong: boolean;
  key: string | null;
  author: string | null;
  notes: string | null;
  duration: number | null;
  action: "song" | "placeholder" | "empty" | "skip";
  matchedSong: {
    id: string;
    title: string;
    key: string | null;
  } | null;
  matchCandidates: SongMatchSummary[];
}

export interface ChurchSuitePlanPreview {
  plan: ChurchSuitePlanSummary;
  items: ChurchSuiteItemPreview[];
  songCount: number;
  matchedCount: number;
  placeholderCount: number;
  emptyCount: number;
}

export interface ChurchSuiteImportReport {
  setlistId: string;
  setlistName: string;
  itemCount: number;
  songsMatched: number;
  placeholders: number;
  emptyItems: number;
  skipped: number;
}

export interface SongSelectWatchFile {
  path: string;
  status: "imported" | "updated" | "skipped" | "error";
  message: string | null;
  songId: string | null;
  songTitle: string | null;
  processedAt: string;
}

export interface SongSelectWatchStatus {
  enabled: boolean;
  directory: string;
  intervalSeconds: number;
  running: boolean;
  lastScanAt: string | null;
  lastError: string | null;
  pendingFiles: number;
  recent: SongSelectWatchFile[];
}

export interface SongSelectWatchReport {
  scanned: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: number;
  files: SongSelectWatchFile[];
}

export interface LiveState {
  sessionId: string;
  setlistId: string | null;
  setlistName: string;
  status: "idle" | "live" | "rehearsal" | "ended";
  itemIndex: number;
  pageIndex: number;
  pageCount: number;
  mode: "song" | "text" | "image" | "image_list" | "tarp" | "blank" | "idle";
  title: string;
  blank: boolean;
  maxLines: number;
  transpose: number;
  footer: string;
  pages: LivePage[];
  items: LiveItemSummary[];
  background?: BackgroundAsset | null;
  templates?: Record<string, DisplayTemplate>;
  displayConfig?: DisplayConfig;
  queuedItemIndex?: number | null;
  queuedTitle?: string | null;
  queuedPages?: LivePage[];
  appendedItems?: number[];
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
  alternateTitles: string | null;
  author: string | null;
  copyright: string | null;
  ccli: string | null;
  key: string | null;
  lyrics: string;
  warnings: string[];
  duplicate: {
    songId: string;
    title: string;
    reason: "ccli" | "title";
  } | null;
  sourceMatch: {
    songId: string;
    title: string;
  } | null;
}

export interface SongImportDecision {
  path: string;
  action: "skip" | "replace" | "duplicate";
  title?: string;
  alternateTitles?: string | null;
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
  replaced: number;
  duplicated: number;
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

export type BibleLayout = "paragraph" | "verses";

export function formatBibleVerses(verses: BibleVerse[], layout: BibleLayout): string {
  const texts = verses.map((verse) => verse.text.trim()).filter(Boolean);
  return layout === "paragraph" ? texts.join(" ") : texts.join("\n");
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

export interface ImageAsset {
  path: string;
  name: string;
  folder: string;
  mime: string;
  bytes: number;
  modifiedAt: string;
  url: string;
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
  alternateTitles: z.string().trim().max(2000).optional().nullable(),
  author: z.string().trim().max(300).optional().nullable(),
  copyright: z.string().trim().max(500).optional().nullable(),
  ccli: z.string().trim().max(50).optional().nullable(),
  key: z.string().trim().max(10).optional().nullable(),
  lyrics: z.string().max(200_000),
  verseOrder: z.string().trim().max(1000).optional().nullable(),
  lyricsMarkdown: z.boolean().optional(),
});

export const songVerseOrderInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  order: z.string().trim().min(1).max(1000),
});

export const songVerseOrderPatchSchema = songVerseOrderInputSchema.partial();

export const setlistInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  serviceTime: z.string().trim().max(10).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  backgroundId: z.string().trim().max(100).optional().nullable(),
  stingerId: z.string().trim().max(100).optional().nullable(),
});

export const setlistItemInputSchema = z.object({
  kind: z.enum(["song", "text", "image", "image_list", "tarp"]),
  songId: z.string().optional().nullable(),
  title: z.string().trim().max(300).optional(),
  content: z.string().max(200_000).optional().nullable(),
  format: z.enum(["text", "markdown", "html", "rst"]).optional().nullable(),
  textAlign: z.enum(["left", "center"]).optional(),
  imageFit: z.enum(["scale", "actual", "crop", "stretch"]).optional(),
  contentSource: z.enum(["text", "bible"]).optional(),
  backgroundId: z.string().trim().max(100).optional().nullable(),
  stingerId: z.string().trim().max(100).optional().nullable(),
  stingerPageOverrides: z
    .record(z.string().regex(/^\d+$/), z.string().trim().max(100))
    .optional(),
  keyOverride: z.string().trim().max(10).optional().nullable(),
  transpose: z.number().int().min(-24).max(24).optional(),
  maxLines: z.number().int().min(1).max(30).optional(),
  verseOrder: z.string().trim().max(1000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const setlistItemPatchSchema = setlistItemInputSchema.partial().omit({ kind: true, songId: true });

export const setlistSongReplacementSchema = z.object({
  songId: z.string().trim().min(1).max(100),
});

export const reorderSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
});

export const liveCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("next") }),
  z.object({ type: z.literal("prev") }),
  z.object({ type: z.literal("page"), delta: z.number().int().min(-50).max(50) }),
  z.object({ type: z.literal("goto"), itemIndex: z.number().int().min(0).optional(), pageIndex: z.number().int().min(0).optional() }),
  z.object({ type: z.literal("queueItem"), itemIndex: z.number().int().min(0) }),
  z.object({ type: z.literal("appendItem"), itemIndex: z.number().int().min(0) }),
  z.object({ type: z.literal("blank"), value: z.boolean().optional() }),
  z.object({ type: z.literal("transpose"), delta: z.number().int().min(-12).max(12) }),
  z.object({ type: z.literal("maxLines"), value: z.number().int().min(1).max(30) }),
  z.object({ type: z.literal("footer"), text: z.string().max(500) }),
]);

export const quickTextSchema = z.object({
  text: z.string().min(1).max(50_000),
  mode: z.enum(["direct", "setlist"]).default("direct"),
});

export const quickSongSchema = z.object({
  songId: z.string().min(1),
  keyOverride: z.string().trim().max(10).optional().nullable(),
  transpose: z.number().int().min(-24).max(24).optional(),
  verseOrder: z.string().trim().max(1000).optional().nullable(),
});

export const quickImageSchema = z.object({
  path: z.string().trim().min(1).max(2000),
  title: z.string().trim().max(300).optional(),
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
  maxWords: z.number().int().min(1).max(500).default(90),
  smartPageSplits: z.boolean().default(true),
  smartWrapMinWords: z.number().int().min(1).max(100).default(15),
  smartWrapModules: z.array(z.enum(SMART_WRAP_MODULES)).max(3).default([...SMART_WRAP_MODULES]),
  lowerThirdImageMaxHeightPercent: z.number().min(5).max(100).default(30),
  lowerThirdImagePadding: z.number().int().min(0).max(200).default(48),
  lowerThirdFontFamily: z.string().trim().min(1).max(200),
  lowerThirdTextScale: z.number().min(0.5).max(2.5),
});

const tarpColorSchema = z.string().trim().regex(/^#[0-9a-f]{6}$/i);

export const tarpBackgroundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("color"), color: tarpColorSchema }),
  z.object({
    type: z.literal("gradient"),
    from: tarpColorSchema,
    to: tarpColorSchema,
    angle: z.number().min(0).max(360).default(180),
  }),
  z.object({ type: z.literal("image"), path: z.string().trim().min(1).max(2000) }),
]);

export const tarpAnimationSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(["fade-in", "fade-out", "slide-in", "move", "scale", "rotate"]),
  delayMs: z.number().int().min(0).max(600_000).default(0),
  durationMs: z.number().int().min(0).max(600_000).default(600),
  easing: z.string().trim().max(80).default("ease"),
});

export const tarpPlacementSchema = z.object({
  x: z.number().min(-1).max(2).default(0),
  y: z.number().min(-1).max(2).default(0),
  width: z.number().min(0.001).max(2).default(1),
  height: z.number().min(0.001).max(2).default(0.2),
  rotation: z.number().min(-360).max(360).default(0),
  opacity: z.number().min(0).max(1).default(1),
  fontSize: z.number().min(0.005).max(0.5).nullable().default(null),
  fontWeight: z.number().int().min(100).max(900).nullable().default(null),
  textAlign: z.enum(["left", "center", "right"]).default("left"),
  fit: z.enum(["contain", "cover"]).default("contain"),
  color: z.string().trim().max(40).nullable().default(null),
  fontFamily: z.string().trim().max(200).nullable().default(null),
  animations: z.array(tarpAnimationSchema).max(100).default([]),
});

export const tarpObjectSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(["text", "markdown", "image"]),
  content: z.string().max(200_000).default(""),
  locked: z.boolean().default(false),
  visible: z.boolean().default(true),
  normal: tarpPlacementSchema,
  lowerthird: tarpPlacementSchema,
});

export const tarpViewSchema = z.object({
  background: tarpBackgroundSchema.nullable().default(null),
  backgroundId: z.string().trim().max(100).nullable().default(null),
  fontFamily: z.string().trim().max(200).nullable().default(null),
  textColor: z.string().trim().max(40).nullable().default(null),
  objects: z.array(tarpObjectSchema).max(200).default([]),
});

export const tarpPageTransitionSchema = z.object({
  type: z.enum(["cut", "fade", "move"]).default("fade"),
  durationMs: z.number().int().min(0).max(10_000).default(500),
  easing: z.string().trim().max(80).default("ease"),
  objectMode: z.enum(["animate", "migrate"]).default("animate"),
});

export const tarpPageInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  themeId: z.string().trim().max(100).nullable().optional(),
  startFromPrevious: z.boolean().optional(),
  transition: tarpPageTransitionSchema.nullable().optional(),
  normal: tarpViewSchema.optional(),
  lowerthird: tarpViewSchema.optional(),
});

export const tarpThemeInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  background: tarpBackgroundSchema,
  fontFamily: z.string().trim().min(1).max(200),
  textColor: tarpColorSchema,
  accentColor: tarpColorSchema,
});

export const tarpPresentationInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  aspect: z.enum(["16:9", "16:10", "flex"]).default("16:9"),
  themeId: z.string().trim().max(100).nullable().optional(),
});

export const tarpReorderSchema = z.object({
  pageIds: z.array(z.string().min(1)).max(500),
});

export type TarpThemeInput = z.infer<typeof tarpThemeInputSchema>;
export type TarpPresentationInput = z.infer<typeof tarpPresentationInputSchema>;
export type TarpPageInput = z.infer<typeof tarpPageInputSchema>;

export const backgroundColorsSchema = z.object({
  background: tarpColorSchema,
  primary: tarpColorSchema,
  secondary: tarpColorSchema,
  accent: tarpColorSchema,
});

export const backgroundInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["image", "css", "svg"]).default("image"),
    preset: z.string().trim().max(80).nullable().optional(),
    imagePath: z.string().trim().max(2000).nullable().optional(),
    useGlobalColors: z.boolean().default(false),
    colors: backgroundColorsSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.kind === "image" && !value.imagePath) {
      context.addIssue({ code: "custom", message: "imagePath is required for image backgrounds" });
    }
    if (value.kind !== "image" && !value.preset) {
      context.addIssue({ code: "custom", message: "preset is required for animated backgrounds" });
    }
  });

export type BackgroundInput = z.infer<typeof backgroundInputSchema>;

export const stingerInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["svg", "image"]).default("svg"),
    preset: z.string().trim().max(80).nullable().optional(),
    imagePath: z.string().trim().max(2000).nullable().optional(),
    durationMs: z.number().int().min(200).max(10_000).default(1200),
  })
  .superRefine((value, context) => {
    if (value.kind === "image" && !value.imagePath) {
      context.addIssue({ code: "custom", message: "imagePath is required for image stingers" });
    }
    if (value.kind === "svg" && !value.preset) {
      context.addIssue({ code: "custom", message: "preset is required for SVG stingers" });
    }
  });

export type StingerInput = z.infer<typeof stingerInputSchema>;

export const fontImportSchema = z
  .object({
    family: z.string().trim().min(1).max(120).optional(),
    url: z.string().trim().url().max(2000).optional(),
  })
  .refine((value) => Boolean(value.family || value.url), {
    message: "family or url is required",
  });

export const appSettingsSchema = z.object({
  pageNavigation: z.enum(["stop", "next-item"]).default("stop"),
  churchsuiteEmptyTypes: z
    .array(z.string().trim().min(1).max(120))
    .max(100)
    .default(DEFAULT_CHURCHSUITE_EMPTY_TYPES),
  defaultBibleTranslation: z.string().trim().max(40).nullable().default(null),
});

export const gitSettingsSchema = z.object({
  autoSave: z.boolean(),
  autoPush: z.boolean(),
  pullIntervalSeconds: z.number().int().min(0).max(86_400),
  mergeMode: z.enum(["ff-only", "merge"]),
});

export const churchsuiteImportSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  serviceTime: z.string().trim().max(10).optional().nullable(),
  songSelections: z.record(z.string(), z.string().min(1).max(100)).optional(),
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
