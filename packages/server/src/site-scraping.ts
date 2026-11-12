import type {
  SiteCredentialInput,
  SiteCredentialSource,
  SiteScraperProviderSummary,
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
  scrape(input: {
    credentials: SiteScraperCredentials;
    query: string;
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
      "Downloads SongPro, lead sheet, chord and lyric files from the SongSelect website using an authorised account.",
    artifactKinds: ["songpro", "lead", "chord", "lyrics"],
  },
];

const adapters = new Map<string, SiteScraperAdapter>();

export function registerSiteScraperAdapter(adapter: SiteScraperAdapter): void {
  adapters.set(adapter.id, adapter);
}

function providerDefinition(providerId: string): SiteScraperProviderDefinition | null {
  return PROVIDERS.find((provider) => provider.id === providerId) ?? null;
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
  return PROVIDERS.map((provider) => {
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

export async function scrapeSiteFiles(
  userId: string,
  providerId: string,
  query: string,
  kinds: SongResourceKind[] = [],
): Promise<ScrapedSiteFile[]> {
  const provider = providerDefinition(providerId);
  if (!provider) throw new Error("Unknown site scraper provider");
  const credentials = resolveSiteCredentials(userId, providerId);
  if (!credentials) throw new Error(`No credentials configured for ${provider.label}`);
  const adapter = adapters.get(providerId);
  if (!adapter) {
    throw new Error(
      `${provider.label} scraping is not implemented yet; the provider adapter is missing`,
    );
  }
  return adapter.scrape({
    credentials,
    query,
    kinds: kinds.length
      ? kinds.filter((kind) => provider.artifactKinds.includes(kind))
      : provider.artifactKinds,
  });
}
