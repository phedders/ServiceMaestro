import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { FontOption } from "@sm/shared";
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

interface LocalFontFile {
  relativePath: string;
  label: string;
  weight: number;
  style: "normal" | "italic";
  format: string;
}

const LOCAL_FONT_EXTENSIONS = new Map([
  [".ttf", "truetype"],
  [".otf", "opentype"],
  [".woff", "woff"],
  [".woff2", "woff2"],
]);
const FONT_WEIGHT_TOKENS = new Set([
  "thin",
  "hairline",
  "extralight",
  "ultralight",
  "light",
  "regular",
  "normal",
  "book",
  "medium",
  "semibold",
  "demibold",
  "bold",
  "extrabold",
  "ultrabold",
  "black",
  "heavy",
  "italic",
  "oblique",
  "variable",
  "vf",
]);

fs.mkdirSync(FONTS_DIR, { recursive: true });

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "font";
}

function localFontWeight(name: string): number {
  const value = name.toLowerCase();
  if (/(thin|hairline)/.test(value)) return 100;
  if (/(extralight|ultralight)/.test(value)) return 200;
  if (/light/.test(value)) return 300;
  if (/(medium)/.test(value)) return 500;
  if (/(semibold|demibold)/.test(value)) return 600;
  if (/(extrabold|ultrabold)/.test(value)) return 800;
  if (/(black|heavy)/.test(value)) return 900;
  if (/bold/.test(value)) return 700;
  return 400;
}

function localFontLabel(filename: string): string {
  const stem = path.basename(filename, path.extname(filename));
  const expanded = stem
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/[-_.\s]+/g, " ")
    .trim();
  const tokens = expanded.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && FONT_WEIGHT_TOKENS.has(tokens[tokens.length - 1].toLowerCase())) {
    tokens.pop();
  }
  return tokens.join(" ").trim() || stem || "Local font";
}

function walkLocalFonts(
  current: string,
  relative: string,
  files: LocalFontFile[],
  depth = 0,
): void {
  if (depth > 5) return;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(current, entry.name);
    const rel = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) {
      // Google downloads and generated local CSS live in these directories.
      const generatedGoogle =
        entry.name.startsWith("google-") && fs.existsSync(path.join(full, "fonts.css"));
      if (generatedGoogle || entry.name === "_local") continue;
      walkLocalFonts(full, rel, files, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    const format = LOCAL_FONT_EXTENSIONS.get(path.extname(entry.name).toLowerCase());
    if (!format) continue;
    const lower = entry.name.toLowerCase();
    files.push({
      relativePath: rel,
      label: localFontLabel(entry.name),
      weight: localFontWeight(lower),
      style: /(italic|oblique)/.test(lower) ? "italic" : "normal",
      format,
    });
  }
}

function localFontCss(files: LocalFontFile[]): string {
  return files
    .map((file) => {
      const url = file.relativePath
        .split(path.sep)
        .map((part) => encodeURIComponent(part))
        .join("/");
      const family = file.label.replace(/"/g, '\\"');
      return `@font-face {\n  font-family: "${family}";\n  src: url("/display/fonts/${url}") format("${file.format}");\n  font-style: ${file.style};\n  font-weight: ${file.weight};\n}`;
    })
    .join("\n\n");
}

function syncLocalFonts(): void {
  const files: LocalFontFile[] = [];
  walkLocalFonts(FONTS_DIR, "", files);

  const groups = new Map<string, { label: string; files: LocalFontFile[] }>();
  for (const file of files) {
    const key = file.label.toLowerCase();
    const group = groups.get(key);
    if (group) group.files.push(file);
    else groups.set(key, { label: file.label, files: [file] });
  }

  const existing = db
    .prepare("SELECT * FROM fonts WHERE source_url IS NULL")
    .all() as FontRow[];
  const existingById = new Map(existing.map((row) => [row.id, row]));
  const keep = new Set<string>();
  let changed = false;
  const now = new Date().toISOString();

  for (const [key, group] of groups) {
    const id = `local-${slug(key)}`;
    keep.add(id);
    const cssPath = path.join("_local", id, "fonts.css");
    const cssFile = path.join(FONTS_DIR, cssPath);
    const css = localFontCss(group.files);
    fs.mkdirSync(path.dirname(cssFile), { recursive: true });
    if (!fs.existsSync(cssFile) || fs.readFileSync(cssFile, "utf8") !== css) {
      fs.writeFileSync(cssFile, css);
      changed = true;
    }
    const family = `"${group.label.replace(/"/g, '\\"')}", system-ui, sans-serif`;
    const current = existingById.get(id);
    if (
      !current ||
      current.label !== group.label ||
      current.family !== family ||
      current.css_path !== cssPath
    ) {
      db.prepare(
        `INSERT INTO fonts (id, label, family, source_url, css_path, created_at)
         VALUES (?, ?, ?, NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, family = excluded.family,
           source_url = NULL, css_path = excluded.css_path`,
      ).run(id, group.label, family, cssPath, current?.created_at ?? now);
      changed = true;
    }
  }

  for (const row of existing) {
    if (keep.has(row.id)) continue;
    db.prepare("DELETE FROM fonts WHERE id = ?").run(row.id);
    fs.rmSync(path.join(FONTS_DIR, "_local", row.id), { recursive: true, force: true });
    changed = true;
  }

  if (changed) refreshAllFontsCss();
}

function mapRow(row: FontRow): FontOption {
  return {
    id: row.id,
    label: row.label,
    family: row.family,
    source: row.source_url ? "google" : "local",
    cssUrl: row.source_url,
    importedAt: row.created_at,
  };
}

export function listFonts(): FontOption[] {
  syncLocalFonts();
  const rows = db.prepare("SELECT * FROM fonts ORDER BY label COLLATE NOCASE").all() as FontRow[];
  return [...BUILTIN_FONTS, ...rows.map(mapRow)];
}

export function refreshAllFontsCss(): void {
  fs.mkdirSync(FONTS_DIR, { recursive: true });
  const rows = db.prepare("SELECT * FROM fonts ORDER BY label COLLATE NOCASE").all() as FontRow[];
  const chunks: string[] = [
    "/* Service Maestro — imported and detected local fonts. Generated automatically. */",
  ];
  for (const row of rows) {
    const file = path.join(FONTS_DIR, row.css_path);
    if (fs.existsSync(file)) {
      const css = fs
        .readFileSync(file, "utf8")
        .replace(/(^|[("'])\/fonts\//g, "$1/display/fonts/");
      chunks.push(`/* ${row.label} */`, css);
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
    css = css.split(remoteUrl).join(`/display/fonts/${id}/${name}`);
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
  if (!row || !row.source_url) return false;
  db.prepare("DELETE FROM fonts WHERE id = ?").run(id);
  fs.rmSync(path.join(FONTS_DIR, id), { recursive: true, force: true });
  refreshAllFontsCss();
  return true;
}

syncLocalFonts();
refreshAllFontsCss();
