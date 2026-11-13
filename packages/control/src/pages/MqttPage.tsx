import { useEffect, useState } from "react";
import type {
  MqttControl,
  MqttIncomingMapping,
  MqttSettings,
  MqttSettingsInput,
  MqttStatus,
} from "@sm/shared";
import { useAdapters } from "../adapters";
import { api, ApiError } from "../api";
import { compactDateTime } from "../service-date";

function newId(prefix: string): string {
  const value =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function newMapping(): MqttIncomingMapping {
  return {
    id: newId("mapping"),
    enabled: true,
    command: "live/next",
    method: "POST",
    path: "/api/live/command",
    bodyTemplate: '{"type":"next"}',
    sourceClients: [],
  };
}

function newControl(): MqttControl {
  return {
    id: newId("control"),
    enabled: true,
    label: "Next",
    path: "next",
    usePrefix: true,
    type: "button",
    payload: "next",
    options: [],
    placement: "live",
  };
}

export default function MqttPage({
  notify,
}: {
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const { modes } = useAdapters();
  const [settings, setSettings] = useState<MqttSettings | null>(null);
  const [status, setStatus] = useState<MqttStatus | null>(null);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await api.mqttSettings();
      setSettings(result.settings);
      setStatus(result.status);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not load MQTT settings", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      api
        .mqttStatus()
        .then((result) => setStatus(result.status))
        .catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  function update(patch: Partial<MqttSettings>) {
    setSettings((current) => (current ? { ...current, ...patch } : current));
  }

  function updateMapping(id: string, patch: Partial<MqttIncomingMapping>) {
    setSettings((current) =>
      current
        ? {
            ...current,
            mappings: current.mappings.map((mapping) =>
              mapping.id === id ? { ...mapping, ...patch } : mapping,
            ),
          }
        : current,
    );
  }

  function updateControl(id: string, patch: Partial<MqttControl>) {
    setSettings((current) =>
      current
        ? {
            ...current,
            controls: current.controls.map((control) =>
              control.id === id ? { ...control, ...patch } : control,
            ),
          }
        : current,
    );
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const {
        hasPassword: _hasPassword,
        ...settingsInput
      } = settings;
      const input: MqttSettingsInput = {
        ...settingsInput,
        ...(password ? { password } : {}),
        ...(clearPassword ? { clearPassword: true } : {}),
      };
      const result = await api.saveMqttSettings(input);
      setSettings(result.settings);
      setStatus(result.status);
      setPassword("");
      setClearPassword(false);
      notify("MQTT settings saved");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save MQTT settings", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="panel">Loading MQTT settings…</p>;
  if (!settings) {
    return (
      <section className="panel">
        <p className="muted">Could not load MQTT settings.</p>
        <button className="button" onClick={() => void load()}>
          Retry
        </button>
      </section>
    );
  }

  return (
    <div className="config-page mqtt-page">
      <p className="hint">
        The MQTT adapter connects this Service Maestro instance to a broker. Incoming commands can
        call protected Service Maestro API endpoints. Credentials are stored encrypted and are never
        returned to the browser.
      </p>
      <p className="hint">
        Adapter mode: <strong>{modes.mqtt}</strong>.{" "}
        {modes.mqtt === "shared"
          ? "Broker, command mappings, outgoing categories and controls follow the team shared settings; the broker password and client ID remain local to this server."
          : "This server uses its own local broker, command mappings, outgoing categories and controls."}
      </p>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Broker connection</h2>
            <p className="muted">
              The bridge subscribes to the incoming prefix and publishes under the outgoing prefix.
              Save to reconnect with the new settings.
            </p>
          </div>
          <span
            className={`badge ${status?.connected ? "live" : "rehearsal"}`}
            title="Current MQTT bridge state"
          >
            {status?.connected ? "connected" : status?.configured ? "disconnected" : "not configured"}
          </span>
        </div>
        <div className="mqtt-connection-grid">
          <label>
            Broker URL
            <input
              value={settings.brokerUrl}
              onChange={(event) => update({ brokerUrl: event.target.value })}
              placeholder="mqtt://192.168.1.10:1883"
            />
          </label>
          <label>
            Protocol override
            <select
              value={settings.protocol}
              onChange={(event) =>
                update({ protocol: event.target.value as MqttSettings["protocol"] })
              }
            >
              <option value="">From broker URL</option>
              <option value="mqtt">MQTT</option>
              <option value="mqtts">MQTT over TLS</option>
              <option value="ws">WebSocket</option>
              <option value="wss">WebSocket over TLS</option>
            </select>
          </label>
          <label>
            Username
            <input
              value={settings.username}
              onChange={(event) => update({ username: event.target.value })}
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={settings.hasPassword ? "Leave blank to keep current" : "Optional"}
              autoComplete="current-password"
            />
          </label>
          <label>
            Client ID
            <input
              value={settings.clientId}
              onChange={(event) => update({ clientId: event.target.value })}
              placeholder="Auto-generated when blank"
            />
          </label>
          <label className="checkbox mqtt-clear-password">
            <input
              type="checkbox"
              checked={clearPassword}
              onChange={(event) => setClearPassword(event.target.checked)}
            />
            Remove stored password
          </label>
        </div>
        {status && (
          <div className="config-kv">
            <div>
              <span>State</span>
              <strong>{status.connected ? "Connected" : "Disconnected"}</strong>
            </div>
            <div>
              <span>Last connected</span>
              <strong>
                {status.lastConnectedAt ? compactDateTime(status.lastConnectedAt) : "Never"}
              </strong>
            </div>
            <div>
              <span>Last message</span>
              <strong>{status.lastMessageAt ? compactDateTime(status.lastMessageAt) : "Never"}</strong>
            </div>
            <div>
              <span>Subscriptions</span>
              <code>{status.subscriptions.join(", ") || "None"}</code>
            </div>
            {status.lastError && (
              <div className="span-2">
                <span>Last error</span>
                <strong className="danger-text">{status.lastError}</strong>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Incoming commands</h2>
            <p className="muted">
              Messages on <code>{settings.incomingPrefix}/&lt;command&gt;</code> call the mapped API
              endpoint. Supply <code>sourceClient</code> in the JSON payload or MQTT user properties
              when source restrictions are configured.
            </p>
          </div>
          <button
            className="button"
            onClick={() => update({ mappings: [...settings.mappings, newMapping()] })}
            title="Add an incoming MQTT command mapping"
          >
            Add mapping
          </button>
        </div>
        <label>
          Incoming command prefix
          <input
            value={settings.incomingPrefix}
            onChange={(event) => update({ incomingPrefix: event.target.value })}
            placeholder="service-maestro/in"
          />
        </label>
        <div className="mqtt-table-wrap">
          <table className="mqtt-table">
            <thead>
              <tr>
                <th>On</th>
                <th>Command suffix</th>
                <th>Method</th>
                <th>SM API path</th>
                <th>Allowed source clients</th>
                <th>Payload template</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {settings.mappings.map((mapping) => (
                <tr key={mapping.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={mapping.enabled}
                      onChange={(event) =>
                        updateMapping(mapping.id, { enabled: event.target.checked })
                      }
                      title="Enable this incoming command"
                    />
                  </td>
                  <td>
                    <input
                      value={mapping.command}
                      onChange={(event) =>
                        updateMapping(mapping.id, { command: event.target.value })
                      }
                      placeholder="live/next"
                    />
                  </td>
                  <td>
                    <select
                      value={mapping.method}
                      onChange={(event) =>
                        updateMapping(mapping.id, {
                          method: event.target.value as MqttIncomingMapping["method"],
                        })
                      }
                    >
                      {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={mapping.path}
                      onChange={(event) => updateMapping(mapping.id, { path: event.target.value })}
                      placeholder="/api/live/command"
                    />
                  </td>
                  <td>
                    <input
                      value={mapping.sourceClients.join(", ")}
                      onChange={(event) =>
                        updateMapping(mapping.id, {
                          sourceClients: event.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="client-a, client-b"
                      title="Leave blank for any source"
                    />
                  </td>
                  <td>
                    <textarea
                      value={mapping.bodyTemplate}
                      onChange={(event) =>
                        updateMapping(mapping.id, { bodyTemplate: event.target.value })
                      }
                      placeholder={'{"type":"next"}'}
                      rows={3}
                    />
                  </td>
                  <td>
                    <button
                      className="button ghost small danger-text"
                      onClick={() =>
                        update({
                          mappings: settings.mappings.filter((entry) => entry.id !== mapping.id),
                        })
                      }
                      title="Remove this incoming command"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!settings.mappings.length && <p className="muted">No incoming commands configured.</p>}
        </div>
        <p className="hint">
          Placeholders: <code>{"{{payload}}"}</code> raw text, <code>{"{{json}}"}</code> JSON value,{" "}
          <code>{"{{value}}"}</code> trimmed string, <code>{"{{topic}}"}</code>,{" "}
          <code>{"{{command}}"}</code> and <code>{"{{clientId}}"}</code>. Authentication, user
          management, integration, MQTT and global settings API paths are blocked.
        </p>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Outgoing information</h2>
            <p className="muted">
              The bridge publishes retained live/status information and activity events under{" "}
              <code>{settings.outgoingPrefix}</code>.
            </p>
          </div>
        </div>
        <label>
          Outgoing information prefix
          <input
            value={settings.outgoingPrefix}
            onChange={(event) => update({ outgoingPrefix: event.target.value })}
            placeholder="service-maestro/out"
          />
        </label>
        <div className="git-settings-grid">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.publishDebug}
              onChange={(event) => update({ publishDebug: event.target.checked })}
            />
            Debug — connection, subscription and incoming-command diagnostics
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.publishInformation}
              onChange={(event) => update({ publishInformation: event.target.checked })}
            />
            Information — retained bridge status and live-session summaries
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.publishEvents}
              onChange={(event) => update({ publishEvents: event.target.checked })}
            />
            Events — activity log entries
          </label>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Outgoing controls</h2>
            <p className="muted">
              Controls publish a configured payload to <code>{settings.outgoingPrefix}/&lt;path&gt;</code>.
              Live controls appear on the Live control page; menu controls appear in the Menu
              dropdown.
            </p>
          </div>
          <button
            className="button"
            onClick={() => update({ controls: [...settings.controls, newControl()] })}
            title="Add an outgoing MQTT control"
          >
            Add control
          </button>
        </div>
        <div className="mqtt-control-list">
          {settings.controls.map((control) => (
            <div className="mqtt-control-editor" key={control.id}>
              <div className="mqtt-control-editor-head">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={control.enabled}
                    onChange={(event) =>
                      updateControl(control.id, { enabled: event.target.checked })
                    }
                  />
                  Enabled
                </label>
                <strong>{control.label || "Untitled control"}</strong>
                <button
                  className="button ghost small danger-text"
                  onClick={() =>
                    update({
                      controls: settings.controls.filter((entry) => entry.id !== control.id),
                    })
                  }
                  title="Remove this outgoing control"
                >
                  Remove
                </button>
              </div>
              <div className="mqtt-control-grid">
                <label>
                  Button label
                  <input
                    value={control.label}
                    onChange={(event) => updateControl(control.id, { label: event.target.value })}
                  />
                </label>
                <label>
                  MQTT path
                  <input
                    value={control.path}
                    onChange={(event) => updateControl(control.id, { path: event.target.value })}
                  />
                </label>
                <label className="checkbox mqtt-prefix-toggle">
                  <input
                    type="checkbox"
                    checked={control.usePrefix}
                    onChange={(event) =>
                      updateControl(control.id, { usePrefix: event.target.checked })
                    }
                    title={`Publish under ${settings.outgoingPrefix} when enabled`}
                  />
                  +prefix
                </label>
                <label>
                  Type
                  <select
                    value={control.type}
                    onChange={(event) =>
                      updateControl(control.id, {
                        type: event.target.value as MqttControl["type"],
                      })
                    }
                  >
                    <option value="button">Button</option>
                    <option value="select">Dropdown + send button</option>
                  </select>
                </label>
                <label>
                  Placement
                  <select
                    value={control.placement}
                    onChange={(event) =>
                      updateControl(control.id, {
                        placement: event.target.value as MqttControl["placement"],
                      })
                    }
                  >
                    <option value="live">Live control page</option>
                    <option value="menu">Menu dropdown</option>
                  </select>
                </label>
                {control.type === "button" && (
                  <label className="span-2">
                    Payload
                    <textarea
                      value={control.payload}
                      onChange={(event) => updateControl(control.id, { payload: event.target.value })}
                      rows={2}
                    />
                  </label>
                )}
              </div>
              {control.type === "select" && (
                <div className="mqtt-options">
                  <div className="mqtt-options-head">
                    <span>Arguments</span>
                    <button
                      className="button ghost small"
                      onClick={() =>
                        updateControl(control.id, {
                          options: [...control.options, { label: "Option", payload: "" }],
                        })
                      }
                      title="Add a dropdown argument"
                    >
                      Add argument
                    </button>
                  </div>
                  {control.options.map((option, index) => (
                    <div className="mqtt-option-row" key={`${control.id}-${index}`}>
                      <input
                        value={option.label}
                        onChange={(event) =>
                          updateControl(control.id, {
                            options: control.options.map((entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, label: event.target.value }
                                : entry,
                            ),
                          })
                        }
                        placeholder="Label"
                      />
                      <input
                        value={option.payload}
                        onChange={(event) =>
                          updateControl(control.id, {
                            options: control.options.map((entry, entryIndex) =>
                              entryIndex === index
                                ? { ...entry, payload: event.target.value }
                                : entry,
                            ),
                          })
                        }
                        placeholder="Payload"
                      />
                      <button
                        className="button ghost small danger-text"
                        onClick={() =>
                          updateControl(control.id, {
                            options: control.options.filter(
                              (_entry, entryIndex) => entryIndex !== index,
                            ),
                          })
                        }
                        title="Remove this argument"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  {!control.options.length && (
                    <p className="muted">Add at least one argument for a dropdown control.</p>
                  )}
                </div>
              )}
            </div>
          ))}
          {!settings.controls.length && (
            <p className="muted">No outgoing controls configured.</p>
          )}
        </div>
      </section>

      <div className="mqtt-save-row">
        <button className="button primary" onClick={save} disabled={saving}>
          {saving ? "Saving and reconnecting…" : "Save MQTT settings"}
        </button>
      </div>
    </div>
  );
}
