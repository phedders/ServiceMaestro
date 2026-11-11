import type { DisplayConfig } from "@wlm/shared";
import { db } from "./db.js";

interface Row {
  font_family: string;
  text_color: string;
  text_scale: number;
  max_lines: number;
  max_words: number;
  smart_page_splits: number;
}

export function getDisplayConfig(): DisplayConfig {
  const row = db
    .prepare(
      "SELECT font_family, text_color, text_scale, max_lines, max_words, smart_page_splits FROM display_config WHERE id = 'default'",
    )
    .get() as Row | undefined;
  return {
    fontFamily: row?.font_family ?? '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
    textColor: row?.text_color ?? "#ffffff",
    textScale: row?.text_scale ?? 1,
    maxLines: row?.max_lines ?? 4,
    maxWords: row?.max_words ?? 90,
    smartPageSplits: row ? Boolean(row.smart_page_splits) : true,
  };
}

export function saveDisplayConfig(config: DisplayConfig): DisplayConfig {
  db.prepare(
    `INSERT INTO display_config (id, font_family, text_color, text_scale, max_lines, max_words, smart_page_splits, updated_at)
     VALUES ('default', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET font_family = excluded.font_family, text_color = excluded.text_color,
       text_scale = excluded.text_scale, max_lines = excluded.max_lines,
       max_words = excluded.max_words, smart_page_splits = excluded.smart_page_splits,
       updated_at = excluded.updated_at`,
  ).run(
    config.fontFamily,
    config.textColor,
    config.textScale,
    config.maxLines,
    config.maxWords,
    config.smartPageSplits ? 1 : 0,
    new Date().toISOString(),
  );
  return getDisplayConfig();
}
