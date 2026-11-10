import { randomUUID } from "node:crypto";
import type { Server } from "socket.io";
import type { LiveState, SetlistItem, Song } from "@wlm/shared";
import { db } from "./db.js";
import { buildPages, type RenderItem } from "./render.js";

interface SnapshotItem extends RenderItem {
  songId: string | null;
  notes: string | null;
}

interface SessionRecord {
  id: string;
  setlistId: string | null;
  setlistName: string;
  status: "live" | "rehearsal";
  items: SnapshotItem[];
  transient: SnapshotItem | null;
  state: LiveState;
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
  };
}

class LiveService {
  private io: Server | null = null;
  private active: SessionRecord | null = null;

  constructor() {
    this.restore();
  }

  attach(io: Server): void {
    this.io = io;
  }

  getState(): LiveState {
    return this.active ? { ...this.active.state, pages: this.active.state.pages } : idleState();
  }

  private restore(): void {
    const row = db
      .prepare(
        `SELECT s.id, s.setlist_id, s.setlist_name, s.snapshot_json, s.status,
                l.state_json
         FROM service_sessions s
         LEFT JOIN live_state l ON l.session_id = s.id
         WHERE s.status IN ('live', 'rehearsal')
         ORDER BY s.started_at DESC LIMIT 1`,
      )
      .get() as
      | {
          id: string;
          setlist_id: string | null;
          setlist_name: string;
          snapshot_json: string;
          status: "live" | "rehearsal";
          state_json: string | null;
        }
      | undefined;
    if (!row) return;
    try {
      const items = JSON.parse(row.snapshot_json) as SnapshotItem[];
      const state = row.state_json ? (JSON.parse(row.state_json) as LiveState) : null;
      if (!state) return;
      this.active = {
        id: row.id,
        setlistId: row.setlist_id,
        setlistName: row.setlist_name,
        status: row.status,
        items,
        transient: null,
        state,
      };
      if (this.active.state.itemIndex < 0) {
        this.active.state.itemIndex = 0;
        this.active.state.pageIndex = 0;
        this.renderCurrent();
      }
    } catch {
      // Ignore corrupt restore; a new session can be started.
    }
  }

  start(setlistId: string, status: "live" | "rehearsal"): LiveState {
    const setlist = db
      .prepare("SELECT id, name FROM setlists WHERE id = ?")
      .get(setlistId) as { id: string; name: string } | undefined;
    if (!setlist) throw new Error("Set list not found");

    const rows = db
      .prepare(
        "SELECT * FROM setlist_items WHERE setlist_id = ? ORDER BY position ASC, rowid ASC",
      )
      .all(setlistId) as Array<{
      id: string;
      kind: "song" | "text";
      song_id: string | null;
      title: string;
      content: string | null;
      key_override: string | null;
      transpose: number;
      max_lines: number;
      notes: string | null;
    }>;

    const items: SnapshotItem[] = rows.map((row) => {
      if (row.kind === "song" && row.song_id) {
        const song = db.prepare("SELECT * FROM songs WHERE id = ?").get(row.song_id) as
          | (Song & { key: string | null })
          | undefined;
        return {
          kind: "song",
          songId: row.song_id,
          title: row.title || song?.title || "Untitled song",
          lyrics: song?.lyrics ?? "",
          key: song?.key ?? null,
          keyOverride: row.key_override,
          transpose: row.transpose,
          maxLines: row.max_lines,
          notes: row.notes,
        };
      }
      return {
        kind: "text",
        songId: null,
        title: row.title || "Text",
        content: row.content ?? "",
        transpose: 0,
        maxLines: row.max_lines,
        notes: row.notes,
      };
    });

    if (!items.length) throw new Error("Set list is empty");

    const id = randomUUID();
    db.prepare(
      "UPDATE service_sessions SET status = 'ended', ended_at = ? WHERE status IN ('live', 'rehearsal')",
    ).run(now());
    db.prepare(
      `INSERT INTO service_sessions (id, setlist_id, setlist_name, snapshot_json, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, setlist.id, setlist.name, JSON.stringify(items), status, now());

    const first = items[0];
    const state: LiveState = {
      sessionId: id,
      setlistId: setlist.id,
      setlistName: setlist.name,
      status,
      itemIndex: 0,
      pageIndex: 0,
      pageCount: 0,
      mode: first.kind,
      title: first.title,
      blank: false,
      maxLines: first.maxLines,
      transpose: 0,
      footer: "",
      pages: [],
      items: items.map((item, index) => ({
        index,
        kind: item.kind,
        title: item.title,
        notes: item.notes,
      })),
      version: 1,
      updatedAt: now(),
    };

    this.active = {
      id,
      setlistId: setlist.id,
      setlistName: setlist.name,
      status,
      items,
      transient: null,
      state,
    };
    this.renderCurrent();
    this.persist();
    this.broadcast();
    return this.getState();
  }

  stop(): LiveState {
    if (!this.active) return idleState();
    db.prepare("UPDATE service_sessions SET status = 'ended', ended_at = ? WHERE id = ?").run(
      now(),
      this.active.id,
    );
    this.active = null;
    const state = idleState();
    this.io?.to("control").emit("live:snapshot", state);
    this.io?.to("outputs").emit("live:snapshot", state);
    return state;
  }

  command(command: Record<string, unknown>): LiveState {
    if (!this.active) return idleState();
    const record = this.active;
    const state = record.state;

    switch (command.type) {
      case "next":
        this.move(1);
        break;
      case "prev":
        this.move(-1);
        break;
      case "page": {
        const delta = Number(command.delta ?? 0);
        this.setPage(state.pageIndex + delta);
        break;
      }
      case "goto": {
        if (typeof command.itemIndex === "number") {
          this.setItem(command.itemIndex);
        }
        if (typeof command.pageIndex === "number") {
          this.setPage(command.pageIndex);
        }
        break;
      }
      case "blank": {
        state.blank = typeof command.value === "boolean" ? command.value : !state.blank;
        break;
      }
      case "transpose": {
        const delta = Number(command.delta ?? 0);
        state.transpose = Math.max(-24, Math.min(24, state.transpose + delta));
        this.renderCurrent();
        break;
      }
      case "maxLines": {
        const value = Number(command.value ?? 4);
        state.maxLines = Math.max(1, Math.min(30, value));
        this.renderCurrent();
        break;
      }
      case "footer": {
        state.footer = String(command.text ?? "");
        break;
      }
      default:
        break;
    }

    state.version += 1;
    state.updatedAt = now();
    this.persist();
    this.broadcast();
    return this.getState();
  }

  quickText(text: string, mode: "direct" | "setlist"): LiveState {
    if (!this.active) return idleState();
    const record = this.active;
    const item: SnapshotItem = {
      kind: "text",
      songId: null,
      title: "Quick text",
      content: text,
      transpose: 0,
      maxLines: record.state.maxLines,
      notes: null,
    };
    record.transient = item;
    record.state.mode = "text";
    record.state.title = "Quick text";
    record.state.itemIndex = -1;
    record.state.pageIndex = 0;
    record.state.blank = false;
    record.state.maxLines = 4;
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
    state.itemIndex = index;
    state.pageIndex = 0;
    state.mode = items[index].kind;
    state.title = items[index].title;
    state.maxLines = items[index].maxLines;
    this.renderCurrent();
  }

  private setPage(index: number): void {
    if (!this.active) return;
    const state = this.active.state;
    state.pageIndex = Math.max(0, Math.min(index, Math.max(0, state.pageCount - 1)));
  }

  private move(delta: number): void {
    if (!this.active) return;
    const { state, items } = this.active;
    if (this.active.transient) {
      this.active.transient = null;
      this.setItem(0);
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
    const pages = buildPages(item, record.state.transpose);
    record.state.pages = pages;
    record.state.pageCount = pages.length;
    record.state.pageIndex = Math.max(0, Math.min(record.state.pageIndex, pages.length - 1));
    record.state.title = item.title;
    record.state.mode = item.kind;
  }

  private persist(): void {
    if (!this.active) return;
    db.prepare(
      `INSERT INTO live_state (session_id, state_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
    ).run(this.active.id, JSON.stringify(this.active.state), now());
    db.prepare("UPDATE service_sessions SET status = ? WHERE id = ?").run(
      this.active.status,
      this.active.id,
    );
  }

  private broadcast(): void {
    if (!this.active) return;
    const state = this.getState();
    this.io?.to("control").emit("live:snapshot", state);
    this.io?.to("outputs").emit("live:snapshot", state);
  }
}

export const live = new LiveService();
export type { SnapshotItem };
