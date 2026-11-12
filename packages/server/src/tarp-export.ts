import { z } from "zod";
import {
  tarpBackgroundSchema,
  tarpPageTransitionSchema,
  tarpViewSchema,
  type TarpPresentationDetail,
} from "@sm/shared";
import { db } from "./db.js";
import { getTarpPresentation, listTarpPresentations, listTarpThemes } from "./tarp.js";

const tarpThemeBundleSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  background: tarpBackgroundSchema,
  fontFamily: z.string(),
  textColor: z.string(),
  accentColor: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const tarpPageBundleSchema = z.object({
  id: z.string().min(1),
  presentationId: z.string().min(1),
  position: z.number().int().min(0),
  name: z.string(),
  themeId: z.string().nullable().optional(),
  startFromPrevious: z.boolean().optional(),
  transition: tarpPageTransitionSchema.nullable().optional(),
  normal: tarpViewSchema,
  lowerthird: tarpViewSchema,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const tarpPresentationBundleSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  aspect: z.enum(["16:9", "16:10"]),
  themeId: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  pages: z.array(tarpPageBundleSchema).max(500),
});

export const tarpBundleSchema = z.object({
  themes: z.array(tarpThemeBundleSchema).max(500).optional(),
  presentations: z.array(tarpPresentationBundleSchema).max(500).optional(),
});

export type TarpBundle = z.infer<typeof tarpBundleSchema>;

export function exportTarpBundle(presentationIds?: string[]): TarpBundle {
  const presentations = presentationIds
    ? presentationIds
        .map((id) => getTarpPresentation(id))
        .filter((item): item is TarpPresentationDetail => item !== null)
    : listTarpPresentations()
        .map((item) => getTarpPresentation(item.id))
        .filter((item): item is TarpPresentationDetail => item !== null);
  const themeIds = new Set<string>();
  for (const presentation of presentations) {
    if (presentation.themeId) themeIds.add(presentation.themeId);
    for (const page of presentation.pages) {
      if (page.themeId) themeIds.add(page.themeId);
    }
  }
  const themes = listTarpThemes().filter(
    (theme) => presentationIds === undefined || themeIds.has(theme.id),
  );
  return { themes, presentations };
}

export function importTarpBundle(input: unknown): {
  themes: number;
  presentations: number;
  pages: number;
} {
  const bundle = tarpBundleSchema.parse(input);
  const timestamp = new Date().toISOString();
  const result = { themes: 0, presentations: 0, pages: 0 };
  const transaction = db.transaction(() => {
    const upsertTheme = db.prepare(
      `INSERT INTO tarp_themes
       (id, name, background_json, font_family, text_color, accent_color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name,
         background_json = excluded.background_json, font_family = excluded.font_family,
         text_color = excluded.text_color, accent_color = excluded.accent_color,
         updated_at = excluded.updated_at`,
    );
    for (const theme of bundle.themes ?? []) {
      upsertTheme.run(
        theme.id,
        theme.name,
        JSON.stringify(theme.background),
        theme.fontFamily,
        theme.textColor,
        theme.accentColor,
        theme.createdAt ?? timestamp,
        theme.updatedAt ?? timestamp,
      );
      result.themes += 1;
    }

    const upsertPresentation = db.prepare(
      `INSERT INTO tarp_presentations (id, name, aspect, theme_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, aspect = excluded.aspect,
         theme_id = excluded.theme_id, updated_at = excluded.updated_at`,
    );
    const upsertPage = db.prepare(
      `INSERT INTO tarp_pages
       (id, presentation_id, position, name, theme_id, start_from_previous, transition_json,
        normal_json, lowerthird_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET presentation_id = excluded.presentation_id,
         position = excluded.position, name = excluded.name, theme_id = excluded.theme_id,
         start_from_previous = excluded.start_from_previous,
         transition_json = excluded.transition_json, normal_json = excluded.normal_json,
         lowerthird_json = excluded.lowerthird_json, updated_at = excluded.updated_at`,
    );

    for (const presentation of bundle.presentations ?? []) {
      upsertPresentation.run(
        presentation.id,
        presentation.name,
        presentation.aspect,
        presentation.themeId ?? null,
        presentation.createdAt ?? timestamp,
        presentation.updatedAt ?? timestamp,
      );
      const pageIds = presentation.pages.map((page) => page.id);
      db.prepare(
        `DELETE FROM tarp_pages WHERE presentation_id = ?
         AND id NOT IN (${pageIds.length ? pageIds.map(() => "?").join(",") : "''"})`,
      ).run(presentation.id, ...pageIds);
      for (const page of presentation.pages) {
        upsertPage.run(
          page.id,
          presentation.id,
          page.position,
          page.name,
          page.themeId ?? null,
          page.startFromPrevious ? 1 : 0,
          page.transition ? JSON.stringify(page.transition) : null,
          JSON.stringify(page.normal),
          JSON.stringify(page.lowerthird),
          page.createdAt ?? timestamp,
          page.updatedAt ?? timestamp,
        );
        result.pages += 1;
      }
      result.presentations += 1;
    }
  });
  transaction();
  return result;
}

export function tarpThemeFile(
  theme: NonNullable<TarpBundle["themes"]>[number],
): string {
  return JSON.stringify(theme, null, 2);
}

export function tarpPresentationFile(
  presentation: NonNullable<TarpBundle["presentations"]>[number],
): string {
  return JSON.stringify(presentation, null, 2);
}
