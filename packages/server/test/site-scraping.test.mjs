import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("stores encrypted per-user site credentials and falls back to server credentials", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-site-credentials-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(
    emptyConfig,
    "songScraping:\n  username: server-user\n  password: server-password\n",
  );

  const script = `
    const { db } = await import(process.env.SM_MODULE_BASE + "db.js");
    const {
      deleteSiteCredentials,
      listSiteScraperProviders,
      resolveSiteCredentials,
      saveSiteCredentials,
    } = await import(process.env.SM_MODULE_BASE + "site-scraping.js");
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role, permissions_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("user-1", "user-1", "x", "editor", null, now);

    const saved = saveSiteCredentials("user-1", "songselect", {
      username: "alice",
      password: "super-secret-password",
      cookie: "session-cookie-value",
    });
    const row = db
      .prepare("SELECT secret_encrypted FROM site_credentials WHERE user_id = ? AND provider = ?")
      .get("user-1", "songselect");
    const userCredentials = resolveSiteCredentials("user-1", "songselect");
    deleteSiteCredentials("user-1", "songselect");
    const afterDelete = listSiteScraperProviders("user-1")[0];
    const serverFallback = resolveSiteCredentials("user-1", "songselect");

    console.log(JSON.stringify({
      saved,
      encrypted: row.secret_encrypted,
      userCredentials,
      afterDelete,
      serverFallback,
    }));
  `;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SM_ENV_FILE: emptyEnv,
      SM_CONFIG_FILE: emptyConfig,
      SM_DATA_DIR: dir,
      SM_GIT_ENABLED: "false",
      SM_MODULE_BASE: moduleBase,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);

  assert.equal(data.saved.userConfigured, true);
  assert.equal(data.saved.userUsername, "alice");
  assert.equal(data.saved.activeSource, "user");
  assert.equal(data.encrypted.includes("super-secret-password"), false);
  assert.equal(data.encrypted.includes("session-cookie-value"), false);
  assert.deepEqual(data.userCredentials, {
    source: "user",
    username: "alice",
    password: "super-secret-password",
    cookie: "session-cookie-value",
    baseUrl: "https://songselect.ccli.com",
  });
  assert.equal(data.afterDelete.userConfigured, false);
  assert.equal(data.afterDelete.serverConfigured, true);
  assert.equal(data.afterDelete.activeSource, "server");
  assert.equal(data.serverFallback.source, "server");
  assert.equal(data.serverFallback.username, "server-user");
  assert.equal(data.serverFallback.password, "server-password");
});
