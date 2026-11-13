import { z } from "zod";

export type Role = "admin" | "editor" | "operator" | "musician" | "viewer";

export const MODULE_PERMISSIONS = [
  { id: "songs", label: "Songs", description: "Song library, lyrics, imports and score assets" },
  { id: "setlists", label: "Set lists", description: "Set lists, items, publishing and service plans" },
  { id: "bible", label: "Bible", description: "Reload Bible translations and Bible settings" },
  { id: "images", label: "Images", description: "Upload and delete images" },
  { id: "tarp", label: "Tarp", description: "Tarp themes and presentations" },
  { id: "backgrounds", label: "Backgrounds", description: "Background library and global palette" },
  { id: "stingers", label: "Stingers", description: "Transition stinger library" },
  { id: "live", label: "Live control", description: "Control outputs, live sessions and quick text" },
  { id: "churchsuite", label: "ChurchSuite", description: "Import ChurchSuite plans as set lists" },
  { id: "settings", label: "Settings", description: "Display, fonts, Git and shared team settings" },
] as const;

export type PermissionModule = (typeof MODULE_PERMISSIONS)[number]["id"];
export type ModulePermissions = Record<PermissionModule, boolean>;

export const ALL_MODULE_PERMISSIONS: PermissionModule[] = MODULE_PERMISSIONS.map(
  (module) => module.id,
);

export function emptyModulePermissions(): ModulePermissions {
  return Object.fromEntries(
    ALL_MODULE_PERMISSIONS.map((module) => [module, false]),
  ) as ModulePermissions;
}

export function defaultPermissionsForRole(role: Role): ModulePermissions {
  const permissions = emptyModulePermissions();
  if (role === "admin") {
    for (const module of ALL_MODULE_PERMISSIONS) permissions[module] = true;
    return permissions;
  }
  if (role === "editor") {
    for (const module of ALL_MODULE_PERMISSIONS) {
      if (module !== "settings") permissions[module] = true;
    }
    return permissions;
  }
  if (role === "operator") {
    permissions.setlists = true;
    permissions.images = true;
    permissions.live = true;
    return permissions;
  }
  return permissions;
}

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  permissions: ModulePermissions;
}

export interface UserManagementEntry {
  id: string;
  username: string;
  role: Role;
  permissions: ModulePermissions;
  passkeyCount: number;
  createdAt: string;
}

export interface PasskeySummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export type SongResourceKind = "songpro" | "chord" | "lead" | "vocal" | "lyrics";
export type SiteCredentialSource = "user" | "server";

export interface SiteScraperProviderSummary {
  id: string;
  label: string;
  description: string;
  baseUrl: string;
  artifactKinds: SongResourceKind[];
  userConfigured: boolean;
  userUsername: string | null;
  userUpdatedAt: string | null;
  serverConfigured: boolean;
  activeSource: SiteCredentialSource | null;
}

export interface SiteCredentialInput {
  username?: string;
  password?: string;
  cookie?: string;
}

export interface SiteScraperSearchResult {
  provider: string;
  songNumber: string;
  slug: string;
  title: string;
  authors: string[];
  availableKinds: SongResourceKind[];
}

export interface SiteScraperImportResult {
  song: {
    id: string;
    title: string;
    ccli: string | null;
  };
  created: boolean;
  files: Array<{
    kind: SongResourceKind;
    filename: string;
    bytes: number;
  }>;
  assets: number;
}

export interface SiteScraperSongUpdateCheck {
  provider: string;
  song: SiteScraperSearchResult;
  missingKinds: SongResourceKind[];
  changedKinds: SongResourceKind[];
  hasUpdates: boolean;
}

export interface ChordProFilePreview {
  filename: string;
  title: string;
  alternateTitles: string | null;
  author: string | null;
  copyright: string | null;
  ccli: string | null;
  key: string | null;
  lyrics: string;
  warnings: string[];
}

export interface ActivityEntry {
  id: string;
  userId: string | null;
  username: string;
  action: string;
  module: string | null;
  method: string | null;
  path: string | null;
  status: number | null;
  detail: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface BrandingSettings {
  logoUrl: string | null;
  navBackground: string | null;
  logoUpdatedAt: string | null;
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
  priority: number;
  differentFromIds: string[];
  sourceFormat: string | null;
  sourcePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SongDuplicateCandidate {
  id: string;
  title: string;
  alternateTitles: string | null;
  author: string | null;
  copyright: string | null;
  ccli: string | null;
  key: string | null;
  lyrics: string;
  lyricsMarkdown: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface SongDuplicateGroup {
  id: string;
  reasons: string[];
  songs: SongDuplicateCandidate[];
}

const SECTION_LABEL_TOKEN =
  /^(?:verse|chorus|pre[-\s]?chorus|bridge|intro|outro|ending|tag|turnaround|interlude|instrumental|refrain)(?:\s*\d+[a-z]?)?$/i;

export function isSongChordToken(value: string): boolean {
  const token = value.trim();
  if (!token || SECTION_LABEL_TOKEN.test(token)) return false;
  if (token === "N.C." || token === "NC") return true;
  return /^[A-G](?:#|b)?[A-Za-z0-9+#°øsusmajmin()/.-]*$/.test(token);
}

export function songHasChords(lyrics: string): boolean {
  return [...lyrics.matchAll(/\[([^\]]+)\]/g)].some((match) =>
    isSongChordToken(match[1]),
  );
}

/**
 * Song lyrics with chord symbols and section labels removed, preserving line
 * breaks for a line-level comparison.
 */
export function songLyricsWithoutChords(lyrics: string): string {
  return lyrics
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/\[([^\]]+)\]/g, (full, token: string) =>
          isSongChordToken(token) ? "" : full,
        )
        .replace(/\[[^\]]*\]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
}

/**
 * Normalized song text with chord symbols and section labels removed.
 * Used to estimate whether two versions differ only by their chords.
 */
export function songKeyWithoutChords(lyrics: string): string {
  return songLyricsWithoutChords(lyrics)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

interface SongWord {
  word: string;
  line: number;
}

function songWordsWithoutChords(lyrics: string): SongWord[] {
  const words: SongWord[] = [];
  const lines = songLyricsWithoutChords(lyrics).split("\n");
  for (const [line, value] of lines.entries()) {
    const normalized = value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+-\s+/g, "")
      .replace(/['’]/g, "")
      .toLowerCase();
    for (const match of normalized.matchAll(/[a-z0-9]+/g)) {
      words.push({ word: match[0], line });
    }
  }
  return words;
}

/**
 * Estimate how many lyric lines differ once chord symbols, section labels,
 * word splits ("can - not") and line breaks are ignored.
 */
export function songLinesDifferingApartFromSplits(
  reference: string,
  candidate: string,
): number {
  const a = songWordsWithoutChords(reference);
  const b = songWordsWithoutChords(candidate);
  if (!a.length && !b.length) return 0;
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i].word === b[j].word
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const hunks: Array<{ reference: Set<number>; candidate: Set<number> }> = [];
  let current = { reference: new Set<number>(), candidate: new Set<number>() };
  const flush = () => {
    if (current.reference.size || current.candidate.size) hunks.push(current);
    current = { reference: new Set<number>(), candidate: new Set<number>() };
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].word === b[j].word) {
      flush();
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      current.reference.add(a[i].line);
      i += 1;
    } else {
      current.candidate.add(b[j].line);
      j += 1;
    }
  }
  while (i < a.length) {
    current.reference.add(a[i].line);
    i += 1;
  }
  while (j < b.length) {
    current.candidate.add(b[j].line);
    j += 1;
  }
  flush();

  return hunks.reduce(
    (total, hunk) => total + Math.max(hunk.reference.size, hunk.candidate.size),
    0,
  );
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
  kind?: "display" | "app";
}

export const DISPLAY_OUTPUT_TEMPLATES = [
  "main",
  "two_thirds",
  "full",
  "stage",
  "chords",
] as const;
export type DisplayOutputTemplate = (typeof DISPLAY_OUTPUT_TEMPLATES)[number];
export type DisplayOutputFade = "none" | "text" | "template";
export type DisplayOutputScope = "shared" | "local";

export interface DisplayOutput {
  id: string;
  label: string;
  description: string;
  template: DisplayOutputTemplate;
  enabled: boolean;
  aliases: string[];
  fade: DisplayOutputFade;
  fadeDurationMs: number;
  background: string;
  backgroundAlpha: number;
  layout: {
    align: "left" | "center";
    verticalAlign: "start" | "center" | "end";
    textAlign: "left" | "center" | "right";
    paddingX: number;
    paddingTop: number;
    paddingBottom: number;
    maxWidthPercent: number;
    maxHeightPercent: number;
  };
  panel: {
    enabled: boolean;
    color: string;
    alpha: number;
    paddingX: number;
    paddingY: number;
    radius: number;
    border: boolean;
    maxWidthPercent: number;
    maxHeightPercent: number;
  };
  text: {
    fontFamily: string | null;
    textColor: string | null;
    scale: number;
    lineHeight: number;
  };
  content: {
    pages: "current" | "upcoming";
    showMeta: boolean;
    showFooter: boolean;
    showChords: boolean;
    showSectionLabels: boolean;
    showSplitWords: boolean;
  };
  image: {
    maxHeightPercent: number | null;
    padding: number | null;
  };
}

export interface DisplayOutputEntry extends DisplayOutput {
  scope: DisplayOutputScope;
}

export const DEFAULT_DISPLAY_OUTPUTS: DisplayOutput[] = [
  {
    id: "lowerthird",
    label: "Lower third",
    description: "Transparent lower-third panel for lyrics, text and lower-third images.",
    template: "main",
    enabled: true,
    aliases: ["main", "lower", "lowerthird", "twothirds"],
    fade: "text",
    fadeDurationMs: 240,
    background: "#000000",
    backgroundAlpha: 0,
    layout: {
      align: "center",
      verticalAlign: "end",
      textAlign: "center",
      paddingX: 6,
      paddingTop: 0,
      paddingBottom: 6,
      maxWidthPercent: 100,
      maxHeightPercent: 100,
    },
    panel: {
      enabled: true,
      color: "#060a10",
      alpha: 0.8,
      paddingX: 28,
      paddingY: 20,
      radius: 18,
      border: true,
      maxWidthPercent: 100,
      maxHeightPercent: 100,
    },
    text: { fontFamily: null, textColor: null, scale: 1, lineHeight: 0.8 },
    content: {
      pages: "current",
      showMeta: false,
      showFooter: true,
      showChords: false,
      showSectionLabels: false,
      showSplitWords: false,
    },
    image: { maxHeightPercent: null, padding: null },
  },
  {
    id: "two-thirds",
    label: "Centered two-thirds",
    description: "Centered full-width lyrics without a lower-third panel.",
    template: "two_thirds",
    enabled: true,
    aliases: ["two-thirds", "two_thirds"],
    fade: "template",
    fadeDurationMs: 240,
    background: "#000000",
    backgroundAlpha: 1,
    layout: {
      align: "center",
      verticalAlign: "center",
      textAlign: "center",
      paddingX: 8,
      paddingTop: 5,
      paddingBottom: 5,
      maxWidthPercent: 100,
      maxHeightPercent: 100,
    },
    panel: {
      enabled: false,
      color: "#060a10",
      alpha: 0.8,
      paddingX: 28,
      paddingY: 20,
      radius: 18,
      border: true,
      maxWidthPercent: 100,
      maxHeightPercent: 100,
    },
    text: { fontFamily: null, textColor: null, scale: 1, lineHeight: 1.2 },
    content: {
      pages: "current",
      showMeta: false,
      showFooter: true,
      showChords: false,
      showSectionLabels: false,
      showSplitWords: false,
    },
    image: { maxHeightPercent: 78, padding: 0 },
  },
  {
    id: "full",
    label: "Full screen",
    description: "Whole-screen lyrics for a dedicated projection or OBS source.",
    template: "full",
    enabled: true,
    aliases: ["full", "fullscreen", "mainfull"],
    fade: "template",
    fadeDurationMs: 240,
    background: "#000000",
    backgroundAlpha: 1,
    layout: {
      align: "center",
      verticalAlign: "center",
      textAlign: "center",
      paddingX: 2,
      paddingTop: 2,
      paddingBottom: 2,
      maxWidthPercent: 100,
      maxHeightPercent: 100,
    },
    panel: {
      enabled: false,
      color: "#060a10",
      alpha: 0.8,
      paddingX: 28,
      paddingY: 20,
      radius: 18,
      border: true,
      maxWidthPercent: 100,
      maxHeightPercent: 100,
    },
    text: { fontFamily: null, textColor: null, scale: 1, lineHeight: 0.92 },
    content: {
      pages: "current",
      showMeta: false,
      showFooter: true,
      showChords: false,
      showSectionLabels: false,
      showSplitWords: false,
    },
    image: { maxHeightPercent: 78, padding: 0 },
  },
  {
    id: "stage",
    label: "Stage",
    description: "Left-aligned stage monitor with current and upcoming pages.",
    template: "stage",
    enabled: true,
    aliases: ["stage"],
    fade: "template",
    fadeDurationMs: 240,
    background: "#000000",
    backgroundAlpha: 1,
    layout: {
      align: "left",
      verticalAlign: "start",
      textAlign: "left",
      paddingX: 5,
      paddingTop: 8,
      paddingBottom: 4,
      maxWidthPercent: 100,
      maxHeightPercent: 100,
    },
    panel: {
      enabled: false,
      color: "#060a10",
      alpha: 0.8,
      paddingX: 28,
      paddingY: 20,
      radius: 18,
      border: true,
      maxWidthPercent: 100,
      maxHeightPercent: 100,
    },
    text: { fontFamily: null, textColor: null, scale: 1, lineHeight: 0.9 },
    content: {
      pages: "upcoming",
      showMeta: true,
      showFooter: true,
      showChords: false,
      showSectionLabels: true,
      showSplitWords: false,
    },
    image: { maxHeightPercent: 78, padding: 0 },
  },
  {
    id: "chords",
    label: "Chords",
    description: "Chords and current/upcoming pages for musicians.",
    template: "chords",
    enabled: true,
    aliases: ["chords"],
    fade: "template",
    fadeDurationMs: 240,
    background: "#000000",
    backgroundAlpha: 1,
    layout: {
      align: "center",
      verticalAlign: "start",
      textAlign: "center",
      paddingX: 8,
      paddingTop: 6,
      paddingBottom: 4,
      maxWidthPercent: 100,
      maxHeightPercent: 100,
    },
    panel: {
      enabled: false,
      color: "#060a10",
      alpha: 0.8,
      paddingX: 28,
      paddingY: 20,
      radius: 18,
      border: true,
      maxWidthPercent: 100,
      maxHeightPercent: 100,
    },
    text: { fontFamily: null, textColor: null, scale: 1, lineHeight: 0.9 },
    content: {
      pages: "upcoming",
      showMeta: true,
      showFooter: true,
      showChords: true,
      showSectionLabels: true,
      showSplitWords: true,
    },
    image: { maxHeightPercent: 78, padding: 0 },
  },
];

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
  source: "built-in" | "google" | "local";
  cssUrl: string | null;
  importedAt: string | null;
}

export interface SharedFontOption {
  id: string;
  label: string;
  family: string;
  cssUrl: string | null;
  importedAt: string | null;
}

export interface FontLibraryStatus {
  fonts: FontOption[];
  sharedFonts: SharedFontOption[];
  missingFonts: SharedFontOption[];
}

export interface FontDownloadFailure {
  id: string;
  label: string;
  error: string;
}

export interface FontDownloadReport {
  ok: boolean;
  downloaded: FontOption[];
  failed: FontDownloadFailure[];
}

export interface ControlTlsReport {
  enabled: boolean;
  status: ControlTlsStatus | null;
}

export interface ControlTlsStatus {
  source: "generated" | "provided";
  selfSigned: boolean;
  hasLocalCa: boolean;
  sslDir: string;
  certFile: string;
  keyFile: string;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  warnings: string[];
}

export const DEFAULT_CHURCHSUITE_EMPTY_TYPES = [
  "Welcome",
  "Misc",
  "Countdown",
  "Prayers",
  "Announcement",
];

export const SONG_SHEET_FONTS = [
  { id: "Helvetica", label: "Helvetica (sans-serif)" },
  { id: "TimesRoman", label: "Times Roman (serif)" },
  { id: "Courier", label: "Courier (monospace)" },
] as const;

export type SongSheetFont = (typeof SONG_SHEET_FONTS)[number]["id"];

export interface AppSettings {
  pageNavigation: "stop" | "next-item";
  churchsuiteEmptyTypes: string[];
  defaultBibleTranslation: string | null;
  pageIdShortcuts: Record<string, string>;
  songSheetFontFamily: SongSheetFont;
  songSheetFontSize: number;
  songSheetColumns: number;
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
  priority: number;
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

export interface LiveAutoplaySettings {
  autoplay: boolean;
  mode: PlaybackMode;
  delaySeconds: number;
}

export interface LiveAutoplayState extends LiveAutoplaySettings {
  itemIndex: number;
  itemKind: "image_list" | "tarp";
  overridden: boolean;
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
  outputs?: Record<string, DisplayOutput>;
  displayConfig?: DisplayConfig;
  queuedItemIndex?: number | null;
  queuedTitle?: string | null;
  queuedPages?: LivePage[];
  appendedItems?: number[];
  autoplay?: LiveAutoplayState | null;
  autoplayOverrides?: Record<string, LiveAutoplaySettings>;
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

export interface SongPageIdChange {
  from: string;
  to: string;
}

export interface SimplifiedSongPageIds {
  lyrics: string;
  verseOrder: string | null;
  changes: SongPageIdChange[];
}

export interface SongPageIdFixPreview {
  songId: string;
  title: string;
  changes: SongPageIdChange[];
  lyricsChanged: boolean;
  verseOrderChanged: boolean;
}

export interface SongPageIdFixScan {
  songs: SongPageIdFixPreview[];
  totalSongs: number;
  totalLabels: number;
}

function sectionPageId(value: string): { canonical: string; id: string } | null {
  const cleaned = value
    .trim()
    .replace(/[:\-–—]+$/g, "")
    .replace(/\s+/g, " ");
  if (!cleaned) return null;

  // Compact page IDs are lowercase. Keeping this check case-sensitive means
  // [C], [B] and [E] continue to be treated as chords rather than sections.
  const compactSingle: Record<string, string> = {
    v: "verse",
    c: "chorus",
    b: "bridge",
    i: "intro",
    o: "outro",
    e: "ending",
    t: "tag",
    r: "refrain",
    p: "prechorus",
  };
  if (compactSingle[cleaned]) return { canonical: compactSingle[cleaned], id: cleaned };

  const patterns: Array<[RegExp, string, string]> = [
    [/^verse(?:\s*(\d+[a-z]?))?$/i, "v", "verse"],
    [/^v(\d+[a-z]?)$/i, "v", "verse"],
    [/^chorus(?:\s*(\d+[a-z]?))?$/i, "c", "chorus"],
    [/^c(\d+[a-z]?)$/i, "c", "chorus"],
    [/^(?:pre[-\s]?chorus|pc)(?:\s*(\d+[a-z]?))?$/i, "pc", "prechorus"],
    [/^bridge(?:\s*(\d+[a-z]?))?$/i, "b", "bridge"],
    [/^b(\d+[a-z]?)$/i, "b", "bridge"],
    [/^intro(?:\s*(\d+[a-z]?))?$/i, "i", "intro"],
    [/^outro(?:\s*(\d+[a-z]?))?$/i, "o", "outro"],
    [/^ending(?:\s*(\d+[a-z]?))?$/i, "e", "ending"],
    [/^tag(?:\s*(\d+[a-z]?))?$/i, "t", "tag"],
    [/^(?:turnaround|turn|tr)(?:\s*(\d+[a-z]?))?$/i, "tr", "turnaround"],
    [/^(?:interlude|il)(?:\s*(\d+[a-z]?))?$/i, "il", "interlude"],
    [/^(?:instrumental|ins|inst|instr|int)(?:\s*(\d+[a-z]?))?$/i, "ins", "instrumental"],
    [/^refrain(?:\s*(\d+[a-z]?))?$/i, "r", "refrain"],
  ];
  for (const [pattern, prefix, canonicalPrefix] of patterns) {
    const match = cleaned.match(pattern);
    if (match) {
      const suffix = (match[1] ?? "").toLowerCase();
      return {
        canonical: `${canonicalPrefix}${suffix}`,
        id: `${prefix}${suffix}`,
      };
    }
  }

  // Labels without spaces are already compact page ids; leave them alone so
  // lines such as [C] / [G] remain chord markers rather than section labels.
  if (!cleaned.includes(" ")) return null;
  const words = cleaned.toLowerCase().split(/\s+/).filter(Boolean);
  const id =
    words.length > 1
      ? words.map((word) => word[0]).join("")
      : cleaned.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 4);
  return id ? { canonical: `custom:${id}`, id } : null;
}

function pageIdToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cleanPageId(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9_-]+/g, "");
}

export function suggestSongPageId(value: string): string | null {
  return sectionPageId(value)?.id ?? null;
}

export function songPageNameCandidates(lyrics: string): string[] {
  const seen = new Map<string, string>();
  for (const match of lyrics.matchAll(/\[([^\]]+)\]/g)) {
    const name = match[1].trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key) || !sectionPageId(name)) continue;
    seen.set(key, name);
  }
  return [...seen.values()];
}

/**
 * Lists recognised page labels in source order, using compact page IDs.
 * Repeats are preserved so a generated verse order can mirror the song's page
 * sequence.
 */
export function songPageOrder(lyrics: string): string {
  const tokens: string[] = [];
  for (const line of lyrics.replace(/\r\n?/g, "\n").split("\n")) {
    const match = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (!match) continue;
    const page = sectionPageId(match[1]);
    if (page) tokens.push(page.id);
  }
  return tokens.join(" ");
}

export function simplifySongPageIds(
  lyrics: string,
  verseOrder?: string | null,
  shortcuts: Record<string, string> = {},
): SimplifiedSongPageIds {
  const shortcutMap = new Map(
    Object.entries(shortcuts).map(([name, id]) => [name.trim().toLowerCase(), id]),
  );
  const labels = [...lyrics.matchAll(/\[([^\]]+)\]/g)].map((match) => match[1]);
  const originalToId = new Map<string, string>();
  const canonicalToId = new Map<string, string>();
  const tokenToId = new Map<string, string>();
  const changes: SongPageIdChange[] = [];
  const used = new Set<string>();

  for (const label of labels) {
    const originalKey = label.trim().toLowerCase();
    if (!originalKey || originalToId.has(originalKey)) continue;
    const info = sectionPageId(label);
    const explicit = shortcutMap.get(originalKey);
    if (!info && !explicit) continue;
    const base = cleanPageId(explicit ?? info?.id ?? "section") || info?.id || "section";
    const canonicalKey = explicit ? `explicit:${originalKey}` : info!.canonical;
    let id = canonicalToId.get(canonicalKey);
    if (!id) {
      let candidate = base;
      let suffix = 2;
      while (used.has(candidate.toLowerCase())) {
        candidate = `${base}_${suffix}`;
        suffix += 1;
      }
      id = candidate;
      used.add(candidate.toLowerCase());
      canonicalToId.set(canonicalKey, id);
    }
    originalToId.set(originalKey, id);
    if (label.trim() !== id) changes.push({ from: label.trim(), to: id });
    tokenToId.set(pageIdToken(label), id);
    if (info) tokenToId.set(pageIdToken(info.id), id);
    tokenToId.set(pageIdToken(id), id);
  }

  const simplifiedLyrics = lyrics.replace(/\[([^\]]+)\]/g, (whole, label: string) => {
    const id = originalToId.get(label.trim().toLowerCase());
    return id ? `[${id}]` : whole;
  });

  const simplifiedOrder =
    verseOrder == null
      ? null
      : verseOrder
          .split(/(\s+)/)
          .map((part) => (part.trim() ? tokenToId.get(pageIdToken(part)) ?? part : part))
          .join("")
          .trim() || null;

  return { lyrics: simplifiedLyrics, verseOrder: simplifiedOrder, changes };
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

export const ROLES = ["admin", "editor", "operator", "musician", "viewer"] as const;

export const loginSchema = z.object({
  username: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

export const userCreateSchema = z.object({
  username: z.string().trim().min(2).max(80),
  password: z.string().min(8).max(200),
  role: z.enum(ROLES),
  permissions: z.record(z.boolean()).optional(),
});

export const userUpdateSchema = z.object({
  username: z.string().trim().min(2).max(80).optional(),
  role: z.enum(ROLES).optional(),
  permissions: z.record(z.boolean()).optional(),
});

export const userPasswordResetSchema = z.object({
  password: z.string().min(8).max(200),
});

export const passkeyLoginOptionsSchema = z.object({
  username: z.string().trim().min(1).max(80),
});

export const passkeyLoginVerifySchema = z.object({
  username: z.string().trim().min(1).max(80),
  response: z.unknown(),
});

export const passkeyRegistrationVerifySchema = z.object({
  response: z.unknown(),
  name: z.string().trim().max(80).optional(),
});

export const siteCredentialInputSchema = z.object({
  username: z.string().trim().max(200).optional(),
  password: z.string().max(500).optional(),
  cookie: z.string().max(8000).optional(),
});

export const siteScraperDownloadSchema = z.object({
  songNumber: z.string().trim().min(1).max(50),
  slug: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(300),
  authors: z.array(z.string().max(200)).max(30).optional(),
  availableKinds: z
    .array(z.enum(["songpro", "chord", "lead", "vocal", "lyrics"]))
    .optional(),
  kinds: z.array(z.enum(["songpro", "chord", "lead", "vocal", "lyrics"])).optional(),
});

export const chordProPreviewSchema = z.object({
  filename: z.string().trim().min(1).max(300),
  content: z.string().min(1).max(500_000),
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

export const songBulkDeleteSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(100)).min(1).max(1000),
});

export const songPrioritySchema = z.object({
  priority: z.number().int().min(0).max(10),
});

export const songDifferentSchema = z.object({
  songIds: z.array(z.string().trim().min(1).max(100)).length(2),
});

export const songPageIdFixApplySchema = z.object({
  songIds: z.array(z.string().trim().min(1).max(100)).max(1000).optional(),
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
  z.object({
    type: z.literal("autoplay"),
    autoplay: z.boolean().optional(),
    mode: z.enum(["single", "loop", "bounce"]).optional(),
    delaySeconds: z.number().int().min(1).max(300).optional(),
    reset: z.boolean().optional(),
  }),
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

const displayOutputHexColor = z.string().trim().regex(/^#[0-9a-f]{6}$/i);
const displayOutputTextSchema = z.object({
  fontFamily: z.string().trim().max(200).nullable().default(null),
  textColor: displayOutputHexColor.nullable().default(null),
  scale: z.number().min(0.5).max(2.5).default(1),
  lineHeight: z.number().min(0.5).max(2).default(1.1),
});
const displayOutputLayoutSchema = z.object({
  align: z.enum(["left", "center"]).default("center"),
  verticalAlign: z.enum(["start", "center", "end"]).default("center"),
  textAlign: z.enum(["left", "center", "right"]).default("center"),
  paddingX: z.number().min(0).max(20).default(6),
  paddingTop: z.number().min(0).max(20).default(4),
  paddingBottom: z.number().min(0).max(20).default(4),
  maxWidthPercent: z.number().min(10).max(100).default(100),
  maxHeightPercent: z.number().min(10).max(100).default(100),
});
const displayOutputPanelSchema = z.object({
  enabled: z.boolean().default(false),
  color: displayOutputHexColor.default("#060a10"),
  alpha: z.number().min(0).max(1).default(0.8),
  paddingX: z.number().int().min(0).max(200).default(28),
  paddingY: z.number().int().min(0).max(200).default(20),
  radius: z.number().int().min(0).max(100).default(18),
  border: z.boolean().default(true),
  maxWidthPercent: z.number().min(10).max(100).default(100),
  maxHeightPercent: z.number().min(10).max(100).default(100),
});
const displayOutputContentSchema = z.object({
  pages: z.enum(["current", "upcoming"]).default("current"),
  showMeta: z.boolean().default(false),
  showFooter: z.boolean().default(true),
  showChords: z.boolean().default(false),
  showSectionLabels: z.boolean().default(false),
  showSplitWords: z.boolean().default(false),
});
const displayOutputImageSchema = z.object({
  maxHeightPercent: z.number().min(5).max(100).nullable().default(null),
  padding: z.number().int().min(0).max(200).nullable().default(null),
});

export const displayOutputSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(""),
  template: z.enum(DISPLAY_OUTPUT_TEMPLATES),
  enabled: z.boolean().default(true),
  aliases: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  fade: z.enum(["none", "text", "template"]).default("template"),
  fadeDurationMs: z.number().int().min(0).max(2000).default(240),
  background: displayOutputHexColor.default("#000000"),
  backgroundAlpha: z.number().min(0).max(1).default(1),
  layout: displayOutputLayoutSchema.default({}),
  panel: displayOutputPanelSchema.default({}),
  text: displayOutputTextSchema.default({}),
  content: displayOutputContentSchema.default({}),
  image: displayOutputImageSchema.default({}),
});

export const displayOutputInputSchema = displayOutputSchema;

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
  pageIdShortcuts: z.record(z.string().trim().min(1).max(120), z.string().trim().min(1).max(40)).default({}),
  songSheetFontFamily: z
    .enum(SONG_SHEET_FONTS.map((font) => font.id) as [SongSheetFont, ...SongSheetFont[]])
    .default("Helvetica"),
  songSheetFontSize: z.number().int().min(8).max(28).default(15),
  songSheetColumns: z.number().int().min(1).max(3).default(1),
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

export const activityRetentionSchema = z.object({
  retentionDays: z.number().int().min(0).max(3650),
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
