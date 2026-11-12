import type {
  SiteScraperProviderSummary,
  SongResourceKind,
} from "@sm/shared";
import { api, ApiError } from "./api";
import { SITE_KIND_LABELS } from "./site-download";

export async function loadActiveSiteProvider(): Promise<SiteScraperProviderSummary | null> {
  try {
    const result = await api.siteScrapingProviders();
    return result.providers.find((provider) => provider.activeSource) ?? null;
  } catch {
    return null;
  }
}

export async function updateSongFromSite(
  provider: SiteScraperProviderSummary,
  songId: string,
  title: string,
  notify: (text: string, kind?: "info" | "error") => void,
): Promise<boolean> {
  try {
    const check = await api.siteScraperCheckUpdates(provider.id, songId);
    if (!check.hasUpdates) {
      notify(`No missing files or updates found for “${title}”`);
      return false;
    }
    const missing = check.missingKinds.map((kind: SongResourceKind) => SITE_KIND_LABELS[kind]);
    const changed = check.changedKinds.map((kind: SongResourceKind) => SITE_KIND_LABELS[kind]);
    const details = [
      missing.length ? `new: ${missing.join(", ")}` : "",
      changed.length ? `updated: ${changed.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (!window.confirm(`${provider.label} has updates for “${title}” (${details}). Update now?`)) {
      return false;
    }
    const result = await api.siteScraperImport(provider.id, check.song, check.song.availableKinds);
    notify(
      `${result.created ? "Imported" : "Updated"} “${result.song.title}” with ${result.files.length} file${result.files.length === 1 ? "" : "s"}`,
    );
    return true;
  } catch (error) {
    notify(
      error instanceof ApiError ? error.message : "Could not check for SongSelect updates",
      "error",
    );
    return false;
  }
}
