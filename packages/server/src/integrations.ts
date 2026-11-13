import type { AdapterMode, IntegrationSettings } from "@sm/shared";
import { db } from "./db.js";

const SONG_SELECT_KEY = "adapter_songselect_mode";
const CHURCH_SUITE_KEY = "adapter_churchsuite_mode";
const MQTT_KEY = "adapter_mqtt_mode";
const LEGACY_SONG_SELECT_KEY = "adapter_songselect_enabled";
const LEGACY_CHURCH_SUITE_KEY = "adapter_churchsuite_enabled";
const LEGACY_MQTT_KEY = "adapter_mqtt_enabled";

const DEFAULTS: IntegrationSettings = {
  songSelect: "local",
  churchSuite: "local",
  mqtt: "off",
};

function readValue(key: string): string | undefined {
  return (
    db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined
  )?.value;
}

function asMode(value: string | undefined): AdapterMode | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "off" || normalized === "local" || normalized === "shared") {
    return normalized;
  }
  return null;
}

function readMode(
  key: string,
  legacyKey: string,
  fallback: AdapterMode,
): AdapterMode {
  const current = asMode(readValue(key));
  if (current) return current;
  const legacy = readValue(legacyKey);
  if (legacy !== undefined) {
    const normalized = legacy.trim().toLowerCase();
    return ["0", "false", "no", "off"].includes(normalized) ? "off" : "local";
  }
  return fallback;
}

export function getIntegrationSettings(): IntegrationSettings {
  return {
    songSelect: readMode(SONG_SELECT_KEY, LEGACY_SONG_SELECT_KEY, DEFAULTS.songSelect),
    churchSuite: readMode(
      CHURCH_SUITE_KEY,
      LEGACY_CHURCH_SUITE_KEY,
      DEFAULTS.churchSuite,
    ),
    mqtt: readMode(MQTT_KEY, LEGACY_MQTT_KEY, DEFAULTS.mqtt),
  };
}

export function saveIntegrationSettings(settings: IntegrationSettings): IntegrationSettings {
  const now = new Date().toISOString();
  const write = db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const apply = db.transaction(() => {
    write.run(SONG_SELECT_KEY, settings.songSelect, now);
    write.run(CHURCH_SUITE_KEY, settings.churchSuite, now);
    write.run(MQTT_KEY, settings.mqtt, now);
  });
  apply();
  return getIntegrationSettings();
}

export function isSongSelectEnabled(): boolean {
  return getIntegrationSettings().songSelect !== "off";
}

export function isChurchSuiteEnabled(): boolean {
  return getIntegrationSettings().churchSuite !== "off";
}

export function isMqttEnabled(): boolean {
  return getIntegrationSettings().mqtt !== "off";
}

export function isAdapterShared(adapter: keyof IntegrationSettings): boolean {
  return getIntegrationSettings()[adapter] === "shared";
}
