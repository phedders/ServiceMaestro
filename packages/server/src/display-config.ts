import type { DisplayConfig } from "@sm/shared";
import { db } from "./db.js";

interface Row {
  font_family: string;
  text_color: string;
  text_scale: number;
  max_lines: number;
  max_words: number;
  smart_page_splits: number;
  lower_third_image_max_height_percent: number;
  lower_third_image_padding: number;
}

export function getDisplayConfig(): DisplayConfig {
  const row = db
    .prepare(
      `SELECT font_family, text_color, text_scale, max_lines, max_words, smart_page_splits,
              lower_third_image_max_height_percent, lower_third_image_padding
       FROM display_config WHERE id = 'default'`,
    )
    .get() as Row | undefined;
  return {
    fontFamily: row?.font_family ?? '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
    textColor: row?.text_color ?? "#ffffff",
    textScale: row?.text_scale ?? 1,
    maxLines: row?.max_lines ?? 4,
    maxWords: row?.max_words ?? 90,
    smartPageSplits: row ? Boolean(row.smart_page_splits) : true,
    lowerThirdImageMaxHeightPercent: row?.lower_third_image_max_height_percent ?? 30,
    lowerThirdImagePadding: row?.lower_third_image_padding ?? 48,
  };
}

export function saveDisplayConfig(config: DisplayConfig): DisplayConfig {
  db.prepare(
    `INSERT INTO display_config
       (id, font_family, text_color, text_scale, max_lines, max_words, smart_page_splits,
        lower_third_image_max_height_percent, lower_third_image_padding, updated_at)
     VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET font_family = excluded.font_family, text_color = excluded.text_color,
       text_scale = excluded.text_scale, max_lines = excluded.max_lines,
       max_words = excluded.max_words, smart_page_splits = excluded.smart_page_splits,
       lower_third_image_max_height_percent = excluded.lower_third_image_max_height_percent,
       lower_third_image_padding = excluded.lower_third_image_padding,
       updated_at = excluded.updated_at`,
  ).run(
    config.fontFamily,
    config.textColor,
    config.textScale,
    config.maxLines,
    config.maxWords,
    config.smartPageSplits ? 1 : 0,
    config.lowerThirdImageMaxHeightPercent,
    config.lowerThirdImagePadding,
    new Date().toISOString(),
  );
  return getDisplayConfig();
}
