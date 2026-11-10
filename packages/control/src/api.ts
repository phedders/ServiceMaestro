import type {
  BibleBook,
  BiblePassage,
  BibleTranslationInfo,
  DashboardLayout,
  LiveState,
  PublicUser,
  SetlistDetail,
  SetlistRevisionInfo,
  SetlistSummary,
  Song,
  SongAsset,
  SongImportReport,
  SongImportScan,
} from "@wlm/shared";

export class ApiError extends Error {
  status: number;
  issues?: unknown;
  constructor(status: number, message: string, issues?: unknown) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "include",
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(response.status, data?.error ?? response.statusText, data?.issues);
  }
  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ user: PublicUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ user: PublicUser | null }>("/api/auth/me"),

  songs: (q = "") => request<{ songs: Song[] }>(`/api/songs${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  song: (id: string) => request<{ song: Song }>(`/api/songs/${id}`),
  createSong: (payload: Partial<Song>) =>
    request<{ song: Song }>("/api/songs", { method: "POST", body: JSON.stringify(payload) }),
  updateSong: (id: string, payload: Partial<Song>) =>
    request<{ song: Song }>(`/api/songs/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteSong: (id: string) => request<{ ok: true }>(`/api/songs/${id}`, { method: "DELETE" }),

  songAssets: (id: string) => request<{ assets: SongAsset[] }>(`/api/songs/${id}/assets`),
  uploadAsset: async (
    songId: string,
    file: File,
    meta: { kind: string; title?: string; key?: string },
  ): Promise<{ asset: SongAsset }> => {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", meta.kind);
    if (meta.title) form.append("title", meta.title);
    if (meta.key) form.append("key", meta.key);
    const response = await fetch(`/api/songs/${songId}/assets`, {
      method: "POST",
      body: form,
      credentials: "include",
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new ApiError(response.status, data?.error ?? response.statusText);
    return data;
  },
  deleteAsset: (id: string) => request<{ ok: true }>(`/api/assets/${id}`, { method: "DELETE" }),

  scanImports: () => request<SongImportScan>("/api/import/scan"),
  applyImports: (paths?: string[]) =>
    request<SongImportReport>("/api/import/apply", {
      method: "POST",
      body: JSON.stringify(paths ? { paths } : {}),
    }),

  setlists: () => request<{ setlists: SetlistSummary[] }>("/api/setlists"),
  setlist: (id: string) => request<{ setlist: SetlistDetail }>(`/api/setlists/${id}`),
  createSetlist: (payload: { name: string; serviceDate: string; serviceTime?: string; notes?: string }) =>
    request<{ setlist: SetlistDetail }>("/api/setlists", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateSetlist: (id: string, payload: Record<string, unknown>) =>
    request<{ setlist: SetlistDetail }>(`/api/setlists/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteSetlist: (id: string) => request<{ ok: true }>(`/api/setlists/${id}`, { method: "DELETE" }),
  addItem: (id: string, payload: Record<string, unknown>) =>
    request<{ setlist: SetlistDetail }>(`/api/setlists/${id}/items`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  patchItem: (id: string, itemId: string, payload: Record<string, unknown>) =>
    request<{ setlist: SetlistDetail }>(`/api/setlists/${id}/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteItem: (id: string, itemId: string) =>
    request<{ setlist: SetlistDetail }>(`/api/setlists/${id}/items/${itemId}`, { method: "DELETE" }),
  reorder: (id: string, ids: string[]) =>
    request<{ setlist: SetlistDetail }>(`/api/setlists/${id}/reorder`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  revisions: (id: string) =>
    request<{ revisions: SetlistRevisionInfo[] }>(`/api/setlists/${id}/revisions`),
  publish: (id: string) =>
    request<{ revision: SetlistRevisionInfo }>(`/api/setlists/${id}/publish`, { method: "POST" }),

  live: () => request<{ state: LiveState }>("/api/live"),
  startLive: (setlistId: string, status: "live" | "rehearsal" = "live") =>
    request<{ state: LiveState }>("/api/live/start", {
      method: "POST",
      body: JSON.stringify({ setlistId, status }),
    }),
  command: (payload: Record<string, unknown>) =>
    request<{ state: LiveState }>("/api/live/command", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  quickText: (text: string, mode: "direct" | "setlist" = "direct") =>
    request<{ state: LiveState }>("/api/live/quick-text", {
      method: "POST",
      body: JSON.stringify({ text, mode }),
    }),
  stopLive: () => request<{ state: LiveState }>("/api/live/stop", { method: "POST" }),
  applyLive: (payload: { setlistId?: string; revisionId?: string; mode: "after-current" | "now" }) =>
    request<{ state: LiveState }>("/api/live/apply", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  layout: () => request<{ layout: DashboardLayout; isDefault: boolean }>("/api/dashboard/layout"),
  saveLayout: (layout: DashboardLayout) =>
    request<{ layout: DashboardLayout }>("/api/dashboard/layout", {
      method: "PUT",
      body: JSON.stringify(layout),
    }),
  resetLayout: () => request<{ layout: DashboardLayout }>("/api/dashboard/layout/reset", { method: "POST" }),

  bibleTranslations: () => request<{ translations: BibleTranslationInfo[] }>("/api/bible/translations"),
  bibleBooks: (translation: string) =>
    request<{ books: BibleBook[] }>(`/api/bible/books?translation=${encodeURIComponent(translation)}`),
  bibleChapter: (translation: string, book: number, chapter: number) =>
    request<{ passage: BiblePassage }>(
      `/api/bible/chapter?translation=${encodeURIComponent(translation)}&book=${book}&chapter=${chapter}`,
    ),
  biblePassage: (translation: string, book: number, chapter: number, from?: number, to?: number) => {
    const params = new URLSearchParams({
      translation,
      book: String(book),
      chapter: String(chapter),
    });
    if (from) params.set("from", String(from));
    if (to) params.set("to", String(to));
    return request<{ passage: BiblePassage }>(`/api/bible/passage?${params.toString()}`);
  },
};
