import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { connect as mqttConnect, type IPublishPacket, type MqttClient } from "mqtt";
import type {
  ActivityEntry,
  LiveState,
  MqttPublicControl,
  MqttSettingsInput,
  MqttStatus,
} from "@sm/shared";
import { onActivity } from "./activity.js";
import { createSession, destroySession, userForToken } from "./auth.js";
import { COOKIE_NAME } from "./config.js";
import { db } from "./db.js";
import { isMqttEnabled } from "./integrations.js";
import { live } from "./live.js";
import { getMqttRuntimeSettings, getMqttSettings } from "./mqtt-settings.js";

const BLOCKED_API_PREFIXES = [
  "/api/auth",
  "/api/users",
  "/api/integrations",
  "/api/mqtt",
  "/api/ssl",
  "/api/activity",
  "/api/git",
  "/api/settings",
  "/api/transfer",
];

interface RuntimeSettings extends MqttSettingsInput {
  password: string;
  brokerUrlEffective: string;
  clientIdEffective: string;
}

let appRef: FastifyInstance | null = null;
let client: MqttClient | null = null;
let runtime: RuntimeSettings | null = null;
let internalToken: string | null = null;
let stopLiveListener: (() => void) | null = null;
let stopActivityListener: (() => void) | null = null;

let status: MqttStatus = emptyStatus(false);

function emptyStatus(enabled: boolean): MqttStatus {
  return {
    enabled,
    configured: false,
    connected: false,
    brokerUrl: "",
    clientId: "",
    lastError: null,
    lastConnectedAt: null,
    lastMessageAt: null,
    subscriptions: [],
  };
}

function now(): string {
  return new Date().toISOString();
}

export function isAllowedMqttApiPath(path: string): boolean {
  const pathname = path.split("?")[0];
  if (!pathname.startsWith("/api/")) return false;
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  if (decoded.split("/").some((segment) => segment === "..")) return false;
  return !BLOCKED_API_PREFIXES.some(
    (prefix) => decoded === prefix || decoded.startsWith(`${prefix}/`),
  );
}

function effectiveBrokerUrl(settings: MqttSettingsInput): string {
  const raw = settings.brokerUrl.trim();
  if (!raw) return "";
  if (settings.protocol) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      return raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, `${settings.protocol}://`);
    }
    return `${settings.protocol}://${raw}`;
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `mqtt://${raw}`;
}

function displayBrokerUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return value;
  }
}

function joinTopic(prefix: string, path: string): string {
  return [prefix, path]
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

export function mqttControlTopic(
  outgoingPrefix: string,
  path: string,
  usePrefix: boolean,
): string {
  return usePrefix ? joinTopic(outgoingPrefix, path) : path.trim();
}

function publish(topic: string, payload: string, retain = false): boolean {
  if (!client || !status.connected || !runtime) return false;
  client.publish(topic, payload, { qos: 0, retain });
  return true;
}

function publishDebug(message: string, detail?: Record<string, unknown>): void {
  appRef?.log.info({ mqtt: true, ...detail }, message);
  if (!runtime?.publishDebug) return;
  publish(
    joinTopic(runtime.outgoingPrefix, "debug"),
    JSON.stringify({ at: now(), message, detail: detail ?? null }),
  );
}

function publishStatus(): void {
  if (!runtime?.publishInformation) return;
  publish(
    joinTopic(runtime.outgoingPrefix, "status"),
    JSON.stringify({
      at: now(),
      connected: status.connected,
      brokerUrl: status.brokerUrl,
      clientId: status.clientId,
      lastError: status.lastError,
    }),
    true,
  );
}

function publishLiveState(state: LiveState): void {
  if (!runtime?.publishInformation) return;
  publish(
    joinTopic(runtime.outgoingPrefix, "live"),
    JSON.stringify({
      at: now(),
      status: state.status,
      sessionId: state.sessionId,
      setlistId: state.setlistId,
      setlistName: state.setlistName,
      itemIndex: state.itemIndex,
      pageIndex: state.pageIndex,
      pageCount: state.pageCount,
      title: state.title,
      blank: state.blank,
      transpose: state.transpose,
      maxLines: state.maxLines,
      version: state.version,
      updatedAt: state.updatedAt,
    }),
    true,
  );
}

function publishEvent(entry: ActivityEntry): void {
  if (!runtime?.publishEvents) return;
  publish(joinTopic(runtime.outgoingPrefix, "event"), JSON.stringify(entry));
}

function internalCookie(): string | null {
  if (!appRef) return null;
  if (internalToken && userForToken(internalToken)) {
    return `${COOKIE_NAME}=${internalToken}`;
  }
  const admin = db
    .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1")
    .get() as { id: string } | undefined;
  if (!admin) return null;
  const session = createSession(admin.id);
  internalToken = session.token;
  return `${COOKIE_NAME}=${session.token}`;
}

function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function sourceClientFromPacket(packet: IPublishPacket): string {
  const values = packet.properties?.userProperties;
  if (!values) return "";
  for (const key of ["sourceClient", "sourceclient", "clientId", "clientid"]) {
    const value = values[key];
    if (Array.isArray(value) && value.length) return value[0] ?? "";
    if (typeof value === "string") return value;
  }
  return "";
}

function sourceClientFromValue(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  for (const key of ["sourceClient", "sourceclient", "clientId", "clientid"]) {
    const entry = record[key];
    if (typeof entry === "string" && entry.trim()) return entry.trim();
  }
  return "";
}

function templateValues(
  raw: string,
  parsed: unknown,
  topic: string,
  command: string,
  sourceClient: string,
): Record<string, string> {
  return {
    payload: raw,
    value: typeof parsed === "string" ? parsed : raw.trim(),
    json: JSON.stringify(parsed === undefined ? raw : parsed),
    topic,
    command,
    clientId: sourceClient,
  };
}

function renderTemplate(
  template: string,
  values: Record<string, string>,
  encode = false,
): string {
  return template.replace(
    /\{\{\s*(payload|value|json|topic|command|clientId)\s*\}\}/g,
    (_match, key: string) => {
      const value = values[key] ?? "";
      return encode ? encodeURIComponent(value) : value;
    },
  );
}

async function handleIncoming(
  topic: string,
  payload: Buffer,
  packet: IPublishPacket,
): Promise<void> {
  if (!runtime || !appRef) return;
  const prefix = runtime.incomingPrefix.replace(/^\/+|\/+$/g, "");
  if (topic !== prefix && !topic.startsWith(`${prefix}/`)) return;
  const command = topic === prefix ? "" : topic.slice(prefix.length + 1);
  const mapping = runtime.mappings.find(
    (entry) => entry.enabled && entry.command === command,
  );
  if (!mapping) {
    publishDebug("Ignored MQTT message with no matching command", { topic });
    return;
  }

  const raw = payload.toString("utf8");
  const parsed = parsePayload(raw);
  const sourceClient =
    sourceClientFromValue(parsed) || sourceClientFromPacket(packet);
  if (
    mapping.sourceClients.length &&
    (!sourceClient || !mapping.sourceClients.includes(sourceClient))
  ) {
    publishDebug("Rejected MQTT command from an unrestricted source", {
      topic,
      command,
      sourceClient: sourceClient || null,
    });
    return;
  }

  if (!isAllowedMqttApiPath(mapping.path)) {
    publishDebug("Rejected MQTT command targeting a protected API path", {
      topic,
      command,
      path: mapping.path,
    });
    return;
  }

  const values = templateValues(raw, parsed, topic, command, sourceClient);
  const url = renderTemplate(mapping.path, values, true);
  if (!isAllowedMqttApiPath(url)) {
    publishDebug("Rejected MQTT command after path expansion", {
      topic,
      command,
      path: url,
    });
    return;
  }
  let body: unknown;
  if (mapping.bodyTemplate.trim()) {
    const rendered = renderTemplate(mapping.bodyTemplate, values);
    try {
      body = JSON.parse(rendered) as unknown;
    } catch {
      body = rendered;
    }
  } else if (raw.trim()) {
    body = parsed === undefined ? raw : parsed;
  }
  if (mapping.method === "GET") body = undefined;

  const headers: Record<string, string> = {
    "user-agent": "Service Maestro MQTT bridge",
    "x-sm-source": "mqtt",
  };
  const cookie = internalCookie();
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";

  try {
    const response = await appRef.inject({
      method: mapping.method,
      url,
      headers,
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    if (response.statusCode >= 400) {
      appRef.log.warn(
        {
          mqtt: true,
          command,
          topic,
          status: response.statusCode,
          response: response.body.slice(0, 500),
        },
        "MQTT command endpoint returned an error",
      );
    }
    publishDebug("MQTT command processed", {
      command,
      topic,
      sourceClient: sourceClient || null,
      status: response.statusCode,
      path: url,
    });
  } catch (error) {
    appRef.log.warn({ mqtt: true, err: error, command, topic }, "MQTT command failed");
    publishDebug("MQTT command failed", {
      command,
      topic,
      error: (error as Error).message,
    });
  }
}

function clearRetained(): void {
  if (!runtime || !client || !status.connected) return;
  client.publish(joinTopic(runtime.outgoingPrefix, "status"), "", {
    qos: 0,
    retain: true,
  });
  client.publish(joinTopic(runtime.outgoingPrefix, "live"), "", {
    qos: 0,
    retain: true,
  });
}

function endClient(): void {
  if (client) {
    client.removeAllListeners();
    client.end(true);
    client = null;
  }
  status.connected = false;
  status.subscriptions = [];
}

function attachClientHandlers(instance: MqttClient, settings: RuntimeSettings): void {
  instance.on("connect", () => {
    status.connected = true;
    status.lastError = null;
    status.lastConnectedAt = now();
    const subscription = `${settings.incomingPrefix.replace(/^\/+|\/+$/g, "")}/#`;
    instance.subscribe(subscription, { qos: 0 }, (error) => {
      if (error) {
        status.lastError = error.message;
        publishDebug("Could not subscribe to incoming MQTT commands", {
          subscription,
          error: error.message,
        });
        return;
      }
      status.subscriptions = [subscription];
      publishDebug("MQTT connected and subscribed", {
        brokerUrl: displayBrokerUrl(settings.brokerUrlEffective),
        subscription,
      });
      publishStatus();
      publishLiveState(live.getState());
    });
  });
  instance.on("message", (topic, payload, packet) => {
    status.lastMessageAt = now();
    void handleIncoming(topic, payload, packet);
  });
  instance.on("error", (error) => {
    status.lastError = error.message;
    appRef?.log.warn({ mqtt: true, err: error }, "MQTT connection error");
    publishDebug("MQTT connection error", { error: error.message });
  });
  instance.on("close", () => {
    if (status.connected) {
      status.connected = false;
      status.subscriptions = [];
      publishDebug("MQTT connection closed");
    }
  });
  instance.on("offline", () => {
    status.connected = false;
    status.subscriptions = [];
  });
  instance.on("reconnect", () => {
    publishDebug("MQTT reconnecting", {
      brokerUrl: displayBrokerUrl(settings.brokerUrlEffective),
    });
  });
}

export function reloadMqttBridge(): MqttStatus {
  const enabled = isMqttEnabled();
  const settings = getMqttRuntimeSettings();
  const brokerUrl = effectiveBrokerUrl(settings);
  const clientId =
    settings.clientId.trim() || `service-maestro-${randomUUID().slice(0, 8)}`;
  clearRetained();
  status = {
    ...emptyStatus(enabled),
    configured: Boolean(brokerUrl),
    brokerUrl: displayBrokerUrl(brokerUrl),
    clientId,
  };
  endClient();
  runtime = null;

  if (!appRef || !enabled || !brokerUrl) {
    return getMqttStatus();
  }

  const nextRuntime: RuntimeSettings = {
    ...settings,
    password: settings.password ?? "",
    brokerUrlEffective: brokerUrl,
    clientIdEffective: clientId,
  };
  runtime = nextRuntime;
  try {
    const instance = mqttConnect(brokerUrl, {
      clientId,
      username: settings.username || undefined,
      password: settings.password || undefined,
      clean: true,
      protocolVersion: 5,
      reconnectPeriod: 5_000,
      connectTimeout: 10_000,
      ...(settings.publishInformation
        ? {
            will: {
              topic: joinTopic(settings.outgoingPrefix, "status"),
              payload: JSON.stringify({
                at: now(),
                connected: false,
                brokerUrl: displayBrokerUrl(brokerUrl),
                clientId,
                reason: "offline",
              }),
              qos: 0,
              retain: true,
            },
          }
        : {}),
    });
    client = instance;
    attachClientHandlers(instance, nextRuntime);
  } catch (error) {
    status.lastError = (error as Error).message;
    appRef.log.warn({ mqtt: true, err: error }, "Could not create MQTT client");
  }
  return getMqttStatus();
}

export function getMqttStatus(): MqttStatus {
  return { ...status, subscriptions: [...status.subscriptions] };
}

export function startMqttBridge(app: FastifyInstance): MqttStatus {
  if (!appRef) {
    appRef = app;
    stopLiveListener = live.onChange((state) => publishLiveState(state));
    stopActivityListener = onActivity((entry) => publishEvent(entry));
  }
  return reloadMqttBridge();
}

export function stopMqttBridge(): void {
  clearRetained();
  endClient();
  stopLiveListener?.();
  stopActivityListener?.();
  stopLiveListener = null;
  stopActivityListener = null;
  if (internalToken) {
    destroySession(internalToken);
    internalToken = null;
  }
  appRef = null;
  runtime = null;
  status = emptyStatus(false);
}

export function listMqttControls(): MqttPublicControl[] {
  if (!isMqttEnabled()) return [];
  return getMqttSettings()
    .controls.filter((control) => control.enabled)
    .map((control) => ({
      id: control.id,
      label: control.label,
      type: control.type,
      placement: control.placement,
      options: control.options.map((option) => ({ label: option.label })),
    }));
}

export async function publishMqttControl(
  controlId: string,
  optionIndex?: number,
): Promise<{ topic: string }> {
  if (!isMqttEnabled()) throw new Error("MQTT adapter is disabled");
  if (!runtime || !client || !status.connected) {
    throw new Error("MQTT is not connected");
  }
  const control = runtime.controls.find(
    (entry) => entry.enabled && entry.id === controlId,
  );
  if (!control) throw new Error("Unknown or disabled MQTT control");
  let payload = control.payload;
  if (control.type === "select") {
    const option = control.options[optionIndex ?? 0];
    if (!option) throw new Error("Choose a valid MQTT control option");
    payload = option.payload;
  }
  const topic = mqttControlTopic(
    runtime.outgoingPrefix,
    control.path,
    control.usePrefix,
  );
  await client.publishAsync(topic, payload, { qos: 0, retain: false });
  publishDebug("MQTT control published", {
    control: control.label,
    topic,
  });
  return { topic };
}
