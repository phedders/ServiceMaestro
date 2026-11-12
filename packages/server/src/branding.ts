import fs from "node:fs";
import path from "node:path";
import type { BrandingSettings } from "@sm/shared";
import { BRANDING_LOGO_FILE, BRANDING_NAV_BACKGROUND, DATA_DIR } from "./config.js";
import { db } from "./db.js";

export const BRANDING_DIR = path.join(DATA_DIR, "branding");
fs.mkdirSync(BRANDING_DIR, { recursive: true });

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

function settingsMap(): Map<string, string> {
  const rows = db.prepare("SELECT key, value FROM app_settings").all() as Array<{
    key: string;
    value: string;
  }>;
  return new Map(rows.map((row) => [row.key, row.value]));
}

function writeSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, new Date().toISOString());
}

function storedLogoFile(): { path: string; mime: string } | null {
  for (const entry of fs.readdirSync(BRANDING_DIR)) {
    const extension = path.extname(entry).toLowerCase();
    const mime = MIME_BY_EXT[extension];
    if (mime) {
      return { path: path.join(BRANDING_DIR, entry), mime };
    }
  }
  return null;
}

function configuredLogoFile(): { path: string; mime: string } | null {
  if (!BRANDING_LOGO_FILE) return null;
  const absolute = path.resolve(BRANDING_LOGO_FILE);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null;
  const mime = MIME_BY_EXT[path.extname(absolute).toLowerCase()];
  return mime ? { path: absolute, mime } : null;
}

export function getBranding(): BrandingSettings {
  const values = settingsMap();
  const storedNav = values.get("branding_nav_background")?.trim() || null;
  const navBackground =
    storedNav ||
    (BRANDING_NAV_BACKGROUND && /^#[0-9a-f]{6}$/i.test(BRANDING_NAV_BACKGROUND)
      ? BRANDING_NAV_BACKGROUND
      : null);
  const storedUpdatedAt = values.get("branding_logo_updated_at")?.trim() || null;
  const file = storedLogoFile() ?? configuredLogoFile();
  const logoUpdatedAt = file
    ? storedLogoFile()
      ? storedUpdatedAt ?? fs.statSync(file.path).mtime.toISOString()
      : fs.statSync(file.path).mtime.toISOString()
    : null;
  return {
    logoUrl: file
      ? `/branding/logo?v=${encodeURIComponent(logoUpdatedAt ?? String(fs.statSync(file.path).mtimeMs))}`
      : null,
    navBackground,
    logoUpdatedAt,
  };
}

export function saveBranding(input: { navBackground: string | null }): BrandingSettings {
  const value = input.navBackground?.trim() ?? "";
  if (value && !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error("Navigation background must be a six-digit hex colour");
  }
  writeSetting("branding_nav_background", value);
  return getBranding();
}

export function saveBrandingLogo(
  buffer: Buffer,
  filename: string,
): BrandingSettings {
  const extension = path.extname(filename).toLowerCase();
  const mime = MIME_BY_EXT[extension];
  if (!mime) {
    throw new Error("Unsupported logo format. Use PNG, JPEG, GIF, WebP, AVIF or SVG.");
  }
  if (buffer.length > 5 * 1024 * 1024) {
    throw new Error("Logo is too large (maximum 5 MB)");
  }
  for (const entry of fs.readdirSync(BRANDING_DIR)) {
    const entryPath = path.join(BRANDING_DIR, entry);
    if (fs.statSync(entryPath).isFile()) fs.unlinkSync(entryPath);
  }
  fs.writeFileSync(path.join(BRANDING_DIR, `logo${extension}`), buffer);
  const now = new Date().toISOString();
  writeSetting("branding_logo_updated_at", now);
  return getBranding();
}

export function deleteBrandingLogo(): BrandingSettings {
  for (const entry of fs.readdirSync(BRANDING_DIR)) {
    const entryPath = path.join(BRANDING_DIR, entry);
    if (fs.statSync(entryPath).isFile()) fs.unlinkSync(entryPath);
  }
  db.prepare("DELETE FROM app_settings WHERE key = 'branding_logo_updated_at'").run();
  return getBranding();
}

export function brandingLogo(): { path: string; mime: string } | null {
  return storedLogoFile() ?? configuredLogoFile();
}
