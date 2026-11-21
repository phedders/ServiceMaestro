import { randomUUID } from "node:crypto";

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_PREVIEWS = 100;

interface StoredPreview {
  html: string;
  expiresAt: number;
}

const previews = new Map<string, StoredPreview>();

function prune(now = Date.now()): void {
  for (const [token, preview] of previews) {
    if (preview.expiresAt <= now) previews.delete(token);
  }
  while (previews.size >= MAX_PREVIEWS) {
    const oldest = previews.keys().next().value;
    if (!oldest) break;
    previews.delete(oldest);
  }
}

export function storePreview(html: string): string {
  prune();
  const token = randomUUID();
  previews.set(token, { html, expiresAt: Date.now() + PREVIEW_TTL_MS });
  return token;
}

export function readPreview(token: string): string | null {
  prune();
  const preview = previews.get(token);
  if (!preview || preview.expiresAt <= Date.now()) return null;
  return preview.html;
}
