import fs from "node:fs";
import path from "node:path";
import type { ImageAsset } from "@sm/shared";
import { IMAGES_DIR } from "./config.js";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

fs.mkdirSync(IMAGES_DIR, { recursive: true });

function cleanRelative(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter((part) => part && part !== "." && part !== "..");
  return parts.join("/");
}

export function resolveImage(relative: string): string | null {
  const clean = cleanRelative(relative);
  if (!clean) return null;
  const absolute = path.resolve(IMAGES_DIR, clean);
  if (!absolute.startsWith(`${path.resolve(IMAGES_DIR)}${path.sep}`)) return null;
  return absolute;
}

export function listImages(query?: string): ImageAsset[] {
  const q = query?.trim().toLowerCase();
  const results: ImageAsset[] = [];

  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      const mime = MIME_BY_EXT[extension];
      if (!mime) continue;
      const relative = path.relative(IMAGES_DIR, absolute).split(path.sep).join("/");
      if (q && !relative.toLowerCase().includes(q)) continue;
      const stat = fs.statSync(absolute);
      results.push({
        path: relative,
        name: path.basename(relative),
        folder: path.dirname(relative) === "." ? "" : path.dirname(relative),
        mime,
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        url: `/api/images/file?path=${encodeURIComponent(relative)}`,
      });
    }
  };

  walk(IMAGES_DIR);
  return results.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));
}

function safeFilename(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  const base = path
    .basename(filename, extension)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "image";
  return `${base}${extension}`;
}

export function saveImage(input: {
  buffer: Buffer;
  filename: string;
  mime?: string;
  folder?: string;
}): ImageAsset {
  const extension = path.extname(input.filename).toLowerCase();
  const mime = MIME_BY_EXT[extension];
  if (!mime) {
    throw new Error("Unsupported image type. Use PNG, JPEG, GIF, WebP, AVIF or SVG.");
  }
  if (input.buffer.length > 25 * 1024 * 1024) {
    throw new Error("Image is too large (maximum 25 MB)");
  }
  const folder = cleanRelative(input.folder ?? "");
  const directory = folder ? path.join(IMAGES_DIR, folder) : IMAGES_DIR;
  fs.mkdirSync(directory, { recursive: true });

  const safe = safeFilename(input.filename);
  const base = path.basename(safe, extension);
  let filename = safe;
  let counter = 1;
  while (fs.existsSync(path.join(directory, filename))) {
    filename = `${base}-${counter}${extension}`;
    counter += 1;
  }
  const absolute = path.join(directory, filename);
  fs.writeFileSync(absolute, input.buffer);
  const stat = fs.statSync(absolute);
  const relative = path.relative(IMAGES_DIR, absolute).split(path.sep).join("/");
  return {
    path: relative,
    name: filename,
    folder,
    mime,
    bytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    url: `/api/images/file?path=${encodeURIComponent(relative)}`,
  };
}

export function deleteImage(relative: string): boolean {
  const absolute = resolveImage(relative);
  if (!absolute || !fs.existsSync(absolute)) return false;
  fs.unlinkSync(absolute);
  let directory = path.dirname(absolute);
  const root = path.resolve(IMAGES_DIR);
  while (directory.startsWith(root) && directory !== root) {
    if (fs.readdirSync(directory).length > 0) break;
    fs.rmdirSync(directory);
    directory = path.dirname(directory);
  }
  return true;
}

export function imageMime(relative: string): string {
  return MIME_BY_EXT[path.extname(relative).toLowerCase()] ?? "application/octet-stream";
}
