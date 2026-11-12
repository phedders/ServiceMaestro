export const PREVIEW_SCREENS = [
  {
    id: "1920x1080",
    width: 1920,
    height: 1080,
    label: "1920 × 1080 — Full HD (16:9)",
  },
  {
    id: "1920x1200",
    width: 1920,
    height: 1200,
    label: "1920 × 1200 — WUXGA (16:10)",
  },
  {
    id: "2560x1440",
    width: 2560,
    height: 1440,
    label: "2560 × 1440 — 2K / QHD (16:9)",
  },
  {
    id: "3840x2160",
    width: 3840,
    height: 2160,
    label: "3840 × 2160 — 4K UHD (16:9)",
  },
] as const;

export type PreviewScreenPreset = (typeof PREVIEW_SCREENS)[number];
export type PreviewScreenId = PreviewScreenPreset["id"];

const PREVIEW_SCREEN_STORAGE_KEY = "sm-live-preview-screen";
export const DEFAULT_PREVIEW_SCREEN_ID: PreviewScreenId = "1920x1080";

export function findPreviewScreen(id: string): PreviewScreenPreset {
  return PREVIEW_SCREENS.find((screen) => screen.id === id) ?? PREVIEW_SCREENS[0];
}

export function loadPreviewScreenId(): PreviewScreenId {
  try {
    const stored = window.localStorage.getItem(PREVIEW_SCREEN_STORAGE_KEY);
    return PREVIEW_SCREENS.some((screen) => screen.id === stored)
      ? (stored as PreviewScreenId)
      : DEFAULT_PREVIEW_SCREEN_ID;
  } catch {
    return DEFAULT_PREVIEW_SCREEN_ID;
  }
}

export function savePreviewScreenId(id: PreviewScreenId): void {
  try {
    window.localStorage.setItem(PREVIEW_SCREEN_STORAGE_KEY, id);
  } catch {
    // Preview sizing is optional; the default still works without storage.
  }
}
