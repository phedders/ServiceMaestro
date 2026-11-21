import type { LiveState, SongFullscreenPreviewInput } from "@sm/shared";
import { renderDisplayBackground } from "./display-background.js";
import { getDisplayConfig } from "./display-config.js";
import { displayOutputsMap } from "./display-outputs.js";
import { displayPreviewDocument } from "./display-app.js";
import { live } from "./live.js";
import { storePreview } from "./preview-store.js";
import { buildPages } from "./render.js";
import { resolveTemplates } from "./templates.js";

export function buildSongPreviewState(input: SongFullscreenPreviewInput): LiveState {
  const config = getDisplayConfig();
  const title = input.title || "Song preview";
  const pages = buildPages(
    {
      kind: "song",
      title,
      lyrics: input.lyrics,
      lyricsMarkdown: input.lyricsMarkdown,
      key: input.key ?? null,
      keyOverride: null,
      transpose: 0,
      maxLines: config.maxLines,
      verseOrder: input.verseOrder ?? null,
    },
    0,
    {
      maxLines: config.maxLines,
      maxWords: config.maxWords,
      smartPageSplits: config.smartPageSplits,
      smartWrapMinWords: config.smartWrapMinWords,
      smartWrapModules: config.smartWrapModules,
      textScale: config.textScale,
    },
  );
  const background = renderDisplayBackground(config.background);
  const base = live.getState();
  return {
    ...base,
    sessionId: "song-preview",
    setlistId: null,
    setlistName: "Song preview",
    status: "live",
    itemIndex: 0,
    pageIndex: 0,
    pageCount: pages.length,
    mode: "song",
    title,
    blank: false,
    transition: "fade",
    halfPageMode: false,
    halfPageOffset: 0,
    maxLines: config.maxLines,
    transpose: 0,
    footer: "",
    bibleVerseNumbers: true,
    pages,
    items: [],
    queuedItemIndex: null,
    queuedTitle: null,
    queuedPages: [],
    appendedItems: [],
    background: background ? { render: background } : null,
    templates: resolveTemplates(null),
    outputs: displayOutputsMap(),
    displayConfig: config,
    autoplay: null,
    autoplayOverrides: {},
    pendingUpdate: false,
    pendingRevision: null,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

export function createSongPreview(input: SongFullscreenPreviewInput): {
  url: string;
  pageCount: number;
} {
  const state = buildSongPreviewState(input);
  const token = storePreview(displayPreviewDocument(state));
  return {
    url: `/display/song-preview/${encodeURIComponent(token)}`,
    pageCount: state.pages.length,
  };
}
