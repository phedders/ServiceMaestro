import { useEffect, useState } from "react";
import {
  NO_BACKGROUND_ID,
  NO_STINGER_ID,
  formatBibleVerses,
  parseImageListContent,
  parseTarpItemContent,
  serializeImageListContent,
  serializeTarpItemContent,
  songPageOrder,
  type BackgroundAsset,
  type BibleBook,
  type BibleLayout,
  type BiblePassage,
  type BibleTranslationInfo,
  type ImageAsset,
  type LiveState,
  type PlaybackMode,
  type SetlistDetail,
  type SetlistImportPreview,
  type SetlistImportReport,
  type SetlistItem,
  type SetlistRevisionInfo,
  type SetlistSummary,
  type SiteScraperProviderSummary,
  type Song,
  type SongAlternative,
  type StingerAsset,
  type TarpPresentationSummary,
  type TextFormat,
} from "@sm/shared";
import { useAdapters } from "../adapters";
import { api, ApiError } from "../api";
import { BibleLayoutButtons } from "../components/BibleLayoutButtons";
import { IsoDateInput } from "../components/IsoDateInput";
import { PageContentEditor } from "../components/PageContentEditor";
import { ReadOnlyFieldset, usePageAccess } from "../page-access";
import { compactDate, compactDateTime, defaultSetlistName } from "../service-date";
import { useSessionState } from "../session-state";
import { loadActiveSiteProvider, updateSongFromSite as checkAndUpdateSongFromSite } from "../site-update";
import { diffLyrics } from "../song-diff";

const ROOT_FOLDER_KEY = "__root__";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function folderKey(folder: string): string {
  return folder ? folder : ROOT_FOLDER_KEY;
}

function folderFromKey(key: string): string {
  return key === ROOT_FOLDER_KEY ? "" : key;
}

function folderLabel(folder: string): string {
  return folder || "Root images";
}

function imagesForFolder(images: ImageAsset[], folder: string): ImageAsset[] {
  if (!folder) return images.filter((image) => image.folder === "");
  return images.filter(
    (image) => image.folder === folder || image.folder.startsWith(`${folder}/`),
  );
}

function imageFolderOptions(images: ImageAsset[]): string[] {
  const folders = [...new Set(images.map((image) => image.folder))].sort((a, b) =>
    folderLabel(a).localeCompare(folderLabel(b), undefined, { sensitivity: "base" }),
  );
  return folders.sort((a, b) => Number(Boolean(a)) - Number(Boolean(b)));
}

function itemKindLabel(kind: SetlistItem["kind"]): string {
  if (kind === "song") return "Song";
  if (kind === "image") return "Image";
  if (kind === "image_list") return "Image list";
  if (kind === "tarp") return "Tarp";
  return "Text";
}

function itemIcon(kind: SetlistItem["kind"]): string {
  if (kind === "song") return "♫";
  if (kind === "image") return "▣";
  if (kind === "image_list") return "▦";
  if (kind === "tarp") return "✦";
  return "T";
}

function defaultItemVerseOrder(item: SetlistItem, song: Song | undefined): string {
  if (item.kind !== "song") return "";
  if (item.verseOrder?.trim()) return item.verseOrder;
  if (song?.verseOrder?.trim()) return "";
  return songPageOrder(item.content ?? song?.lyrics ?? "");
}

function previewLines(item: SetlistItem, song: Song | undefined): string {
  let raw = item.kind === "song" ? (item.content ?? song?.lyrics ?? "") : (item.content ?? "");
  if (!raw.trim()) return "";
  raw = raw.replace(/\r/g, "");
  if (item.kind === "text") {
    raw = raw
      .replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "")
      .replace(/^\s*(?:type|format|mode)\s*:\s*(?:html|htm|markdown|md|rst|text|plain)\s*\n/i, "")
      .replace(/<[^>]+>/g, " ");
  }
  raw = raw.replace(/<!--[\s\S]*?-->/g, "");
  const lines = raw
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 6);
  const text = lines.join("\n");
  return text.length > 360 ? `${text.slice(0, 360)}…` : text;
}

function extractTextHeader(content: string): { format: TextFormat | null; content: string } {
  const firstLine = content.match(
    /^\s*(?:type|format|mode)\s*:\s*(html|htm|markdown|md|rst|restructuredtext|restructured|text|plain)\s*(?:\n|$)/i,
  );
  if (firstLine) {
    const raw = firstLine[1].toLowerCase();
    const format: TextFormat =
      raw === "html" || raw === "htm"
        ? "html"
        : raw === "markdown" || raw === "md"
          ? "markdown"
          : raw === "rst" || raw.startsWith("restructured")
            ? "rst"
            : "text";
    return { format, content: content.slice(firstLine[0].length) };
  }
  return { format: null, content };
}

function initialTextState(item: SetlistItem): { format: TextFormat; content: string } {
  if (item.kind !== "text") return { format: "text", content: item.content ?? "" };
  if (item.format) return { format: item.format, content: item.content ?? "" };
  const extracted = extractTextHeader(item.content ?? "");
  return {
    format: extracted.format ?? "markdown",
    content: extracted.format ? extracted.content : (item.content ?? ""),
  };
}

function songFirstLines(song: Song): string {
  return song.lyrics
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\[[^\]]+\]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("\n");
}

function playbackModeLabel(mode: PlaybackMode): string {
  return mode === "bounce" ? "bounce" : mode === "loop" ? "looping" : "single pass";
}

function stingerPageRows(overrides: Record<string, string>) {
  return Object.entries(overrides)
    .map(([page, stingerId]) => ({ page: Number(page), stingerId }))
    .filter((entry) => Number.isInteger(entry.page) && entry.page > 0)
    .sort((a, b) => a.page - b.page);
}

function ItemRow({
  item,
  song,
  images,
  backgrounds,
  stingers,
  tarpPresentations,
  siteProvider,
  siteUpdatingSongId,
  onUpdateFromSite,
  onUploadImage,
  first,
  last,
  dragging,
  dragOver,
  onMove,
  onDelete,
  onSave,
  onSaveInventory,
  onSongReplaced,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  notify,
}: {
  item: SetlistItem;
  song: Song | undefined;
  images: ImageAsset[];
  backgrounds: BackgroundAsset[];
  stingers: StingerAsset[];
  tarpPresentations: TarpPresentationSummary[];
  siteProvider: SiteScraperProviderSummary | null;
  siteUpdatingSongId: string | null;
  onUpdateFromSite: (song: Song) => Promise<void>;
  onUploadImage: (file: File) => Promise<ImageAsset>;
  first: boolean;
  last: boolean;
  dragging: boolean;
  dragOver: boolean;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onSaveInventory: (payload: Record<string, unknown>) => Promise<void>;
  onSongReplaced: (songId: string) => Promise<void>;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const { songSelectEnabled } = useAdapters();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const initial = initialTextState(item);
  const [content, setContent] = useState(
    item.kind === "song" ? item.content ?? song?.lyrics ?? "" : initial.content,
  );
  const [format, setFormat] = useState<TextFormat>(initial.format);
  const [textAlign, setTextAlign] = useState<"left" | "center">(item.textAlign ?? "left");
  const [imageFit, setImageFit] = useState<"scale" | "actual" | "crop" | "stretch">(
    item.imageFit ?? "scale",
  );
  const [backgroundId, setBackgroundId] = useState(item.backgroundId ?? "");
  const [stingerId, setStingerId] = useState(item.stingerId ?? "");
  const [pageStingers, setPageStingers] = useState(() =>
    stingerPageRows(item.stingerPageOverrides),
  );
  const initialImageList = parseImageListContent(item.content);
  const [listFolder, setListFolder] = useState(initialImageList?.folder ?? "");
  const [listAutoplay, setListAutoplay] = useState(initialImageList?.autoplay ?? false);
  const [listMode, setListMode] = useState<PlaybackMode>(initialImageList?.mode ?? "loop");
  const [listDelay, setListDelay] = useState(initialImageList?.delaySeconds ?? 6);
  const initialTarp = parseTarpItemContent(item.content);
  const [tarpPresentationId, setTarpPresentationId] = useState(initialTarp?.presentationId ?? "");
  const [tarpAutoplay, setTarpAutoplay] = useState(initialTarp?.autoplay ?? false);
  const [tarpMode, setTarpMode] = useState<PlaybackMode>(initialTarp?.mode ?? "loop");
  const [tarpDelay, setTarpDelay] = useState(initialTarp?.delaySeconds ?? 6);
  const [keyOverride, setKeyOverride] = useState(item.keyOverride ?? "");
  const [transpose, setTranspose] = useState(item.transpose);
  const [verseOrder, setVerseOrder] = useState(() => defaultItemVerseOrder(item, song));
  const [verseOrderId, setVerseOrderId] = useState(
    song?.verseOrders.find((entry) => entry.order === item.verseOrder)?.id ?? "",
  );
  const [notes, setNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [altOpen, setAltOpen] = useState(false);
  const [altLoading, setAltLoading] = useState(false);
  const [alternatives, setAlternatives] = useState<SongAlternative[]>([]);
  const [altDiffId, setAltDiffId] = useState<string | null>(null);
  const [replacingAltId, setReplacingAltId] = useState<string | null>(null);

  useEffect(() => {
    const next = initialTextState(item);
    setTitle(item.title);
    setFormat(next.format);
    setTextAlign(item.textAlign ?? "left");
    setImageFit(item.imageFit ?? "scale");
    setBackgroundId(item.backgroundId ?? "");
    setStingerId(item.stingerId ?? "");
    setPageStingers(stingerPageRows(item.stingerPageOverrides));
    const nextImageList = parseImageListContent(item.content);
    setListFolder(nextImageList?.folder ?? "");
    setListAutoplay(nextImageList?.autoplay ?? false);
    setListMode(nextImageList?.mode ?? "loop");
    setListDelay(nextImageList?.delaySeconds ?? 6);
    const nextTarp = parseTarpItemContent(item.content);
    setTarpPresentationId(nextTarp?.presentationId ?? "");
    setTarpAutoplay(nextTarp?.autoplay ?? false);
    setTarpMode(nextTarp?.mode ?? "loop");
    setTarpDelay(nextTarp?.delaySeconds ?? 6);
    setContent(item.kind === "song" ? item.content ?? song?.lyrics ?? "" : next.content);
    setKeyOverride(item.keyOverride ?? "");
    setTranspose(item.transpose);
    setVerseOrder(defaultItemVerseOrder(item, song));
    setVerseOrderId(
      song?.verseOrders.find((entry) => entry.order === item.verseOrder)?.id ?? "",
    );
    setNotes(item.notes ?? "");
  }, [item, song]);

  const displayTitle = item.title || song?.title || "Untitled";
  const generatedVerseOrder =
    item.kind === "song" &&
    !item.verseOrder?.trim() &&
    !song?.verseOrder?.trim() &&
    !verseOrderId &&
    Boolean(verseOrder);
  const localSongEdit =
    item.kind === "song" && (item.content != null || (song != null && item.title !== song.title));
  const preview =
    item.kind === "image_list" || item.kind === "tarp" ? "" : previewLines(item, song);
  const tarpSummary = item.kind === "tarp" ? initialTarp : null;
  const imageListPreview = initialImageList;
  const listImages = imagesForFolder(images, listFolder);

  function resetDraft() {
    const next = initialTextState(item);
    setTitle(item.title);
    setFormat(next.format);
    setTextAlign(item.textAlign ?? "left");
    setImageFit(item.imageFit ?? "scale");
    setBackgroundId(item.backgroundId ?? "");
    setStingerId(item.stingerId ?? "");
    setPageStingers(stingerPageRows(item.stingerPageOverrides));
    const nextImageList = parseImageListContent(item.content);
    setListFolder(nextImageList?.folder ?? "");
    setListAutoplay(nextImageList?.autoplay ?? false);
    setListMode(nextImageList?.mode ?? "loop");
    setListDelay(nextImageList?.delaySeconds ?? 6);
    const nextTarp = parseTarpItemContent(item.content);
    setTarpPresentationId(nextTarp?.presentationId ?? "");
    setTarpAutoplay(nextTarp?.autoplay ?? false);
    setTarpMode(nextTarp?.mode ?? "loop");
    setTarpDelay(nextTarp?.delaySeconds ?? 6);
    setContent(item.kind === "song" ? item.content ?? song?.lyrics ?? "" : next.content);
    setKeyOverride(item.keyOverride ?? "");
    setTranspose(item.transpose);
    setVerseOrder(defaultItemVerseOrder(item, song));
    setVerseOrderId(
      song?.verseOrders.find((entry) => entry.order === item.verseOrder)?.id ?? "",
    );
    setNotes(item.notes ?? "");
  }

  function closeEditor() {
    resetDraft();
    setEditing(false);
  }

  function toggleEditor() {
    if (editing) {
      resetDraft();
      setEditing(false);
    } else {
      setEditing(true);
    }
  }

  function stingerFields(): Record<string, unknown> {
    return {
      stingerId: stingerId || null,
      stingerPageOverrides: Object.fromEntries(
        pageStingers
          .filter((entry) => entry.page > 0 && entry.stingerId)
          .map((entry) => [String(entry.page), entry.stingerId]),
      ),
    };
  }

  function payload(): Record<string, unknown> {
    if (item.kind === "image") {
      return {
        title: title.trim() || content.split("/").pop() || "Image",
        content,
        imageFit,
        notes: notes || null,
        ...stingerFields(),
      };
    }
    if (item.kind === "image_list") {
      const listImages = imagesForFolder(images, listFolder);
      if (!listImages.length) throw new Error("Choose a folder with images");
      return {
        title: title.trim() || folderLabel(listFolder),
        content: serializeImageListContent({
          folder: listFolder,
          images: listImages.map((image) => image.path),
          autoplay: listAutoplay,
          mode: listMode,
          delaySeconds: listDelay,
        }),
        imageFit,
        notes: notes || null,
        ...stingerFields(),
      };
    }
    if (item.kind === "tarp") {
      if (!tarpPresentationId) throw new Error("Choose a Tarp presentation");
      return {
        title:
          title.trim() ||
          tarpPresentations.find((presentation) => presentation.id === tarpPresentationId)?.name ||
          "Tarp",
        content: serializeTarpItemContent({
          presentationId: tarpPresentationId,
          autoplay: tarpAutoplay,
          mode: tarpMode,
          delaySeconds: tarpDelay,
        }),
        notes: notes || null,
        ...stingerFields(),
      };
    }
    const nextContent = content;
    return {
      title: title.trim() || (item.kind === "song" ? song?.title ?? displayTitle : "Text"),
      // Songs follow the inventory unless the lyrics were actually changed.
      content:
        item.kind === "song"
          ? song
            ? nextContent === song.lyrics
              ? null
              : nextContent
            : nextContent || null
          : nextContent,
      keyOverride: keyOverride || null,
      transpose: Number(transpose) || 0,
      verseOrder: verseOrder || null,
      notes: notes || null,
      backgroundId: backgroundId || null,
      ...stingerFields(),
      ...(item.kind === "text" ? { format, textAlign } : {}),
    };
  }

  async function saveLocal() {
    setSaving(true);
    try {
      await onSave(payload());
      setEditing(false);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save item", "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveInventory() {
    setSaving(true);
    try {
      await onSaveInventory(payload());
      setEditing(false);
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Could not save changes to the song library",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function openAlternatives() {
    if (!song) return;
    setAltOpen(true);
    setAltLoading(true);
    setAlternatives([]);
    setAltDiffId(null);
    try {
      const result = await api.songAlternatives(song.id, item.title || song.title);
      setAlternatives(result.alternatives);
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Could not load alternative versions",
        "error",
      );
      setAltOpen(false);
    } finally {
      setAltLoading(false);
    }
  }

  async function chooseAlternative(alternative: SongAlternative) {
    if (
      (item.content != null || (song != null && item.title !== song.title)) &&
      !confirm(
        `Replace this item with “${alternative.title}”? Local edits to the current song will be discarded.`,
      )
    ) {
      return;
    }
    setReplacingAltId(alternative.id);
    try {
      await onSongReplaced(alternative.id);
      setAltOpen(false);
      notify(`Changed this item to “${alternative.title}”`);
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Could not change the song version",
        "error",
      );
    } finally {
      setReplacingAltId(null);
    }
  }

  const currentLyrics = item.content ?? song?.lyrics ?? "";

  return (
    <div
      className={`setlist-item ${dragging ? "dragging" : ""} ${dragOver ? "drag-over" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      <div className="setlist-item-main">
        <span
          className="drag-handle"
          draggable
          title="Drag to reorder"
          aria-label="Drag to reorder"
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", item.id);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
        >
          ⠿
        </span>
        <span className={`item-icon ${item.kind}`}>{itemIcon(item.kind)}</span>
        <button
          type="button"
          className="setlist-item-summary"
          onClick={toggleEditor}
          title={editing ? "Close editor" : "Click to edit"}
        >
          <span className="setlist-item-title-row">
            <strong>{displayTitle}</strong>
            {localSongEdit && <span className="local-badge">Local edit</span>}
          </span>
          <span className="muted">
            {itemKindLabel(item.kind)}
            {item.kind === "image_list" && imageListPreview
              ? ` · ${imageListPreview.images.length} images`
              : ""}
            {item.notes ? ` · ${item.notes}` : ""}
          </span>
          {!editing && item.kind === "image" && content && (
            <img
              className="setlist-image-thumb"
              src={`/display/images/file?path=${encodeURIComponent(content)}`}
              alt={displayTitle}
            />
          )}
          {!editing && item.kind === "image_list" && imageListPreview?.images[0] && (
            <img
              className="setlist-image-thumb"
              src={`/display/images/file?path=${encodeURIComponent(imageListPreview.images[0])}`}
              alt={displayTitle}
            />
          )}
          {!editing && item.kind === "image_list" && imageListPreview && (
            <span className="setlist-item-preview">
              {imageListPreview.autoplay
                ? `Autoplay every ${imageListPreview.delaySeconds}s · ${playbackModeLabel(imageListPreview.mode)}`
                : "Autoplay off · advance manually"}
            </span>
          )}
          {!editing && item.kind === "tarp" && tarpSummary && (
            <span className="setlist-item-preview">
              {tarpSummary.autoplay
                ? `Autoplay every ${tarpSummary.delaySeconds}s · ${playbackModeLabel(tarpSummary.mode)}`
                : "Autoplay off · advance manually"}
            </span>
          )}
          {!editing &&
            preview &&
            item.kind !== "image" &&
            item.kind !== "image_list" &&
            item.kind !== "tarp" && (
              <span className="setlist-item-preview">{preview}</span>
            )}
        </button>
        <div className="setlist-item-actions">
          <button
            className="button ghost small"
            disabled={first}
            onClick={() => onMove(-1)}
            title="Move this item up"
          >
            ↑
          </button>
          <button
            className="button ghost small"
            disabled={last}
            onClick={() => onMove(1)}
            title="Move this item down"
          >
            ↓
          </button>
          {item.kind === "song" && song && (
            <button
              className="button ghost small alt-button"
              onClick={openAlternatives}
              title="Find alternative versions with similar titles"
            >
              ALT
            </button>
          )}
          {item.kind === "song" && song && songSelectEnabled && siteProvider && (
            <button
              className="button ghost small"
              onClick={() => void onUpdateFromSite(song)}
              disabled={siteUpdatingSongId !== null}
              title={`Update from ${siteProvider.label} — check for missing files or changes`}
            >
              {siteUpdatingSongId === song.id ? "Checking…" : "Update"}
            </button>
          )}
          <button
            className="button ghost small"
            onClick={toggleEditor}
            title={editing ? "Close the item editor" : "Edit this item"}
          >
            {editing ? "Done" : "Edit"}
          </button>
          <button
            className="button ghost small danger-text"
            onClick={onDelete}
            title="Remove this item from the set list"
          >
            Remove
          </button>
        </div>
      </div>

      {editing && (
        <div className="setlist-item-edit">
          <div className="setlist-item-edit-heading">
            <strong>
              {item.kind === "song"
                ? "Edit song for this set list"
                : item.kind === "image"
                  ? "Edit image"
                  : item.kind === "image_list"
                    ? "Edit image list"
                    : item.kind === "tarp"
                      ? "Edit Tarp item"
                      : "Edit text"}
            </strong>
            {item.kind === "song" && (
              <span className="muted">
                Changes stay in this set list unless you choose “Save to song library”.
              </span>
            )}
          </div>
          <label>
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            Stinger override
            <select value={stingerId} onChange={(event) => setStingerId(event.target.value)}>
              <option value="">Use set-list stinger</option>
              <option value={NO_STINGER_ID}>No stinger</option>
              {stingers.map((stinger) => (
                <option key={stinger.id} value={stinger.id}>
                  {stinger.name} · {stinger.durationMs} ms
                </option>
              ))}
            </select>
          </label>
          <details className="stinger-page-overrides">
            <summary>
              Page stinger overrides
              {pageStingers.length ? ` (${pageStingers.length})` : ""}
            </summary>
            <p className="hint">
              Overrides are keyed by the 1-based page number shown on stage. They win over the
              item and set-list stingers.
            </p>
            {pageStingers.map((entry, index) => (
              <div className="stinger-page-row" key={`${entry.page}-${index}`}>
                <label>
                  Page
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={entry.page}
                    onChange={(event) =>
                      setPageStingers((current) =>
                        current.map((candidate, candidateIndex) =>
                          candidateIndex === index
                            ? {
                                ...candidate,
                                page: Math.max(1, Number(event.target.value) || 1),
                              }
                            : candidate,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Stinger
                  <select
                    value={entry.stingerId}
                    onChange={(event) =>
                      setPageStingers((current) =>
                        current.map((candidate, candidateIndex) =>
                          candidateIndex === index
                            ? { ...candidate, stingerId: event.target.value }
                            : candidate,
                        ),
                      )
                    }
                  >
                    <option value={NO_STINGER_ID}>No stinger</option>
                    {stingers.map((stinger) => (
                      <option key={stinger.id} value={stinger.id}>
                        {stinger.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="button ghost small danger-text"
                  onClick={() =>
                    setPageStingers((current) =>
                      current.filter((_candidate, candidateIndex) => candidateIndex !== index),
                    )
                  }
                  title="Remove this page override"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button ghost small"
              onClick={() =>
                setPageStingers((current) => [
                  ...current,
                  {
                    page:
                      current.reduce((highest, entry) => Math.max(highest, entry.page), 0) + 1,
                    stingerId: stingers[0]?.id ?? NO_STINGER_ID,
                  },
                ])
              }
              title="Add a stinger override for one page"
            >
              Add page override
            </button>
          </details>
          {item.kind === "image" && (
            <>
              {content && (
                <img
                  className="image-edit-preview"
                  src={`/display/images/file?path=${encodeURIComponent(content)}`}
                  alt={displayTitle}
                />
              )}
              <label>
                Image
                <select value={content} onChange={(event) => setContent(event.target.value)}>
                  <option value="">Choose an image…</option>
                  {images.map((image) => (
                    <option key={image.path} value={image.path}>
                      {image.path}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Image display
                <select
                  value={imageFit}
                  onChange={(event) =>
                    setImageFit(event.target.value as "scale" | "actual" | "crop" | "stretch")
                  }
                >
                  <option value="scale">Scale to screen (default)</option>
                  <option value="actual">1:1 actual size</option>
                  <option value="crop">Crop to fill</option>
                  <option value="stretch">Stretch to fill</option>
                </select>
              </label>
              <label>
                Upload replacement
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    try {
                      const uploaded = await onUploadImage(file);
                      setContent(uploaded.path);
                      if (!title.trim()) setTitle(uploaded.name);
                      notify("Image uploaded");
                    } catch (error) {
                      notify(
                        error instanceof ApiError ? error.message : "Could not upload image",
                        "error",
                      );
                    }
                  }}
                />
              </label>
              <label>
                Notes
                <input
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Optional"
                />
              </label>
            </>
          )}
          {item.kind === "image_list" && (
            <>
              {listImages[0] && (
                <img
                  className="image-edit-preview"
                  src={`/display/images/file?path=${encodeURIComponent(listImages[0].path)}`}
                  alt={displayTitle}
                />
              )}
              <label>
                Folder
                <select
                  value={folderKey(listFolder)}
                  onChange={(event) => {
                    const folder = folderFromKey(event.target.value);
                    setListFolder(folder);
                    if (!title.trim()) setTitle(folderLabel(folder));
                  }}
                >
                  <option value="">Choose a folder…</option>
                  {imageFolderOptions(images).map((folder) => (
                    <option key={folderKey(folder)} value={folderKey(folder)}>
                      {folderLabel(folder)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Image display
                <select
                  value={imageFit}
                  onChange={(event) =>
                    setImageFit(event.target.value as "scale" | "actual" | "crop" | "stretch")
                  }
                >
                  <option value="scale">Scale to screen (default)</option>
                  <option value="actual">1:1 actual size</option>
                  <option value="crop">Crop to fill</option>
                  <option value="stretch">Stretch to fill</option>
                </select>
              </label>
              <div className="image-list-options">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={listAutoplay}
                    onChange={(event) => setListAutoplay(event.target.checked)}
                  />
                  Autoplay
                </label>
                <label>
                  Mode
                  <select
                    value={listMode}
                    onChange={(event) => setListMode(event.target.value as PlaybackMode)}
                  >
                    <option value="single">Single</option>
                    <option value="loop">Loop</option>
                    <option value="bounce">Bounce</option>
                  </select>
                </label>
                <label>
                  Delay (seconds)
                  <input
                    type="number"
                    min={1}
                    max={300}
                    value={listDelay}
                    onChange={(event) =>
                      setListDelay(Math.max(1, Math.min(300, Number(event.target.value) || 6)))
                    }
                  />
                </label>
              </div>
              <p className="hint">
                {listImages.length} image{listImages.length === 1 ? "" : "s"} selected
                {listImages.length === 0 ? " — choose a folder with images" : ""}.
              </p>
              <label>
                Notes
                <input
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Optional"
                />
              </label>
            </>
          )}
          {item.kind === "tarp" && (
            <>
              <label>
                Presentation
                <select
                  value={tarpPresentationId}
                  onChange={(event) => {
                    const id = event.target.value;
                    setTarpPresentationId(id);
                    if (!title.trim()) {
                      const presentation = tarpPresentations.find((entry) => entry.id === id);
                      if (presentation) setTitle(presentation.name);
                    }
                  }}
                >
                  <option value="">Choose a Tarp presentation…</option>
                  {tarpPresentations.map((presentation) => (
                    <option key={presentation.id} value={presentation.id}>
                      {presentation.name} · {presentation.pageCount} page
                      {presentation.pageCount === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              </label>
              <div className="image-list-options">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={tarpAutoplay}
                    onChange={(event) => setTarpAutoplay(event.target.checked)}
                  />
                  Autoplay
                </label>
                <label>
                  Mode
                  <select
                    value={tarpMode}
                    onChange={(event) => setTarpMode(event.target.value as PlaybackMode)}
                  >
                    <option value="single">Single</option>
                    <option value="loop">Loop</option>
                    <option value="bounce">Bounce</option>
                  </select>
                </label>
                <label>
                  Delay (seconds)
                  <input
                    type="number"
                    min={1}
                    max={300}
                    value={tarpDelay}
                    onChange={(event) =>
                      setTarpDelay(Math.max(1, Math.min(300, Number(event.target.value) || 6)))
                    }
                  />
                </label>
              </div>
              <p className="hint">
                Tarp items use the referenced presentation&apos;s normal and lower-third views. The
                normal view is used on full/two-thirds/stage; the lower-third view is used on the
                lower-third output.
              </p>
              <label>
                Notes
                <input
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Optional"
                />
              </label>
            </>
          )}
          {(item.kind === "song" || item.kind === "text") && (
            <>
              <label>
                Background override
                <select
                  value={backgroundId}
                  onChange={(event) => setBackgroundId(event.target.value)}
                >
                  <option value="">Use set-list background</option>
                  <option value={NO_BACKGROUND_ID}>No background</option>
                  {backgrounds.map((background) => (
                    <option key={background.id} value={background.id}>
                      {background.name}
                    </option>
                  ))}
                </select>
              </label>
              {item.kind === "text" && (
            <>
              <label>
                Text format
                <select
                  value={format}
                  onChange={(event) => setFormat(event.target.value as TextFormat)}
                >
                  <option value="markdown">Markdown (default)</option>
                  <option value="text">Plain text</option>
                  <option value="html">HTML</option>
                  <option value="rst">reStructuredText</option>
                </select>
              </label>
              <label>
                Alignment
                <select
                  value={textAlign}
                  onChange={(event) => setTextAlign(event.target.value as "left" | "center")}
                >
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                </select>
              </label>
            </>
          )}
          <div className="page-field">
            <span className="field-label">{item.kind === "song" ? "Lyrics" : "Text"}</span>
            <PageContentEditor
              value={content}
              onChange={setContent}
              rows={item.kind === "song" ? 12 : 8}
              textareaClassName="setlist-item-content"
              placeholder={item.kind === "song" ? "Song lyrics and chords…" : "Text or rich text…"}
            />
          </div>
          <div className="setlist-item-settings">
            <label>
              Key
              <input
                value={keyOverride}
                placeholder="auto"
                onChange={(event) => setKeyOverride(event.target.value)}
              />
            </label>
            <label>
              Transpose
              <input
                type="number"
                min={-24}
                max={24}
                value={transpose}
                onChange={(event) => setTranspose(Number(event.target.value))}
              />
            </label>
            {item.kind === "song" && (song?.verseOrders.length ?? 0) > 0 && (
              <label>
                Saved verse order
                <select
                  value={verseOrderId}
                  onChange={(event) => {
                    setVerseOrderId(event.target.value);
                    const chosen = song?.verseOrders.find((entry) => entry.id === event.target.value);
                    setVerseOrder(chosen ? chosen.order : "");
                  }}
                >
                  <option value="">Song default</option>
                  {song?.verseOrders.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} — {entry.order}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Verse order
              <input
                value={verseOrder}
                onChange={(event) => {
                  setVerseOrder(event.target.value);
                  setVerseOrderId("");
                }}
                placeholder="auto"
                title={
                  generatedVerseOrder
                    ? "Generated from the song's pages in source order. Edit to reorder; saving keeps this order for this set-list item."
                    : undefined
                }
              />
            </label>
            <label className="grow">
              Notes
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional"
              />
            </label>
          </div>
            </>
          )}
          <div className="setlist-item-edit-actions">
            <button className="button ghost" onClick={closeEditor} title="Discard changes and close the editor">
              Cancel
            </button>
            <button
              className="button"
              onClick={saveLocal}
              disabled={saving}
              title="Save changes only to this set list item"
            >
              {saving ? "Saving…" : "Save local"}
            </button>
            {item.kind === "song" && item.songId && (
              <button
                className="button primary"
                onClick={saveInventory}
                disabled={saving}
                title="Save these song changes back to the shared song library"
              >
                {saving ? "Saving…" : "Save to song library"}
              </button>
            )}
          </div>
        </div>
      )}

      {altOpen && (
        <div
          className="alt-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAltOpen(false);
          }}
        >
          <div className="alt-modal" role="dialog" aria-modal="true">
            <div className="alt-modal-heading">
              <div>
                <h3>Alternative versions</h3>
                <p className="muted">
                  Comparing against “{item.title || song?.title || displayTitle}”. Choose another
                  local song with a similar title.
                </p>
              </div>
              <button
                className="button ghost small"
                onClick={() => setAltOpen(false)}
                title="Close alternatives"
              >
                Close
              </button>
            </div>
            {altLoading && <p className="muted">Looking for similar songs…</p>}
            {!altLoading && !alternatives.length && (
              <p className="muted">
                No other local songs with similar titles were found for this song.
              </p>
            )}
            {!altLoading && alternatives.length > 0 && (
              <div className="alt-list">
                {alternatives.map((alternative) => {
                  const diff =
                    altDiffId === alternative.id
                      ? diffLyrics(currentLyrics, alternative.lyrics)
                      : null;
                  const changedLines =
                    diff?.filter((line) => line.type !== "same").length ?? 0;
                  const metadata: Array<[string, string, string]> = [
                    ["Title", item.title || song?.title || "", alternative.title],
                    ["Author", song?.author ?? "", alternative.author ?? ""],
                    ["CCLI", song?.ccli ?? "", alternative.ccli ?? ""],
                    ["Key", song?.key ?? "", alternative.key ?? ""],
                    [
                      "Alternate titles",
                      song?.alternateTitles ?? "",
                      alternative.alternateTitles ?? "",
                    ],
                  ];
                  return (
                    <article key={alternative.id} className="alt-card">
                      <div className="alt-card-heading">
                        <div>
                          <strong>{alternative.title}</strong>
                          <span className="muted">
                            {alternative.author || "Unknown author"}
                            {alternative.ccli ? ` · CCLI ${alternative.ccli}` : ""}
                            {alternative.key ? ` · key ${alternative.key}` : ""}
                          </span>
                          {alternative.alternateTitles && (
                            <span className="alt-alias">
                              Also known as: {alternative.alternateTitles}
                            </span>
                          )}
                          <span className="alt-first-lines">{alternative.firstLines}</span>
                        </div>
                        <div className="button-row">
                          <button
                            className="button ghost small"
                            onClick={() =>
                              setAltDiffId((current) =>
                                current === alternative.id ? null : alternative.id,
                              )
                            }
                            title="Show what is different from the current song"
                          >
                            {altDiffId === alternative.id ? "Hide difference" : "Difference"}
                          </button>
                          <button
                            className="button primary small"
                            onClick={() => chooseAlternative(alternative)}
                            disabled={replacingAltId !== null}
                            title={`Use “${alternative.title}” for this set-list item`}
                          >
                            {replacingAltId === alternative.id ? "Changing…" : "Use this version"}
                          </button>
                        </div>
                      </div>
                      {alternative.reasons.length > 0 && (
                        <p className="alt-reasons">{alternative.reasons.join(" · ")}</p>
                      )}
                      {diff && (
                        <div className="alt-diff">
                          <table className="alt-diff-meta">
                            <thead>
                              <tr>
                                <th></th>
                                <th>Current</th>
                                <th>Alternative</th>
                              </tr>
                            </thead>
                            <tbody>
                              {metadata.map(([label, current, next]) => (
                                <tr key={label}>
                                  <th>{label}</th>
                                  <td className={current !== next ? "diff-changed" : ""}>
                                    {current || "—"}
                                  </td>
                                  <td className={current !== next ? "diff-changed" : ""}>
                                    {next || "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {changedLines === 0 ? (
                            <p className="muted">Lyrics are identical.</p>
                          ) : (
                            <div className="alt-diff-lines">
                              <div className="alt-diff-summary">
                                {changedLines} changed or reordered lyric lines
                              </div>
                              {diff.map((line, index) => (
                                <div
                                  key={`${index}-${line.type}`}
                                  className={`alt-diff-line ${line.type}`}
                                >
                                  <span className="alt-diff-marker" aria-hidden="true">
                                    {line.type === "removed" ? "−" : line.type === "added" ? "+" : " "}
                                  </span>
                                  <span>{line.text || " "}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SetlistsPage({
  live,
  onStarted,
  notify,
}: {
  live: LiveState;
  onStarted: (state: LiveState) => void;
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const { canWrite } = usePageAccess();
  const { songSelectEnabled } = useAdapters();
  const [setlists, setSetlists] = useState<SetlistSummary[]>([]);
  const [selectedId, setSelectedId] = useSessionState<string | null>(
    "setlists:selected",
    null,
  );
  const [detail, setDetail] = useState<SetlistDetail | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [backgrounds, setBackgrounds] = useState<BackgroundAsset[]>([]);
  const [stingers, setStingers] = useState<StingerAsset[]>([]);
  const [revisions, setRevisions] = useState<SetlistRevisionInfo[]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<SetlistImportPreview | null>(null);
  const [importReport, setImportReport] = useState<SetlistImportReport | null>(null);
  const [importing, setImporting] = useState(false);
  const [creatingSongPdf, setCreatingSongPdf] = useState(false);
  const [songPdfFontSize, setSongPdfFontSize] = useState(15);
  const [songPdfColumns, setSongPdfColumns] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [siteProvider, setSiteProvider] = useState<SiteScraperProviderSummary | null>(null);
  const [siteUpdatingSongId, setSiteUpdatingSongId] = useState<string | null>(null);

  const [newName, setNewName] = useState(() => defaultSetlistName(today()));
  const [newNameEdited, setNewNameEdited] = useState(false);
  const [newDate, setNewDate] = useState(today());
  const [newTime, setNewTime] = useState("");

  const [name, setName] = useState("");
  const [serviceDate, setServiceDate] = useState(today());
  const [serviceTime, setServiceTime] = useState("");
  const [notes, setNotes] = useState("");
  const [backgroundId, setBackgroundId] = useState("");
  const [stingerId, setStingerId] = useState("");

  const [addKind, setAddKind] = useState<
    "song" | "text" | "bible" | "image" | "image_list" | "tarp"
  >("song");
  const [songToAdd, setSongToAdd] = useState("");
  const [imageToAdd, setImageToAdd] = useState("");
  const [imageTitle, setImageTitle] = useState("");
  const [imageFitAdd, setImageFitAdd] = useState<"scale" | "actual" | "crop" | "stretch">("scale");
  const [imageListFolder, setImageListFolder] = useState<string | null>(null);
  const [imageListTitle, setImageListTitle] = useState("");
  const [imageListAutoplay, setImageListAutoplay] = useState(false);
  const [imageListMode, setImageListMode] = useState<PlaybackMode>("loop");
  const [imageListDelay, setImageListDelay] = useState(6);
  const [tarpPresentations, setTarpPresentations] = useState<TarpPresentationSummary[]>([]);
  const [tarpToAdd, setTarpToAdd] = useState("");
  const [tarpTitle, setTarpTitle] = useState("");
  const [tarpAutoplay, setTarpAutoplay] = useState(false);
  const [tarpMode, setTarpMode] = useState<PlaybackMode>("loop");
  const [tarpDelay, setTarpDelay] = useState(6);
  const [bibleTranslations, setBibleTranslations] = useState<BibleTranslationInfo[]>([]);
  const [bibleTranslation, setBibleTranslation] = useState("");
  const [bibleBooks, setBibleBooks] = useState<BibleBook[]>([]);
  const [bibleBook, setBibleBook] = useState(1);
  const [bibleChapter, setBibleChapter] = useState(1);
  const [biblePassage, setBiblePassage] = useState<BiblePassage | null>(null);
  const [bibleFrom, setBibleFrom] = useState(1);
  const [bibleTo, setBibleTo] = useState(1);
  const [bibleIncludeReference, setBibleIncludeReference] = useState(true);
  const [bibleLayout, setBibleLayout] = useState<BibleLayout>("verses");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [songSearch, setSongSearch] = useState("");
  const [songSearchFields, setSongSearchFields] = useState({
    title: true,
    firstLines: true,
    alternateTitles: true,
    body: false,
  });
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const [textFormat, setTextFormat] = useState<TextFormat>("markdown");
  const [textAlign, setTextAlign] = useState<"left" | "center">("left");

  async function loadList(select?: string) {
    const result = await api.setlists();
    setSetlists(result.setlists);
    const next =
      select ??
      (selectedId && result.setlists.some((setlist) => setlist.id === selectedId)
        ? selectedId
        : result.setlists[0]?.id ?? null);
    setSelectedId(next);
    if (next) await loadDetail(next);
    else setDetail(null);
    setLoading(false);
  }

  async function loadDetail(id: string) {
    const result = await api.setlist(id);
    setDetail(result.setlist);
    setName(result.setlist.name);
    setServiceDate(result.setlist.serviceDate);
    setServiceTime(result.setlist.serviceTime ?? "");
    setNotes(result.setlist.notes ?? "");
    setBackgroundId(result.setlist.backgroundId ?? "");
    setStingerId(result.setlist.stingerId ?? "");
    api
      .revisions(id)
      .then((revisionResult) => setRevisions(revisionResult.revisions))
      .catch(() => setRevisions([]));
  }

  async function updateSongFromSelect(song: Song) {
    if (!siteProvider) return;
    setSiteUpdatingSongId(song.id);
    try {
      if (await checkAndUpdateSongFromSite(siteProvider, song.id, song.title, notify)) {
        const songResult = await api.songs();
        setSongs(songResult.songs);
        if (selectedId) await loadDetail(selectedId);
      }
    } finally {
      setSiteUpdatingSongId(null);
    }
  }

  useEffect(() => {
    loadList().catch((error) => {
      notify(error instanceof ApiError ? error.message : "Could not load set lists", "error");
      setLoading(false);
    });
    api.songs().then((result) => setSongs(result.songs)).catch(() => undefined);
    api.images().then((result) => setImages(result.images)).catch(() => undefined);
    api
      .backgrounds()
      .then((result) => setBackgrounds(result.backgrounds))
      .catch(() => undefined);
    api
      .stingers()
      .then((result) => setStingers(result.stingers))
      .catch(() => undefined);
    api
      .tarpPresentations()
      .then((result) => setTarpPresentations(result.presentations))
      .catch(() => undefined);
    api
      .settings()
      .then((result) => {
        setSongPdfFontSize(result.settings.songSheetFontSize);
        setSongPdfColumns(result.settings.songSheetColumns);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!songSelectEnabled) {
      setSiteProvider(null);
      return;
    }
    void loadActiveSiteProvider().then(setSiteProvider);
  }, [songSelectEnabled]);

  useEffect(() => {
    if (addKind !== "bible" || bibleTranslations.length) return;
    Promise.all([
      api.bibleTranslations(),
      api.settings().catch(() => null),
    ])
      .then(([result, settings]) => {
        setBibleTranslations(result.translations);
        const preferred = settings?.settings.defaultBibleTranslation ?? null;
        const initial =
          result.translations.find((translation) => translation.code === preferred) ??
          result.translations[0];
        if (initial) setBibleTranslation(initial.code);
        if (!result.translations.length) {
          notify("No Bible translations found in the Bible folder", "error");
        }
      })
      .catch((error) =>
        notify(error instanceof ApiError ? error.message : "Could not load translations", "error"),
      );
  }, [addKind, bibleTranslations.length]);

  useEffect(() => {
    if (!bibleTranslation) return;
    api
      .bibleBooks(bibleTranslation)
      .then((result) => {
        setBibleBooks(result.books);
        const first = result.books[0];
        if (first) {
          setBibleBook(first.number);
          setBibleChapter(1);
        }
      })
      .catch(() => undefined);
  }, [bibleTranslation]);

  useEffect(() => {
    if (!bibleTranslation || !bibleBook || !bibleChapter) return;
    setBiblePassage(null);
    api
      .bibleChapter(bibleTranslation, bibleBook, bibleChapter)
      .then((result) => {
        setBiblePassage(result.passage);
        const first = result.passage.verses[0]?.number ?? 1;
        const last = result.passage.verses.at(-1)?.number ?? first;
        setBibleFrom(first);
        setBibleTo(last);
      })
      .catch(() => undefined);
  }, [bibleTranslation, bibleBook, bibleChapter]);

  async function uploadImage(file: File, folder = "setlists"): Promise<ImageAsset> {
    const result = await api.uploadImage(file, folder);
    setImages((current) => [...current, result.image].sort((a, b) => a.path.localeCompare(b.path)));
    return result.image;
  }

  async function createSetlist() {
    try {
      const result = await api.createSetlist({
        name: newName.trim() || defaultSetlistName(newDate),
        serviceDate: newDate,
        serviceTime: newTime || undefined,
      });
      setNewName(defaultSetlistName(newDate));
      setNewNameEdited(false);
      await loadList(result.setlist.id);
      notify("Set list created");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not create set list", "error");
    }
  }

  async function saveMeta() {
    if (!detail) return;
    try {
      const result = await api.updateSetlist(detail.id, {
        name,
        serviceDate,
        serviceTime: serviceTime || null,
        notes: notes || null,
        backgroundId: backgroundId || null,
        stingerId: stingerId || null,
      });
      setDetail(result.setlist);
      await loadList(detail.id);
      notify("Set list saved");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save set list", "error");
    }
  }

  async function addSong() {
    if (!detail || !songToAdd) return;
    try {
      const result = await api.addItem(detail.id, { kind: "song", songId: songToAdd });
      setDetail(result.setlist);
      setSongToAdd("");
      await loadList(detail.id);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not add song", "error");
    }
  }

  async function addImage() {
    if (!detail || !imageToAdd) return;
    try {
      const result = await api.addItem(detail.id, {
        kind: "image",
        title: imageTitle.trim() || imageToAdd.split("/").pop() || "Image",
        content: imageToAdd,
        imageFit: imageFitAdd,
      });
      setDetail(result.setlist);
      setImageTitle("");
      setImageToAdd("");
      setImageFitAdd("scale");
      await loadList(detail.id);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not add image", "error");
    }
  }

  async function addImageList() {
    if (!detail || imageListFolder === null) return;
    const listImages = imagesForFolder(images, imageListFolder);
    if (!listImages.length) {
      notify("Choose a folder with images", "error");
      return;
    }
    try {
      const result = await api.addItem(detail.id, {
        kind: "image_list",
        title: imageListTitle.trim() || folderLabel(imageListFolder),
        content: serializeImageListContent({
          folder: imageListFolder,
          images: listImages.map((image) => image.path),
          autoplay: imageListAutoplay,
          mode: imageListMode,
          delaySeconds: imageListDelay,
        }),
        imageFit: "scale",
      });
      setDetail(result.setlist);
      setImageListFolder(null);
      setImageListTitle("");
      setImageListAutoplay(false);
      setImageListMode("loop");
      setImageListDelay(6);
      await loadList(detail.id);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not add image list", "error");
    }
  }

  async function addTarp() {
    if (!detail || !tarpToAdd) return;
    const presentation = tarpPresentations.find((entry) => entry.id === tarpToAdd);
    try {
      const result = await api.addItem(detail.id, {
        kind: "tarp",
        title: tarpTitle.trim() || presentation?.name || "Tarp",
        content: serializeTarpItemContent({
          presentationId: tarpToAdd,
          autoplay: tarpAutoplay,
          mode: tarpMode,
          delaySeconds: tarpDelay,
        }),
      });
      setDetail(result.setlist);
      setTarpToAdd("");
      setTarpTitle("");
      setTarpAutoplay(false);
      setTarpMode("loop");
      setTarpDelay(6);
      await loadList(detail.id);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not add Tarp item", "error");
    }
  }

  function bibleReference(): string {
    if (!biblePassage) return "";
    return `${biblePassage.bookName} ${biblePassage.chapter}:${bibleFrom}${
      bibleTo !== bibleFrom ? `–${bibleTo}` : ""
    } (${biblePassage.translationName})`;
  }

  async function addBible() {
    if (!detail || !biblePassage) return;
    const verses = biblePassage.verses.filter(
      (verse) => verse.number >= bibleFrom && verse.number <= bibleTo,
    );
    if (!verses.length) return;
    const reference = bibleReference();
    const body = formatBibleVerses(verses, bibleLayout);
    try {
      const result = await api.addItem(detail.id, {
        kind: "text",
        title: reference || "Bible passage",
        content: bibleIncludeReference ? `${reference}\n${body}` : body,
        contentSource: "bible",
        format: "text",
      });
      setDetail(result.setlist);
      await loadList(detail.id);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not add Bible passage", "error");
    }
  }

  function addSelectedItem() {
    if (!canAddSelected) return;
    if (addKind === "song") void addSong();
    else if (addKind === "text") void addText();
    else if (addKind === "bible") void addBible();
    else if (addKind === "image") void addImage();
    else if (addKind === "image_list") void addImageList();
    else void addTarp();
  }

  async function addText() {
    if (!detail || !textContent.trim()) return;    const extracted = extractTextHeader(textContent);
    try {
      const result = await api.addItem(detail.id, {
        kind: "text",
        title: textTitle.trim() || "Text",
        content: extracted.content,
        format: extracted.format ?? textFormat,
        textAlign,
      });
      setDetail(result.setlist);
      setTextTitle("");
      setTextContent("");
      setTextFormat("markdown");
      setTextAlign("left");
      await loadList(detail.id);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not add text", "error");
    }
  }

  async function move(item: SetlistItem, direction: -1 | 1) {
    if (!detail) return;
    const items = [...detail.items];
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    try {
      const result = await api.reorder(
        detail.id,
        items.map((candidate) => candidate.id),
      );
      setDetail(result.setlist);
      await loadList(detail.id);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not reorder", "error");
    }
  }

  async function dropItem(targetId: string) {
    const sourceId = dragId;
    setDragId(null);
    setDragOverId(null);
    if (!detail || !sourceId || sourceId === targetId) return;
    const items = [...detail.items];
    const from = items.findIndex((candidate) => candidate.id === sourceId);
    const to = items.findIndex((candidate) => candidate.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    try {
      const result = await api.reorder(
        detail.id,
        items.map((candidate) => candidate.id),
      );
      setDetail(result.setlist);
      await loadList(detail.id);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not reorder", "error");
    }
  }

  async function start() {
    if (!detail) return;
    try {
      const result = await api.startLive(detail.id, "live");
      onStarted(result.state);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not start session", "error");
    }
  }

  async function publish() {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await api.publish(detail.id);
      setRevisions((current) => [result.revision, ...current]);
      notify(`Published revision ${result.revision.revisionNo}`);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not publish", "error");
    } finally {
      setBusy(false);
    }
  }

  async function createSongPdf() {
    if (!detail) return;
    setCreatingSongPdf(true);
    try {
      const { blob, filename } = await api.downloadSetlistSongsPdf(detail.id, {
        fontSize: songPdfFontSize,
        columns: songPdfColumns,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("Song sheet PDF downloaded");
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Could not create the song sheet PDF",
        "error",
      );
    } finally {
      setCreatingSongPdf(false);
    }
  }

  async function chooseImport(file: File | null) {
    if (!canWrite) return;
    setImportFile(file);
    setImportReport(null);
    setImportPreview(null);
    if (!file) return;
    setImporting(true);
    try {
      const result = await api.previewSetlistImport(file);
      setImportPreview(result.preview);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not read set list file", "error");
      setImportFile(null);
    } finally {
      setImporting(false);
    }
  }

  async function confirmImport() {
    if (!importFile || !canWrite) return;
    setImporting(true);
    try {
      const result = await api.importSetlist(importFile);
      setImportReport(result.report);
      setImportPreview(null);
      setImportFile(null);
      await loadList(result.report.setlistId);
      notify(`Imported “${result.report.setlistName}”`);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Import failed", "error");
    } finally {
      setImporting(false);
    }
  }

  async function apply(mode: "after-current" | "now") {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await api.applyLive({ setlistId: detail.id, mode });
      onStarted(result.state);
      const revs = await api.revisions(detail.id);
      setRevisions(revs.revisions);
      notify(
        mode === "now"
          ? "Draft applied immediately"
          : "Update queued — applies after the current item",
      );
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not apply draft", "error");
    } finally {
      setBusy(false);
    }
  }

  const songQuery = songSearch.trim().toLowerCase();
  const filteredSongs = songs.filter((song) => {
    if (!songQuery) return true;
    const fields: string[] = [];
    if (songSearchFields.title) fields.push(song.title);
    if (songSearchFields.alternateTitles) fields.push(song.alternateTitles ?? "");
    if (songSearchFields.firstLines) fields.push(songFirstLines(song));
    if (songSearchFields.body) fields.push(song.lyrics);
    return fields.some((value) => value.toLowerCase().includes(songQuery));
  });
  const imageListFolderImages =
    imageListFolder === null ? [] : imagesForFolder(images, imageListFolder);
  const bibleVerses =
    biblePassage?.verses.filter(
      (verse) => verse.number >= bibleFrom && verse.number <= bibleTo,
    ) ?? [];
  const addKindLabels: Record<typeof addKind, string> = {
    song: "Add song",
    text: "Add text",
    bible: "Add Bible passage",
    image: "Add image",
    image_list: "Add image list",
    tarp: "Add Tarp",
  };
  const canAddSelected =
    addKind === "song"
      ? Boolean(songToAdd)
      : addKind === "text"
        ? Boolean(textContent.trim())
        : addKind === "bible"
          ? bibleVerses.length > 0
          : addKind === "image"
            ? Boolean(imageToAdd) && !uploadingImage
            : addKind === "image_list"
              ? imageListFolderImages.length > 0
              : Boolean(tarpToAdd);

  if (loading) return <div className="panel">Loading set lists…</div>;

  return (
    <div className="two-column">
      <aside className="panel list-panel">
        <div className="panel-heading">
          <h2>Set lists</h2>
          <span className="muted">{setlists.length}</span>
        </div>
        <div className="setlist-list" data-key-list>
          {setlists.map((setlist) => (
            <button
              key={setlist.id}
              data-key-list-item
              className={`setlist-list-item ${setlist.id === selectedId ? "current" : ""}`}
              onClick={() => {
                setSelectedId(setlist.id);
                loadDetail(setlist.id).catch(() => undefined);
              }}
              title={`Edit set list “${setlist.name}”`}
            >
              <strong>{setlist.name}</strong>
              <span>
                {compactDate(setlist.serviceDate)}
                {setlist.serviceTime ? ` · ${setlist.serviceTime}` : ""} · {setlist.itemCount} items
              </span>
            </button>
          ))}
          {!setlists.length && <p className="muted">No set lists yet.</p>}
        </div>
        <ReadOnlyFieldset className="new-setlist">
          <h3>New set list</h3>
          <label>
            Name
            <input
              value={newName}
              onChange={(event) => {
                setNewName(event.target.value);
                setNewNameEdited(true);
              }}
              placeholder={defaultSetlistName(newDate)}
            />
          </label>
          <div className="inline-fields">
            <label>
              Date
              <IsoDateInput
                value={newDate}
                onChange={(nextDate) => {
                  setNewDate(nextDate);
                  if (!newNameEdited) setNewName(defaultSetlistName(nextDate));
                }}
              />
            </label>
            <label>
              Time
              <input type="time" value={newTime} onChange={(event) => setNewTime(event.target.value)} />
            </label>
          </div>
          <button
            className="button primary full"
            onClick={createSetlist}
            title="Create a new draft set list with the entered name, date and time"
          >
            Create
          </button>
        </ReadOnlyFieldset>

        <div className="big-print-pdf">
          <h3>Big Print PDF</h3>
          <p className="hint">
            Printable song words for elderly members. Size and columns apply only to this download;
            defaults live in Settings.
          </p>
          <div className="big-print-controls">
            <label>
              Text size
              <input
                type="number"
                min={8}
                max={28}
                value={songPdfFontSize}
                onChange={(event) =>
                  setSongPdfFontSize(
                    Math.max(8, Math.min(28, Number(event.target.value) || 15)),
                  )
                }
              />
            </label>
            <label>
              Columns
              <select
                value={songPdfColumns}
                onChange={(event) => setSongPdfColumns(Number(event.target.value))}
              >
                <option value={1}>1 column</option>
                <option value={2}>2 columns</option>
                <option value={3}>3 columns</option>
              </select>
            </label>
            <button
              className="button primary small"
              onClick={createSongPdf}
              disabled={!detail || creatingSongPdf || !detail.items.some((item) => item.kind === "song")}
              title={
                detail?.items.some((item) => item.kind === "song")
                  ? "Download a printable PDF containing the words of every song in this service"
                  : "Add at least one song to create a song sheet"
              }
            >
              {creatingSongPdf ? "Creating PDF…" : "Create PDF of the songs"}
            </button>
          </div>
        </div>

        <div className="transfer-panel">
          <h3>Share / backup</h3>
          {detail && (
            <div className="button-row">
              <a
                className="button ghost small"
                href={api.exportSetlistUrl(detail.id, "json")}
                title="Download this set list as a JSON reference file"
              >
                Export JSON
              </a>
              <a
                className="button ghost small"
                href={api.exportSetlistUrl(detail.id, "bundle")}
                title="Download a self-contained bundle with songs and assets"
              >
                Export bundle
              </a>
            </div>
          )}
          <ReadOnlyFieldset>
            <label
              className="button ghost full file-button"
              title={
                canWrite
                  ? "Choose a JSON or ZIP set-list file to preview before importing"
                  : "Read-only access to set lists"
              }
            >
              {importing ? "Reading…" : "Import set list file"}
              <input
                type="file"
                accept=".json,.zip,.sm-setlist.json,.sm-bundle.zip"
                hidden
                onChange={(event) => chooseImport(event.target.files?.[0] ?? null)}
              />
            </label>
          </ReadOnlyFieldset>

          {importPreview && (
            <div className="import-preview-card">
              <strong>{importPreview.name}</strong>
              <span className="muted">
                {compactDate(importPreview.serviceDate)}
                {importPreview.serviceTime ? ` · ${importPreview.serviceTime}` : ""} · {importPreview.itemCount}{" "}
                items
              </span>
              <span className="muted">
                {importPreview.songCount} songs ({importPreview.songs.filter((song) => song.matched).length}{" "}
                matched), {importPreview.textCount} text
              </span>
              {!importPreview.selfContained && (
                <span className="hint">Reference file — unmatched songs import as text placeholders.</span>
              )}
              <div className="button-row">
                <button
                  className="button ghost small"
                  onClick={() => chooseImport(null)}
                  title="Cancel this import preview"
                >
                  Cancel
                </button>
                <button
                  className="button primary small"
                  onClick={confirmImport}
                  disabled={!canWrite || importing}
                  title={
                    canWrite
                      ? "Import this file as a new draft set list"
                      : "Read-only access to set lists"
                  }
                >
                  Import as new draft
                </button>
              </div>
            </div>
          )}

          {importReport && (
            <div className="import-preview-card">
              <strong>Imported “{importReport.setlistName}”</strong>
              <span className="muted">
                {importReport.importedItems} items · {importReport.songsMatched} matched ·{" "}
                {importReport.songsCreated} new songs · {importReport.assetsImported} assets
              </span>
              {importReport.skipped.length > 0 && (
                <details>
                  <summary>{importReport.skipped.length} skipped</summary>
                  <ul>
                    {importReport.skipped.map((item, index) => (
                      <li key={`${item.title}-${index}`}>
                        {item.title} — {item.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      </aside>

      {detail ? (
        <ReadOnlyFieldset className="panel editor-panel">
          <div className="panel-heading">
            <h2>{detail.name}</h2>
            <div className="button-row">
              <button
                className="button ghost"
                onClick={publish}
                disabled={busy}
                title="Publish a new revision of this set list without changing the live session"
              >
                Publish
              </button>
              {live.status !== "idle" && live.setlistId === detail.id ? (
                <>
                  <button
                    className="button primary"
                    onClick={() => apply("now")}
                    disabled={busy}
                    title="Replace the live session with this draft immediately"
                  >
                    Send to live session
                  </button>
                  <button
                    className="button ghost"
                    onClick={() => apply("after-current")}
                    disabled={busy}
                    title="Queue this draft to apply automatically after the current live item"
                  >
                    Add to live
                  </button>
                </>
              ) : (
                <button
                  className="button primary"
                  onClick={start}
                  title="Start a new live session using this set list"
                >
                  Start live
                </button>
              )}
            </div>
          </div>

          {live.pendingUpdate && live.setlistId === detail.id && (
            <div className="banner">
              A published update is queued (revision {live.pendingRevision ?? "?"}); it will apply after the
              current item.
            </div>
          )}

          {revisions.length > 0 && (
            <details className="revision-list">
              <summary>{revisions.length} published revisions</summary>
              <ul>
                {revisions.map((revision) => (
                  <li key={revision.id}>
                    Revision {revision.revisionNo} · {revision.itemCount} items ·{" "}
                    {compactDateTime(revision.createdAt)}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="meta-grid">
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Date
              <IsoDateInput value={serviceDate} onChange={setServiceDate} />
            </label>
            <label>
              Time
              <input type="time" value={serviceTime} onChange={(event) => setServiceTime(event.target.value)} />
            </label>
            <label>
              Background
              <select
                value={backgroundId}
                onChange={(event) => setBackgroundId(event.target.value)}
              >
                <option value="">No background</option>
                {backgrounds.map((background) => (
                  <option key={background.id} value={background.id}>
                    {background.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Stinger
              <select value={stingerId} onChange={(event) => setStingerId(event.target.value)}>
                <option value="">No stinger</option>
                {stingers.map((stinger) => (
                  <option key={stinger.id} value={stinger.id}>
                    {stinger.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grow">
              Notes
              <input value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
            <button
              className="button ghost"
              onClick={saveMeta}
              title="Save the set-list name, date, time and notes"
            >
              Save details
            </button>
          </div>

          <div className="items">
            {detail.items.map((item, index) => (
              <ItemRow
                key={item.id}
                item={item}
                song={songs.find((song) => song.id === item.songId)}
                images={images}
                backgrounds={backgrounds}
                stingers={stingers}
                tarpPresentations={tarpPresentations}
                siteProvider={siteProvider}
                siteUpdatingSongId={siteUpdatingSongId}
                onUpdateFromSite={updateSongFromSelect}
                onUploadImage={(file) => uploadImage(file)}
                first={index === 0}
                last={index === detail.items.length - 1}
                dragging={dragId === item.id}
                dragOver={dragOverId === item.id && dragId !== item.id}
                onDragStart={() => setDragId(item.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setDragOverId(null);
                }}
                onDragOver={() => setDragOverId(item.id)}
                onDrop={() => dropItem(item.id)}
                onMove={(direction) => move(item, direction)}
                onDelete={async () => {
                  try {
                    const result = await api.deleteItem(detail.id, item.id);
                    setDetail(result.setlist);
                    await loadList(detail.id);
                  } catch (error) {
                    notify(error instanceof ApiError ? error.message : "Could not remove item", "error");
                  }
                }}
                onSave={async (payload) => {
                  const result = await api.patchItem(detail.id, item.id, payload);
                  setDetail(result.setlist);
                  await loadList(detail.id);
                  notify("Saved to this set list");
                }}
                onSaveInventory={async (payload) => {
                  const result = await api.saveItemToInventory(detail.id, item.id, payload);
                  setDetail(result.setlist);
                  await loadList(detail.id);
                  api
                    .songs()
                    .then((songResult) => setSongs(songResult.songs))
                    .catch(() => undefined);
                  notify("Song library updated");
                }}
                onSongReplaced={async (songId) => {
                  const result = await api.replaceSetlistSong(detail.id, item.id, songId);
                  setDetail(result.setlist);
                  await loadList(detail.id);
                }}
                notify={notify}
              />
            ))}
            {!detail.items.length && <p className="muted">Add an item below.</p>}
          </div>

          <div className="add-item-block">
            <div className="add-card add-item-card">
              <div className="add-item-heading">
                <h3>Add</h3>
                <div className="add-kind-tabs" role="group" aria-label="Item type to add">
                  {(
                    [
                      ["song", "Song"],
                      ["text", "Text"],
                      ["bible", "Bible passage"],
                      ["image", "Image"],
                      ["image_list", "Image list"],
                      ["tarp", "Tarp"],
                    ] as const
                  ).map(([kind, label]) => (
                    <button
                      key={kind}
                      type="button"
                      className={`add-kind-tab ${addKind === kind ? "active" : ""}`}
                      aria-pressed={addKind === kind}
                      onClick={() => setAddKind(kind)}
                      title={`Add ${/^[aeiou]/i.test(label) ? "an" : "a"} ${label.toLowerCase()} item`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {addKind === "song" && (
                <>
                  <input
                    className="search"
                    value={songSearch}
                    onChange={(event) => setSongSearch(event.target.value)}
                    placeholder="Search songs…"
                  />
                  <div className="song-search-fields">
                    {(
                      [
                        ["title", "Titles"],
                        ["firstLines", "First lines"],
                        ["alternateTitles", "Alternative titles"],
                        ["body", "Body / lyrics"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="checkbox">
                        <input
                          type="checkbox"
                          checked={songSearchFields[key]}
                          onChange={(event) =>
                            setSongSearchFields((current) => ({
                              ...current,
                              [key]: event.target.checked,
                            }))
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <span className="hint">
                    {songQuery
                      ? `${filteredSongs.length} match${filteredSongs.length === 1 ? "" : "es"}`
                      : `${songs.length} songs`}
                  </span>
                  <select value={songToAdd} onChange={(event) => setSongToAdd(event.target.value)}>
                    <option value="">Choose a song…</option>
                    {filteredSongs.map((song) => (
                      <option key={song.id} value={song.id}>
                        {song.title}
                        {song.author ? ` — ${song.author}` : ""}
                      </option>
                    ))}
                  </select>
                  {songQuery && !filteredSongs.length && (
                    <span className="hint">No songs match the selected search fields.</span>
                  )}
                </>
              )}

              {addKind === "text" && (
                <>
                  <input
                    value={textTitle}
                    onChange={(event) => setTextTitle(event.target.value)}
                    placeholder="Title (optional)"
                  />
                  <select
                    value={textFormat}
                    onChange={(event) => setTextFormat(event.target.value as TextFormat)}
                  >
                    <option value="markdown">Markdown (default)</option>
                    <option value="text">Plain text</option>
                    <option value="html">HTML</option>
                    <option value="rst">reStructuredText</option>
                  </select>
                  <select
                    value={textAlign}
                    onChange={(event) => setTextAlign(event.target.value as "left" | "center")}
                  >
                    <option value="left">Align left</option>
                    <option value="center">Centre</option>
                  </select>
                  <div className="page-field">
                    <span className="field-label">Text pages</span>
                    <PageContentEditor
                      value={textContent}
                      onChange={setTextContent}
                      rows={4}
                      placeholder={"# Welcome\n\n**Please stand** as we begin."}
                    />
                  </div>
                  <span className="hint">
                    A leading <code>format: markdown</code> header is moved into the format setting
                    automatically. Use <code>&lt;!-- page --&gt;</code> for a page break.
                  </span>
                </>
              )}

              {addKind === "bible" && (
                <>
                  <label>
                    Translation
                    <select
                      value={bibleTranslation}
                      onChange={(event) => setBibleTranslation(event.target.value)}
                    >
                      {!bibleTranslations.length && <option value="">No translations found</option>}
                      {bibleTranslations.map((translation) => (
                        <option key={translation.code} value={translation.code}>
                          {translation.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="inline-fields">
                    <label>
                      Book
                      <select
                        value={bibleBook}
                        onChange={(event) => {
                          setBibleBook(Number(event.target.value));
                          setBibleChapter(1);
                        }}
                      >
                        {bibleBooks.map((book) => (
                          <option key={book.number} value={book.number}>
                            {book.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Chapter
                      <select
                        value={bibleChapter}
                        onChange={(event) => setBibleChapter(Number(event.target.value))}
                      >
                        {Array.from(
                          {
                            length:
                              bibleBooks.find((book) => book.number === bibleBook)?.chapters ?? 0,
                          },
                          (_, index) => index + 1,
                        ).map((chapter) => (
                          <option key={chapter} value={chapter}>
                            {chapter}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="inline-fields">
                    <label>
                      From verse
                      <select
                        value={bibleFrom}
                        onChange={(event) => setBibleFrom(Number(event.target.value))}
                      >
                        {(biblePassage?.verses ?? []).map((verse) => (
                          <option key={verse.number} value={verse.number}>
                            {verse.number}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      To verse
                      <select
                        value={bibleTo}
                        onChange={(event) => setBibleTo(Number(event.target.value))}
                      >
                        {(biblePassage?.verses ?? []).map((verse) => (
                          <option key={verse.number} value={verse.number}>
                            {verse.number}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={bibleIncludeReference}
                      onChange={(event) => setBibleIncludeReference(event.target.checked)}
                    />
                    Include reference
                  </label>
                  <BibleLayoutButtons value={bibleLayout} onChange={setBibleLayout} />
                  <span className="hint">
                    {bibleReference() || "Choose a translation, book, chapter and verse range."}
                  </span>
                </>
              )}

              {addKind === "image" && (
                <>
                  <select value={imageToAdd} onChange={(event) => setImageToAdd(event.target.value)}>
                    <option value="">Choose an image…</option>
                    {images.map((image) => (
                      <option key={image.path} value={image.path}>
                        {image.path}
                      </option>
                    ))}
                  </select>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      setUploadingImage(true);
                      try {
                        const uploaded = await uploadImage(file);
                        setImageToAdd(uploaded.path);
                        setImageTitle(uploaded.name);
                        notify("Image uploaded");
                      } catch (error) {
                        notify(
                          error instanceof ApiError ? error.message : "Could not upload image",
                          "error",
                        );
                      } finally {
                        setUploadingImage(false);
                      }
                    }}
                  />
                  <input
                    value={imageTitle}
                    onChange={(event) => setImageTitle(event.target.value)}
                    placeholder="Title (optional)"
                  />
                  <select
                    value={imageFitAdd}
                    onChange={(event) =>
                      setImageFitAdd(event.target.value as "scale" | "actual" | "crop" | "stretch")
                    }
                  >
                    <option value="scale">Scale to screen (default)</option>
                    <option value="actual">1:1 actual size</option>
                    <option value="crop">Crop to fill</option>
                    <option value="stretch">Stretch to fill</option>
                  </select>
                </>
              )}

              {addKind === "image_list" && (
                <>
                  <select
                    value={imageListFolder === null ? "" : folderKey(imageListFolder)}
                    onChange={(event) => {
                      if (!event.target.value) {
                        setImageListFolder(null);
                        return;
                      }
                      const folder = folderFromKey(event.target.value);
                      setImageListFolder(folder);
                      if (!imageListTitle.trim()) setImageListTitle(folderLabel(folder));
                    }}
                  >
                    <option value="">Choose a folder…</option>
                    {imageFolderOptions(images).map((folder) => (
                      <option key={folderKey(folder)} value={folderKey(folder)}>
                        {folderLabel(folder)}
                      </option>
                    ))}
                  </select>
                  <input
                    value={imageListTitle}
                    onChange={(event) => setImageListTitle(event.target.value)}
                    placeholder="Title (optional)"
                  />
                  <div className="image-list-options">
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={imageListAutoplay}
                        onChange={(event) => setImageListAutoplay(event.target.checked)}
                      />
                      Autoplay
                    </label>
                    <label>
                      Mode
                      <select
                        value={imageListMode}
                        onChange={(event) =>
                          setImageListMode(event.target.value as PlaybackMode)
                        }
                      >
                        <option value="single">Single</option>
                        <option value="loop">Loop</option>
                        <option value="bounce">Bounce</option>
                      </select>
                    </label>
                    <label>
                      Delay (seconds)
                      <input
                        type="number"
                        min={1}
                        max={300}
                        value={imageListDelay}
                        onChange={(event) =>
                          setImageListDelay(
                            Math.max(1, Math.min(300, Number(event.target.value) || 6)),
                          )
                        }
                      />
                    </label>
                  </div>
                  <span className="hint">
                    {imageListFolder === null
                      ? "Choose a folder to create an image list."
                      : `${imageListFolderImages.length} image${
                          imageListFolderImages.length === 1 ? "" : "s"
                        } in ${folderLabel(imageListFolder)}.`}
                  </span>
                </>
              )}

              {addKind === "tarp" && (
                <>
                  <select value={tarpToAdd} onChange={(event) => setTarpToAdd(event.target.value)}>
                    <option value="">Choose a Tarp presentation…</option>
                    {tarpPresentations.map((presentation) => (
                      <option key={presentation.id} value={presentation.id}>
                        {presentation.name} · {presentation.pageCount} page
                        {presentation.pageCount === 1 ? "" : "s"}
                      </option>
                    ))}
                  </select>
                  <input
                    value={tarpTitle}
                    onChange={(event) => setTarpTitle(event.target.value)}
                    placeholder="Title (optional)"
                  />
                  <div className="image-list-options">
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={tarpAutoplay}
                        onChange={(event) => setTarpAutoplay(event.target.checked)}
                      />
                      Autoplay
                    </label>
                    <label>
                      Mode
                      <select
                        value={tarpMode}
                        onChange={(event) => setTarpMode(event.target.value as PlaybackMode)}
                      >
                        <option value="single">Single</option>
                        <option value="loop">Loop</option>
                        <option value="bounce">Bounce</option>
                      </select>
                    </label>
                    <label>
                      Delay (seconds)
                      <input
                        type="number"
                        min={1}
                        max={300}
                        value={tarpDelay}
                        onChange={(event) =>
                          setTarpDelay(Math.max(1, Math.min(300, Number(event.target.value) || 6)))
                        }
                      />
                    </label>
                  </div>
                  <span className="hint">
                    The presentation’s normal view appears on full/two-thirds/stage outputs; its
                    lower-third view appears on the lower-third output.
                  </span>
                </>
              )}

              <div className="add-item-actions">
                <button
                  className="button primary"
                  onClick={addSelectedItem}
                  disabled={!canAddSelected}
                  title={canAddSelected ? addKindLabels[addKind] : "Choose the item content first"}
                >
                  {addKindLabels[addKind]}
                </button>
              </div>
            </div>
          </div>

          <button
            className="button danger-text"
            onClick={async () => {
              if (!confirm(`Delete “${detail.name}”?`)) return;
              await api.deleteSetlist(detail.id);
              setDetail(null);
              setSelectedId(null);
              const result = await api.setlists();
              setSetlists(result.setlists);
              if (result.setlists[0]) {
                setSelectedId(result.setlists[0].id);
                await loadDetail(result.setlists[0].id);
              }
            }}
            title="Delete this set list permanently"
          >
            Delete set list
          </button>
        </ReadOnlyFieldset>
      ) : (
        <section className="panel empty-state">Create a set list to get started.</section>
      )}
    </div>
  );
}
