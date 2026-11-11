import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { FontOption } from "@wlm/shared";
import { db } from "./db.js";
import { FONTS_DIR } from "./config.js";

const BUILTIN_FONTS: FontOption[] = [
  {
    id: "builtin-clear-sans",
    label: "Clear Sans / system",
    family: '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
    source: "built-in",
    cssUrl: null,
    importedAt: null,
  },
  {
    id: "builtin-system",
    label: "System sans-serif",
    family: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    source: "built-in",
    cssUrl: null,
    importedAt: null,
  },
  {
    id: "builtin-serif",
    label: "Serif",
    family: 'Georgia, "Times New Roman", serif',
    source: "built-in",
    cssUrl: null,
    importedAt: null,
  },
  {
    id: "builtin-humanist",
    label: "Humanist sans",
    family: '"Trebuchet MS", "Segoe UI", sans-serif',
    source: "built-in",
    cssUrl: null,
    importedAt: null,
  },
  {
    id: "builtin-mono",
    label: "Monospace",
    family: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
    source: "built-in",
    cssUrl: null,
    importedAt: null,
  },
];

interface FontRow {
  id: string;
  label: string;
  family: string;
  source_url: string | null;
  css_path: string;
  created_at: string;
}

fs.mkdirSync(FONTS_DIR, { recursive: true });

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "font";
}

function mapRow(row: FontRow): FontOption {
  return {
    id: row.id,
    label: row.label,
    family: row.family,
    source: "google",
    cssUrl: row.source_url,
    importedAt: row.created_at,
  };
}

export function listFonts(): FontOption[] {
  const rows = db.prepare("SELECT * FROM fonts ORDER BY label COLLATE NOCASE").all() as FontRow[];
  return [...BUILTIN_FONTS, ...rows.map(mapRow)];
}

export function refreshAllFontsCss(): void {
  fs.mkdirSync(FONTS_DIR, { recursive: true });
  const rows = db.prepare("SELECT * FROM fonts ORDER BY label COLLATE NOCASE").all() as FontRow[];
  const chunks: string[] = [
    "/* Service Maestro — imported Google Fonts. Generated automatically. */",
  ];
  for (const row of rows) {
    const file = path.join(FONTS_DIR, row.css_path);
    if (fs.existsSync(file)) {
      chunks.push(`/* ${row.label} */`, fs.readFileSync(file, "utf8"));
    }
  }
  fs.writeFileSync(path.join(FONTS_DIR, "all.css"), `${chunks.join("\n")}\n`);
}

function googleCssUrl(input: { family?: string; url?: string }): string {
  if (input.url) {
    const url = new URL(input.url);
    if (url.protocol !== "https:" || url.hostname !== "fonts.googleapis.com") {
      throw new Error("Only https://fonts.googleapis.com CSS URLs can be imported");
    }
    return url.toString();
  }
  const family = (input.family ?? "").trim();
  if (!family) throw new Error("Font family or Google Fonts URL is required");
  const encoded = family.replace(/\s+/g, "+");
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(encoded).replace(/%2B/g, "+")}:wght@400;600;700&display=swap`;
}

function familyFromCss(css: string, fallback: string): string {
  const match = css.match(/font-family:\s*['"]?([^;'"\n]+)['"]?\s*;/i);
  return (match?.[1] ?? fallback).trim();
}

function fontFamilyValue(family: string): string {
  const escaped = family.replace(/"/g, '\\"');
  return `"${escaped}", system-ui, sans-serif`;
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Font download failed (${response.status}) for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function importGoogleFont(input: { family?: string; url?: string }): Promise<FontOption> {
  const url = googleCssUrl(input);
  const requestedFamily = (input.family ?? "").trim();
  const cssResponse = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!cssResponse.ok) {
    throw new Error(`Google Fonts returned ${cssResponse.status}`);
  }
  let css = await cssResponse.text();
  const family = familyFromCss(css, requestedFamily || "Imported font");
  const id = `google-${slug(family)}`;
  const dir = path.join(FONTS_DIR, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/gi)].map((m) => m[1]))];
  if (!urls.length) {
    throw new Error("No hosted font files were found in the Google Fonts CSS");
  }
  for (const remoteUrl of urls) {
    const parsed = new URL(remoteUrl);
    if (parsed.protocol !== "https:" || parsed.hostname !== "fonts.gstatic.com") {
      throw new Error("Google Fonts CSS referenced an unsupported font host");
    }
    const extension = path.extname(parsed.pathname) || ".woff2";
    const name = `${createHash("sha1").update(remoteUrl).digest("hex").slice(0, 16)}${extension}`;
    fs.writeFileSync(path.join(dir, name), await download(remoteUrl));
    css = css.split(remoteUrl).join(`/fonts/${id}/${name}`);
  }

  fs.writeFileSync(path.join(dir, "fonts.css"), css);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO fonts (id, label, family, source_url, css_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET label = excluded.label, family = excluded.family,
       source_url = excluded.source_url, css_path = excluded.css_path, created_at = excluded.created_at`,
  ).run(id, family, fontFamilyValue(family), url, path.join(id, "fonts.css"), now);
  refreshAllFontsCss();
  return mapRow(db.prepare("SELECT * FROM fonts WHERE id = ?").get(id) as FontRow);
}

export function deleteFont(id: string): boolean {
  const row = db.prepare("SELECT * FROM fonts WHERE id = ?").get(id) as FontRow | undefined;
  if (!row) return false;
  db.prepare("DELETE FROM fonts WHERE id = ?").run(id);
  fs.rmSync(path.join(FONTS_DIR, id), { recursive: true, force: true });
  refreshAllFontsCss();
  return true;
}

refreshAllFontsCss();
