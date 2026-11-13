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
    saveIntegrationSettings({ songSelectEnabled: false, churchSuiteEnabled: false });
    const disabled = getIntegrationSettings();
    const disabledProviders = listSiteScraperProviders("user-1");
    const disabledCredentials = resolveSiteCredentials("user-1", "songselect");
    saveIntegrationSettings({ songSelectEnabled: true, churchSuiteEnabled: true });

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
    songSelectEnabled: true,
    churchSuiteEnabled: true,
  });
  assert.deepEqual(data.initialProviderIds, ["songselect"]);
  assert.deepEqual(data.disabledProviders, []);
  assert.equal(data.disabledCredentials, null);
  assert.deepEqual(data.disabled, {
    songSelectEnabled: false,
    churchSuiteEnabled: false,
  });
  assert.deepEqual(data.restored, {
    songSelectEnabled: true,
    churchSuiteEnabled: true,
  });
});
