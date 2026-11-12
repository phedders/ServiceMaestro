import fs from "node:fs";
import path from "node:path";
import type { FontOption, SharedFontOption } from "@sm/shared";
import { db } from "./db.js";
import { GIT_REPOS } from "./config.js";

export const FONT_SETTINGS_RELATIVE_PATH = path.join("settings", "fonts.json");
export const FONT_SETTINGS_SCHEMA_VERSION = 1;

export interface SharedFontSettings {
  schemaVersion: number;
  updatedAt: string | null;
  fonts: SharedFontOption[];
}

interface SharedFontRow {
  id: string;
  label: string;
  family: string;
  source_url: string | null;
  created_at: string;
}

function sharedFontPath(repoPath = GIT_REPOS.setlists.path): string {
  return path.join(repoPath, FONT_SETTINGS_RELATIVE_PATH);
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

export function readSharedFontSettings(repoPath = GIT_REPOS.setlists.path): SharedFontSettings {
  const file = sharedFontPath(repoPath);
  if (!fs.existsSync(file)) {
    return { schemaVersion: FONT_SETTINGS_SCHEMA_VERSION, updatedAt: null, fonts: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { schemaVersion: FONT_SETTINGS_SCHEMA_VERSION, updatedAt: null, fonts: [] };
    }
    const value = parsed as Record<string, unknown>;
    const fonts = Array.isArray(value.fonts)
      ? value.fonts
          .map(normaliseFont)
          .filter((font): font is SharedFontOption => font !== null)
          .slice(0, 2000)
      : [];
    return {
      schemaVersion:
        typeof value.schemaVersion === "number"
          ? value.schemaVersion
          : FONT_SETTINGS_SCHEMA_VERSION,
      updatedAt:
        typeof value.updatedAt === "string" && value.updatedAt.trim()
          ? value.updatedAt.trim()
          : null,
      fonts: sortSharedFonts(fonts),
    };
  } catch {
    return { schemaVersion: FONT_SETTINGS_SCHEMA_VERSION, updatedAt: null, fonts: [] };
  }
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

export function sharedFontsEqual(
  left: SharedFontOption[],
  right: SharedFontOption[],
): boolean {
  return JSON.stringify(sortSharedFonts(left)) === JSON.stringify(sortSharedFonts(right));
}

export function missingSharedFonts(
  local: FontOption[],
  shared: SharedFontOption[],
): SharedFontOption[] {
  const ids = new Set(local.map((font) => font.id));
  const families = new Set(local.map((font) => font.family));
  return shared.filter((font) => !ids.has(font.id) && !families.has(font.family));
}

export function sharedFontSettingsJson(
  fonts: SharedFontOption[],
  updatedAt = new Date().toISOString(),
): string {
  return JSON.stringify(
    {
      schemaVersion: FONT_SETTINGS_SCHEMA_VERSION,
      updatedAt,
      fonts: sortSharedFonts(fonts),
    },
    null,
    2,
  );
}

export function sharedFontSettingsPath(repoPath = GIT_REPOS.setlists.path): string {
  return sharedFontPath(repoPath);
}
