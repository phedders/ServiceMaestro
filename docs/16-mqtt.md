# MQTT adapter

Status: **implemented**. MQTT is an optional external adapter, disabled by default and controlled by an administrator.

The bridge connects Service Maestro to an MQTT broker so other systems can drive selected API actions and receive live, activity and diagnostic information. It is intended for trusted production or rehearsal networks, with broker ACLs and TLS where appropriate.

## 1. Enable and configure

Each adapter has an **Off / Local / Shared** mode under **Settings → External adapters**:

- **Off** — MQTT is not connected and all MQTT UI and API routes are unavailable.
- **Local** — this server uses its own broker, mappings, outgoing categories and controls.
- **Shared** — non-secret MQTT configuration follows `settings/shared.json` in the set lists repository. The broker password, client ID and per-instance secrets stay local.

To configure:

1. Open **Settings → External adapters** and set **MQTT adapter** to **Local** or **Shared**.
2. Open **Menu → MQTT**.
3. Set the broker URL, optional protocol override, username/password and optional client ID.
4. Configure incoming commands, outgoing categories and controls.
5. Choose **Save MQTT settings**.

In Shared mode, broker settings, mappings, outgoing categories and controls are exported through the shared settings repository. The password and client ID are never shared. Applying a shared file updates the saved MQTT configuration on instances whose MQTT mode is Shared.

Broker passwords are encrypted with the instance secret key (AES-256-GCM) and are never returned to the browser. Leaving the password field blank preserves the stored password; **Remove stored password** clears it. The bridge connects with MQTT 5; older publishers can still use the broker normally and supply source restrictions in the JSON payload.

The protocol override replaces the scheme in the broker URL or adds one when omitted. Supported values are MQTT, MQTT over TLS, WebSocket and WebSocket over TLS. Without an override, the URL scheme is used; a URL without a scheme defaults to `mqtt://`.

## 2. Incoming commands

The bridge subscribes to:

```text
<incomingPrefix>/#
```

Each enabled mapping matches one command suffix. For example, with prefix `service-maestro/in` and command `live/next`, publish to:

```text
service-maestro/in/live/next
```

A mapping defines:

| Field | Meaning |
| --- | --- |
| Command suffix | Topic suffix after the incoming prefix |
| Method | `GET`, `POST`, `PUT`, `PATCH` or `DELETE` |
| SM API path | Target path beginning `/api/` |
| Source clients | Optional allow-list of publisher identifiers |
| Payload template | Optional translation from the MQTT payload to the API body |

### Source-client restrictions

MQTT does not expose the publisher's client ID to subscribers in the protocol. Source restrictions therefore use a `sourceClient` value supplied in the JSON message payload:

```json
{ "sourceClient": "lighting-desk", "value": true }
```

MQTT 5 user properties named `sourceClient`, `sourceclient`, `clientId` or `clientid` are also accepted when present. This is an application-level filter, not authentication; use broker credentials and ACLs for real authentication.

### Payload templates

An empty template sends the parsed JSON payload as the API body. Otherwise, these placeholders are available:

| Placeholder | Value |
| --- | --- |
| `{{payload}}` | Raw message text |
| `{{json}}` | Parsed payload serialized as JSON, or the raw text when not JSON |
| `{{value}}` | Parsed string value or trimmed raw text |
| `{{topic}}` | Full incoming topic |
| `{{command}}` | Matched command suffix |
| `{{clientId}}` | Detected source client |

For example:

```json
{"type":"blank","value":true}
```

or:

```json
{"title":{{json}},"source":"{{clientId}}"}
```

Placeholders in the API path are URL-encoded. This allows mappings such as:

```text
/api/songs?q={{value}}
```

### Blocked endpoints

Incoming MQTT commands cannot target authentication, user management, integration, MQTT, TLS, activity, Git, global settings or transfer endpoints. The bridge also re-checks the path at execution time. Use least-privilege broker ACLs as well.

## 3. Outgoing information

The bridge publishes under `<outgoingPrefix>`:

| Topic | Category | Retained | Contents |
| --- | --- | --- | --- |
| `/status` | Information | Yes | Broker state, client ID and last error |
| `/live` | Information | Yes | Current live status, set list, item/page and blank state |
| `/event` | Events | No | Activity-log entry for non-GET API actions |
| `/debug` | Debug | No | Connection, subscription, incoming-command and control diagnostics |

Enable each category independently in the MQTT settings page.

## 4. Outgoing controls

Controls publish a configured payload to:

```text
<outgoingPrefix>/<control path>
```

Each control has:

- A button label.
- A MQTT path.
- A type: single button or dropdown with arguments.
- A payload, or a list of labelled arguments with payloads.
- A placement: **Live control page** or **Menu dropdown**.

Control publishing requires the `live` write permission. If the bridge is disconnected, the API returns `409` and the control shows an error notification.

## 5. API

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `/api/mqtt/settings` (GET) | admin | Read connection, mapping, outgoing and control settings |
| `/api/mqtt/settings` (PUT) | admin | Save settings, encrypt credentials and reconnect |
| `/api/mqtt/status` (GET) | admin | Current connection, subscription, last-message and error state |
| `/api/mqtt/controls` (GET) | authenticated | List enabled control buttons without publishing details |
| `/api/mqtt/controls/:id/publish` (POST) | live write | Publish the button payload or selected dropdown argument |

The adapter toggle is stored locally with the other external-adapter flags and is not shared through `settings/shared.json`.
