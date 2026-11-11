import type { LiveState } from "@sm/shared";

export const EMPTY_LIVE: LiveState = {
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
  updatedAt: new Date(0).toISOString(),
  pendingUpdate: false,
  pendingRevision: null,
};
