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

interface FileConfig {
  git?: {
    enabled?: boolean;
    autoSave?: boolean;
    autoPush?: boolean;
    pullIntervalSeconds?: number;
    author?: { name?: string; email?: string };
    sshKeyFile?: string;
    knownHostsFile?: string;
    repositories?: Record<
      string,
      {
        path?: string;
        remote?: string | null;
        branch?: string;
        optional?: boolean;
        lfs?: "required" | "auto" | "off";
      }
    >;
  };
}

function loadConfigFile(): FileConfig {
  const file = process.env.SM_CONFIG_FILE;
  if (!file) return {};
  try {
    if (!fs.existsSync(file)) return {};
    return (parseYaml(fs.readFileSync(file, "utf8")) ?? {}) as FileConfig;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[sm] Could not read config file ${file}: ${(error as Error).message}`);
    return {};
  }
}

const fileConfig = loadConfigFile();
const gitConfig = fileConfig.git ?? {};

function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function stringEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export interface GitRepoConfig {
  name: "songs" | "setlists" | "bibles" | "templates";
  path: string;
  remote: string | null;
  branch: string;
  optional: boolean;
  lfs: "required" | "auto" | "off";
}

function portEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return value;
}

export const HOST = process.env.SM_HOST ?? "0.0.0.0";
export const PORT = portEnv("SM_PORT", 8080);
export const DISPLAY_PORT = portEnv("SM_DISPLAY_PORT", 8081);
export const DATA_DIR = path.resolve(process.env.SM_DATA_DIR ?? path.join(packageRoot, "data"));
export const CONTROL_DIST = path.resolve(packageRoot, "../control/dist");
export const DISPLAY_DIR = path.resolve(packageRoot, "../display");
export const SONGS_DIR = path.resolve(
  process.env.SM_SONGS_DIR ?? path.join(packageRoot, "../../samples"),
);
export const BIBLE_DIR = path.resolve(
  process.env.SM_BIBLE_DIR ?? path.join(packageRoot, "../../samples/bible"),
);
export const ASSETS_DIR = path.join(DATA_DIR, "assets");
export const FONTS_DIR = path.resolve(process.env.SM_FONTS_DIR ?? path.join(DATA_DIR, "fonts"));
export const IMAGES_DIR = path.resolve(
  process.env.SM_IMAGES_DIR ?? path.join(packageRoot, "../../library/images"),
);
export const SONGSELECT_WATCH_DIR = path.resolve(
  process.env.SM_SONGSELECT_WATCH_DIR ?? path.join(DATA_DIR, "imports", "songselect"),
);
export const SONGSELECT_WATCH_ENABLED = boolEnv("SM_SONGSELECT_WATCH_ENABLED", true);
export const SONGSELECT_WATCH_INTERVAL = Math.max(
  2,
  Math.min(3600, Number(process.env.SM_SONGSELECT_WATCH_INTERVAL ?? 10) || 10),
);
export const TEMPLATES_DIR = path.resolve(process.env.SM_TEMPLATES_DIR ?? path.join(DATA_DIR, "templates"));
export const OUTPUT_TOKEN = process.env.SM_OUTPUT_TOKEN ?? "dev-output";
export const ADMIN_PASSWORD = process.env.SM_ADMIN_PASSWORD ?? "admin";
export const SESSION_DAYS = Number(process.env.SM_SESSION_DAYS ?? 7);
export const COOKIE_NAME = "sm_session";

export const GIT_ENABLED = boolEnv("SM_GIT_ENABLED", gitConfig.enabled ?? true);
export const GIT_AUTO_SAVE = boolEnv("SM_GIT_AUTO_SAVE", gitConfig.autoSave ?? true);
export const GIT_AUTO_PUSH = boolEnv("SM_GIT_AUTO_PUSH", gitConfig.autoPush ?? true);
export const GIT_PULL_INTERVAL = Number(
  process.env.SM_GIT_PULL_INTERVAL ?? gitConfig.pullIntervalSeconds ?? 60,
);
export const GIT_AUTHOR_NAME = stringEnv(
  "SM_GIT_AUTHOR_NAME",
  gitConfig.author?.name ?? "Service Maestro",
);
export const GIT_AUTHOR_EMAIL = stringEnv(
  "SM_GIT_AUTHOR_EMAIL",
  gitConfig.author?.email ?? "maestro@localhost",
);
export const GIT_SSH_KEY_FILE = process.env.SM_GIT_SSH_KEY_FILE ?? gitConfig.sshKeyFile;
export const GIT_KNOWN_HOSTS_FILE =
  process.env.SM_GIT_KNOWN_HOSTS_FILE ?? gitConfig.knownHostsFile;

function envFile(name: string): string {
  const file = process.env[`${name}_FILE`];
  if (file) {
    try {
      return fs.readFileSync(file, "utf8").trim();
    } catch {
      // Fall back to an empty value; the integration will report itself unconfigured.
    }
  }
  return process.env[name] ?? "";
}

function optionalEnvFile(name: string): string | undefined {
  const file = process.env[`${name}_FILE`];
  if (file) {
    try {
      return fs.readFileSync(file, "utf8").trim();
    } catch {
      return undefined;
    }
  }
  return process.env[name];
}

export const CHURCHSUITE_CLIENT_ID = envFile("SM_CHURCHSUITE_CLIENT_ID");
export const CHURCHSUITE_CLIENT_SECRET = envFile("SM_CHURCHSUITE_CLIENT_SECRET");
export const CHURCHSUITE_TOKEN_URL =
  process.env.SM_CHURCHSUITE_TOKEN_URL ?? "https://login.churchsuite.com/oauth2/token";
export const CHURCHSUITE_API_URL =
  process.env.SM_CHURCHSUITE_API_URL ?? "https://api.churchsuite.com/v2";
export const CHURCHSUITE_SCOPES = process.env.SM_CHURCHSUITE_SCOPES ?? "planning.read";
export const CHURCHSUITE_REDIRECT_URI =
  process.env.SM_CHURCHSUITE_REDIRECT_URI ?? "";

function repo(
  name: "songs" | "setlists" | "bibles" | "templates",
  defaultPath: string,
  optional = false,
): GitRepoConfig {
  const fromFile = gitConfig.repositories?.[name] ?? {};
  const envPrefix = `SM_GIT_${name.toUpperCase()}`;
  const remote =
    optionalEnvFile(`${envPrefix}_REMOTE`) ?? fromFile.remote ?? "";
  const branchCandidates = [
    process.env[`${envPrefix}_BRANCH`],
    process.env[`${envPrefix}_REMOTE_BRANCH`],
    name === "setlists" ? process.env.SM_GIT_SETLIST_REMOTE_BRANCH : undefined,
  ].filter((value): value is string => Boolean(value?.trim()));
  return {
    name,
    path: path.resolve(process.env[`${envPrefix}_PATH`] ?? fromFile.path ?? defaultPath),
    remote: remote.trim() || null,
    branch: branchCandidates[0]?.trim() ?? fromFile.branch ?? "main",
    optional:
      name === "bibles"
        ? boolEnv("SM_GIT_BIBLES_OPTIONAL", fromFile.optional ?? true)
        : (fromFile.optional ?? optional),
    lfs:
      (process.env[`${envPrefix}_LFS`] as GitRepoConfig["lfs"] | undefined) ??
      fromFile.lfs ??
      (name === "bibles" ? "required" : "auto"),
  };
}

export const GIT_REPOS: Record<"songs" | "setlists" | "bibles" | "templates", GitRepoConfig> = {
  songs: repo("songs", path.join(DATA_DIR, "repos", "songs")),
  setlists: repo("setlists", path.join(DATA_DIR, "repos", "setlists")),
  bibles: repo("bibles", path.join(DATA_DIR, "repos", "bibles"), true),
  templates: repo("templates", path.join(DATA_DIR, "repos", "templates"), true),
};
