import {
  DEFAULT_CHURCHSUITE_EMPTY_TYPES,
  SONG_SHEET_FONTS,
  type AppSettings,
  type GitSettings,
  type SongSheetFont,
} from "@sm/shared";
import { db } from "./db.js";
import { GIT_AUTO_PUSH, GIT_AUTO_SAVE, GIT_PULL_INTERVAL } from "./config.js";

const DEFAULTS: AppSettings = {
  pageNavigation: "stop",
  churchsuiteEmptyTypes: [...DEFAULT_CHURCHSUITE_EMPTY_TYPES],
  defaultBibleTranslation: null,
  pageIdShortcuts: {},
  songSheetFontFamily: "Helvetica",
  songSheetFontSize: 15,
  songSheetColumns: 1,
};

const GIT_DEFAULTS: GitSettings = {
  autoSave: GIT_AUTO_SAVE,
  autoPush: GIT_AUTO_PUSH,
  pullIntervalSeconds: GIT_PULL_INTERVAL,
  mergeMode: "ff-only",
};

interface Row {
  key: string;
  value: string;
}

export function getAppSettings(): AppSettings {
  const rows = db.prepare("SELECT key, value FROM app_settings").all() as Row[];
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const pageNavigation = values.get("page_navigation");
  let churchsuiteEmptyTypes = DEFAULTS.churchsuiteEmptyTypes;
  const rawEmptyTypes = values.get("churchsuite_empty_types");
  if (rawEmptyTypes) {
    try {
      const parsed = JSON.parse(rawEmptyTypes) as unknown;
      if (Array.isArray(parsed)) {
        churchsuiteEmptyTypes = parsed
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean)
          .slice(0, 100);
      }
    } catch {
      // Fall back to the seeded list when the stored value is corrupt.
    }
  }
  const defaultBibleTranslation = values.get("default_bible_translation")?.trim() || null;
  let pageIdShortcuts: Record<string, string> = {};
  const rawPageIdShortcuts = values.get("page_id_shortcuts");
  if (rawPageIdShortcuts) {
    try {
      const parsed = JSON.parse(rawPageIdShortcuts) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        pageIdShortcuts = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>)
            .filter(
              ([name, short]) =>
                typeof name === "string" &&
                typeof short === "string" &&
                name.trim() &&
                short.trim(),
            )
            .map(([name, short]) => [name.trim(), String(short).trim()]),
        );
      }
    } catch {
      // Ignore malformed configuration.
    }
  }
  const rawSongSheetFont = values.get("song_sheet_font_family");
  const songSheetFontFamily: SongSheetFont = SONG_SHEET_FONTS.some(
    (font) => font.id === rawSongSheetFont,
  )
    ? (rawSongSheetFont as SongSheetFont)
    : DEFAULTS.songSheetFontFamily;
  const rawSongSheetFontSize = Number(values.get("song_sheet_font_size"));
  const songSheetFontSize =
    Number.isFinite(rawSongSheetFontSize) && rawSongSheetFontSize >= 8 && rawSongSheetFontSize <= 28
      ? Math.round(rawSongSheetFontSize)
      : DEFAULTS.songSheetFontSize;
  const rawSongSheetColumns = Number(values.get("song_sheet_columns"));
  const songSheetColumns =
    Number.isFinite(rawSongSheetColumns) && rawSongSheetColumns >= 1 && rawSongSheetColumns <= 3
      ? Math.round(rawSongSheetColumns)
      : DEFAULTS.songSheetColumns;
  return {
    pageNavigation:
      pageNavigation === "next-item" ? "next-item" : DEFAULTS.pageNavigation,
    churchsuiteEmptyTypes,
    defaultBibleTranslation,
    pageIdShortcuts,
    songSheetFontFamily,
    songSheetFontSize,
    songSheetColumns,
  };
}

export function saveAppSettings(settings: AppSettings): AppSettings {
  const now = new Date().toISOString();
  const write = db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  write.run("page_navigation", settings.pageNavigation, now);
  write.run("churchsuite_empty_types", JSON.stringify(settings.churchsuiteEmptyTypes), now);
  write.run("default_bible_translation", settings.defaultBibleTranslation ?? "", now);
  write.run("page_id_shortcuts", JSON.stringify(settings.pageIdShortcuts), now);
  write.run("song_sheet_font_family", settings.songSheetFontFamily, now);
  write.run("song_sheet_font_size", String(settings.songSheetFontSize), now);
  write.run("song_sheet_columns", String(settings.songSheetColumns), now);
  return getAppSettings();
}

function boolValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

export function getGitSettings(): GitSettings {
  const rows = db.prepare("SELECT key, value FROM app_settings").all() as Row[];
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const interval = Number(values.get("git_pull_interval_seconds"));
  return {
    autoSave: boolValue(values.get("git_auto_save"), GIT_DEFAULTS.autoSave),
    autoPush: boolValue(values.get("git_auto_push"), GIT_DEFAULTS.autoPush),
    pullIntervalSeconds:
      Number.isFinite(interval) && interval >= 0
        ? Math.min(86_400, Math.floor(interval))
        : GIT_DEFAULTS.pullIntervalSeconds,
    mergeMode: values.get("git_merge_mode") === "merge" ? "merge" : "ff-only",
  };
}

export function saveGitSettings(settings: GitSettings): GitSettings {
  const now = new Date().toISOString();
  const write = db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const apply = db.transaction(() => {
    write.run("git_auto_save", settings.autoSave ? "1" : "0", now);
    write.run("git_auto_push", settings.autoPush ? "1" : "0", now);
    write.run("git_pull_interval_seconds", String(settings.pullIntervalSeconds), now);
    write.run("git_merge_mode", settings.mergeMode, now);
  });
  apply();
  return getGitSettings();
}
