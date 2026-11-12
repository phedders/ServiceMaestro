import fs from "node:fs";
import path from "node:path";
import {
  appSettingsSchema,
  backgroundColorsSchema,
  displayConfigSchema,
  type AppSettings,
  type BackgroundColors,
  type DisplayConfig,
  type FontOption,
  type SharedFontOption,
} from "@sm/shared";
import { db } from "./db.js";
import { GIT_REPOS } from "./config.js";
import { getAppSettings, saveAppSettings } from "./settings.js";
import { getDisplayConfig, saveDisplayConfig } from "./display-config.js";
import { getBackgroundColors, saveBackgroundColors } from "./backgrounds.js";

export const SHARED_SETTINGS_RELATIVE_PATH = path.join("settings", "shared.json");
export const LEGACY_FONT_SETTINGS_RELATIVE_PATH = path.join("settings", "fonts.json");
export const SHARED_SETTINGS_SCHEMA_VERSION = 1;

export interface SharedSettings {
  schemaVersion: number;
  updatedAt: string | null;
  fonts: SharedFontOption[];
  appSettings: AppSettings | null;
  displayConfig: DisplayConfig | null;
  backgroundColors: BackgroundColors | null;
}

interface SharedFontRow {
  id: string;
  label: string;
  family: string;
  source_url: string | null;
  created_at: string;
}

interface SharedSettingsPayload {
  schemaVersion: number;
  fonts: SharedFontOption[];
  appSettings: AppSettings;
  displayConfig: DisplayConfig;
  backgroundColors: BackgroundColors;
}

function sharedPath(repoPath: string, relative: string): string {
  return path.join(repoPath, relative);
}

export function sharedSettingsPath(repoPath = GIT_REPOS.setlists.path): string {
  return sharedPath(repoPath, SHARED_SETTINGS_RELATIVE_PATH);
}

export function legacyFontSettingsPath(repoPath = GIT_REPOS.setlists.path): string {
  return sharedPath(repoPath, LEGACY_FONT_SETTINGS_RELATIVE_PATH);
}

function normaliseFont(value: unknown): SharedFontOption | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const font = value as Record<string, unknown>;
  if (
    typeof font.id !== "string" ||
    !font.id.trim() ||
    typeof font.label !== "string" ||
    !font.label.trim() ||
    typeof font.family !== "string" ||
    !font.family.trim()
  ) {
    return null;
  }
  return {
    id: font.id.trim(),
    label: font.label.trim(),
    family: font.family.trim(),
    cssUrl: typeof font.cssUrl === "string" && font.cssUrl.trim() ? font.cssUrl.trim() : null,
    importedAt:
      typeof font.importedAt === "string" && font.importedAt.trim()
        ? font.importedAt.trim()
        : null,
  };
}

export function sortSharedFonts(fonts: SharedFontOption[]): SharedFontOption[] {
  return [...fonts].sort(
    (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
  );
}

function readFonts(value: unknown): SharedFontOption[] {
  const settings = value as Record<string, unknown>;
  return Array.isArray(settings.fonts)
    ? settings.fonts
        .map(normaliseFont)
        .filter((font): font is SharedFontOption => font !== null)
        .slice(0, 2000)
    : [];
}

export function readSharedSettings(repoPath = GIT_REPOS.setlists.path): SharedSettings {
  const file = sharedSettingsPath(repoPath);
  const legacyFile = legacyFontSettingsPath(repoPath);
  const source = fs.existsSync(file) ? file : fs.existsSync(legacyFile) ? legacyFile : null;
  if (!source) {
    return {
      schemaVersion: SHARED_SETTINGS_SCHEMA_VERSION,
      updatedAt: null,
      fonts: [],
      appSettings: null,
      displayConfig: null,
      backgroundColors: null,
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(source, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        schemaVersion: SHARED_SETTINGS_SCHEMA_VERSION,
        updatedAt: null,
        fonts: [],
        appSettings: null,
        displayConfig: null,
        backgroundColors: null,
      };
    }
    const value = parsed as Record<string, unknown>;
    const appSettings = appSettingsSchema.safeParse(value.appSettings);
    const displayConfig = displayConfigSchema.safeParse(value.displayConfig);
    const backgroundColors = backgroundColorsSchema.safeParse(value.backgroundColors);
    return {
      schemaVersion:
        typeof value.schemaVersion === "number"
          ? value.schemaVersion
          : SHARED_SETTINGS_SCHEMA_VERSION,
      updatedAt:
        typeof value.updatedAt === "string" && value.updatedAt.trim()
          ? value.updatedAt.trim()
          : null,
      fonts: sortSharedFonts(readFonts(value)),
      appSettings: appSettings.success ? appSettings.data : null,
      displayConfig: displayConfig.success ? displayConfig.data : null,
      backgroundColors: backgroundColors.success ? backgroundColors.data : null,
    };
  } catch {
    return {
      schemaVersion: SHARED_SETTINGS_SCHEMA_VERSION,
      updatedAt: null,
      fonts: [],
      appSettings: null,
      displayConfig: null,
      backgroundColors: null,
    };
  }
}

export function applySharedSettings(shared: SharedSettings): void {
  if (shared.appSettings) saveAppSettings(shared.appSettings);
  if (shared.displayConfig) saveDisplayConfig(shared.displayConfig);
  if (shared.backgroundColors) saveBackgroundColors(shared.backgroundColors);
}

export function localDownloadedFonts(): SharedFontOption[] {
  const rows = db
    .prepare("SELECT id, label, family, source_url, created_at FROM fonts ORDER BY label COLLATE NOCASE")
    .all() as SharedFontRow[];
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    family: row.family,
    cssUrl: row.source_url,
    importedAt: row.created_at,
  }));
}

export function mergeSharedFonts(
  existing: SharedFontOption[],
  local: SharedFontOption[],
): SharedFontOption[] {
  const merged = new Map<string, SharedFontOption>();
  for (const font of existing) merged.set(font.id, font);
  for (const font of local) merged.set(font.id, font);
  return sortSharedFonts([...merged.values()]);
}

export function sharedSettingsPayload(
  fonts: SharedFontOption[],
  appSettings = getAppSettings(),
  displayConfig = getDisplayConfig(),
  backgroundColors = getBackgroundColors(),
): SharedSettingsPayload {
  return {
    schemaVersion: SHARED_SETTINGS_SCHEMA_VERSION,
    fonts: sortSharedFonts(fonts),
    appSettings,
    displayConfig,
    backgroundColors,
  };
}

export function sharedSettingsEqual(
  left: SharedSettingsPayload,
  right: SharedSettingsPayload,
): boolean {
  return JSON.stringify({
    ...left,
    fonts: sortSharedFonts(left.fonts),
  }) ===
    JSON.stringify({
      ...right,
      fonts: sortSharedFonts(right.fonts),
    });
}

export function sharedSettingsJson(
  fonts: SharedFontOption[],
  updatedAt = new Date().toISOString(),
): string {
  return JSON.stringify(
    {
      updatedAt,
      ...sharedSettingsPayload(fonts),
    },
    null,
    2,
  );
}

export function missingSharedFonts(
  local: FontOption[],
  shared: SharedFontOption[],
): SharedFontOption[] {
  const ids = new Set(local.map((font) => font.id));
  const families = new Set(local.map((font) => font.family));
  return shared.filter((font) => !ids.has(font.id) && !families.has(font.family));
}
