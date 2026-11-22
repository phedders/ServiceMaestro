import type { PageOverride } from "@sm/shared";

/**
 * Parse the persisted page override map. Invalid or partial entries are
 * ignored so a damaged JSON value cannot break live output.
 */
export function parsePageOverrides(
  value: string | null | undefined,
): Record<string, PageOverride> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const overrides: Record<string, PageOverride> = {};
    for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^\d+$/.test(key)) continue;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      if (typeof record.source !== "string" || typeof record.html !== "string") continue;
      overrides[key] = {
        source: record.source,
        html: record.html,
        section: typeof record.section === "string" ? record.section : null,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
      };
    }
    return overrides;
  } catch {
    return {};
  }
}
