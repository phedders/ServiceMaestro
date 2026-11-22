# WebSockets API

Status: **implemented**. Service Maestro uses **Socket.IO 4** rather than raw WebSocket frames. The
control interface and every display output receive realtime state over two separate Socket.IO
endpoints:

| Endpoint | Listener | Path | Authentication |
| --- | --- | --- | --- |
| Control | `SM_PORT` (default `8080`) | `/socket.io` | Session cookie + same-origin check |
| Output (control listener) | `SM_PORT` | `/display/socket.ro.io` | Output token, always required |
| Output (display listener) | `SM_DISPLAY_PORT` (default `8081`) | `/display/socket.ro.io` | Output token only when `SM_DISPLAY_REQUIRE_TOKEN=true` |

The two `/display/socket.ro.io` endpoints are the same read-only stream. Output pages served from the
control listener (`/display/*` and the `/obs-*` aliases) use the control-listener endpoint and must
include a token. Output pages served by the plain-HTTP display listener use the token-free stream by
default.

A raw WebSocket client cannot speak this protocol. Use `socket.io-client` 4.x, or another Socket.IO 4
implementation.

## 1. Connecting a control client

The control socket authenticates with the normal browser session. Sign in through `/login` first,
then connect with credentials enabled:

```ts
import { io } from "socket.io-client";

const socket = io("https://lyrics.local:8080", {
  path: "/socket.io",
  withCredentials: true,
});
```

The browser sends the `sm_session` cookie automatically for a same-origin connection. The server
accepts the socket only when:

- the `Origin` header is absent, matches the request host and protocol, or matches the configured
  `SM_WEBAUTHN_ORIGIN`; and
- the session cookie maps to a valid, unexpired user session.

A failed handshake produces a Socket.IO `connect_error` with the message `unauthorized`. There is no
API-key or bearer-token login for the control socket.

In the current control UI, this socket is used for **state** while live commands are sent over HTTP.
The socket command events are still supported for integrations.

## 2. Connecting a display output

The bundled display client passes the output token in the Socket.IO handshake:

```js
const socket = window.io({
  path: "/display/socket.ro.io",
  auth: { outputToken: outputToken },
  reconnection: true,
  reconnectionDelay: 800,
  reconnectionDelayMax: 4000,
});
```

The token is read from the page's `?token=` parameter by the bundled client, with a fallback to the
development token. A query parameter is also accepted directly by the server:

```js
const socket = io("http://lyrics.local:8081", {
  path: "/display/socket.ro.io",
  query: { token: outputToken },
});
```

Rules:

- On the **control listener**, `/display/socket.ro.io` always requires the output token, even when
  `SM_DISPLAY_REQUIRE_TOKEN=false`.
- On the **display listener**, the token is optional by default. Set
  `SM_DISPLAY_REQUIRE_TOKEN=true` to require it there too.
- The output socket has **no Origin check**. Its only protection is the shared output token, so a
  token-free display listener should be reachable only on a trusted network.
- The output socket receives state and sends nothing. No control events are registered on it.

Do not publish or screenshot the real token. Prefer `auth.outputToken` over a URL query string
because query strings are more likely to appear in proxy logs, browser history and screenshots.

## 3. Rooms

Each socket joins one server-assigned room:

| Room | Members | Receives |
| --- | --- | --- |
| `control` | Every authenticated control socket | `live:snapshot`, `heartbeat` |
| `outputs` | Every output socket on every output endpoint | `live:snapshot`, `heartbeat` |

Clients cannot subscribe to or leave rooms, and cannot send messages to a room. Both rooms receive
the same `LiveState`; an output filters that state locally according to its own output definition
(template, page mode, background and so on).

## 4. Server-to-client events

### `live:snapshot`

The primary state event. The server sends it:

- immediately after a socket connects, so a refresh or reconnect never starts blank; and
- after every live-state change, to both `control` and `outputs`.

The payload is a **complete** `LiveState`. Replace the local state with it; there are no delta
messages to merge.

```jsonc
{
  "sessionId": "…",
  "setlistId": "…",
  "setlistName": "Sunday morning",
  "status": "live",
  "itemIndex": 3,
  "pageIndex": 1,
  "pageCount": 4,
  "mode": "song",
  "title": "Amazing Grace",
  "blank": false,
  "transition": "fade",
  "halfPageMode": false,
  "halfPageOffset": 0,
  "stagePreview": false,
  "maxLines": 4,
  "transpose": 0,
  "footer": "",
  "bibleVerseNumbers": true,
  "pages": [
    {
      "index": 1,
      "section": "v2",
      "html": "<div class=\"slide\">…</div>",
      "stinger": null
    }
  ],
  "items": [
    { "index": 0, "kind": "song", "title": "Welcome", "notes": null }
  ],
  "background": { "render": "…" },
  "templates": { "main": { "html": "…", "css": "…" } },
  "outputs": { "main": { "id": "main", "label": "Main", "template": "main" } },
  "displayConfig": { "fontFamily": "Oxygen", "textColor": "#ffffff" },
  "queuedItemIndex": null,
  "queuedTitle": null,
  "queuedPages": [],
  "queuedOutOfDatePages": [],
  "appendedItems": [],
  "autoplay": null,
  "autoplayOverrides": {},
  "version": 42,
  "updatedAt": "2026-11-16T09:30:00.000Z",
  "pendingUpdate": false,
  "pendingRevision": null
}
```

Key fields:

| Field | Meaning |
| --- | --- |
| `sessionId`, `status` | Active session and whether it is `live`, `rehearsal`, `ended` or `idle`. |
| `setlistId`, `setlistName` | Source set list. Empty/null outside a session. |
| `itemIndex`, `pageIndex`, `pageCount` | Current set-list item and zero-based page position. `itemIndex` is `-1` while a quick song or presentation overlay is showing. |
| `mode` | Active item kind: `song`, `text`, `image`, `image_list`, `tarp`, `presentation`, or `idle` when no session is active. Blanking is reported by `blank`, not by `mode`. |
| `blank` | Output is hidden or faded out. |
| `transition` | Fullscreen page-change transition: `fade` or `scroll`. Other outputs use their own per-output transition setting. |
| `halfPageMode`, `halfPageOffset` | Half-page scroll preview state. `halfPageOffset = 1` shows the lower half of the current page and the top of the next; `0` shows the top half of the current page. |
| `pagesOutOfDate` | True after a max-lines change until the operator reselects a page. |
| `stagePreview`, `queuedItemIndex`, `queuedPages` | A queued item selected from the set list, and whether outputs with **Stage previews** enabled are showing that queued item instead of the live pages. |
| `outOfDatePages`, `queuedOutOfDatePages` | Page indexes with a saved page edit waiting for a reload. Clicking the page reloads the edited content. |
| `transpose`, `maxLines`, `footer` | Current live overrides. |
| `bibleVerseNumbers` | Show or hide the superscript verse numbers on Bible paragraph pages. Defaults to `true`. |
| `pages` | Rendered pages for the current item. `html` is already sanitized and styled. `stinger` is an optional transition overlay. |
| `items` | Summaries of the active queue (index, kind, title, notes), not full item content. |
| `background` | Optional rendered CSS for the active display background. Item/set-list backgrounds take precedence over the global background. |
| `templates`, `outputs`, `displayConfig` | Current templates, output definitions and global display settings. |
| `queuedItemIndex`, `queuedTitle`, `queuedPages` | Preview of an item queued for the next `next`/forward page action. The queued item is not on screen yet. |
| `appendedItems` | Item indexes whose pages were appended to the live queue. |
| `autoplay`, `autoplayOverrides` | Transient autoplay state for image-list and Tarp items. |
| `version` | Increases with every state change. Useful for ordering and diagnostics. |
| `updatedAt` | ISO-8601 timestamp of the last change. |
| `pendingUpdate`, `pendingRevision` | A newer set-list revision is waiting to be applied after the current item. |

The snapshot can contain song lyrics, notes, template HTML/CSS and display settings. It is not
public data: anyone holding a valid control session or output token can read it.

### `heartbeat`

A liveness signal sent to every connected socket immediately on connection and every **15 seconds**
afterwards:

```json
{ "at": 1763285400000 }
```

`at` is a Unix timestamp in milliseconds. The heartbeat does not carry application state; use
`live:snapshot` for that.

The bundled display client uses it as a watchdog: it refreshes the page when no heartbeat has arrived
for **45 seconds** while the page is visible. It checks every 5 seconds and skips the check while the
tab is hidden. The control client does not depend on the heartbeat because it also sends commands over
HTTP.

### Socket.IO lifecycle events

`connect`, `disconnect` and `connect_error` are emitted by Socket.IO itself, not by Service Maestro.
Use them to drive connection indicators and reconnect handling.

## 5. Client-to-server events (control only)

Both inbound events require write permission for the **live** module (administrators always pass).
The permission check uses the user captured during the handshake, so reconnect after changing a
user's role or permissions.

Payloads are validated with Zod. An unauthorised or invalid payload is **silently dropped**: the
server does not send an error event or acknowledgement. Observe the result through the next
`live:snapshot`.

There is no command for starting, applying or stopping a live session. Those operations remain
HTTP-only (`/api/live/start`, `/api/live/apply`, `/api/live/stop`), as do quick songs, images and
presentations.

### `live:command`

```js
socket.emit("live:command", { type: "page", delta: 1 });
```

Valid payloads:

| Payload | Effect |
| --- | --- |
| `{ "type": "next" }` | Advance one page, then into the next item at the item boundary. If an item is queued, commit it at page 0. |
| `{ "type": "prev" }` | Go back one page, then into the previous item at the item boundary. |
| `{ "type": "transition", "value": "scroll" }` | Set the fullscreen page-change transition to `fade` or `scroll`. |
| `{ "type": "stagePreview" }` | Show the queued item from page 1 on outputs with Stage previews enabled; the live pages and other outputs are unchanged. Only valid while the queued item is not live. |
| `{ "type": "nextHalf" }` | Scroll fullscreen/lower-third outputs up by half a page and reveal the top half of the next page. Repeating advances through the item in half-page steps; on the last page it scrolls that page's top half to the top, then a further press shows the full final page. Stage and chords outputs show the same half-step as a close pair of half sections at normal page size when they preview upcoming pages. |
| `{ "type": "prevHalf" }` | Scroll back by half a page, reversing `nextHalf`. From the full last page it first shows the final page's half view; on earlier pages it shows the lower half of the previous page, and at the first page it returns to the normal full-page view. |
| `{ "type": "page", "delta": 1 }` | Move by `-50…50` pages. A forward move commits a queued item first. Page boundaries follow the global **Live navigation** setting. |
| `{ "type": "goto", "itemIndex": 2, "pageIndex": 0 }` | Select an item and/or page directly. At least one field is required. Clears blank. |
| `{ "type": "queueItem", "itemIndex": 4 }` | Preview an item as the next queued item **without changing the output**. |
| `{ "type": "appendItem", "itemIndex": 4 }` | Append an item's pages to the current live queue. |
| `{ "type": "blank", "value": true }` | Set blank on/off. Omit `value` to toggle. |
| `{ "type": "transpose", "delta": 1 }` | Change transpose by `-12…12` semitones per command. The state is clamped to `-24…24`. |
| `{ "type": "maxLines", "value": 4 }` | Set lines per page for the current queue, `1…30`. While a set-list item is live, the value is stored on that item. |
| `{ "type": "editPage", "itemIndex": 0, "pageIndex": 1, "source": "[Chorus]\n…", "target": "queue" }` | Save an edited page. `target` is `queue` (current page queue only; discarded when the item is reloaded), `setlist`, or `source` (song/text). The page is marked out of date until it is reloaded. |
| `POST /api/live/page-preview` with `{ "itemIndex": 0, "source": "…" }` | Render an edited source page for the editor preview without saving it. |
| `{ "type": "footer", "text": "…" }` | Set footer text, up to 500 characters. Empty text clears it. |
| `{ "type": "bibleVerseNumbers", "value": false }` | Show or hide Bible verse numbers. Omit `value` to toggle. Defaults to shown. |
| `{ "type": "autoplay", "autoplay": true, "mode": "loop", "delaySeconds": 8 }` | Override autoplay for the current image-list/Tarp item. Fields are optional; `mode` is `single`, `loop` or `bounce`; `delaySeconds` is `1…300`. |
| `{ "type": "autoplay", "reset": true }` | Remove the current item's autoplay override and return to its configured values. |

Notes:

- Commands only affect an active session. With no active session they are ignored.
- `queueItem` sets `queuedItemIndex`, `queuedTitle` and `queuedPages` but leaves the currently
  displayed item and page untouched. The queue commits on the next `next` or forward `page` command
  and starts at page 0. `goto` with a `pageIndex` also resolves the queued item.
- `goto` unblanks the output. `next`, `prev` and page navigation can also unblank according to the
  **Auto show on page change** setting.
- Each accepted command is recorded in the activity log.

### `live:quickText`

```js
socket.emit("live:quickText", {
  text: "Welcome — please stand",
  mode: "direct",
});
```

| Field | Rules |
| --- | --- |
| `text` | Required string, 1–50,000 characters. |
| `mode` | Optional `direct` or `setlist`. Reserved for compatibility; the server appends quick text to the current live page queue. |

Quick text appends its pages to the current live page queue, becomes the active page and does not
edit the set list. Changing to another set-list item clears the appended queue, including quick
text and quick images. The quick-text event is also recorded in the activity log.

## 6. HTTP equivalents

The control UI uses these HTTP endpoints while listening to the socket for state:

| Endpoint | Body | Result |
| --- | --- | --- |
| `POST /api/live/command` | Same payload as `live:command` | `{ "state": LiveState }`, or `400` with validation issues |
| `POST /api/live/quick-text` | `{ "text": "…", "mode": "direct" }` | `{ "state": LiveState }`, or `400` for invalid text |

Both require an authenticated session and live write permission. The HTTP responses return the new
state directly, which makes them convenient for scripts that do not need the realtime stream. Unlike
the socket events, HTTP rejects invalid payloads with a `400` response.

## 7. Reconnection behaviour

- Socket.IO clients reconnect automatically by default. The bundled display client retries with an
  800 ms initial delay and a 4 s maximum delay.
- Every successful (re)connection immediately receives a full `live:snapshot`, so no replay or
  catch-up request is needed.
- A display keeps its last rendered frame when the socket disconnects, adds an offline indicator, and
  reloads after 45 s without a heartbeat while visible. This recovers from half-open connections
  that the browser does not report as closed.
- A control socket that loses its session cookie on reconnect fails with `connect_error:
  unauthorized`. Redirect the user to `/login`; do not retry indefinitely with bad credentials.
- Session expiry is checked at handshake, not continuously. An already-connected control socket
  continues to send commands until it disconnects, even after the session expires. Reconnect after
  login/logout so authorisation is re-evaluated.
- A permission change also requires reconnecting an existing control socket.

## 8. Deployment and security limits

- The control listener is HTTPS by default. The display listener is plain HTTP by default and serves
  only `/display/*`, including the output socket.
- A reverse proxy must forward both **HTTP long-polling** and **WebSocket upgrade** requests for
  `/socket.io` and `/display/socket.ro.io`. If it terminates TLS, it must preserve the original
  `Host` and `Origin`, or the control socket's origin check will reject the handshake. Set
  `SM_TRUST_PROXY=true` only when a trusted proxy supplies `X-Forwarded-*` headers.
- The control socket checks the request Origin against the request host/protocol or
  `SM_WEBAUTHN_ORIGIN`. The output socket does not check Origin because outputs are often loaded in
  OBS or on separate display hosts.
- No per-socket rate limiter is applied. Protection consists of authentication, live permission,
  payload size limits in the schemas and the network boundary. Keep the control port on a trusted
  network, and enable `SM_DISPLAY_REQUIRE_TOKEN=true` if the display port is not isolated.
- The output token is shared by all outputs. Rotating `SM_OUTPUT_TOKEN` invalidates existing output
  connections and any control-origin display URLs using the old token; reconnect displays afterwards.
- Never commit the session cookie, the output token or a `data/config.yaml` containing real secrets.

## 9. Client examples

The examples below show complete connection and event flows. They read passwords and tokens from
environment variables or prompts so that real secrets do not end up in shell history or source
control.

### 9.1 Browser control client

This example connects with the signed-in session, renders snapshots and sends the common live
commands. It assumes your page is served from the same origin as the control interface and that
`socket.io-client` is bundled with the page.

```js
import { io } from "socket.io-client";

const statusEl = document.querySelector("#status");
const titleEl = document.querySelector("#title");
const pageEl = document.querySelector("#page");
const contentEl = document.querySelector("#content");

const socket = io("https://lyrics.local:8080", {
  path: "/socket.io",
  withCredentials: true,
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
});

let live = null;

socket.on("connect", () => {
  statusEl.textContent = "connected";
});

socket.on("disconnect", (reason) => {
  statusEl.textContent = `disconnected: ${reason}`;
});

socket.on("connect_error", (error) => {
  statusEl.textContent = `connection failed: ${error.message}`;
  if (error.message === "unauthorized") {
    socket.disconnect();
    window.location.assign("/login");
  }
});

socket.on("live:snapshot", (state) => {
  live = state;
  titleEl.textContent = state.title || "No active item";
  pageEl.textContent = state.pageCount
    ? `${state.pageIndex + 1} / ${state.pageCount}`
    : "—";

  // The server already sanitized this HTML.
  contentEl.innerHTML = state.pages[state.pageIndex]?.html ?? "";
  contentEl.classList.toggle("is-blank", state.blank);
});

function send(payload) {
  if (!live || (live.status !== "live" && live.status !== "rehearsal")) return;
  socket.emit("live:command", payload);
}

document.querySelector("#next").addEventListener("click", () => {
  send({ type: "next" });
});

document.querySelector("#previous").addEventListener("click", () => {
  send({ type: "prev" });
});

document.querySelector("#hide").addEventListener("click", () => {
  send({ type: "blank" }); // omitted value toggles
});

document.querySelector("#queue").addEventListener("click", () => {
  send({ type: "queueItem", itemIndex: 4 });
});

document.querySelector("#welcome").addEventListener("click", () => {
  socket.emit("live:quickText", {
    text: "Welcome — please stand",
    mode: "direct",
  });
});
```

The `send` guard is only a UI convenience. The server still enforces the live permission and
validates every payload.

### 9.2 Browser output client

A minimal output page that renders the current page and recovers from a half-open connection:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Service Maestro output</title>
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        background: transparent;
        color: #fff;
        font-family: system-ui, sans-serif;
      }
      #stage {
        display: grid;
        place-items: center;
        height: 100%;
        font-size: 6vmin;
        text-align: center;
      }
      body.is-blank #stage {
        visibility: hidden;
      }
      body.is-offline::after {
        content: "offline";
        position: fixed;
        top: 1rem;
        right: 1rem;
        padding: 0.25rem 0.5rem;
        background: #900;
        font-size: 0.8rem;
      }
    </style>
  </head>
  <body>
    <main id="stage"></main>
    <script src="/display/socket.ro.io/socket.io.js"></script>
    <script>
      const token = new URLSearchParams(location.search).get("token");
      const stage = document.querySelector("#stage");
      let lastHeartbeat = Date.now();

      const socket = io({
        path: "/display/socket.ro.io",
        auth: { outputToken: token },
        reconnection: true,
        reconnectionDelay: 800,
        reconnectionDelayMax: 4000,
      });

      socket.on("live:snapshot", (state) => {
        stage.innerHTML = state.pages[state.pageIndex]?.html ?? "";
        document.body.classList.toggle("is-blank", state.blank);
      });

      socket.on("heartbeat", () => {
        lastHeartbeat = Date.now();
        document.body.classList.remove("is-offline");
      });

      socket.on("connect", () => {
        lastHeartbeat = Date.now();
        document.body.classList.remove("is-offline");
      });

      socket.on("disconnect", () => document.body.classList.add("is-offline"));
      socket.on("connect_error", () => document.body.classList.add("is-offline"));

      setInterval(() => {
        if (
          document.visibilityState === "visible" &&
          Date.now() - lastHeartbeat > 45_000
        ) {
          location.reload();
        }
      }, 5_000);
    </script>
  </body>
</html>
```

This deliberately omits fades, backgrounds, templates and lower-third handling. The bundled
`/display/*` outputs implement those and should normally be used instead.

### 9.3 Node output monitor

A read-only CLI listener is useful when checking what the display listeners are receiving:

```js
import { io } from "socket.io-client";

const url = process.env.SM_OUTPUT_URL ?? "http://127.0.0.1:8081";
const token = process.env.SM_OUTPUT_TOKEN;

const socket = io(url, {
  path: "/display/socket.ro.io",
  auth: token ? { outputToken: token } : {},
  reconnection: true,
});

socket.on("connect", () => console.log("connected", socket.id));
socket.on("connect_error", (error) => console.error("connect_error:", error.message));
socket.on("heartbeat", ({ at }) => console.log("heartbeat", new Date(at).toISOString()));

socket.on("live:snapshot", (state) => {
  console.log(
    JSON.stringify({
      status: state.status,
      title: state.title,
      item: state.itemIndex,
      page: `${state.pageIndex + 1}/${state.pageCount}`,
      blank: state.blank,
    }),
  );
});
```

Leave `SM_OUTPUT_TOKEN` unset for a token-free display listener. Set it when
`SM_DISPLAY_REQUIRE_TOKEN=true` or when connecting to the control listener.

### 9.4 HTTP equivalents with curl

The HTTP command API is convenient for shell scripts because it returns the resulting state
directly. The cookie jar contains a live session token, so keep it private.

```bash
SM_URL="https://lyrics.local:8080"

read -rsp 'Password: ' SM_PASSWORD; echo

# Log in and save the sm_session cookie. Omit -k when the certificate is trusted.
SM_PASSWORD="$SM_PASSWORD" \
jq -n '{username:"operator", password:env.SM_PASSWORD}' |
  curl -k -c /tmp/sm-cookies \
    -H 'Content-Type: application/json' \
    --data-binary @- \
    "$SM_URL/api/auth/login"

# Read the current live state. The shape is the same as live:snapshot.
curl -k -b /tmp/sm-cookies "$SM_URL/api/live" |
  jq '.state | {status, setlistName, title, pageIndex, pageCount, blank}'

# Send a command. Invalid payloads return 400 with validation issues.
curl -k -b /tmp/sm-cookies \
  -H 'Content-Type: application/json' \
  --data '{"type":"page","delta":1}' \
  "$SM_URL/api/live/command" |
  jq '.state | {title, pageIndex, pageCount}'

# Append quick text to the live page queue.
curl -k -b /tmp/sm-cookies \
  -H 'Content-Type: application/json' \
  --data '{"text":"Welcome — please stand","mode":"direct"}' \
  "$SM_URL/api/live/quick-text" |
  jq '.state | {title, pageIndex}'
```

`-k` is only for a local self-signed certificate. Do not use it for a production certificate.

### 9.5 Complete bash script using Socket.IO

Bash cannot speak the Socket.IO protocol by itself. This script uses `curl` for login and the
project's Node `socket.io-client` for the WebSocket connection. It is **read-only by default**:
without an argument it connects, prints the first snapshot and exits. Pass `next` to send one
command, or pass any other text to append it as quick text.

```bash
#!/usr/bin/env bash
#
# Usage:
#   SM_PASSWORD='…' ./sm-socket-example.sh            # print state and exit
#   SM_PASSWORD='…' ./sm-socket-example.sh next       # send next
#   SM_PASSWORD='…' ./sm-socket-example.sh 'Welcome'  # append quick text
#
# Requires: curl, awk and node with socket.io-client available.
# Run from the Service Maestro repository root.

set -euo pipefail

SM_URL="${SM_URL:-https://127.0.0.1:8080}"
SM_USER="${SM_USER:-admin}"
SM_ACTION="${1:-}"

if [[ -z "${SM_PASSWORD:-}" ]]; then
  read -rsp "Password for ${SM_USER}: " SM_PASSWORD
  echo
fi

CURL_OPTS=(-fsS)
if [[ "${SM_INSECURE_TLS:-0}" == "1" ]]; then
  CURL_OPTS+=(-k)
fi

COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

# 1. Log in and keep the session cookie in a private temporary file.
LOGIN_JSON="$(
  SM_USER="$SM_USER" SM_PASSWORD="$SM_PASSWORD" \
  node -e 'process.stdout.write(JSON.stringify({
    username: process.env.SM_USER,
    password: process.env.SM_PASSWORD
  }))'
)"
printf '%s' "$LOGIN_JSON" | curl "${CURL_OPTS[@]}" -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  --data-binary @- \
  "$SM_URL/api/auth/login" >/dev/null

# 2. Extract the sm_session cookie for the Socket.IO handshake.
COOKIE="$(awk 'BEGIN { FS = "\t" } $6 == "sm_session" { print $6 "=" $7 }' "$COOKIE_JAR")"
if [[ -z "$COOKIE" ]]; then
  echo "Login did not return an sm_session cookie." >&2
  exit 1
fi

# 3. Connect, print the first snapshot, then optionally send one action.
SM_URL="$SM_URL" SM_COOKIE="$COOKIE" SM_ACTION="$SM_ACTION" \
SM_INSECURE_TLS="${SM_INSECURE_TLS:-0}" \
node --input-type=module <<'NODE'
import { io } from "socket.io-client";

const socket = io(process.env.SM_URL, {
  path: "/socket.io",
  extraHeaders: { cookie: process.env.SM_COOKIE },
  rejectUnauthorized: process.env.SM_INSECURE_TLS !== "1",
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
});

const firstSnapshot = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("timed out waiting for live:snapshot")),
    10_000,
  );
  socket.once("live:snapshot", (state) => {
    clearTimeout(timer);
    resolve(state);
  });
});

socket.on("connect_error", (error) => {
  console.error(`Socket error: ${error.message}`);
});

await new Promise((resolve, reject) => {
  socket.once("connect", resolve);
  socket.once("connect_error", reject);
});

const state = await firstSnapshot;
console.log(JSON.stringify({
  status: state.status,
  setlist: state.setlistName,
  title: state.title,
  page: `${state.pageIndex + 1}/${state.pageCount}`,
  blank: state.blank,
}, null, 2));

if (process.env.SM_ACTION === "next") {
  socket.emit("live:command", { type: "next" });
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log("Sent live:command { type: 'next' }");
} else if (process.env.SM_ACTION) {
  socket.emit("live:quickText", {
    text: process.env.SM_ACTION,
    mode: "direct",
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  console.log("Sent live:quickText");
}

socket.disconnect();
NODE
```

Run it against a local self-signed certificate with:

```bash
SM_URL="https://127.0.0.1:8080" \
SM_USER="admin" \
SM_INSECURE_TLS=1 \
./sm-socket-example.sh
```

`SM_INSECURE_TLS=1` disables certificate verification for both `curl` and the Node client. Use it
only for local testing. For a trusted certificate, omit it and use the real hostname in `SM_URL`.
