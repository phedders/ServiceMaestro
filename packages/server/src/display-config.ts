import { SMART_WRAP_MODULES } from "@sm/shared";
import type { DisplayConfig, SmartWrapModule } from "@sm/shared";
import { db } from "./db.js";

interface Row {
  font_family: string;
  text_color: string;
  text_scale: number;
  max_lines: number;
  max_words: number;
  smart_page_splits: number;
  smart_wrap_min_words: number;
  smart_wrap_modules: string | null;
  lower_third_image_max_height_percent: number;
  lower_third_image_padding: number;
  lower_third_font_family: string | null;
  lower_third_text_scale: number | null;
}

function parseSmartWrapModules(value: string | null | undefined): SmartWrapModule[] {
  if (!value) return [...SMART_WRAP_MODULES];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [...SMART_WRAP_MODULES];
    const modules = parsed.filter(
      (entry): entry is SmartWrapModule =>
        typeof entry === "string" &&
        (SMART_WRAP_MODULES as readonly string[]).includes(entry),
    );
    return [...new Set(modules)];
  } catch {
    return [...SMART_WRAP_MODULES];
  }
}

export function getDisplayConfig(): DisplayConfig {
  const row = db
    .prepare(
      `SELECT font_family, text_color, text_scale, max_lines, max_words, smart_page_splits,
              smart_wrap_min_words, smart_wrap_modules,
              lower_third_image_max_height_percent, lower_third_image_padding,
              lower_third_font_family, lower_third_text_scale
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
    smartWrapMinWords: row?.smart_wrap_min_words ?? 15,
    smartWrapModules: parseSmartWrapModules(row?.smart_wrap_modules),
    lowerThirdImageMaxHeightPercent: row?.lower_third_image_max_height_percent ?? 30,
    lowerThirdImagePadding: row?.lower_third_image_padding ?? 48,
    lowerThirdFontFamily:
      row?.lower_third_font_family ??
      row?.font_family ??
      '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
    lowerThirdTextScale: row?.lower_third_text_scale ?? row?.text_scale ?? 1,
  };
}

export function saveDisplayConfig(config: DisplayConfig): DisplayConfig {
  db.prepare(
    `INSERT INTO display_config
       (id, font_family, text_color, text_scale, max_lines, max_words, smart_page_splits,
        smart_wrap_min_words, smart_wrap_modules,
        lower_third_image_max_height_percent, lower_third_image_padding,
        lower_third_font_family, lower_third_text_scale, updated_at)
     VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET font_family = excluded.font_family, text_color = excluded.text_color,
       text_scale = excluded.text_scale, max_lines = excluded.max_lines,
       max_words = excluded.max_words, smart_page_splits = excluded.smart_page_splits,
       smart_wrap_min_words = excluded.smart_wrap_min_words,
       smart_wrap_modules = excluded.smart_wrap_modules,
       lower_third_image_max_height_percent = excluded.lower_third_image_max_height_percent,
       lower_third_image_padding = excluded.lower_third_image_padding,
       lower_third_font_family = excluded.lower_third_font_family,
       lower_third_text_scale = excluded.lower_third_text_scale,
       updated_at = excluded.updated_at`,
  ).run(
    config.fontFamily,
    config.textColor,
    config.textScale,
    config.maxLines,
    config.maxWords,
    config.smartPageSplits ? 1 : 0,
    config.smartWrapMinWords,
    JSON.stringify(config.smartWrapModules),
    config.lowerThirdImageMaxHeightPercent,
    config.lowerThirdImagePadding,
    config.lowerThirdFontFamily,
    config.lowerThirdTextScale,
    new Date().toISOString(),
  );
  return getDisplayConfig();
}
