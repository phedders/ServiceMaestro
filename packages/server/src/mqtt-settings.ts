import {
  mqttSettingsInputSchema,
  type MqttSettings,
  type MqttSettingsInput,
} from "@sm/shared";
import { db } from "./db.js";
import { decryptSecret, encryptSecret } from "./secrets.js";

const SETTINGS_KEY = "mqtt_settings";
const PASSWORD_KEY = "mqtt_password";

interface PasswordSecret {
  password?: string;
}

function readStored(): MqttSettingsInput {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return mqttSettingsInputSchema.parse({});
  try {
    const parsed = mqttSettingsInputSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : mqttSettingsInputSchema.parse({});
  } catch {
    return mqttSettingsInputSchema.parse({});
  }
}

function storedPassword(): string {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(PASSWORD_KEY) as { value: string } | undefined;
  if (!row) return "";
  return decryptSecret<PasswordSecret>(row.value)?.password ?? "";
}

export function getMqttSettings(): MqttSettings {
  const stored = readStored();
  const { password: _password, clearPassword: _clearPassword, ...settings } = stored;
  return {
    ...settings,
    hasPassword: Boolean(storedPassword()),
  };
}

export function getMqttRuntimeSettings(): MqttSettingsInput {
  const stored = readStored();
  const { password: _password, clearPassword: _clearPassword, ...settings } = stored;
  return {
    ...settings,
    password: storedPassword(),
  };
}

export function saveMqttSettings(input: MqttSettingsInput): MqttSettings {
  const parsed = mqttSettingsInputSchema.parse(input);
  const {
    password,
    clearPassword,
    ...stored
  } = parsed;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(SETTINGS_KEY, JSON.stringify(stored), now);

  if (clearPassword) {
    db.prepare("DELETE FROM app_settings WHERE key = ?").run(PASSWORD_KEY);
  } else if (password?.trim()) {
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(PASSWORD_KEY, encryptSecret({ password }), now);
  }
  return getMqttSettings();
}
