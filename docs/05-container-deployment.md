# Container deployment

Design for running Service Maestro as a **lightweight, single-process container** on Docker, Podman, Incus or plain LXC. The application must not require Docker-in-Docker, host networking, privileged mode, systemd inside an OCI container, or external services (no Redis/Postgres).

See [02-architecture.md](02-architecture.md) for the application design and [03-content-model.md](03-content-model.md) for set list export/import, which doubles as the portable backup format.

## 1. Constraints the design guarantees

- **One process** (Node.js) owns HTTP, WebSockets, SQLite and background scans. No sidecars.
- **One writable volume** (`/data`); library directories can be mounted read-only.
- **Two TCP ports**: `8080` for control/login/API and `8081` for the read-only `/display/*` tree. Both use normal HTTP + WebSocket upgrades.
- **No privileged operations**, no kernel modules, no FUSE, no Docker socket, no host PID/network namespaces.
- **Runs as a non-root user** with a fixed UID/GID; no files created as root on bind mounts.
- **Read-only root filesystem** is supported (`/tmp` as tmpfs, config read-only, data writable).
- **Offline by default**: fonts, JS and CSS are bundled; no CDN calls.
- **Graceful shutdown** on SIGTERM/SIGINT; SQLite WAL checkpoint and clean close.

## 2. Image design

| Item | Choice |
| --- | --- |
| Base (build) | `node:24-trixie` + build tools for native modules |
| Base (runtime) | `node:24-trixie-slim` |
| Why Debian slim (not Alpine) | `better-sqlite3` and `sharp` ship glibc prebuilds; musl builds add risk and size. |
| Init | `tini` as PID 1 (reaps zombies, forwards signals) |
| User | `sm` UID/GID **10001** (numeric, no login shell) |
| Locale/TZ | `TZ` env, `tzdata` installed |
| Ports | `8080` control, `8081` read-only displays (both unprivileged) |
| Healthcheck | `GET /api/health` |
| Architectures | `linux/amd64`, `linux/arm64` |
| Target size | ~200–300 MB compressed (fonts/media excluded — they live in `/data` or `/library`) |

Multi-stage sketch (to be committed with the code):

```dockerfile
FROM node:24-trixie AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates tzdata git git-lfs openssh-client \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 10001 sm && useradd -u 10001 -g sm -M -s /usr/sbin/nologin sm
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
USER 10001:10001
EXPOSE 8080 8081
ENV NODE_ENV=production SM_PORT=8080 SM_DISPLAY_PORT=8081 SM_DATA_DIR=/data
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "process.env.NODE_TLS_REJECT_UNAUTHORIZED='0'; fetch('https://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
```

Native modules (`better-sqlite3`, `sharp`) are installed in the builder; the runtime only receives the compiled artifacts and their runtime libraries.

## 3. Volumes and filesystem layout

| Container path | Mode | Contents |
| --- | --- | --- |
| `/data` | **rw** | `app.sqlite`, `assets/` (ChordPro/PDF/tabs), `repos/` (Git clones), `cache/` (thumbs, Bible cache), `imports/`, `exports/`, `logs/` (optional), `backups/` (optional) |
| `/library/songs` | ro (default) | OpenLP, ChordPro and text source directories |
| `/library/bible` | ro | One SQLite file per translation |
| `/library/images` | rw if uploads enabled, else ro | Slides, notices, logos, backgrounds |
| `/config` | ro | `config.json`, secrets, theme/branding overrides |
| `/tmp` | tmpfs | Transient upload/zip extraction and render scratch |
| `/backups` | rw (optional) | Database dumps and bundle archives |

Rules:

- SQLite must live on a **local filesystem** (WAL does not work safely on NFS/SMB). If media is on a network share, keep `/data` local.
- The cache is disposable; safe to delete at any time.
- `/library/songs` is treated as source-of-truth and never written by the app; edits go to the app DB as versions.
- File ownership: the runtime UID must be able to write `/data`, `/library/images` (if uploads) and `/backups`. Document `chown -R 10001:10001` for bind mounts, `:Z` for SELinux, and `shift=true`/`raw.idmap` for Incus/LXC.

## 4. Configuration

Environment-first, with optional file values and `_FILE` secret support:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SM_PORT` | `8080` | HTTPS control HTTP/WS port |
| `SM_DISPLAY_PORT` | `8081` | Read-only display HTTP/WS port; serves only `/display/*` |
| `SM_HOST` | `0.0.0.0` | Bind address |
| `SM_SECURE_COOKIES` | `true` | Mark session cookies Secure; keep enabled behind an HTTPS proxy |
| `SM_TRUST_PROXY` | `false` | Honour `X-Forwarded-*` from a trusted reverse proxy |
| `SM_SSL_ENABLED` | `true` | Serve control over HTTPS; disable only behind a TLS-terminating forward proxy |
| `SM_SSL_DIR` | `/data/ssl` | Control HTTPS certificate directory |
| `SM_SSL_CERT_FILE` | `cert.pem` | Trusted certificate/full-chain path |
| `SM_SSL_KEY_FILE` | `key.pem` | Private key path |
| `SM_SSL_HOSTS` | unset | Extra comma-separated DNS names/IPs for generated certificates |
| `SM_WEBAUTHN_RP_NAME` | `Service Maestro` | Passkey relying-party display name |
| `SM_WEBAUTHN_RP_ID` | derived | Passkey RP ID; set explicitly for a proxy/domain |
| `SM_WEBAUTHN_ORIGIN` | derived | Browser-facing HTTPS origin for passkeys |
| `SM_BRANDING_NAV_BACKGROUND` | unset | Default instance sidebar/top-menu background |
| `SM_BRANDING_LOGO_FILE` | unset | Optional instance logo file |
| `SM_DATA_DIR` | `/data` | Writable state |
| `SM_SONGS_DIR` | `/library/songs` | Song sources |
| `SM_BIBLE_DIR` | `/library/bible` | Bible SQLite files |
| `SM_IMAGES_DIR` | `/library/images` | Images and uploads |
| `SM_SONGSELECT_WATCH_DIR` | `/data/imports/songselect` | SongSelect drop folder for lyrics/text downloads |
| `SM_SONGSELECT_WATCH_ENABLED` | `true` | Enable background drop-folder imports |
| `SM_SONGSELECT_WATCH_INTERVAL` | `10` | Watched-folder poll interval in seconds |
| `SM_CONFIG_FILE` | auto-discovered | Optional YAML/JSON config; environment variables override file values |
| `SM_TZ` | `Europe/London` | Service dates/times and logs |
| `SM_SESSION_SECRET` / `_FILE` | generated at first start | Cookie signing |
| `SM_SECRET_KEY` / `_FILE` | generated at first start | Master key for encrypted site credentials |
| `SM_SONG_SCRAPING_PROVIDER` | `songselect` | Site scraping provider id |
| `SM_SONG_SCRAPING_BASE_URL` | `https://songselect.ccli.com` | Base URL for the download site |
| `SM_SONG_SCRAPING_USERNAME` / `_FILE` | unset | Optional server-level fallback username |
| `SM_SONG_SCRAPING_PASSWORD` / `_FILE` | unset | Optional server-level fallback password |
| `SM_SONG_SCRAPING_COOKIE` / `_FILE` | unset | Optional server-level fallback session cookie |
| `HTTPS_PROXY`, `NO_PROXY` | unset | Egress proxy for site downloads |
| `SM_MAX_ASSET_MB` | `100` | Per-file cap for PDFs/tabs/ChordPro |
| `SM_OUTPUT_LEGACY_TOKEN` / `_FILE` | unset | Optional token-free legacy `/obs-*` access (disabled by default) |
| `SM_MAX_IMPORT_MB` | `200` | Set list/media import cap |
| `SM_FONTS_DIR` | `/data/fonts` | Cached Google Fonts plus detected local font files |
| `SM_CHURCHSUITE_CLIENT_ID` / `_FILE` | unset | ChurchSuite API user client id |
| `SM_CHURCHSUITE_CLIENT_SECRET` / `_FILE` | unset | ChurchSuite API user secret |
| `SM_CHURCHSUITE_SCOPES` | `planning.read` | Requested ChurchSuite scopes |
| `SM_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |

`SM_PORT` and `SM_DISPLAY_PORT` are read at startup, must be different, and accept values from `1` to `65535`. The control interface on `SM_PORT` is HTTPS-only by default; the display listener on `SM_DISPLAY_PORT` remains plain HTTP for OBS and display devices. Place `cert.pem` and `key.pem` in `SM_SSL_DIR` (default `/data/ssl`) or point `SM_SSL_CERT_FILE`/`SM_SSL_KEY_FILE` at a trusted certificate and key. If neither is present, a local self-signed certificate is generated and the Settings page shows a warning until it is replaced.

For a forward proxy that terminates TLS, set `SM_SSL_ENABLED=false` so the control server accepts plain HTTP from the proxy. Never expose that port directly. Secure cookies remain enabled by default because the browser still reaches the proxy over HTTPS; keep `SM_SECURE_COOKIES=true` unless testing directly over HTTP. Secrets are never printed; `_FILE` variants allow Docker/Podman secrets and Incus/LXC files. Git repositories use `SM_GIT_*` remotes (`ssh://` or `https://token@…`), SSH key/known-hosts secrets, and optional Git LFS for Bibles — see [11-git-data-sync.md](11-git-data-sync.md).

Passkeys require a browser-trusted HTTPS origin. Configure certificates and passkeys as described in §4.1–4.4 below.

The optional structured config can be YAML or JSON. Set `SM_CONFIG_FILE`, or mount it as `config.yaml` / `config.yml` / `config.json` in `/config/`. Environment variables remain the final override, so secrets and deployment-specific values can stay in `.env` or container secrets. Start from [`config.example.yaml`](../config.example.yaml).

### 4.1 HTTPS certificate options

Use one of these arrangements:

| Arrangement | Use when | Key settings |
| --- | --- | --- |
| **External trusted certificate** (recommended) | You have a real hostname and a certificate from a public CA or your organisation | Put the full chain and key in `SM_SSL_DIR` or point `SM_SSL_CERT_FILE`/`SM_SSL_KEY_FILE` at them |
| **Local CA** | Isolated LAN with no public DNS, but devices can install a CA certificate | Create a local CA and a server certificate; install the CA on every browser/device |
| **Generated self-signed certificate** | Temporary test only | Leave certificate files absent; the app generates one and shows a trust warning |
| **TLS terminated by a reverse proxy** | Caddy/nginx/Traefik already handles the public certificate | `SM_SSL_ENABLED=false`; proxy forwards to the control port |

The control port is HTTPS by default. The display listener remains plain HTTP for OBS and display devices. Never expose the control HTTP port directly when `SM_SSL_ENABLED=false`; expose only the reverse proxy.

For any browser-facing HTTPS URL:

- The certificate must include the browser-facing hostname in its SAN. A certificate for `localhost` does not work for `service.example.org`.
- Use the full chain if the issuing CA provides one.
- Set `SM_WEBAUTHN_RP_ID` to the hostname only, without scheme or port.
- Set `SM_WEBAUTHN_ORIGIN` to the exact browser URL, including a non-standard port. For example:
  `SM_WEBAUTHN_RP_ID=service.example.org`
  `SM_WEBAUTHN_ORIGIN=https://service.example.org:8443`
- Restart the server after changing certificates.
- Passkeys are tied to the RP ID and origin. Changing either invalidates existing passkeys; users must register them again.

#### External certificate, direct TLS

Place the files at `SM_SSL_DIR/cert.pem` and `SM_SSL_DIR/key.pem` (default `/data/ssl`), or set explicit paths:

```yaml
ssl:
  enabled: true
  dir: /data/ssl
  certFile: /data/ssl/fullchain.pem
  keyFile: /data/ssl/privkey.pem

webauthn:
  rpId: service.example.org
  origin: https://service.example.org
```

Check the SAN before restarting:

```sh
openssl x509 -in /data/ssl/fullchain.pem -noout -subject -ext subjectAltName
```

#### External certificate behind a reverse proxy

Let the proxy terminate TLS and forward to the control port over HTTP:

```yaml
ssl:
  enabled: false

webauthn:
  rpId: service.example.org
  origin: https://service.example.org
```

Set `SM_TRUST_PROXY=true` when the proxy supplies `X-Forwarded-*` headers. Keep secure cookies enabled because the browser still reaches the proxy over HTTPS. Example Caddy site:

```caddyfile
service.example.org {
  reverse_proxy 127.0.0.1:6111
}
```

Use your actual published control port in place of `6111`, and expose only the proxy to users.

### 4.2 Local CA certificate setup

A local CA is the practical option for a LAN hostname such as `brix.foo` or `service.church.local`. The public CA certificate is installed on each device; the CA private key stays on the server.

The following creates a local CA and a CA-signed server certificate inside the running container, so the files have the correct runtime ownership:

```sh
docker compose exec -T service-maestro sh -lc '
set -e
cd /data/ssl
cp -f cert.pem cert.previous.pem 2>/dev/null || true
cp -f key.pem key.previous.pem 2>/dev/null || true

openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -out ca.crt \
  -subj "/CN=Service Maestro Local CA/O=Service Maestro" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign"

openssl genrsa -out key.pem 2048
openssl req -new -key key.pem -out server.csr \
  -subj "/CN=service.example.org/O=Service Maestro" \
  -addext "subjectAltName=DNS:service.example.org,DNS:localhost,IP:127.0.0.1"

printf "%s\n" \
  "basicConstraints=CA:FALSE" \
  "keyUsage=critical,digitalSignature,keyEncipherment" \
  "extendedKeyUsage=serverAuth" \
  "subjectAltName=DNS:service.example.org,DNS:localhost,IP:127.0.0.1" \
  > /tmp/server.ext

openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out cert.pem -days 825 -sha256 \
  -extfile /tmp/server.ext

chmod 600 key.pem ca.key
rm -f server.csr
'
docker compose restart service-maestro
```

Replace `service.example.org` in both `subjectAltName` values. Add any additional LAN names or IPs that users will type. Then configure the relying party:

```yaml
ssl:
  enabled: true
  dir: /data/ssl
  hosts:
    - service.example.org

webauthn:
  rpId: service.example.org
  origin: https://service.example.org
```

`SM_SSL_HOSTS` only affects the certificate generated automatically when no certificate files exist. For a CA-signed certificate, the SAN is controlled by the `openssl` command above. Setting both is harmless and avoids a mismatch if the generated fallback is ever used.

Install `ca.crt` on each device:

- **From the app:** Settings → Control HTTPS → **Download local CA** (`GET /api/ssl/ca.crt`, authenticated).
- **Before login/on another device:** `http://<host>:<display-port>/display/ca.crt`. For this deployment that is `http://brix.foo:8898/display/ca.crt`.
- **iOS/iPadOS:** install the downloaded profile, then enable it under Settings → General → About → Certificate Trust Settings.
- **Android:** Settings → Security → Encryption & credentials → Install a certificate → CA certificate. Android shows a security warning for user-installed CAs.
- **Desktop:** import `ca.crt` into the OS or browser trust store. Chromium on Linux can use `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Service Maestro Local CA" -i ca.crt`.

Keep `ca.key` private and backed up. Do not commit it to Git or place it in a shared folder. If the server certificate is replaced later, devices only need the same CA; keep `ca.crt` stable. If the CA itself changes, every device must install the new CA.

### 4.3 Passkey setup and use

1. Configure HTTPS and trust the certificate/CA on the device.
2. Set `SM_WEBAUTHN_RP_NAME`, `SM_WEBAUTHN_RP_ID` and `SM_WEBAUTHN_ORIGIN` as described above.
3. Open the exact browser-facing origin (for example `https://service.example.org:8443`).
4. Sign in with a password.
5. Open **Settings → My account → Passkeys**, name the device if desired, and choose **Register passkey**.
6. Follow the device prompt (fingerprint, face, PIN or security key).
7. Sign out. Enter the username first, then choose **Sign in with a passkey**.

The same origin rule applies to every device: users must open the exact URL configured in `SM_WEBAUTHN_ORIGIN`. A different port, hostname or IP address is a different passkey origin.

### 4.4 Verifying HTTPS and passkeys

Check that the server is serving the certificate you expect:

```sh
openssl s_client -connect service.example.org:8443 -servername service.example.org </dev/null 2>/dev/null \
  | openssl x509 -noout -subject -issuer -ext subjectAltName -dates
```

After signing in, **Settings → Control HTTPS** shows the certificate source, issuer, validity, warnings and a **Download local CA** button when `SM_SSL_DIR/ca.crt` exists. The JSON status is available at `/api/ssl/status`.

In the browser console on the control origin:

```js
window.isSecureContext
typeof PublicKeyCredential !== "undefined"
```

Both must be truthy before passkey registration can work. If registration still fails, check that the browser URL exactly matches `SM_WEBAUTHN_ORIGIN`, the certificate SAN contains that hostname, and the device trusts the issuing CA.

For host-specific ports, library paths and WebAuthn settings, copy
[`compose.override.example.yaml`](../compose.override.example.yaml) to
`compose.override.yaml` and edit it. The real override is git-ignored so each
host can keep its own values without committing them. The example includes
placeholder hostname/origin values and library bind paths.

## 5. Docker / Podman

`compose.yaml` (works unchanged with `docker compose` and `podman-compose`):

```yaml
services:
  service-maestro:
    image: ghcr.io/example/service-maestro:0.1
    container_name: service-maestro
    restart: unless-stopped
    ports:
      - "8080:${SM_PORT:-8080}"
      - "8081:${SM_DISPLAY_PORT:-8081}"
    environment:
      SM_TZ: Europe/London
      SM_PORT: ${SM_PORT:-8080}
      SM_DISPLAY_PORT: ${SM_DISPLAY_PORT:-8081}
    volumes:
      - ./data:/data
      - ./library/songs:/library/songs:ro
      - ./library/bible:/library/bible:ro
      - ./library/images:/library/images
      - ./config:/config:ro
    read_only: true
    tmpfs:
      - /tmp:size=256m
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    mem_limit: 512m
    cpus: 1.0
```

For host-specific ports, library paths and WebAuthn settings, copy the
example override and edit it:

```sh
cp compose.override.example.yaml compose.override.yaml
```

`compose.override.yaml` is git-ignored, so each host can keep its own bind
mounts and published ports. The base `compose.yaml` ports remain enabled; add or
change host ports in the override, or edit `compose.yaml` if you want a single
canonical set.

Notes:

- **Rootless Podman:** `podman unshare chown -R 10001:10001 ./data ./library/images`; add `:Z` to bind mounts on SELinux hosts; Quadlet `.container` files can replace Compose for systemd integration.
- **Docker:** add `--user 10001:10001` only if host ownership differs; otherwise the image user is already non-root.
- **Read-only root:** logs go to stdout; nothing else is written outside `/data` and `/tmp`.
- No `network_mode: host`, `privileged`, or Docker socket mounts — none are needed.

## 6. Incus and LXC

There are two supported ways; both keep the same app image/data contract.

### Option A — Incus OCI application container (closest to Docker)

If the installed Incus supports OCI application containers:

```sh
incus remote add docker https://docker.io --protocol=oci
incus launch docker:ghcr.io/example/service-maestro:0.1 sm

incus config device add sm data disk source=/srv/sm/data path=/data shift=true
incus config device add sm songs disk source=/srv/sm/songs path=/library/songs shift=true readonly=true
incus config device add sm bible disk source=/srv/sm/bible path=/library/bible shift=true readonly=true
incus config device add sm images disk source=/srv/sm/images path=/library/images shift=true
incus config device add sm proxy proxy listen=tcp:0.0.0.0:8080 connect=tcp:127.0.0.1:8080
incus config device add sm display-proxy proxy listen=tcp:0.0.0.0:8081 connect=tcp:127.0.0.1:8081
```

This mode runs the container image as a single application (no systemd), exactly like Docker/Podman.

### Option B — Incus/LXC system container (recommended when OCI mode is unavailable)

Run a normal Debian container and a systemd unit; the app is the same Node build.

```sh
incus launch images:debian/12 sm
incus exec sm -- bash -c 'apt-get update && apt-get install -y curl ca-certificates tini tzdata git git-lfs openssh-client'

# Install a pinned Node 24 runtime (official binary tarball avoids distro lag)
incus exec sm -- bash -c '
  set -e
  NODE_VERSION=24.x.y   # pin an exact release and verify its SHA256
  curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
  tar -xJf "node-v${NODE_VERSION}-linux-x64.tar.xz" -C /opt
  ln -sf "/opt/node-v${NODE_VERSION}-linux-x64" /opt/node
  ln -sf /opt/node/bin/node /usr/local/bin/node
  ln -sf /opt/node/bin/npm /usr/local/bin/npm'

incus exec sm -- useradd -r -u 10001 -U -M -s /usr/sbin/nologin sm
# copy /opt/sm (dist + node_modules), /config, systemd unit
incus file push -r ./deploy/opt/sm sm/opt/
incus file push ./deploy/sm.service sm/etc/systemd/system/sm.service
incus exec sm -- systemctl daemon-reload
incus exec sm -- systemctl enable --now sm

incus config device add sm data disk source=/srv/sm/data path=/data shift=true
incus config device add sm songs disk source=/srv/sm/songs path=/library/songs shift=true readonly=true
incus config device add sm bible disk source=/srv/sm/bible path=/library/bible shift=true readonly=true
incus config device add sm images disk source=/srv/sm/images path=/library/images shift=true
incus config device add sm proxy proxy listen=tcp:0.0.0.0:8080 connect=tcp:127.0.0.1:8080
incus config device add sm display-proxy proxy listen=tcp:0.0.0.0:8081 connect=tcp:127.0.0.1:8081
```

`/etc/systemd/system/sm.service`:

```ini
[Unit]
Description=Service Maestro
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=sm
Group=sm
EnvironmentFile=/config/sm.env
ExecStart=/usr/local/bin/node /opt/sm/dist/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/data
# /library/* is read-only unless image uploads are enabled
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

LXC (without Incus) follows Option B: unprivileged container, `lxc.idmap`/subuid mapping for UID 10001, bind mounts via `lxc.mount.entry`, and the same systemd unit. Do **not** run Docker inside LXC; it is unnecessary and fragile.

### UID/GID guidance

- Keep host directories owned by **10001:10001**, or use `shift=true` (Incus) / `raw.idmap` so the container's 10001 maps to a host subuid.
- Avoid `chown` at container start (slow and breaks read-only root); document ownership once.
- If uploads are disabled, mount `/library/images` read-only.

## 7. Networking and OBS

- Keep `8080` on the trusted control network and access it as `https://<host>:8080`. OBS Browser Sources can use `http://<host>:8081/display/lowerthird?token=…` and `/display/full?token=…` on the read-only listener.
- The `8081` listener serves only `/display/*` and has no login, control UI or API. It includes `/display/assets`, `/display/fonts`, `/display/images/file` and the output-only `/display/socket.ro.io`. A forward proxy can therefore expose only that prefix.
- Example nginx location for the read-only listener:

  ```nginx
  location /display/ {
      proxy_pass http://127.0.0.1:8081;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_set_header Host $host;
  }
  ```

- `/display/twothirds`, `/display/main`, `/display/lower`, `/display/fullscreen`, `/display/mainfull`, `/display/stage` and `/display/chords` work on the read-only listener. Legacy `/obs-*` aliases remain on the control port for existing local OBS sources.
- WebSockets use normal HTTP upgrade; enable upgrade headers and set generous read timeouts for the long-lived output sockets.
- TLS is optional and best terminated by Caddy/nginx/Traefik in front. Set `SM_TRUST_PROXY=true` when the proxy supplies `X-Forwarded-*` headers.
- LAN-only deployments can skip TLS; output tokens still prevent casual access.
- No mDNS/discovery is required; outputs are plain URLs.
- **Outbound HTTPS is optional** and only needed when a site scraping adapter is enabled: allow egress to the download site through `HTTPS_PROXY`/`NO_PROXY`, or use manual imports and the drop folder offline. Downloads are user-initiated; no background crawling.
- OBS never talks to download sites directly; it only reaches the app on the LAN.

## 8. Resource sizing

| Load | CPU | RAM | Disk |
| --- | --- | --- | --- |
| Idle / small service | 0.2 vCPU | 128–256 MB | 200 MB + media |
| Typical service (3–5 outputs, thumbnails) | 0.5 vCPU | 256–512 MB | + image cache |
| Large library / video-sized images | 1 vCPU | 512 MB–1 GB | media-dependent |

- Limit image upload size and thumbnail dimensions.
- Bible DBs are memory-mapped read-only; keep them local.
- Score/tab PDFs and ChordPro archives live in `/data/assets`; budget for the expected set list/library (typically tens of MB, not GB).
- SQLite WAL needs a few hundred MB of headroom for the DB.
- One container is enough; horizontal scaling is not supported (single-writer live state).

## 9. Backups, restore and upgrades

- **Database:** `sqlite3 /data/app.sqlite "VACUUM INTO '/backups/app-$(date +%F).sqlite'"` (online, consistent).
- **Media/assets:** snapshot `/library/images` and `/data/assets`; deduplicated by hash where possible.
- **Set lists:** scheduled `sm backup --all` producing reference JSON + bundles (see content model §12).
- **Secrets:** back up `SM_SECRET_KEY` (or `data/secret.key`) separately; without it, encrypted site credentials cannot be restored.
- **Before migrations:** automatic DB copy to `/backups/pre-migrate-<version>.sqlite`; migrations run under a lock at startup.
- **Restore:** stop container → restore DB/media/assets → start; `/healthz` verifies schema version and directories.
- Volumes are the unit of restore; container image is replaceable.

## 10. Health and observability

- `GET /healthz` — process up, DB readable/writable, app schema current, library dirs present, Bible DBs openable, asset store writable; returns JSON detail but no secrets. Site credential status is reported from configuration/database only, without outbound calls.
- `GET /readyz` — ready to serve displays (migrations complete).
- Optional `GET /metrics` (Prometheus text) for sessions, outputs connected, request latency, import jobs.
- Logs: structured JSON to stdout; include request id, user, live command audit, scan/import results.
- Startup logs the resolved config paths and versions (no secrets).

## 11. Security hardening checklist

- Run as non-root, `no-new-privileges`, drop all capabilities, read-only root.
- No Docker socket, no privileged, no host network/PID.
- `/config` and library source dirs mounted read-only where possible.
- Secrets via `_FILE`/runtime secrets, not baked into the image.
- Imported archives are untrusted: size/entry caps, path traversal checks, sanitized HTML, decoded image validation.
- Site credentials are encrypted with a master key, never logged and revocable; licensed score/tab assets are served only to authenticated roles through signed URLs.
- Session cookies `HttpOnly`/`SameSite`/`Secure` behind TLS; output tokens hashed at rest.
- Application security headers: CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, Referrer-Policy and Permissions-Policy. HSTS is emitted for the control interface when it is serving a non-self-signed HTTPS certificate.
- Rate limits cover password login, passkey login and password changes (IP and username buckets); successful authentication clears the username bucket.
- State-changing HTTP requests and the control Socket.IO handshake enforce same-origin/configured-origin checks. Wildcard Socket.IO CORS is disabled.
- Uploaded SVG images are served as attachments with a sandbox CSP; other assets use `nosniff`.
- Startup warns if the default admin password or default output token is still in use.
- The MQTT adapter is disabled by default. If enabled, use broker TLS and per-client ACLs, keep incoming API mappings least-privilege, and remember that MQTT source-client filters are application-level checks rather than authentication.
- Keep the base image and Node patched; rebuild monthly and on CVEs.
- Optional: run behind a reverse proxy with request limits and TLS; keep the control port private and expose only the read-only `/display/*` listener to wider audiences. Treat the output token as a secret: it appears in display URLs and OBS configuration.

## 12. Test matrix

| Runtime | Mode | Checks |
| --- | --- | --- |
| Docker | rootful, read-only root | start, health, WS, import/export, shutdown |
| Docker | rootless (userns) | bind-mount ownership, writes only in `/data` |
| Podman | rootless + SELinux `:Z` | same, plus Quadlet unit |
| Incus | OCI app container | proxy device, bind mounts with `shift=true` |
| Incus | system container | systemd unit, unprivileged UID mapping, upgrade |
| LXC | unprivileged | idmap, read-only library mounts |
| All | offline (no network beyond LAN) | no CDN/font fetches; displays render |

Also test: tiny memory limit, SIGTERM during live session (outputs reconnect), DB on local disk, read-only `/config`, missing Bible dir (healthy but warns).

## 13. Implementation checklist (when coding starts)

1. `Dockerfile` (multi-stage, tini, non-root, healthcheck) + `.dockerignore`.
2. `compose.yaml` and Podman Quadlet `.container`.
3. `deploy/incus/` — profile or provisioning script, systemd unit, env template.
4. Config loader with env/`_FILE` support and path validation.
5. `/healthz`/`/readyz`, graceful shutdown, migration lock.
6. Backup command (`sm backup --all`) and documented restore.
7. CI: multi-arch build, image scan, smoke test in Docker and Podman; Incus test job if available.
8. Documentation: volumes, UID/GID, TLS proxy, OBS URLs, upgrade steps.

## 14. Decisions

Resolved by this design:

- Single container, single process; no external database/cache.
- Docker + Podman (rootless) and Incus/LXC are all first-class.
- Debian slim runtime, non-root UID 10001, read-only root, one writable `/data` volume.
- No CDN, no privileged features, local SQLite.

Still open:

1. **Incus mode** — does the target Incus version support OCI application containers, or should we standardise on the system-container path?
2. **Image uploads** — should `/library/images` be writable (operator uploads) or read-only (curated on host)?
3. **TLS** — terminate in a reverse proxy (recommended) or add optional built-in TLS?
4. **Site download egress** — is outbound HTTPS to the SongSelect website allowed on this network, and should it be proxied/allow-listed or kept offline with manual imports?
5. **Asset retention** — quota and retention for licensed PDFs/tabs, and whether assets are removed when a subscription lapses.
6. **Secret backup** — where to store the site-credential master key and who is responsible for restoring it?
