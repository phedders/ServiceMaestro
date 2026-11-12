import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const configModule = new URL("../dist/config.js", import.meta.url).href;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sm-config-test-"));
}

function loadConfig({ config, env = {}, discover = false }) {
  const dir = tempDir();
  const configFile = path.join(dir, "config.yaml");
  const emptyEnv = path.join(dir, "empty.env");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(configFile, config);
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const c = await import(process.env.SM_CONFIG_MODULE);
       console.log(JSON.stringify({
         HOST: c.HOST, PORT: c.PORT, DISPLAY_PORT: c.DISPLAY_PORT,
         LOG_LEVEL: c.LOG_LEVEL, SECURE_COOKIES: c.SECURE_COOKIES,
         DATA_DIR: c.DATA_DIR, SONGS_DIR: c.SONGS_DIR, BIBLE_DIR: c.BIBLE_DIR,
         IMAGES_DIR: c.IMAGES_DIR, FONTS_DIR: c.FONTS_DIR,
         TEMPLATES_DIR: c.TEMPLATES_DIR, SONGSELECT_WATCH_DIR: c.SONGSELECT_WATCH_DIR,
         SONGSELECT_WATCH_ENABLED: c.SONGSELECT_WATCH_ENABLED,
         SONGSELECT_WATCH_INTERVAL: c.SONGSELECT_WATCH_INTERVAL,
         OUTPUT_TOKEN: c.OUTPUT_TOKEN, ADMIN_PASSWORD: c.ADMIN_PASSWORD,
         SESSION_DAYS: c.SESSION_DAYS,
         CHURCHSUITE_CLIENT_ID: c.CHURCHSUITE_CLIENT_ID,
         CHURCHSUITE_CLIENT_SECRET: c.CHURCHSUITE_CLIENT_SECRET,
         CHURCHSUITE_TOKEN_URL: c.CHURCHSUITE_TOKEN_URL,
         CHURCHSUITE_API_URL: c.CHURCHSUITE_API_URL,
         CHURCHSUITE_SCOPES: c.CHURCHSUITE_SCOPES,
         CHURCHSUITE_REDIRECT_URI: c.CHURCHSUITE_REDIRECT_URI,
         GIT_ENABLED: c.GIT_ENABLED, GIT_AUTO_SAVE: c.GIT_AUTO_SAVE,
         GIT_AUTO_PUSH: c.GIT_AUTO_PUSH, GIT_PULL_INTERVAL: c.GIT_PULL_INTERVAL,
         GIT_AUTHOR_NAME: c.GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL: c.GIT_AUTHOR_EMAIL,
         GIT_SSH_KEY_FILE: c.GIT_SSH_KEY_FILE, GIT_KNOWN_HOSTS_FILE: c.GIT_KNOWN_HOSTS_FILE,
         GIT_REPOS: c.GIT_REPOS
       }));`,
    ],
    {
      encoding: "utf8",
      cwd: discover ? dir : undefined,
      env: {
        PATH: process.env.PATH,
        SM_ENV_FILE: emptyEnv,
        ...(discover ? {} : { SM_CONFIG_FILE: configFile }),
        SM_CONFIG_MODULE: configModule,
        ...env,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return { values: JSON.parse(result.stdout), dir };
}

test("loads YAML configuration and lets environment variables override it", () => {
  const dir = tempDir();
  const { values } = loadConfig({
    config: `server:
  host: 127.0.0.2
  port: 18080
  displayPort: 18081
  dataDir: ${dir}/data
  adminPassword: file-admin
  outputToken: file-output
  sessionDays: 12
  secureCookies: true
  logLevel: debug
paths:
  songs: ${dir}/songs
  bible: ${dir}/bible
  images: ${dir}/images
  fonts: ${dir}/fonts
  templates: ${dir}/templates
  songselect: ${dir}/songselect
songselect:
  watchEnabled: false
  watchIntervalSeconds: 45
churchsuite:
  clientId: file-client
  clientSecret: file-secret
  tokenUrl: https://example.test/token
  apiUrl: https://example.test/api
  scopes: custom.scope
  redirectUri: https://example.test/callback
git:
  enabled: false
  autoSave: false
  autoPush: false
  workDir: ${dir}/repos
  pullIntervalSeconds: 120
  author:
    name: File Author
    email: file@example.test
  sshKeyFile: ${dir}/ssh
  knownHostsFile: ${dir}/known
repositories:
  songs:
    remote: https://file.invalid/songs.git
    branch: file-branch
    optional: true
    lfs: required
  setlists:
    path: ${dir}/setlists-custom
    remote: https://file.invalid/setlists.git
    branch: file-setlists
  bibles:
    optional: false
    lfs: off
  templates:
    optional: false
    remote: https://file.invalid/templates.git
`,
    env: {
      SM_HOST: "127.0.0.3",
      SM_PORT: "19080",
      SM_ADMIN_PASSWORD: "env-admin",
      SM_SONGS_DIR: `${dir}/env-songs`,
      SM_SONGSELECT_WATCH_INTERVAL: "15",
      SM_CHURCHSUITE_CLIENT_ID: "",
      SM_CHURCHSUITE_CLIENT_SECRET: "env-secret",
      SM_GIT_ENABLED: "true",
      SM_GIT_SONGS_REMOTE: "https://env.invalid/songs.git",
      SM_GIT_SONGS_BRANCH: "env-branch",
      SM_GIT_SETLISTS_PATH: `${dir}/env-setlists`,
      SM_GIT_TEMPLATES_REMOTE: "",
      SM_GIT_WORK_DIR: `${dir}/env-repos`,
    },
  });

  assert.equal(values.HOST, "127.0.0.3");
  assert.equal(values.PORT, 19080);
  assert.equal(values.DISPLAY_PORT, 18081);
  assert.equal(values.LOG_LEVEL, "debug");
  assert.equal(values.SECURE_COOKIES, true);
  assert.equal(values.DATA_DIR, `${dir}/data`);
  assert.equal(values.SONGS_DIR, `${dir}/env-songs`);
  assert.equal(values.BIBLE_DIR, `${dir}/bible`);
  assert.equal(values.IMAGES_DIR, `${dir}/images`);
  assert.equal(values.FONTS_DIR, `${dir}/fonts`);
  assert.equal(values.TEMPLATES_DIR, `${dir}/templates`);
  assert.equal(values.SONGSELECT_WATCH_DIR, `${dir}/songselect`);
  assert.equal(values.SONGSELECT_WATCH_ENABLED, false);
  assert.equal(values.SONGSELECT_WATCH_INTERVAL, 15);
  assert.equal(values.OUTPUT_TOKEN, "file-output");
  assert.equal(values.ADMIN_PASSWORD, "env-admin");
  assert.equal(values.SESSION_DAYS, 12);
  assert.equal(values.CHURCHSUITE_CLIENT_ID, "file-client");
  assert.equal(values.CHURCHSUITE_CLIENT_SECRET, "env-secret");
  assert.equal(values.CHURCHSUITE_TOKEN_URL, "https://example.test/token");
  assert.equal(values.CHURCHSUITE_API_URL, "https://example.test/api");
  assert.equal(values.CHURCHSUITE_SCOPES, "custom.scope");
  assert.equal(values.CHURCHSUITE_REDIRECT_URI, "https://example.test/callback");
  assert.equal(values.GIT_ENABLED, true);
  assert.equal(values.GIT_AUTO_SAVE, false);
  assert.equal(values.GIT_AUTO_PUSH, false);
  assert.equal(values.GIT_PULL_INTERVAL, 120);
  assert.equal(values.GIT_AUTHOR_NAME, "File Author");
  assert.equal(values.GIT_AUTHOR_EMAIL, "file@example.test");
  assert.equal(values.GIT_SSH_KEY_FILE, `${dir}/ssh`);
  assert.equal(values.GIT_KNOWN_HOSTS_FILE, `${dir}/known`);

  assert.equal(values.GIT_REPOS.songs.remote, "https://env.invalid/songs.git");
  assert.equal(values.GIT_REPOS.songs.branch, "env-branch");
  assert.equal(values.GIT_REPOS.songs.path, `${dir}/env-repos/songs`);
  assert.equal(values.GIT_REPOS.songs.optional, true);
  assert.equal(values.GIT_REPOS.songs.lfs, "required");
  assert.equal(values.GIT_REPOS.setlists.remote, "https://file.invalid/setlists.git");
  assert.equal(values.GIT_REPOS.setlists.branch, "file-setlists");
  assert.equal(values.GIT_REPOS.setlists.path, `${dir}/env-setlists`);
  assert.equal(values.GIT_REPOS.bibles.optional, false);
  assert.equal(values.GIT_REPOS.bibles.lfs, "off");
  assert.equal(values.GIT_REPOS.bibles.path, `${dir}/env-repos/bibles`);
  assert.equal(values.GIT_REPOS.templates.optional, false);
  assert.equal(
    values.GIT_REPOS.templates.remote,
    "https://file.invalid/templates.git",
  );
});

test("discovers config.yaml from the working directory", () => {
  const { values } = loadConfig({
    discover: true,
    config: `server:
  host: 127.0.0.4
  port: 28080
  displayPort: 28081
`,
  });
  assert.equal(values.HOST, "127.0.0.4");
  assert.equal(values.PORT, 28080);
  assert.equal(values.DISPLAY_PORT, 28081);
});

test("accepts the legacy git.repositories layout and JSON config", () => {
  const dir = tempDir();
  const { values } = loadConfig({
    config: JSON.stringify({
      git: {
        repositories: {
          songs: {
            path: `${dir}/legacy-songs`,
            remote: "https://legacy.invalid/songs.git",
            branch: "legacy",
          },
        },
      },
    }),
    env: {
      SM_DATA_DIR: `${dir}/data`,
    },
  });
  assert.equal(values.GIT_REPOS.songs.path, `${dir}/legacy-songs`);
  assert.equal(values.GIT_REPOS.songs.remote, "https://legacy.invalid/songs.git");
  assert.equal(values.GIT_REPOS.songs.branch, "legacy");
});
