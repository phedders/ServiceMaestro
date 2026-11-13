import type {
  SiteCredentialInput,
  SiteCredentialSource,
  SiteScraperProviderSummary,
  SiteScraperSearchResult,
  SongResourceKind,
} from "@sm/shared";
import {
  SONG_SCRAPING_BASE_URL,
  SONG_SCRAPING_COOKIE,
  SONG_SCRAPING_PASSWORD,
  SONG_SCRAPING_PROVIDER,
  SONG_SCRAPING_USERNAME,
} from "./config.js";
import { db } from "./db.js";
import { isSongSelectEnabled } from "./integrations.js";
import { decryptSecret, encryptSecret } from "./secrets.js";

interface SiteScraperProviderDefinition {
  id: string;
  label: string;
  description: string;
  artifactKinds: SongResourceKind[];
}

export interface SiteScraperCredentials {
  source: SiteCredentialSource;
  username: string;
  password: string;
  cookie: string;
  baseUrl: string;
}

export interface ScrapedSiteFile {
  kind: SongResourceKind;
  filename: string;
  mime: string;
  data: Buffer;
  sourceUrl?: string;
}

export interface SiteScraperAdapter {
  id: string;
  search(input: {
    credentials: SiteScraperCredentials;
    query: string;
  }): Promise<SiteScraperSearchResult[]>;
  download(input: {
    credentials: SiteScraperCredentials;
    song: SiteScraperSearchResult;
    kinds: SongResourceKind[];
  }): Promise<ScrapedSiteFile[]>;
}

interface StoredSiteSecret {
  password?: string;
  cookie?: string;
}

interface SiteCredentialRow {
  user_id: string;
  provider: string;
  username: string | null;
  secret_encrypted: string;
  created_at: string;
  updated_at: string;
}

const PROVIDERS: SiteScraperProviderDefinition[] = [
  {
    id: "songselect",
    label: "SongSelect website",
    description:
      "Downloads ChordPro, lead sheet, vocal sheet and lyric files from the SongSelect website using an authorised account.",
    artifactKinds: ["chord", "lead", "vocal", "lyrics"],
  },
];

const adapters = new Map<string, SiteScraperAdapter>();

export function registerSiteScraperAdapter(adapter: SiteScraperAdapter): void {
  adapters.set(adapter.id, adapter);
}

function providerAvailable(providerId: string): boolean {
  return providerId !== SONG_SCRAPING_PROVIDER || isSongSelectEnabled();
}

function providerDefinition(providerId: string): SiteScraperProviderDefinition | null {
  const provider = PROVIDERS.find((entry) => entry.id === providerId) ?? null;
  return provider && providerAvailable(provider.id) ? provider : null;
}

function providerBaseUrl(providerId: string): string {
  return providerId === SONG_SCRAPING_PROVIDER
    ? SONG_SCRAPING_BASE_URL
    : "https://songselect.ccli.com";
}

function credentialRow(userId: string, providerId: string): SiteCredentialRow | null {
  return (
    (db
      .prepare("SELECT * FROM site_credentials WHERE user_id = ? AND provider = ?")
      .get(userId, providerId) as SiteCredentialRow | undefined) ?? null
  );
}

function decryptedSecret(row: SiteCredentialRow | null): StoredSiteSecret | null {
  return row ? decryptSecret<StoredSiteSecret>(row.secret_encrypted) : null;
}

function serverCredentials(providerId: string): SiteScraperCredentials | null {
  if (!providerAvailable(providerId)) return null;
  if (providerId !== SONG_SCRAPING_PROVIDER) return null;
  if (!SONG_SCRAPING_USERNAME && !SONG_SCRAPING_PASSWORD && !SONG_SCRAPING_COOKIE) {
    return null;
  }
  return {
    source: "server",
    username: SONG_SCRAPING_USERNAME,
    password: SONG_SCRAPING_PASSWORD,
    cookie: SONG_SCRAPING_COOKIE,
    baseUrl: SONG_SCRAPING_BASE_URL,
  };
}

export function resolveSiteCredentials(
  userId: string,
  providerId: string,
): SiteScraperCredentials | null {
  if (!providerAvailable(providerId)) return null;
  const row = credentialRow(userId, providerId);
  const secret = decryptedSecret(row);
  if (row && secret) {
    return {
      source: "user",
      username: row.username ?? "",
      password: secret.password ?? "",
      cookie: secret.cookie ?? "",
      baseUrl: providerBaseUrl(providerId),
    };
  }
  return serverCredentials(providerId);
}

export function listSiteScraperProviders(userId: string): SiteScraperProviderSummary[] {
  return PROVIDERS.filter((provider) => providerAvailable(provider.id)).map((provider) => {
    const row = credentialRow(userId, provider.id);
    const server = serverCredentials(provider.id);
    return {
      id: provider.id,
      label: provider.label,
      description: provider.description,
      baseUrl: providerBaseUrl(provider.id),
      artifactKinds: provider.artifactKinds,
      userConfigured: Boolean(row),
      userUsername: row?.username ?? null,
      userUpdatedAt: row?.updated_at ?? null,
      serverConfigured: Boolean(server),
      activeSource: row ? "user" : server ? "server" : null,
    };
  });
}

export function saveSiteCredentials(
  userId: string,
  providerId: string,
  input: SiteCredentialInput,
): SiteScraperProviderSummary {
  const provider = providerDefinition(providerId);
  if (!provider) throw new Error("Unknown site scraper provider");
  const existing = credentialRow(userId, providerId);
  const existingSecret = decryptedSecret(existing);
  const password = input.password ?? existingSecret?.password ?? "";
  const cookie = input.cookie ?? existingSecret?.cookie ?? "";
  if (!password && !cookie) {
    throw new Error("Enter a password or session cookie");
  }
  const username = input.username?.trim() || existing?.username || null;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO site_credentials
       (user_id, provider, username, secret_encrypted, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET
       username = excluded.username,
       secret_encrypted = excluded.secret_encrypted,
       updated_at = excluded.updated_at`,
  ).run(userId, providerId, username, encryptSecret({ password, cookie }), now, now);
  return listSiteScraperProviders(userId).find((entry) => entry.id === providerId)!;
}

export function deleteSiteCredentials(userId: string, providerId: string): void {
  db.prepare("DELETE FROM site_credentials WHERE user_id = ? AND provider = ?").run(
    userId,
    providerId,
  );
}

export async function searchSiteSongs(
  userId: string,
  providerId: string,
  query: string,
): Promise<SiteScraperSearchResult[]> {
  const provider = providerDefinition(providerId);
  if (!provider) throw new Error("Unknown site scraper provider");
  const credentials = resolveSiteCredentials(userId, providerId);
  if (!credentials) throw new Error(`No credentials configured for ${provider.label}`);
  const adapter = adapters.get(providerId);
  if (!adapter) throw new Error(`${provider.label} scraping is not implemented`);
  return adapter.search({ credentials, query });
}

export async function downloadSiteSong(
  userId: string,
  providerId: string,
  song: SiteScraperSearchResult,
  kinds: SongResourceKind[] = [],
): Promise<ScrapedSiteFile[]> {
  const provider = providerDefinition(providerId);
  if (!provider) throw new Error("Unknown site scraper provider");
  const credentials = resolveSiteCredentials(userId, providerId);
  if (!credentials) throw new Error(`No credentials configured for ${provider.label}`);
  const adapter = adapters.get(providerId);
  if (!adapter) throw new Error(`${provider.label} scraping is not implemented`);
  const selected = kinds.length
    ? kinds.filter((kind) => provider.artifactKinds.includes(kind))
    : provider.artifactKinds;
  return adapter.download({
    credentials,
    song,
    kinds: selected.length ? selected : provider.artifactKinds,
  });
}

function cleanFilename(value: string): string {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140) || "song"
  );
}

function scraperHeaders(
  credentials: SiteScraperCredentials,
  referer: string,
): Record<string, string> {
  return {
    accept: "*/*",
    origin: credentials.baseUrl,
    referer,
    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156 Safari/537.36",
    cookie: credentials.cookie,
  };
}

async function songSelectProfile(credentials: SiteScraperCredentials): Promise<{
  signedIn: boolean;
  antiForgeryToken: string;
  licenseNumber: string | null;
}> {
  if (!credentials.cookie.trim()) {
    throw new Error(
      "SongSelect requires a signed-in session cookie because its login challenge cannot be automated. Sign in through a browser and paste the session cookie.",
    );
  }
  const response = await fetch(`${credentials.baseUrl}/api/user/GetProfileDetails`, {
    headers: scraperHeaders(credentials, `${credentials.baseUrl}/`),
  });
  if (!response.ok) {
    throw new Error(`SongSelect profile request failed (${response.status})`);
  }
  const data = (await response.json()) as {
    payload?: {
      signedIn?: boolean;
      antiForgeryToken?: string;
      licenseNumber?: string | null;
    };
  };
  const payload = data.payload;
  if (!payload?.signedIn || !payload.antiForgeryToken) {
    throw new Error("SongSelect session is not signed in; update the site credentials");
  }
  return {
    signedIn: true,
    antiForgeryToken: payload.antiForgeryToken,
    licenseNumber: payload.licenseNumber ?? null,
  };
}

interface SongSelectSearchItem {
  title: string;
  songNumber: string;
  slug: string;
  authors: string[];
  productExists?: {
    lyrics?: boolean;
    chords?: boolean;
    lead?: boolean;
    vocal?: boolean;
  };
}

function availability(item: SongSelectSearchItem): SongResourceKind[] {
  const kinds: SongResourceKind[] = [];
  if (item.productExists?.lyrics) kinds.push("lyrics");
  if (item.productExists?.chords) kinds.push("chord");
  if (item.productExists?.lead) kinds.push("lead");
  if (item.productExists?.vocal) kinds.push("vocal");
  return kinds;
}

async function songSelectSearch(
  credentials: SiteScraperCredentials,
  query: string,
): Promise<SiteScraperSearchResult[]> {
  const profile = await songSelectProfile(credentials);
  const form = new FormData();
  form.append("numPerPage", "25");
  form.append("search", query);
  form.append("page", "1");
  form.append("expandToAllSongs", "false");
  const referer = `${credentials.baseUrl}/search/results?search=${encodeURIComponent(query)}`;
  const response = await fetch(`${credentials.baseUrl}/api/GetSongSearchResults`, {
    method: "POST",
    headers: {
      ...scraperHeaders(credentials, referer),
      RequestVerificationToken: profile.antiForgeryToken,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`SongSelect search failed (${response.status})`);
  }
  const data = (await response.json()) as {
    payload?: { items?: SongSelectSearchItem[] };
  };
  return (data.payload?.items ?? []).map((item) => ({
    provider: "songselect",
    songNumber: item.songNumber,
    slug: item.slug,
    title: item.title,
    authors: item.authors ?? [],
    availableKinds: availability(item),
  }));
}

interface SongSelectLyricsPart {
  lyrics: string;
  partLabel: string;
}

interface SongSelectSongDetails {
  title: string;
  ccliSongNumber: string;
  slug: string;
  defaultKey: string | string[];
  lyrics: SongSelectLyricsPart[];
  authors: Array<{ label: string }>;
  copyrights: string;
  products?: Record<
    string,
    { exists?: boolean; authorized?: boolean; noAuthReason?: string | null }
  >;
}

async function songSelectDetails(
  credentials: SiteScraperCredentials,
  song: SiteScraperSearchResult,
): Promise<SongSelectSongDetails> {
  const songUrl = `${credentials.baseUrl}/songs/${encodeURIComponent(song.songNumber)}/${encodeURIComponent(song.slug)}`;
  const response = await fetch(
    `${credentials.baseUrl}/api/GetSongDetails?songNumber=${encodeURIComponent(song.songNumber)}&slug=${encodeURIComponent(song.slug)}`,
    { headers: scraperHeaders(credentials, songUrl) },
  );
  if (!response.ok) {
    throw new Error(`SongSelect song details failed (${response.status})`);
  }
  const data = (await response.json()) as { payload?: SongSelectSongDetails };
  if (!data.payload) throw new Error("SongSelect returned no song details");
  return data.payload;
}

function lyricsText(
  song: SiteScraperSearchResult,
  details: SongSelectSongDetails,
  licenseNumber: string | null,
): string {
  const lines: string[] = [details.title, ""];
  for (const part of details.lyrics ?? []) {
    lines.push(part.partLabel);
    lines.push(...part.lyrics.split(" | "));
    lines.push("");
  }
  lines.push((details.authors ?? []).map((author) => author.label).join(", "));
  lines.push(`CCLI Song #${details.ccliSongNumber || song.songNumber}`);
  if (details.copyrights) lines.push(details.copyrights);
  lines.push(
    "For use solely with the SongSelect® Terms of Use. All rights reserved. www.ccli.com",
  );
  if (licenseNumber) lines.push(`CCLI Licence No. ${licenseNumber}`);
  lines.push("");
  return lines.join("\n");
}

async function songSelectDownload(
  credentials: SiteScraperCredentials,
  song: SiteScraperSearchResult,
  kinds: SongResourceKind[],
): Promise<ScrapedSiteFile[]> {
  const profile = await songSelectProfile(credentials);
  const details = await songSelectDetails(credentials, song);
  const key = Array.isArray(details.defaultKey)
    ? details.defaultKey[0] ?? "G"
    : details.defaultKey || "G";
  const songUrl = `${credentials.baseUrl}/songs/${encodeURIComponent(song.songNumber)}/${encodeURIComponent(song.slug)}`;
  const files: ScrapedSiteFile[] = [];

  for (const kind of kinds) {
    if (kind === "lyrics") {
      files.push({
        kind,
        filename: `${cleanFilename(song.title)}-lyrics.txt`,
        mime: "text/plain; charset=utf-8",
        data: Buffer.from(lyricsText(song, details, profile.licenseNumber), "utf8"),
        sourceUrl: songUrl,
      });
      continue;
    }
    if (kind === "chord") {
      const response = await fetch(
        `${credentials.baseUrl}/api/GetSongChordPro?songNumber=${encodeURIComponent(song.songNumber)}&key=${encodeURIComponent(key)}&style=Standard&columns=1`,
        { headers: scraperHeaders(credentials, `${songUrl}/viewchordsheet`) },
      );
      if (!response.ok) throw new Error(`SongSelect ChordPro failed (${response.status})`);
      const data = (await response.json()) as { payload?: string };
      if (!data.payload) throw new Error("SongSelect returned no ChordPro content");
      files.push({
        kind,
        filename: `${cleanFilename(song.title)}-chordpro-${cleanFilename(key)}.cho`,
        mime: "text/plain; charset=utf-8",
        data: Buffer.from(data.payload, "utf8"),
        sourceUrl: `${songUrl}/viewchordsheet`,
      });
      continue;
    }
    if (kind === "lead" || kind === "vocal") {
      const endpoint = kind === "lead" ? "GetSongLeadPdf" : "GetSongVocalPdf";
      const view = kind === "lead" ? "viewleadsheet" : "viewvocalsheet";
      const query = new URLSearchParams({
        songNumber: song.songNumber,
        transposeKey: key,
        octave: "0",
        noteSize: "0",
        orientation: "portrait",
        paperSize: "A4",
        activityType: "downloaded",
        renderer: "pipeline",
      });
      const sourceUrl = `${credentials.baseUrl}/api/${endpoint}?${query.toString()}`;
      const response = await fetch(sourceUrl, {
        headers: scraperHeaders(credentials, `${songUrl}/${view}`),
      });
      if (!response.ok) throw new Error(`SongSelect ${kind} PDF failed (${response.status})`);
      const data = Buffer.from(await response.arrayBuffer());
      files.push({
        kind,
        filename: `${cleanFilename(song.title)}-${kind}-${cleanFilename(key)}.pdf`,
        mime: "application/pdf",
        data,
        sourceUrl,
      });
      continue;
    }
    throw new Error(`SongSelect does not support the ${kind} download`);
  }

  return files;
}

const songSelectAdapter: SiteScraperAdapter = {
  id: "songselect",
  search: ({ credentials, query }) => songSelectSearch(credentials, query),
  download: ({ credentials, song, kinds }) => songSelectDownload(credentials, song, kinds),
};

registerSiteScraperAdapter(songSelectAdapter);
