import type { IntegrationSettings } from "@sm/shared";
import { db } from "./db.js";

const SONG_SELECT_KEY = "adapter_songselect_enabled";
const CHURCH_SUITE_KEY = "adapter_churchsuite_enabled";

const DEFAULTS: IntegrationSettings = {
  songSelectEnabled: true,
  churchSuiteEnabled: true,
};

function readFlag(key: string, fallback: boolean): boolean {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  return !["0", "false", "no", "off"].includes(row.value.toLowerCase());
}

export function getIntegrationSettings(): IntegrationSettings {
  return {
    songSelectEnabled: readFlag(SONG_SELECT_KEY, DEFAULTS.songSelectEnabled),
    churchSuiteEnabled: readFlag(CHURCH_SUITE_KEY, DEFAULTS.churchSuiteEnabled),
  };
}

export function saveIntegrationSettings(settings: IntegrationSettings): IntegrationSettings {
  const now = new Date().toISOString();
  const write = db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const apply = db.transaction(() => {
    write.run(SONG_SELECT_KEY, settings.songSelectEnabled ? "1" : "0", now);
    write.run(CHURCH_SUITE_KEY, settings.churchSuiteEnabled ? "1" : "0", now);
  });
  apply();
  return getIntegrationSettings();
}

export function isSongSelectEnabled(): boolean {
  return getIntegrationSettings().songSelectEnabled;
}

export function isChurchSuiteEnabled(): boolean {
  return getIntegrationSettings().churchSuiteEnabled;
}
