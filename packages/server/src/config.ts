import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");

function loadDotEnvFile(): void {
  const file = process.env.SM_ENV_FILE ?? path.resolve(packageRoot, "../../.env");
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2")
      .replace(/\\n/g, "\n");
  }
}

loadDotEnvFile();

type RepoName = "songs" | "setlists" | "bibles" | "templates";
type LfsMode = "required" | "auto" | "off";

interface FileRepoConfig {
  path?: unknown;
  remote?: unknown;
  branch?: unknown;
  optional?: unknown;
  lfs?: unknown;
}

interface FileServerConfig {
  host?: unknown;
  port?: unknown;
  displayPort?: unknown;
  dataDir?: unknown;
  adminPassword?: unknown;
  outputToken?: unknown;
  secretKey?: unknown;
  sessionDays?: unknown;
  secureCookies?: unknown;
  logLevel?: unknown;
}

interface FilePathsConfig {
  songs?: unknown;
  bible?: unknown;
  bibles?: unknown;
  images?: unknown;
  fonts?: unknown;
  templates?: unknown;
  songselect?: unknown;
  songSelect?: unknown;
}

interface FileSongSelectConfig {
  watchEnabled?: unknown;
  watchIntervalSeconds?: unknown;
}

interface FileSongScrapingConfig {
  provider?: unknown;
  baseUrl?: unknown;
  username?: unknown;
  password?: unknown;
  cookie?: unknown;
}

interface FileChurchSuiteConfig {
  clientId?: unknown;
  clientSecret?: unknown;
  tokenUrl?: unknown;
  apiUrl?: unknown;
  scopes?: unknown;
  redirectUri?: unknown;
}

interface FileSslConfig {
  enabled?: unknown;
  dir?: unknown;
  certFile?: unknown;
  keyFile?: unknown;
  hosts?: unknown;
}

interface FileWebAuthnConfig {
  rpId?: unknown;
  origin?: unknown;
  rpName?: unknown;
}

interface FileBrandingConfig {
  navBackground?: unknown;
  logoFile?: unknown;
}

interface FileGitConfig {
  enabled?: unknown;
  autoSave?: unknown;
  autoPush?: unknown;
  workDir?: unknown;
  pullIntervalSeconds?: unknown;
  author?: { name?: unknown; email?: unknown };
  sshKeyFile?: unknown;
  knownHostsFile?: unknown;
  repositories?: Record<string, FileRepoConfig>;
}

interface FileConfig {
  server?: FileServerConfig;
  paths?: FilePathsConfig;
  songselect?: FileSongSelectConfig;
  songScraping?: FileSongScrapingConfig;
  churchsuite?: FileChurchSuiteConfig;
  ssl?: FileSslConfig;
  webauthn?: FileWebAuthnConfig;
  branding?: FileBrandingConfig;
  git?: FileGitConfig;
  /** Top-level form used by the documented configuration example. */
  repositories?: Record<string, FileRepoConfig>;
}

function configFileCandidates(): { files: string[]; explicit: boolean } {
  const explicit = process.env.SM_CONFIG_FILE?.trim();
  if (explicit) return { files: [path.resolve(explicit)], explicit: true };
  const files = [
    path.resolve(process.cwd(), "config.yaml"),
    path.resolve(process.cwd(), "config.yml"),
    path.resolve(process.cwd(), "config.json"),
    path.resolve(packageRoot, "../../config.yaml"),
    path.resolve(packageRoot, "../../config.yml"),
    path.resolve(packageRoot, "../../config.json"),
    "/config/config.yaml",
    "/config/config.yml",
    "/config/config.json",
  ];
  return { files: [...new Set(files)], explicit: false };
}

function loadConfigFile(): FileConfig {
  const { files, explicit } = configFileCandidates();
  const file = files.find((candidate) => fs.existsSync(candidate));
  if (!file) {
    if (explicit) {
      // eslint-disable-next-line no-console
      console.warn(`[sm] Config file not found: ${files[0]}`);
    }
    return {};
  }
  try {
    const parsed = parseYaml(fs.readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      // eslint-disable-next-line no-console
      console.warn(`[sm] Config file must contain an object: ${file}`);
      return {};
    }
    return parsed as FileConfig;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[sm] Could not read config file ${file}: ${(error as Error).message}`);
    return {};
  }
}

const fileConfig = loadConfigFile();
const serverConfig = fileConfig.server ?? {};
const pathsConfig = fileConfig.paths ?? {};
const songselectConfig = fileConfig.songselect ?? {};
const songScrapingConfig = fileConfig.songScraping ?? {};
const churchsuiteConfig = fileConfig.churchsuite ?? {};
const sslConfig = fileConfig.ssl ?? {};
const webauthnConfig = fileConfig.webauthn ?? {};
const brandingConfig = fileConfig.branding ?? {};
const gitConfig = fileConfig.git ?? {};
const repositoryConfig = {
  ...(gitConfig.repositories ?? {}),
  ...(fileConfig.repositories ?? {}),
};

function fileString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function fileNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function fileBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string" && value.trim() !== "") {
    return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
  }
  return undefined;
}

function optionString(name: string, fileValue: unknown, fallback: string): string {
  const env = process.env[name];
  if (env !== undefined && env.trim() !== "") return env;
  const value = fileString(fileValue);
  return value !== undefined && value.trim() !== "" ? value : fallback;
}

function optionNumber(name: string, fileValue: unknown, fallback: number): number {
  const env = process.env[name];
  if (env !== undefined && env.trim() !== "") {
    const value = Number(env);
    if (Number.isFinite(value)) return value;
  }
  return fileNumber(fileValue) ?? fallback;
}

function optionBool(name: string, fileValue: unknown, fallback: boolean): boolean {
  const env = process.env[name];
  if (env !== undefined && env.trim() !== "") {
    return !["0", "false", "no", "off"].includes(env.trim().toLowerCase());
  }
  return fileBool(fileValue) ?? fallback;
}

function optionalOptionString(name: string, fileValue: unknown): string | undefined {
  const env = process.env[name];
  if (env !== undefined && env.trim() !== "") return env;
  return fileString(fileValue);
}

function optionList(name: string, fileValue: unknown): string[] {
  const env = process.env[name];
  const entries = env !== undefined
    ? env.split(",")
    : Array.isArray(fileValue)
      ? fileValue
      : fileString(fileValue)?.split(",") ?? [];
  return entries
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function portOption(name: string, fileValue: unknown, fallback: number): number {
  const env = process.env[name];
  const value = env !== undefined && env.trim() !== "" ? Number(env) : fileNumber(fileValue);
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return value;
}

function secretOption(name: string, fileValue: unknown, fallback = ""): string {
  const file = process.env[`${name}_FILE`];
  if (file) {
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (value !== "") return value;
    } catch {
      // Fall through to the environment or config file value.
    }
  }
  const env = process.env[name];
  if (env !== undefined && env !== "") return env;
  const value = fileString(fileValue);
  return value !== undefined && value !== "" ? value : fallback;
}

function optionalEnvFile(name: string): string | undefined {
  const file = process.env[`${name}_FILE`];
  if (file) {
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (value !== "") return value;
    } catch {
      // Fall through to the environment value.
    }
  }
  const env = process.env[name];
  return env !== undefined && env.trim() !== "" ? env : undefined;
}

export interface GitRepoConfig {
  name: RepoName;
  path: string;
  remote: string | null;
  branch: string;
  optional: boolean;
  lfs: LfsMode;
}

export const HOST = optionString("SM_HOST", serverConfig.host, "0.0.0.0");
export const PORT = portOption("SM_PORT", serverConfig.port, 8080);
export const DISPLAY_PORT = portOption("SM_DISPLAY_PORT", serverConfig.displayPort, 8081);
export const LOG_LEVEL = optionString("SM_LOG_LEVEL", serverConfig.logLevel, "info");
export const SECURE_COOKIES = optionBool("SM_SECURE_COOKIES", serverConfig.secureCookies, true);
export const DATA_DIR = path.resolve(
  optionString("SM_DATA_DIR", serverConfig.dataDir, path.join(packageRoot, "data")),
);
export const SSL_ENABLED = optionBool("SM_SSL_ENABLED", sslConfig.enabled, true);
export const SSL_DIR = path.resolve(
  optionString("SM_SSL_DIR", sslConfig.dir, path.join(DATA_DIR, "ssl")),
);
export const SSL_CERT_FILE = optionalOptionString("SM_SSL_CERT_FILE", sslConfig.certFile);
export const SSL_KEY_FILE = optionalOptionString("SM_SSL_KEY_FILE", sslConfig.keyFile);
export const SSL_HOSTS = optionList("SM_SSL_HOSTS", sslConfig.hosts);
export const WEBAUTHN_RP_ID = optionalOptionString("SM_WEBAUTHN_RP_ID", webauthnConfig.rpId);
export const WEBAUTHN_ORIGIN = optionalOptionString("SM_WEBAUTHN_ORIGIN", webauthnConfig.origin);
export const WEBAUTHN_RP_NAME = optionString(
  "SM_WEBAUTHN_RP_NAME",
  webauthnConfig.rpName,
  "Service Maestro",
);
export const BRANDING_NAV_BACKGROUND = optionalOptionString(
  "SM_BRANDING_NAV_BACKGROUND",
  brandingConfig.navBackground,
);
export const BRANDING_LOGO_FILE = optionalOptionString(
  "SM_BRANDING_LOGO_FILE",
  brandingConfig.logoFile,
);
export const CONTROL_DIST = path.resolve(packageRoot, "../control/dist");
export const DISPLAY_DIR = path.resolve(packageRoot, "../display");
export const SONGS_DIR = path.resolve(
  optionString("SM_SONGS_DIR", pathsConfig.songs, path.join(packageRoot, "../../samples")),
);
export const BIBLE_DIR = path.resolve(
  optionString(
    "SM_BIBLE_DIR",
    pathsConfig.bible ?? pathsConfig.bibles,
    path.join(packageRoot, "../../samples/bible"),
  ),
);
export const ASSETS_DIR = path.join(DATA_DIR, "assets");
export const FONTS_DIR = path.resolve(
  optionString("SM_FONTS_DIR", pathsConfig.fonts, path.join(DATA_DIR, "fonts")),
);
export const IMAGES_DIR = path.resolve(
  optionString(
    "SM_IMAGES_DIR",
    pathsConfig.images,
    path.join(packageRoot, "../../library/images"),
  ),
);
const songselectPath = pathsConfig.songselect ?? pathsConfig.songSelect;
export const SONGSELECT_WATCH_DIR = path.resolve(
  optionString(
    "SM_SONGSELECT_WATCH_DIR",
    songselectPath,
    path.join(DATA_DIR, "imports", "songselect"),
  ),
);
export const SONGSELECT_WATCH_ENABLED = optionBool(
  "SM_SONGSELECT_WATCH_ENABLED",
  songselectConfig.watchEnabled,
  true,
);
export const SONGSELECT_WATCH_INTERVAL = Math.max(
  2,
  Math.min(
    3600,
    optionNumber(
      "SM_SONGSELECT_WATCH_INTERVAL",
      songselectConfig.watchIntervalSeconds,
      10,
    ),
  ),
);
export const SONG_SCRAPING_PROVIDER = optionString(
  "SM_SONG_SCRAPING_PROVIDER",
  songScrapingConfig.provider,
  "songselect",
);
export const SONG_SCRAPING_BASE_URL = optionString(
  "SM_SONG_SCRAPING_BASE_URL",
  songScrapingConfig.baseUrl,
  "https://songselect.ccli.com",
);
export const SONG_SCRAPING_USERNAME = secretOption(
  "SM_SONG_SCRAPING_USERNAME",
  songScrapingConfig.username,
);
export const SONG_SCRAPING_PASSWORD = secretOption(
  "SM_SONG_SCRAPING_PASSWORD",
  songScrapingConfig.password,
);
export const SONG_SCRAPING_COOKIE = secretOption(
  "SM_SONG_SCRAPING_COOKIE",
  songScrapingConfig.cookie,
);
export const TEMPLATES_DIR = path.resolve(
  optionString("SM_TEMPLATES_DIR", pathsConfig.templates, path.join(DATA_DIR, "templates")),
);
export const OUTPUT_TOKEN = secretOption("SM_OUTPUT_TOKEN", serverConfig.outputToken, "dev-output");
export const ADMIN_PASSWORD = secretOption("SM_ADMIN_PASSWORD", serverConfig.adminPassword, "admin");
export const SECRET_KEY = secretOption("SM_SECRET_KEY", serverConfig.secretKey, "");
export const SESSION_DAYS = optionNumber("SM_SESSION_DAYS", serverConfig.sessionDays, 7);
export const COOKIE_NAME = "sm_session";

export const GIT_ENABLED = optionBool("SM_GIT_ENABLED", gitConfig.enabled, true);
export const GIT_AUTO_SAVE = optionBool("SM_GIT_AUTO_SAVE", gitConfig.autoSave, true);
export const GIT_AUTO_PUSH = optionBool("SM_GIT_AUTO_PUSH", gitConfig.autoPush, true);
export const GIT_PULL_INTERVAL = optionNumber(
  "SM_GIT_PULL_INTERVAL",
  gitConfig.pullIntervalSeconds,
  60,
);
export const GIT_AUTHOR_NAME = optionString(
  "SM_GIT_AUTHOR_NAME",
  gitConfig.author?.name,
  "Service Maestro",
);
export const GIT_AUTHOR_EMAIL = optionString(
  "SM_GIT_AUTHOR_EMAIL",
  gitConfig.author?.email,
  "maestro@localhost",
);
export const GIT_SSH_KEY_FILE = optionalOptionString(
  "SM_GIT_SSH_KEY_FILE",
  gitConfig.sshKeyFile,
);
export const GIT_KNOWN_HOSTS_FILE = optionalOptionString(
  "SM_GIT_KNOWN_HOSTS_FILE",
  gitConfig.knownHostsFile,
);
const gitWorkDirValue = optionalOptionString("SM_GIT_WORK_DIR", gitConfig.workDir);
const gitWorkDir = gitWorkDirValue ? path.resolve(gitWorkDirValue) : null;

export const CHURCHSUITE_CLIENT_ID = secretOption(
  "SM_CHURCHSUITE_CLIENT_ID",
  churchsuiteConfig.clientId,
);
export const CHURCHSUITE_CLIENT_SECRET = secretOption(
  "SM_CHURCHSUITE_CLIENT_SECRET",
  churchsuiteConfig.clientSecret,
);
export const CHURCHSUITE_TOKEN_URL = optionString(
  "SM_CHURCHSUITE_TOKEN_URL",
  churchsuiteConfig.tokenUrl,
  "https://login.churchsuite.com/oauth2/token",
);
export const CHURCHSUITE_API_URL = optionString(
  "SM_CHURCHSUITE_API_URL",
  churchsuiteConfig.apiUrl,
  "https://api.churchsuite.com/v2",
);
export const CHURCHSUITE_SCOPES = optionString(
  "SM_CHURCHSUITE_SCOPES",
  churchsuiteConfig.scopes,
  "planning.read",
);
export const CHURCHSUITE_REDIRECT_URI = optionString(
  "SM_CHURCHSUITE_REDIRECT_URI",
  churchsuiteConfig.redirectUri,
  "",
);

function repo(name: RepoName, optional = false): GitRepoConfig {
  const fromFile = repositoryConfig[name] ?? {};
  const envPrefix = `SM_GIT_${name.toUpperCase()}`;
  const remote =
    optionalEnvFile(`${envPrefix}_REMOTE`) ?? fileString(fromFile.remote) ?? "";
  const branchCandidates = [
    process.env[`${envPrefix}_BRANCH`]?.trim(),
    process.env[`${envPrefix}_REMOTE_BRANCH`]?.trim(),
    name === "setlists" ? process.env.SM_GIT_SETLIST_REMOTE_BRANCH?.trim() : undefined,
    fileString(fromFile.branch)?.trim(),
  ].filter((value): value is string => Boolean(value));
  const filePath = fileString(fromFile.path);
  const defaultPath = gitWorkDir
    ? path.join(gitWorkDir, name)
    : path.join(DATA_DIR, "repos", name);
  const rawLfs =
    process.env[`${envPrefix}_LFS`] ??
    fileString(fromFile.lfs) ??
    (name === "bibles" ? "required" : "auto");
  const lfs: LfsMode =
    rawLfs === "required" || rawLfs === "auto" || rawLfs === "off"
      ? rawLfs
      : name === "bibles"
        ? "required"
        : "auto";
  return {
    name,
    path: path.resolve(process.env[`${envPrefix}_PATH`] ?? filePath ?? defaultPath),
    remote: remote.trim() || null,
    branch: branchCandidates[0] ?? "main",
    optional: optionBool(
      `${envPrefix}_OPTIONAL`,
      fromFile.optional,
      name === "bibles" ? true : optional,
    ),
    lfs,
  };
}

export const GIT_REPOS: Record<RepoName, GitRepoConfig> = {
  songs: repo("songs"),
  setlists: repo("setlists"),
  bibles: repo("bibles", true),
  templates: repo("templates", true),
};
