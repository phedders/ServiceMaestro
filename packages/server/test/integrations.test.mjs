import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("adapter availability is persisted and removes disabled SongSelect providers", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-integrations-"));
  const emptyEnv = path.join(dir, "empty.env");
  const config = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(config, "{}\n");

  const script = `
    const {
      getIntegrationSettings,
      saveIntegrationSettings,
    } = await import(process.env.SM_MODULE_BASE + "integrations.js");
    const {
      listSiteScraperProviders,
      resolveSiteCredentials,
    } = await import(process.env.SM_MODULE_BASE + "site-scraping.js");

    const initial = getIntegrationSettings();
    const initialProviders = listSiteScraperProviders("user-1");
    saveIntegrationSettings({ songSelect: "off", churchSuite: "off", mqtt: "shared" });
    const disabled = getIntegrationSettings();
    const disabledProviders = listSiteScraperProviders("user-1");
    const disabledCredentials = resolveSiteCredentials("user-1", "songselect");
    saveIntegrationSettings({ songSelect: "local", churchSuite: "local", mqtt: "off" });

    console.log(JSON.stringify({
      initial,
      initialProviderIds: initialProviders.map((provider) => provider.id),
      disabled,
      disabledProviders,
      disabledCredentials,
      restored: getIntegrationSettings(),
    }));
  `;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SM_ENV_FILE: emptyEnv,
      SM_CONFIG_FILE: config,
      SM_DATA_DIR: dir,
      SM_GIT_ENABLED: "false",
      SM_MODULE_BASE: moduleBase,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);

  assert.deepEqual(data.initial, {
    songSelect: "local",
    churchSuite: "local",
    mqtt: "off",
  });
  assert.deepEqual(data.initialProviderIds, ["songselect"]);
  assert.deepEqual(data.disabledProviders, []);
  assert.equal(data.disabledCredentials, null);
  assert.deepEqual(data.disabled, {
    songSelect: "off",
    churchSuite: "off",
    mqtt: "shared",
  });
  assert.deepEqual(data.restored, {
    songSelect: "local",
    churchSuite: "local",
    mqtt: "off",
  });
});

test("migrates legacy adapter enable flags to local/off modes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-integrations-legacy-"));
  const emptyEnv = path.join(dir, "empty.env");
  const config = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(config, "{}\n");

  const script = `
    const { db } = await import(process.env.SM_MODULE_BASE + "db.js");
    const {
      getIntegrationSettings,
      saveIntegrationSettings,
    } = await import(process.env.SM_MODULE_BASE + "integrations.js");
    const now = new Date().toISOString();
    const write = db.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)",
    );
    write.run("adapter_songselect_enabled", "0", now);
    write.run("adapter_churchsuite_enabled", "1", now);
    write.run("adapter_mqtt_enabled", "1", now);
    const migrated = getIntegrationSettings();
    saveIntegrationSettings({ songSelect: "shared", churchSuite: "off", mqtt: "local" });
    console.log(JSON.stringify({
      migrated,
      saved: getIntegrationSettings(),
    }));
  `;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SM_ENV_FILE: emptyEnv,
      SM_CONFIG_FILE: config,
      SM_DATA_DIR: dir,
      SM_GIT_ENABLED: "false",
      SM_MODULE_BASE: moduleBase,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);

  assert.deepEqual(data.migrated, {
    songSelect: "off",
    churchSuite: "local",
    mqtt: "local",
  });
  assert.deepEqual(data.saved, {
    songSelect: "shared",
    churchSuite: "off",
    mqtt: "local",
  });
});
