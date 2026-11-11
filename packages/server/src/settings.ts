import type { AppSettings } from "@wlm/shared";
import { db } from "./db.js";

const DEFAULTS: AppSettings = {
  pageNavigation: "stop",
};

interface Row {
  key: string;
  value: string;
}

export function getAppSettings(): AppSettings {
  const rows = db.prepare("SELECT key, value FROM app_settings").all() as Row[];
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const pageNavigation = values.get("page_navigation");
  return {
    pageNavigation:
      pageNavigation === "next-item" ? "next-item" : DEFAULTS.pageNavigation,
  };
}

export function saveAppSettings(settings: AppSettings): AppSettings {
  const now = new Date().toISOString();
  const write = db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  write.run("page_navigation", settings.pageNavigation, now);
  return getAppSettings();
}
