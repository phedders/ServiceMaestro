import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("stores MQTT credentials encrypted and exposes only public controls", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-mqtt-"));
  const emptyEnv = path.join(dir, "empty.env");
  const config = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(config, "{}\n");

  const script = `
    const { db } = await import(process.env.SM_MODULE_BASE + "db.js");
    const {
      getMqttRuntimeSettings,
      getMqttSettings,
      saveMqttSettings,
    } = await import(process.env.SM_MODULE_BASE + "mqtt-settings.js");
    const {
      getIntegrationSettings,
      saveIntegrationSettings,
    } = await import(process.env.SM_MODULE_BASE + "integrations.js");
    const {
      isAllowedMqttApiPath,
      listMqttControls,
    } = await import(process.env.SM_MODULE_BASE + "mqtt-bridge.js");

    const initialIntegrations = getIntegrationSettings();
    saveIntegrationSettings({
      songSelectEnabled: true,
      churchSuiteEnabled: true,
      mqttEnabled: true,
    });
    const saved = saveMqttSettings({
      brokerUrl: "broker.example.test:8883",
      protocol: "mqtts",
      username: "maestro",
      clientId: "sm-test",
      password: "very-secret-password",
      incomingPrefix: "sm/in",
      mappings: [{
        id: "next",
        enabled: true,
        command: "live/next",
        method: "POST",
        path: "/api/live/command",
        bodyTemplate: '{"type":"next"}',
        sourceClients: ["operator-a"],
      }],
      outgoingPrefix: "sm/out",
      publishDebug: true,
      publishInformation: true,
      publishEvents: false,
      controls: [{
        id: "lights",
        enabled: true,
        label: "Lights",
        path: "lights/scene",
        type: "select",
        payload: "",
        options: [
          { label: "Welcome", payload: "scene-1" },
          { label: "Sermon", payload: "scene-2" },
        ],
        placement: "live",
      }],
    });
    const runtime = getMqttRuntimeSettings();
    const passwordRow = db
      .prepare("SELECT value FROM app_settings WHERE key = 'mqtt_password'")
      .get();
    const controls = listMqttControls();
    const cleared = saveMqttSettings({
      ...runtime,
      password: undefined,
      clearPassword: true,
    });

    console.log(JSON.stringify({
      initialIntegrations,
      integrations: getIntegrationSettings(),
      saved,
      runtimePassword: runtime.password,
      encryptedPassword: passwordRow.value,
      controls,
      clearedHasPassword: cleared.hasPassword,
      allowedLive: isAllowedMqttApiPath("/api/live/command"),
      blockedAuth: isAllowedMqttApiPath("/api/auth/login"),
      blockedUsers: isAllowedMqttApiPath("/api/users/abc"),
      blockedTraversal: isAllowedMqttApiPath("/api/live/../users"),
      blockedEncodedTraversal: isAllowedMqttApiPath("/api/live/%2e%2e/users"),
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

  assert.deepEqual(data.initialIntegrations, {
    songSelectEnabled: true,
    churchSuiteEnabled: true,
    mqttEnabled: false,
  });
  assert.equal(data.integrations.mqttEnabled, true);
  assert.equal(data.saved.hasPassword, true);
  assert.equal(data.saved.brokerUrl, "broker.example.test:8883");
  assert.equal(data.saved.protocol, "mqtts");
  assert.equal(data.runtimePassword, "very-secret-password");
  assert.equal(data.encryptedPassword.includes("very-secret-password"), false);
  assert.deepEqual(data.controls, [
    {
      id: "lights",
      label: "Lights",
      type: "select",
      placement: "live",
      options: [{ label: "Welcome" }, { label: "Sermon" }],
    },
  ]);
  assert.equal(data.clearedHasPassword, false);
  assert.equal(data.allowedLive, true);
  assert.equal(data.blockedAuth, false);
  assert.equal(data.blockedUsers, false);
  assert.equal(data.blockedTraversal, false);
  assert.equal(data.blockedEncodedTraversal, false);
});
