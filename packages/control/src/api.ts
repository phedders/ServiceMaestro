import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import type {
  ActivityPage,
  AppSettings,
  BackgroundAsset,
  BackgroundColors,
  BackgroundInput,
  BibleBook,
  StingerAsset,
  StingerInput,
  BiblePassage,
  BibleTranslationInfo,
  BrandingSettings,
  ChurchSuiteImportReport,
  ChurchSuitePlanPreview,
  ChurchSuitePlanSummary,
  ControlTlsReport,
  DashboardLayout,
  DisplayConfig,
  DisplayViewLink,
  FontDownloadReport,
  FontLibraryStatus,
  FontOption,
  GitSettings,
  GitStatus,
  ImageAsset,
  LiveState,
  ModulePermissions,
  PasskeySummary,
  PublicUser,
  Role,
  SetlistDetail,
  SetlistImportPreview,
  SetlistImportReport,
  SetlistRevisionInfo,
  SetlistSummary,
  Song,
  SongAlternative,
  SongDuplicateGroup,
  SongAsset,
  SongImportReport,
  SongImportScan,
  SongImportDecision,
  SongPageIdFixScan,
  SongSelectWatchReport,
  SongSelectWatchStatus,
  SongVerseOrder,
  TarpPage,
  TarpPageInput,
  TarpPresentationDetail,
  TarpPresentationInput,
  TarpPresentationSummary,
  TarpTheme,
  TarpThemeInput,
  UserManagementEntry,
} from "@sm/shared";

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
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  passkeyLoginOptions: (username: string) =>
    request<{ options: PublicKeyCredentialRequestOptionsJSON }>("/api/auth/passkey/login/options", {
      method: "POST",
      body: JSON.stringify({ username }),
    }),
  passkeyLoginVerify: (username: string, response: AuthenticationResponseJSON) =>
    request<{ user: PublicUser }>("/api/auth/passkey/login/verify", {
      method: "POST",
      body: JSON.stringify({ username, response }),
    }),
  passkeys: () => request<{ passkeys: PasskeySummary[] }>("/api/auth/passkeys"),
  passkeyRegistrationOptions: () =>
    request<{ options: PublicKeyCredentialCreationOptionsJSON }>("/api/auth/passkeys/options", {
      method: "POST",
    }),
  verifyPasskeyRegistration: (response: RegistrationResponseJSON, name?: string) =>
    request<{ passkey: PasskeySummary }>("/api/auth/passkeys/verify", {
      method: "POST",
      body: JSON.stringify({ response, name }),
    }),
  deletePasskey: (id: string) =>
    request<{ ok: true }>(`/api/auth/passkeys/${id}`, { method: "DELETE" }),

  users: () => request<{ users: UserManagementEntry[] }>("/api/users"),
  createUser: (payload: {
    username: string;
    password: string;
    role: Role;
    permissions: ModulePermissions;
  }) =>
    request<{ user: UserManagementEntry }>("/api/users", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateUser: (
    id: string,
    payload: { username?: string; role?: Role; permissions?: ModulePermissions },
  ) =>
    request<{ user: UserManagementEntry }>(`/api/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  resetUserPassword: (id: string, password: string) =>
    request<{ ok: true }>(`/api/users/${id}/password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  deleteUser: (id: string) =>
    request<{ ok: true }>(`/api/users/${id}`, { method: "DELETE" }),
  activity: (options: {
    limit?: number;
    offset?: number;
    module?: string;
    userId?: string;
    q?: string;
  } = {}) => {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.offset !== undefined) params.set("offset", String(options.offset));
    if (options.module) params.set("module", options.module);
    if (options.userId) params.set("userId", options.userId);
    if (options.q) params.set("q", options.q);
    return request<ActivityPage>(`/api/activity${params.size ? `?${params}` : ""}`);
  },

  songs: (q = "") => request<{ songs: Song[] }>(`/api/songs${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  song: (id: string) => request<{ song: Song }>(`/api/songs/${id}`),
  songAlternatives: (id: string, q = "") =>
    request<{ alternatives: SongAlternative[] }>(
      `/api/songs/${id}/alternatives${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    ),
  songDuplicates: () => request<{ groups: SongDuplicateGroup[] }>("/api/songs/duplicates"),
  setSongPriority: (id: string, priority: number) =>
    request<{ song: Song }>(`/api/songs/${id}/priority`, {
      method: "PATCH",
      body: JSON.stringify({ priority }),
    }),
  createSong: (payload: Partial<Song>) =>
    request<{ song: Song }>("/api/songs", { method: "POST", body: JSON.stringify(payload) }),
  updateSong: (id: string, payload: Partial<Song>) =>
    request<{ song: Song }>(`/api/songs/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteSong: (id: string) => request<{ ok: true }>(`/api/songs/${id}`, { method: "DELETE" }),
  deleteSongs: (ids: string[]) =>
    request<{ ok: true; deleted: number; ids: string[] }>("/api/songs/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  songPageNames: () => request<{ names: string[] }>("/api/songs/page-names"),
  songPageIdFixes: () => request<SongPageIdFixScan>("/api/songs/page-id-fixes"),
  applySongPageIdFixes: (songIds?: string[]) =>
    request<{ ok: true; updated: number; ids: string[] }>("/api/songs/page-id-fixes/apply", {
      method: "POST",
      body: JSON.stringify(songIds ? { songIds } : {}),
    }),

  images: (q = "") =>
    request<{ root: string; images: ImageAsset[] }>(
      `/api/images${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    ),
  uploadImage: async (file: File, folder: string): Promise<{ image: ImageAsset }> => {
    const form = new FormData();
    form.append("file", file);
    form.append("folder", folder);
    const response = await fetch("/api/images", {
      method: "POST",
      body: form,
      credentials: "include",
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new ApiError(response.status, data?.error ?? response.statusText);
    return data;
  },
  deleteImage: (path: string) =>
    request<{ ok: true }>(`/api/images?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  createVerseOrder: (songId: string, payload: { name: string; order: string }) =>
    request<{ verseOrder: SongVerseOrder }>(`/api/songs/${songId}/verse-orders`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateVerseOrder: (songId: string, id: string, payload: { name?: string; order?: string }) =>
    request<{ verseOrder: SongVerseOrder }>(`/api/songs/${songId}/verse-orders/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteVerseOrder: (songId: string, id: string) =>
    request<{ ok: true }>(`/api/songs/${songId}/verse-orders/${id}`, { method: "DELETE" }),

  fonts: () => request<FontLibraryStatus>("/api/fonts"),
  importFont: (payload: { family?: string; url?: string }) =>
    request<{ font: FontOption }>("/api/fonts/import", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  importMissingFonts: () =>
    request<FontDownloadReport>("/api/fonts/import-missing", { method: "POST" }),
  deleteFont: (id: string) => request<{ ok: true }>(`/api/fonts/${id}`, { method: "DELETE" }),

  branding: () => request<{ branding: BrandingSettings }>("/api/branding"),
  saveBranding: (navBackground: string | null) =>
    request<{ branding: BrandingSettings }>("/api/branding", {
      method: "PUT",
      body: JSON.stringify({ navBackground }),
    }),
  uploadBrandingLogo: async (file: File): Promise<{ branding: BrandingSettings }> => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/branding/logo", {
      method: "POST",
      body: form,
      credentials: "include",
    });
    const data = (await response.json().catch(() => null)) as
      | { branding?: BrandingSettings; error?: string }
      | null;
    if (!response.ok) {
      throw new ApiError(response.status, data?.error ?? "Could not upload logo");
    }
    return data as { branding: BrandingSettings };
  },
  deleteBrandingLogo: () =>
    request<{ branding: BrandingSettings }>("/api/branding/logo", { method: "DELETE" }),
  settings: () => request<{ settings: AppSettings }>("/api/settings"),
  sslStatus: () => request<ControlTlsReport>("/api/ssl/status"),
  saveSettings: (settings: AppSettings) =>
    request<{ settings: AppSettings }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),

  gitStatus: () => request<GitStatus>("/api/git/status"),
  saveGitSettings: (settings: GitSettings) =>
    request<{ settings: GitSettings; repositories: GitStatus["repositories"] }>("/api/git/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
  syncGit: () =>
    request<{ ok: true; repositories: GitStatus["repositories"] }>("/api/git/sync", {
      method: "POST",
    }),
  exportGit: () =>
    request<{ ok: true; repositories: GitStatus["repositories"] }>("/api/git/export", {
      method: "POST",
    }),

  churchsuiteStatus: () =>
    request<{
      status: {
        configured: boolean;
        tokenUrl: string;
        apiUrl: string;
        scopes: string;
        redirectUri: string;
        hasCachedToken: boolean;
      };
    }>("/api/integrations/churchsuite/status"),
  testChurchsuite: () =>
    request<{ ok: true; plans: unknown }>("/api/integrations/churchsuite/test", {
      method: "POST",
    }),
  churchsuitePlans: (query: { from?: string; to?: string; status?: string }) => {
    const params = new URLSearchParams();
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    if (query.status) params.set("status", query.status);
    return request<{
      plans: {
        data: ChurchSuitePlanSummary[];
        pagination?: Record<string, unknown>;
      };
    }>(`/api/integrations/churchsuite/plans?${params.toString()}`);
  },
  songselectWatch: () =>
    request<{ status: SongSelectWatchStatus }>("/api/integrations/songselect/watch"),
  scanSongselectWatch: (force = false) =>
    request<{ report: SongSelectWatchReport; status: SongSelectWatchStatus }>(
      "/api/integrations/songselect/watch/scan",
      { method: "POST", body: JSON.stringify({ force }) },
    ),
  churchsuitePlanPreview: (id: number) =>
    request<{ preview: ChurchSuitePlanPreview }>(
      `/api/integrations/churchsuite/plans/${id}/preview`,
    ),
  importChurchsuitePlan: (
    id: number,
    payload: {
      name?: string;
      serviceDate?: string;
      serviceTime?: string | null;
      songSelections?: Record<string, string>;
    },
  ) =>
    request<{ report: ChurchSuiteImportReport; setlist: unknown }>(
      `/api/integrations/churchsuite/plans/${id}/import`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),

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
  applyImports: (decisions?: SongImportDecision[], simplifyPageIds = false) =>
    request<SongImportReport>("/api/import/apply", {
      method: "POST",
      body: JSON.stringify({
        ...(decisions ? { decisions } : {}),
        ...(simplifyPageIds ? { simplifyPageIds: true } : {}),
      }),
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
  replaceSetlistSong: (id: string, itemId: string, songId: string) =>
    request<{ setlist: SetlistDetail }>(`/api/setlists/${id}/items/${itemId}/song`, {
      method: "PATCH",
      body: JSON.stringify({ songId }),
    }),
  patchItem: (id: string, itemId: string, payload: Record<string, unknown>) =>
    request<{ setlist: SetlistDetail }>(`/api/setlists/${id}/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  saveItemToInventory: (id: string, itemId: string, payload: Record<string, unknown>) =>
    request<{ setlist: SetlistDetail }>(`/api/setlists/${id}/items/${itemId}/save-to-inventory`, {
      method: "POST",
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
  exportSetlistUrl: (id: string, format: "json" | "bundle") =>
    `/api/setlists/${id}/export?format=${format}`,
  downloadSetlistSongsPdf: async (
    id: string,
    options: { fontSize?: number; columns?: number } = {},
  ): Promise<{ blob: Blob; filename: string }> => {
    const params = new URLSearchParams();
    if (options.fontSize !== undefined) params.set("fontSize", String(options.fontSize));
    if (options.columns !== undefined) params.set("columns", String(options.columns));
    const response = await fetch(
      `/api/setlists/${id}/songs.pdf${params.size ? `?${params}` : ""}`,
      { credentials: "include" },
    );
    if (!response.ok) {
      let message = response.statusText;
      try {
        const data = (await response.json()) as { error?: string };
        if (data.error) message = data.error;
      } catch {
        // Keep the HTTP status text when the error body is not JSON.
      }
      throw new ApiError(response.status, message);
    }
    const disposition = response.headers.get("content-disposition") ?? "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    return {
      blob: await response.blob(),
      filename: match?.[1] ?? "service-songs.pdf",
    };
  },
  previewSetlistImport: async (file: File): Promise<{ preview: SetlistImportPreview }> => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/setlists/import/preview", {
      method: "POST",
      body: form,
      credentials: "include",
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new ApiError(response.status, data?.error ?? response.statusText);
    return data;
  },
  importSetlist: async (file: File): Promise<{ report: SetlistImportReport }> => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/setlists/import", {
      method: "POST",
      body: form,
      credentials: "include",
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) throw new ApiError(response.status, data?.error ?? response.statusText);
    return data;
  },

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
  quickSong: (songId: string) =>
    request<{ state: LiveState }>("/api/live/quick-song", {
      method: "POST",
      body: JSON.stringify({ songId }),
    }),
  quickImage: (path: string, title?: string) =>
    request<{ state: LiveState }>("/api/live/quick-image", {
      method: "POST",
      body: JSON.stringify({ path, title }),
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

  backgrounds: () =>
    request<{ backgrounds: BackgroundAsset[]; colors: BackgroundColors }>("/api/backgrounds"),
  saveBackgroundColors: (colors: BackgroundColors) =>
    request<{ colors: BackgroundColors }>("/api/backgrounds/colors", {
      method: "PUT",
      body: JSON.stringify(colors),
    }),
  createBackground: (background: BackgroundInput) =>
    request<{ background: BackgroundAsset }>("/api/backgrounds", {
      method: "POST",
      body: JSON.stringify(background),
    }),
  updateBackground: (id: string, background: BackgroundInput) =>
    request<{ background: BackgroundAsset }>(`/api/backgrounds/${id}`, {
      method: "PATCH",
      body: JSON.stringify(background),
    }),
  deleteBackground: (id: string) =>
    request<{ ok: true }>(`/api/backgrounds/${id}`, { method: "DELETE" }),
  stingers: () => request<{ stingers: StingerAsset[] }>("/api/stingers"),
  createStinger: (stinger: StingerInput) =>
    request<{ stinger: StingerAsset }>("/api/stingers", {
      method: "POST",
      body: JSON.stringify(stinger),
    }),
  updateStinger: (id: string, stinger: StingerInput) =>
    request<{ stinger: StingerAsset }>(`/api/stingers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(stinger),
    }),
  deleteStinger: (id: string) =>
    request<{ ok: true }>(`/api/stingers/${id}`, { method: "DELETE" }),
  tarpThemes: () => request<{ themes: TarpTheme[] }>("/api/tarp/themes"),
  createTarpTheme: (theme: TarpThemeInput) =>
    request<{ theme: TarpTheme }>("/api/tarp/themes", {
      method: "POST",
      body: JSON.stringify(theme),
    }),
  updateTarpTheme: (id: string, theme: TarpThemeInput) =>
    request<{ theme: TarpTheme }>(`/api/tarp/themes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(theme),
    }),
  deleteTarpTheme: (id: string) =>
    request<{ ok: true }>(`/api/tarp/themes/${id}`, { method: "DELETE" }),
  tarpPresentations: () =>
    request<{ presentations: TarpPresentationSummary[] }>("/api/tarp/presentations"),
  tarpPresentation: (id: string) =>
    request<{ presentation: TarpPresentationDetail }>(`/api/tarp/presentations/${id}`),
  createTarpPresentation: (presentation: TarpPresentationInput) =>
    request<{ presentation: TarpPresentationDetail }>("/api/tarp/presentations", {
      method: "POST",
      body: JSON.stringify(presentation),
    }),
  updateTarpPresentation: (id: string, presentation: Partial<TarpPresentationInput>) =>
    request<{ presentation: TarpPresentationDetail }>(`/api/tarp/presentations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(presentation),
    }),
  deleteTarpPresentation: (id: string) =>
    request<{ ok: true }>(`/api/tarp/presentations/${id}`, { method: "DELETE" }),
  addTarpPage: (id: string, fromPageId?: string | null) =>
    request<{ presentation: TarpPresentationDetail }>(`/api/tarp/presentations/${id}/pages`, {
      method: "POST",
      body: JSON.stringify({ fromPageId: fromPageId ?? null }),
    }),
  updateTarpPage: (id: string, page: TarpPageInput) =>
    request<{ page: TarpPage }>(`/api/tarp/pages/${id}`, {
      method: "PATCH",
      body: JSON.stringify(page),
    }),
  deleteTarpPage: (id: string) =>
    request<{ ok: true }>(`/api/tarp/pages/${id}`, { method: "DELETE" }),
  reorderTarpPages: (id: string, pageIds: string[]) =>
    request<{ presentation: TarpPresentationDetail }>(`/api/tarp/presentations/${id}/pages/reorder`, {
      method: "POST",
      body: JSON.stringify({ pageIds }),
    }),
  displayViews: () => request<{ views: DisplayViewLink[] }>("/api/display/views"),
  displayConfig: () => request<{ config: DisplayConfig }>("/api/display/config"),
  saveDisplayConfig: (config: DisplayConfig) =>
    request<{ config: DisplayConfig; state: LiveState }>("/api/display/config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),

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
