import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");

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
  const file = process.env.WLM_CONFIG_FILE;
  if (!file) return {};
  try {
    if (!fs.existsSync(file)) return {};
    return (parseYaml(fs.readFileSync(file, "utf8")) ?? {}) as FileConfig;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[wlm] Could not read config file ${file}: ${(error as Error).message}`);
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

export const HOST = process.env.WLM_HOST ?? "0.0.0.0";
export const PORT = Number(process.env.WLM_PORT ?? 8080);
export const DATA_DIR = path.resolve(process.env.WLM_DATA_DIR ?? path.join(packageRoot, "data"));
export const CONTROL_DIST = path.resolve(packageRoot, "../control/dist");
export const DISPLAY_DIR = path.resolve(packageRoot, "../display");
export const SONGS_DIR = path.resolve(
  process.env.WLM_SONGS_DIR ?? path.join(packageRoot, "../../samples"),
);
export const BIBLE_DIR = path.resolve(
  process.env.WLM_BIBLE_DIR ?? path.join(packageRoot, "../../samples/bible"),
);
export const ASSETS_DIR = path.join(DATA_DIR, "assets");
export const TEMPLATES_DIR = path.resolve(process.env.WLM_TEMPLATES_DIR ?? path.join(DATA_DIR, "templates"));
export const OUTPUT_TOKEN = process.env.WLM_OUTPUT_TOKEN ?? "dev-output";
export const ADMIN_PASSWORD = process.env.WLM_ADMIN_PASSWORD ?? "admin";
export const SESSION_DAYS = Number(process.env.WLM_SESSION_DAYS ?? 7);
export const COOKIE_NAME = "wlm_session";

export const GIT_ENABLED = boolEnv("WLM_GIT_ENABLED", gitConfig.enabled ?? true);
export const GIT_AUTO_SAVE = boolEnv("WLM_GIT_AUTO_SAVE", gitConfig.autoSave ?? true);
export const GIT_AUTO_PUSH = boolEnv("WLM_GIT_AUTO_PUSH", gitConfig.autoPush ?? true);
export const GIT_PULL_INTERVAL = Number(
  process.env.WLM_GIT_PULL_INTERVAL ?? gitConfig.pullIntervalSeconds ?? 60,
);
export const GIT_AUTHOR_NAME = stringEnv(
  "WLM_GIT_AUTHOR_NAME",
  gitConfig.author?.name ?? "Web Lyric Master",
);
export const GIT_AUTHOR_EMAIL = stringEnv(
  "WLM_GIT_AUTHOR_EMAIL",
  gitConfig.author?.email ?? "wlm@localhost",
);
export const GIT_SSH_KEY_FILE = process.env.WLM_GIT_SSH_KEY_FILE ?? gitConfig.sshKeyFile;
export const GIT_KNOWN_HOSTS_FILE =
  process.env.WLM_GIT_KNOWN_HOSTS_FILE ?? gitConfig.knownHostsFile;

function repo(
  name: "songs" | "setlists" | "bibles" | "templates",
  defaultPath: string,
  optional = false,
): GitRepoConfig {
  const fromFile = gitConfig.repositories?.[name] ?? {};
  const envPrefix = `WLM_GIT_${name.toUpperCase()}`;
  const remote = process.env[`${envPrefix}_REMOTE`] ?? fromFile.remote ?? "";
  return {
    name,
    path: path.resolve(process.env[`${envPrefix}_PATH`] ?? fromFile.path ?? defaultPath),
    remote: remote.trim() || null,
    branch: process.env[`${envPrefix}_BRANCH`] ?? fromFile.branch ?? "main",
    optional:
      name === "bibles"
        ? boolEnv("WLM_GIT_BIBLES_OPTIONAL", fromFile.optional ?? true)
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
