import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { Server } from "socket.io";
import {
  NO_BACKGROUND_ID,
  NO_STINGER_ID,
  nextPlaybackPage,
  parseImageListContent,
  parseTarpItemContent,
  type PlaybackMode,
} from "@sm/shared";
import type {
  DisplayConfig,
  LiveApplyMode,
  LiveState,
  SetlistRevisionInfo,
  Song,
  TextFormat,
} from "@sm/shared";
import { db } from "./db.js";
import { buildPages, type RenderItem } from "./render.js";
import { resolveTemplates } from "./templates.js";
import { getDisplayConfig } from "./display-config.js";
import { getAppSettings } from "./settings.js";
import { resolveImage } from "./images.js";
import { getBackground } from "./backgrounds.js";
import { getStinger } from "./stingers.js";
import { renderTarpPages } from "./tarp-render.js";

interface SnapshotItem extends RenderItem {
  itemId: string | null;
  songId: string | null;
  backgroundId?: string | null;
  stingerId?: string | null;
  stingerPageOverrides?: Record<string, string>;
  notes: string | null;
}

interface PendingUpdate {
  items: SnapshotItem[];
  revisionId: string | null;
  revisionNo: number | null;
}

interface SessionRecord {
  id: string;
  setlistId: string | null;
  revisionId: string | null;
  setlistName: string;
  status: "live" | "rehearsal";
  items: SnapshotItem[];
  transient: SnapshotItem | null;
  transientReturnItemIndex: number | null;
  pending: PendingUpdate | null;
  state: LiveState;
  autoplayDirection: 1 | -1;
}

function now(): string {
  return new Date().toISOString();
}

export function idleState(): LiveState {
  return {
    sessionId: "",
    setlistId: null,
    setlistName: "",
    status: "idle",
    itemIndex: 0,
    pageIndex: 0,
    pageCount: 0,
    mode: "idle",
    title: "",
    blank: false,
    maxLines: 4,
    transpose: 0,
    footer: "",
    pages: [],
    items: [],
    version: 0,
    updatedAt: now(),
    pendingUpdate: false,
    pendingRevision: null,
  };
}

function summaries(items: SnapshotItem[]): LiveState["items"] {
  return items.map((item, index) => ({
    index,
    kind: item.kind,
    title: item.title,
    notes: item.notes,
  }));
}

function parseStingerOverrides(value: string | null): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([key, entry]) => /^\d+$/.test(key) && typeof entry === "string",
      ),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function resolveSetlistItems(setlistId: string): { name: string; items: SnapshotItem[] } {
  const setlist = db
    .prepare("SELECT id, name, background_id, stinger_id FROM setlists WHERE id = ?")
    .get(setlistId) as
    | { id: string; name: string; background_id: string | null; stinger_id: string | null }
    | undefined;
  if (!setlist) throw new Error("Set list not found");

  const rows = db
    .prepare("SELECT * FROM setlist_items WHERE setlist_id = ? ORDER BY position ASC, rowid ASC")
    .all(setlistId) as Array<{
    id: string;
    kind: "song" | "text" | "image" | "image_list" | "tarp";
    song_id: string | null;
    title: string;
    content: string | null;
    content_source: string | null;
    text_format: string | null;
    text_align: string | null;
    image_fit: string | null;
    background_id: string | null;
    stinger_id: string | null;
    stinger_overrides_json: string | null;
    key_override: string | null;
    transpose: number;
    max_lines: number;
    verse_order: string | null;
    notes: string | null;
  }>;

  const items: SnapshotItem[] = rows.map((row) => {
    if (row.kind === "song" && row.song_id) {
      const song = db.prepare("SELECT * FROM songs WHERE id = ?").get(row.song_id) as
        | (Song & { lyrics_markdown: number })
        | undefined;
      return {
        kind: "song",
        itemId: row.id,
        songId: row.song_id,
        title: row.title || song?.title || "Untitled song",
        // A song item may carry a local lyric override for this set list only.
        lyrics: row.content ?? song?.lyrics ?? "",
        lyricsMarkdown: Boolean(song?.lyrics_markdown),
        key: song?.key ?? null,
        keyOverride: row.key_override,
        transpose: row.transpose,
        maxLines: row.max_lines,
        verseOrder: row.verse_order ?? song?.verseOrder ?? null,
        notes: row.notes,
      };
    }
    if (row.kind === "tarp") {
      return {
        kind: "tarp",
        itemId: row.id,
        songId: null,
        title: row.title || "Tarp",
        content: row.content ?? "",
        transpose: 0,
        maxLines: row.max_lines,
        verseOrder: null,
        notes: row.notes,
      };
    }
    if (row.kind === "image" || row.kind === "image_list") {
      return {
        kind: row.kind,
        itemId: row.id,
        songId: null,
        title: row.title || (row.kind === "image_list" ? "Image list" : "Image"),
        content: row.content ?? "",
        imageFit:
          row.image_fit === "actual" || row.image_fit === "crop" || row.image_fit === "stretch"
            ? row.image_fit
            : "scale",
        transpose: 0,
        maxLines: row.max_lines,
        verseOrder: null,
        notes: row.notes,
      };
    }
    return {
      kind: "text",
      itemId: row.id,
      songId: null,
      title: row.title || "Text",
      content: row.content ?? "",
      format: (row.text_format as TextFormat | null) ?? null,
      textAlign: row.text_align === "center" ? "center" : "left",
      transpose: 0,
      maxLines: row.max_lines,
      verseOrder: null,
      notes: row.notes,
    };
  });

  for (const [index, item] of items.entries()) {
    const row = rows[index];
    item.contentSource = row?.content_source === "bible" ? "bible" : "text";
    const backgroundOverride = row?.background_id;
    item.backgroundId =
      backgroundOverride === NO_BACKGROUND_ID
        ? null
        : backgroundOverride ?? setlist.background_id ?? null;
    const stingerOverride = row?.stinger_id;
    item.stingerId =
      stingerOverride === NO_STINGER_ID
        ? null
        : stingerOverride ?? setlist.stinger_id ?? null;
    item.stingerPageOverrides = parseStingerOverrides(row?.stinger_overrides_json ?? null);
  }

  if (!items.length) throw new Error("Set list is empty");
  return { name: setlist.name, items };
}

function createRevision(
  setlistId: string,
  items: SnapshotItem[],
  userId: string | null,
): { id: string; revisionNo: number } {
  const row = db
    .prepare("SELECT COALESCE(MAX(revision_no), 0) + 1 AS next FROM setlist_revisions WHERE setlist_id = ?")
    .get(setlistId) as { next: number };
  const id = randomUUID();
  db.prepare(
    `INSERT INTO setlist_revisions (id, setlist_id, revision_no, snapshot_json, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, setlistId, row.next, JSON.stringify(items), now(), userId);
  return { id, revisionNo: row.next };
}

function revisionRow(id: string):
  | { id: string; setlist_id: string; revision_no: number; snapshot_json: string; created_at: string; created_by: string | null }
  | undefined {
  return db.prepare("SELECT * FROM setlist_revisions WHERE id = ?").get(id) as
    | {
        id: string;
        setlist_id: string;
        revision_no: number;
        snapshot_json: string;
        created_at: string;
        created_by: string | null;
      }
    | undefined;
}

function mapRevision(row: {
  id: string;
  setlist_id: string;
  revision_no: number;
  snapshot_json: string;
  created_at: string;
  created_by: string | null;
}): SetlistRevisionInfo {
  let count = 0;
  try {
    count = (JSON.parse(row.snapshot_json) as unknown[]).length;
  } catch {
    count = 0;
  }
  return {
    id: row.id,
    setlistId: row.setlist_id,
    revisionNo: row.revision_no,
    itemCount: count,
    createdAt: row.created_at,
    createdBy: row.created_by,
  };
}

interface AutoplayConfig {
  autoplay: boolean;
  mode: PlaybackMode;
  delaySeconds: number;
}

function autoplayConfigFor(item: SnapshotItem | null | undefined): AutoplayConfig | null {
  if (!item) return null;
  if (item.kind === "image_list") {
    const list = parseImageListContent(item.content);
    return list
      ? { autoplay: list.autoplay, mode: list.mode, delaySeconds: list.delaySeconds }
      : null;
  }
  if (item.kind === "tarp") {
    const tarp = parseTarpItemContent(item.content);
    return tarp
      ? { autoplay: tarp.autoplay, mode: tarp.mode, delaySeconds: tarp.delaySeconds }
      : null;
  }
  return null;
}

class LiveService {
  private ios = new Set<Server>();
  private active: SessionRecord | null = null;
  private autoplayTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.restore();
  }

  attach(io: Server): void {
    this.ios.add(io);
  }

  private emit(room: "control" | "outputs", state: LiveState): void {
    for (const io of this.ios) io.to(room).emit("live:snapshot", state);
  }

  getState(): LiveState {
    const config = getDisplayConfig();
    if (!this.active) {
      return {
        ...idleState(),
        background: null,
        templates: resolveTemplates(null),
        displayConfig: config,
      };
    }
    const state = this.active.state;
    state.pendingUpdate = Boolean(this.active.pending);
    state.pendingRevision = this.active.pending?.revisionNo ?? null;
    state.displayConfig = config;
    const item = this.active.transient ?? this.active.items[state.itemIndex];
    const background = item?.backgroundId ? getBackground(item.backgroundId) : null;
    return {
      ...state,
      pages: state.pages,
      background,
      templates: resolveTemplates(this.active.setlistId),
      displayConfig: config,
    };
  }

  private restore(): void {
    const row = db
      .prepare(
        `SELECT s.id, s.setlist_id, s.revision_id, s.setlist_name, s.snapshot_json,
                s.pending_json, s.status, l.state_json
         FROM service_sessions s
         LEFT JOIN live_state l ON l.session_id = s.id
         WHERE s.status IN ('live', 'rehearsal')
         ORDER BY s.started_at DESC LIMIT 1`,
      )
      .get() as
      | {
          id: string;
          setlist_id: string | null;
          revision_id: string | null;
          setlist_name: string;
          snapshot_json: string;
          pending_json: string | null;
          status: "live" | "rehearsal";
          state_json: string | null;
        }
      | undefined;
    if (!row) return;
    try {
      const items = JSON.parse(row.snapshot_json) as SnapshotItem[];
      const state = row.state_json ? (JSON.parse(row.state_json) as LiveState) : null;
      if (!state) return;
      const pending = row.pending_json
        ? (JSON.parse(row.pending_json) as PendingUpdate)
        : null;
      state.pendingUpdate = Boolean(pending);
      state.pendingRevision = pending?.revisionNo ?? null;
      this.active = {
        id: row.id,
        setlistId: row.setlist_id,
        revisionId: row.revision_id,
        setlistName: row.setlist_name,
        status: row.status,
        items,
        transient: null,
        transientReturnItemIndex: null,
        pending,
        state,
        autoplayDirection: 1,
      };
      this.active.state.queuedItemIndex = null;
      this.active.state.queuedTitle = null;
      this.active.state.queuedPages = [];
      if (this.active.state.itemIndex < 0) {
        this.active.state.itemIndex = 0;
        this.active.state.pageIndex = 0;
        this.renderCurrent();
      }
      if (!this.active.state.blank) this.scheduleAutoplay();
    } catch {
      // Ignore corrupt restore; a new session can be started.
    }
  }

  start(setlistId: string, status: "live" | "rehearsal", userId: string | null = null): LiveState {
    const { name, items } = resolveSetlistItems(setlistId);
    const revision = createRevision(setlistId, items, userId);
    const id = randomUUID();

    db.prepare(
      "UPDATE service_sessions SET status = 'ended', ended_at = ? WHERE status IN ('live', 'rehearsal')",
    ).run(now());
    db.prepare(
      `INSERT INTO service_sessions
       (id, setlist_id, revision_id, setlist_name, snapshot_json, pending_json, status, started_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).run(id, setlistId, revision.id, name, JSON.stringify(items), status, now());

    const first = items[0];
    const displayConfig = getDisplayConfig();
    const state: LiveState = {
      sessionId: id,
      setlistId,
      setlistName: name,
      status,
      itemIndex: 0,
      pageIndex: 0,
      pageCount: 0,
      mode: first.kind,
      title: first.title,
      blank: true,
      maxLines: displayConfig.maxLines,
      transpose: 0,
      footer: "",
      pages: [],
      items: summaries(items),
      version: 1,
      updatedAt: now(),
      pendingUpdate: false,
      pendingRevision: null,
      queuedItemIndex: null,
      queuedTitle: null,
      queuedPages: [],
      appendedItems: [],
      displayConfig,
    };

    this.active = {
      id,
      setlistId,
      revisionId: revision.id,
      setlistName: name,
      status,
      items,
      transient: null,
      transientReturnItemIndex: null,
      pending: null,
      state,
      autoplayDirection: 1,
    };
    this.renderCurrent();
    this.persist();
    this.broadcast();
    return this.getState();
  }

  stop(): LiveState {
    if (this.autoplayTimer) {
      clearTimeout(this.autoplayTimer);
      this.autoplayTimer = null;
    }
    if (!this.active) return idleState();
    db.prepare("UPDATE service_sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(
      now(),
      this.active.id,
    );
    this.active = null;
    const state = idleState();
    this.emit("control", state);
    this.emit("outputs", state);
    return state;
  }

  publish(setlistId: string, userId: string | null): SetlistRevisionInfo {
    const { items } = resolveSetlistItems(setlistId);
    const revision = createRevision(setlistId, items, userId);
    const row = revisionRow(revision.id)!;
    return mapRevision(row);
  }

  listRevisions(setlistId: string): SetlistRevisionInfo[] {
    const rows = db
      .prepare("SELECT * FROM setlist_revisions WHERE setlist_id = ? ORDER BY revision_no DESC")
      .all(setlistId) as Array<{
      id: string;
      setlist_id: string;
      revision_no: number;
      snapshot_json: string;
      created_at: string;
      created_by: string | null;
    }>;
    return rows.map(mapRevision);
  }

  applyCurrent(setlistId: string, mode: LiveApplyMode, userId: string | null): LiveState {
    if (!this.active) throw new Error("No live session");
    const { items, name } = resolveSetlistItems(setlistId);
    const revision = createRevision(setlistId, items, userId);
    this.active.setlistId = setlistId;
    this.active.setlistName = name;
    this.active.state.setlistId = setlistId;
    this.active.state.setlistName = name;
    return this.applySnapshot(items, revision.id, revision.revisionNo, mode);
  }

  applyRevision(revisionId: string, mode: LiveApplyMode): LiveState {
    if (!this.active) throw new Error("No live session");
    const row = revisionRow(revisionId);
    if (!row) throw new Error("Revision not found");
    const items = JSON.parse(row.snapshot_json) as SnapshotItem[];
    if (!items.length) throw new Error("Revision is empty");
    return this.applySnapshot(items, row.id, row.revision_no, mode);
  }

  updateDisplayConfig(config: DisplayConfig): LiveState {
    if (!this.active) return this.getState();
    this.active.state.displayConfig = config;
    this.active.state.maxLines = config.maxLines;
    this.renderCurrent();
    this.active.state.version += 1;
    this.active.state.updatedAt = now();
    this.persist();
    this.broadcast();
    return this.getState();
  }

  private applySnapshot(
    items: SnapshotItem[],
    revisionId: string | null,
    revisionNo: number | null,
    mode: LiveApplyMode,
  ): LiveState {
    if (!this.active) throw new Error("No live session");
    const record = this.active;
    record.state.queuedItemIndex = null;
    record.state.queuedTitle = null;
    record.state.queuedPages = [];
    record.state.appendedItems = [];
    if (mode === "now") {
      record.items = items;
      record.revisionId = revisionId;
      record.pending = null;
      record.transient = null;
      record.transientReturnItemIndex = null;
      record.state.itemIndex = 0;
      record.state.pageIndex = 0;
      record.state.items = summaries(items);
      record.state.pendingUpdate = false;
      record.state.pendingRevision = null;
      this.renderCurrent();
    } else {
      record.pending = { items, revisionId, revisionNo };
      record.state.pendingUpdate = true;
      record.state.pendingRevision = revisionNo;
    }
    record.state.version += 1;
    record.state.updatedAt = now();
    this.persist();
    this.broadcast();
    return this.getState();
  }

  private applyPending(): void {
    const record = this.active;
    if (!record?.pending) return;
    record.items = record.pending.items;
    record.revisionId = record.pending.revisionId;
    record.pending = null;
    record.transient = null;
    record.transientReturnItemIndex = null;
    record.state.itemIndex = 0;
    record.state.pageIndex = 0;
    record.state.items = summaries(record.items);
    record.state.pendingUpdate = false;
    record.state.pendingRevision = null;
    record.state.appendedItems = [];
    this.renderCurrent();
  }

  command(command: Record<string, unknown>): LiveState {
    if (!this.active) return idleState();
    const state = this.active.state;

    switch (command.type) {
      case "next":
        this.move(1);
        break;
      case "prev":
        this.move(-1);
        break;
      case "page": {
        const delta = Number(command.delta ?? 0);
        if (this.active.transient) {
          this.setPage(state.pageIndex + delta);
          break;
        }
        const settings = getAppSettings();
        if (settings.pageNavigation === "next-item" && Math.abs(delta) === 1) {
          const lastPage = Math.max(0, state.pageCount - 1);
          if (delta > 0 && state.pageIndex >= lastPage) {
            const nextItem = state.itemIndex + 1;
            if (nextItem >= 0 && nextItem < this.active.items.length) {
              this.setItem(nextItem);
              state.blank = false;
              break;
            }
          }
          if (delta < 0 && state.pageIndex <= 0) {
            const previousItem = state.itemIndex - 1;
            if (previousItem >= 0 && previousItem < this.active.items.length) {
              this.setItem(previousItem);
              state.pageIndex = Math.max(0, state.pageCount - 1);
              state.blank = false;
              break;
            }
          }
        }
        this.setPage(state.pageIndex + delta);
        break;
      }
      case "goto": {
        let selected = false;
        if (typeof command.pageIndex === "number") {
          if (state.queuedItemIndex != null) {
            this.setItem(state.queuedItemIndex);
          }
          this.setPage(command.pageIndex);
          selected = true;
        }
        if (typeof command.itemIndex === "number") {
          this.setItem(command.itemIndex);
          selected = true;
        }
        if (selected) state.blank = false;
        break;
      }
      case "queueItem": {
        this.queueItem(Number(command.itemIndex));
        break;
      }
      case "appendItem": {
        this.appendItem(Number(command.itemIndex));
        break;
      }
      case "blank":
        state.blank = typeof command.value === "boolean" ? command.value : !state.blank;
        break;
      case "transpose": {
        const delta = Number(command.delta ?? 0);
        state.transpose = Math.max(-24, Math.min(24, state.transpose + delta));
        this.renderCurrent();
        break;
      }
      case "maxLines": {
        state.maxLines = Math.max(1, Math.min(30, Number(command.value ?? 4)));
        this.renderCurrent();
        break;
      }
      case "footer":
        state.footer = String(command.text ?? "");
        break;
      default:
        break;
    }

    state.version += 1;
    state.updatedAt = now();
    this.persist();
    this.broadcast();
    return this.getState();
  }

  quickText(text: string): LiveState {
    if (!this.active) return idleState();
    const record = this.active;
    const item: SnapshotItem = {
      kind: "text",
      itemId: null,
      songId: null,
      title: "Quick text",
      content: text,
      format: "text",
      textAlign: "left",
      transpose: 0,
      maxLines: record.state.maxLines,
      verseOrder: null,
      notes: null,
    };
    if (!record.transient) {
      record.transientReturnItemIndex =
        record.state.itemIndex >= 0 ? record.state.itemIndex : 0;
    }
    record.transient = item;
    record.state.mode = "text";
    record.state.title = "Quick text";
    record.state.itemIndex = -1;
    record.state.pageIndex = 0;
    record.state.blank = false;
    record.state.appendedItems = [];
    this.renderCurrent();
    record.state.version += 1;
    record.state.updatedAt = now();
    this.persist();
    this.broadcast();
    return this.getState();
  }

  quickSong(
    songId: string,
    options: { keyOverride?: string | null; transpose?: number; verseOrder?: string | null } = {},
  ): LiveState {
    if (!this.active) return idleState();
    const song = db.prepare("SELECT * FROM songs WHERE id = ?").get(songId) as
      | (Song & { lyrics_markdown: number; verse_order: string | null })
      | undefined;
    if (!song) throw new Error("Song not found");
    const record = this.active;
    const item: SnapshotItem = {
      kind: "song",
      itemId: null,
      songId: song.id,
      title: song.title,
      lyrics: song.lyrics,
      lyricsMarkdown: Boolean(song.lyrics_markdown),
      key: song.key,
      keyOverride: options.keyOverride ?? null,
      transpose: options.transpose ?? 0,
      maxLines: record.state.maxLines,
      verseOrder: options.verseOrder ?? song.verse_order,
      notes: null,
    };
    if (!record.transient) {
      record.transientReturnItemIndex =
        record.state.itemIndex >= 0 ? record.state.itemIndex : 0;
    }
    record.transient = item;
    record.state.mode = "song";
    record.state.title = song.title;
    record.state.itemIndex = -1;
    record.state.pageIndex = 0;
    record.state.blank = false;
    record.state.appendedItems = [];
    this.renderCurrent();
    record.state.version += 1;
    record.state.updatedAt = now();
    this.persist();
    this.broadcast();
    return this.getState();
  }

  quickImage(imagePath: string, title?: string): LiveState {
    if (!this.active) throw new Error("Start a live session first");
    const content = imagePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const absolute = resolveImage(content);
    if (!absolute || !fs.existsSync(absolute)) throw new Error("Image not found");
    const record = this.active;
    const item: SnapshotItem = {
      kind: "image",
      itemId: null,
      songId: null,
      title: title?.trim() || content.split("/").pop() || "Image",
      content,
      imageFit: "scale",
      transpose: 0,
      maxLines: record.state.maxLines,
      verseOrder: null,
      notes: null,
    };
    if (!record.transient) {
      record.transientReturnItemIndex =
        record.state.itemIndex >= 0 ? record.state.itemIndex : 0;
    }
    record.transient = item;
    record.state.mode = "image";
    record.state.title = item.title;
    record.state.itemIndex = -1;
    record.state.pageIndex = 0;
    record.state.blank = false;
    this.renderCurrent();
    record.state.version += 1;
    record.state.updatedAt = now();
    this.persist();
    this.broadcast();
    return this.getState();
  }

  private setItem(index: number): void {
    if (!this.active) return;
    const { state, items } = this.active;
    if (index < 0 || index >= items.length) return;
    this.active.transient = null;
    this.active.transientReturnItemIndex = null;
    state.queuedItemIndex = null;
    state.queuedTitle = null;
    state.queuedPages = [];
    state.appendedItems = [];
    state.itemIndex = index;
    state.pageIndex = 0;
    state.mode = items[index].kind;
    state.title = items[index].title;
    this.renderCurrent();
  }

  private queueItem(index: number): void {
    if (!this.active) return;
    const { state, items } = this.active;
    if (!Number.isFinite(index) || index < 0 || index >= items.length) return;
    const item = items[index];
    state.queuedItemIndex = index;
    state.queuedTitle = item.title;
    state.queuedPages = this.pagesFor(item);
  }

  private appendItem(index: number): void {
    if (!this.active) return;
    const { state, items } = this.active;
    if (!Number.isFinite(index) || index < 0 || index >= items.length) return;
    // Appending affects the live page queue; return the Pages panel to the
    // live queue instead of leaving a previously queued item preview visible.
    state.queuedItemIndex = null;
    state.queuedTitle = null;
    state.queuedPages = [];
    state.appendedItems = [...(state.appendedItems ?? []), index];
    this.renderCurrent();
  }

  private setPage(index: number): void {
    if (!this.active) return;
    const state = this.active.state;
    state.pageIndex = Math.max(0, Math.min(index, Math.max(0, state.pageCount - 1)));
  }

  private move(delta: number): void {
    if (!this.active) return;
    const record = this.active;
    const { state, items } = record;

    if (record.transient) {
      // A quick song/text/image is a temporary overlay item. Its pages behave
      // like any other item; don't discard it just because the operator
      // advances or goes back a page.
      const nextPage = state.pageIndex + delta;
      if (nextPage >= 0 && nextPage < state.pageCount) {
        state.pageIndex = nextPage;
        return;
      }
      // At the end of a transient item, resume the item that was live before
      // it, or apply a queued snapshot when one is waiting.
      if (delta > 0) {
        if (record.pending) {
          this.applyPending();
        } else if (items.length) {
          const returnIndex = record.transientReturnItemIndex ?? 0;
          this.setItem(Math.max(0, Math.min(returnIndex, items.length - 1)));
        }
      }
      return;
    }

    if (delta > 0 && record.pending && state.pageIndex >= Math.max(0, state.pageCount - 1)) {
      this.applyPending();
      return;
    }

    const nextPage = state.pageIndex + delta;
    if (nextPage >= 0 && nextPage < state.pageCount) {
      state.pageIndex = nextPage;
      return;
    }

    const nextItem = state.itemIndex + (delta > 0 ? 1 : -1);
    if (nextItem < 0 || nextItem >= items.length) return;
    this.setItem(nextItem);
  }

  private renderCurrent(): void {
    if (!this.active) return;
    const record = this.active;
    const item = record.transient ?? record.items[record.state.itemIndex];
    if (!item) {
      record.state.pages = [];
      record.state.pageCount = 0;
      return;
    }
    const pages = this.pagesFor(item);
    const appendedPages = record.transient
      ? []
      : (record.state.appendedItems ?? []).flatMap((index) => {
          const appended = record.items[index];
          return appended ? this.pagesFor(appended) : [];
        });
    record.state.pages = [...pages, ...appendedPages].map((page, index) => ({
      ...page,
      index,
    }));
    record.state.pageCount = record.state.pages.length;
    record.state.pageIndex = Math.max(
      0,
      Math.min(record.state.pageIndex, record.state.pages.length - 1),
    );
    record.state.title = item.title;
    record.state.mode = item.kind;

    if (record.state.queuedItemIndex != null) {
      const queued = record.items[record.state.queuedItemIndex];
      if (queued) record.state.queuedPages = this.pagesFor(queued);
    }
  }

  private pagesFor(item: SnapshotItem): LiveState["pages"] {
    if (!this.active) return [];
    const stored = this.active.state.displayConfig;
    const config = { ...getDisplayConfig(), ...(stored ?? {}) };
    const pages =
      item.kind === "tarp"
        ? (() => {
            const content = parseTarpItemContent(item.content);
            return content ? renderTarpPages(content.presentationId) : [];
          })()
        : buildPages(item, this.active.state.transpose, {
            maxLines: this.active.state.maxLines || config.maxLines,
            maxWords: config.maxWords,
            smartPageSplits: config.smartPageSplits,
            smartWrapMinWords: config.smartWrapMinWords,
            smartWrapModules: config.smartWrapModules,
            textScale: config.textScale,
          });
    for (const page of pages) {
      const pageOverride = item.stingerPageOverrides?.[String(page.index + 1)];
      const stingerId =
        pageOverride === NO_STINGER_ID ? null : pageOverride ?? item.stingerId ?? null;
      page.stinger = stingerId ? getStinger(stingerId) : null;
    }
    return pages;
  }

  private scheduleAutoplay(): void {
    if (this.autoplayTimer) {
      clearTimeout(this.autoplayTimer);
      this.autoplayTimer = null;
    }
    const record = this.active;
    if (!record || record.state.blank) return;
    const item = record.transient ?? record.items[record.state.itemIndex];
    if (!item) return;
    const autoplay = autoplayConfigFor(item);
    if (!autoplay?.autoplay) return;
    const count = this.pagesFor(item).length;
    if (count < 2 || record.state.pageIndex >= count) return;
    if (autoplay.mode === "single" && record.state.pageIndex >= count - 1) return;
    this.autoplayTimer = setTimeout(
      () => this.advanceAutoplay(),
      Math.max(1, autoplay.delaySeconds) * 1000,
    );
  }

  private advanceAutoplay(): void {
    this.autoplayTimer = null;
    const record = this.active;
    if (!record || record.state.blank) return;
    const item = record.transient ?? record.items[record.state.itemIndex];
    if (!item) return;
    const autoplay = autoplayConfigFor(item);
    if (!autoplay?.autoplay) return;
    const count = this.pagesFor(item).length;
    if (count < 2) return;
    const step = nextPlaybackPage(
      record.state.pageIndex,
      count,
      autoplay.mode,
      record.autoplayDirection,
    );
    record.autoplayDirection = step.direction;
    if (step.done || step.pageIndex === record.state.pageIndex) return;
    record.state.pageIndex = step.pageIndex;
    record.state.version += 1;
    record.state.updatedAt = now();
    this.persist();
    this.broadcast();
  }

  private persist(): void {
    if (!this.active) return;
    db.prepare(
      `INSERT INTO live_state (session_id, state_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
    ).run(this.active.id, JSON.stringify(this.active.state), now());
    db.prepare(
      "UPDATE service_sessions SET status = ?, revision_id = ?, pending_json = ? WHERE id = ?",
    ).run(
      this.active.status,
      this.active.revisionId,
      this.active.pending ? JSON.stringify(this.active.pending) : null,
      this.active.id,
    );
  }

  private broadcast(): void {
    if (!this.active) return;
    const state = this.getState();
    this.emit("control", state);
    this.emit("outputs", state);
    this.scheduleAutoplay();
  }
}

export const live = new LiveService();
export type { SnapshotItem };
