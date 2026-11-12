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
| `SM_PUBLIC_URL` | — | Absolute URL used in generated links |
| `SM_SSL_ENABLED` | `true` | Serve control over HTTPS; disable only behind a TLS-terminating forward proxy |
| `SM_SSL_DIR` | `/data/ssl` | Control HTTPS certificate directory |
| `SM_SSL_CERT_FILE` | `cert.pem` | Trusted certificate/full-chain path |
| `SM_SSL_KEY_FILE` | `key.pem` | Private key path |
| `SM_SSL_HOSTS` | unset | Extra comma-separated DNS names/IPs for generated certificates |
| `SM_WEBAUTHN_RP_NAME` | `Service Maestro` | Passkey relying-party display name |
| `SM_WEBAUTHN_RP_ID` | derived | Passkey RP ID; set explicitly for a proxy/domain |
| `SM_WEBAUTHN_ORIGIN` | derived | Browser-facing HTTPS origin for passkeys |
| `SM_DATA_DIR` | `/data` | Writable state |
| `SM_SONGS_DIR` | `/library/songs` | Song sources |
| `SM_BIBLE_DIR` | `/library/bible` | Bible SQLite files |
| `SM_IMAGES_DIR` | `/library/images` | Images and uploads |
| `SM_SONGSELECT_WATCH_DIR` | `/data/imports/songselect` | Watched folder for CCLI SongSelect downloader `.txt` files |
| `SM_SONGSELECT_WATCH_ENABLED` | `true` | Enable background watched-folder imports |
| `SM_SONGSELECT_WATCH_INTERVAL` | `10` | Watched-folder poll interval in seconds |
| `SM_CONFIG_FILE` | auto-discovered | Optional YAML/JSON config; environment variables override file values |
| `SM_TZ` | `Europe/London` | Service dates/times and logs |
| `SM_SESSION_SECRET` / `_FILE` | generated at first start | Cookie signing |
| `SM_SECRET_KEY` / `_FILE` | generated at first start | Master key for encrypted provider credentials (SongSelect) |
| `SM_PROVIDERS_ENABLED` | `false` | Enable external song providers; each provider still needs credentials |
| `SM_OFFLINE` | `false` | Disable all outbound provider calls while keeping cached assets |
| `HTTPS_PROXY`, `NO_PROXY` | unset | Egress proxy for provider access |
| `SM_MAX_ASSET_MB` | `100` | Per-file cap for PDFs/tabs/ChordPro |
| `SM_OUTPUT_LEGACY_TOKEN` / `_FILE` | unset | Optional token-free legacy `/obs-*` access (disabled by default) |
| `SM_MAX_IMPORT_MB` | `200` | Set list/media import cap |
| `SM_FONTS_DIR` | `/data/fonts` | Cached Google Fonts plus detected local font files |
| `SM_CHURCHSUITE_CLIENT_ID` / `_FILE` | unset | ChurchSuite API user client id |
| `SM_CHURCHSUITE_CLIENT_SECRET` / `_FILE` | unset | ChurchSuite API user secret |
| `SM_CHURCHSUITE_SCOPES` | `planning.read` | Requested ChurchSuite scopes |
| `SM_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `SM_TRUST_PROXY` | `false` | Honour `X-Forwarded-*` behind TLS proxy |

`SM_PORT` and `SM_DISPLAY_PORT` are read at startup, must be different, and accept values from `1` to `65535`. The control interface on `SM_PORT` is HTTPS-only by default; the display listener on `SM_DISPLAY_PORT` remains plain HTTP for OBS and display devices. Place `cert.pem` and `key.pem` in `SM_SSL_DIR` (default `/data/ssl`) or point `SM_SSL_CERT_FILE`/`SM_SSL_KEY_FILE` at a trusted certificate and key. If neither is present, a local self-signed certificate is generated and the Settings page shows a warning until it is replaced.

For a forward proxy that terminates TLS, set `SM_SSL_ENABLED=false` so the control server accepts plain HTTP from the proxy. Never expose that port directly. Secure cookies remain enabled by default because the browser still reaches the proxy over HTTPS; keep `SM_SECURE_COOKIES=true` unless testing directly over HTTP. Secrets are never printed; `_FILE` variants allow Docker/Podman secrets and Incus/LXC files. Git repositories use `SM_GIT_*` remotes (`ssh://` or `https://token@…`), SSH key/known-hosts secrets, and optional Git LFS for Bibles — see [11-git-data-sync.md](11-git-data-sync.md).

The optional structured config can be YAML or JSON. Set `SM_CONFIG_FILE`, or mount it as `config.yaml` / `config.yml` / `config.json` in `/config/`. Environment variables remain the final override, so secrets and deployment-specific values can stay in `.env` or container secrets. Start from [`config.example.yaml`](../config.example.yaml).

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
      SM_PUBLIC_URL: http://10.181.1.10:8080
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
- TLS is optional and best terminated by Caddy/nginx/Traefik in front. Set `SM_PUBLIC_URL` and `SM_TRUST_PROXY=true` accordingly.
- LAN-only deployments can skip TLS; output tokens still prevent casual access.
- No mDNS/discovery is required; outputs are plain URLs.
- **Outbound HTTPS is optional** and only needed for SongSelect/providers: allow egress to CCLI/SongSelect through `HTTPS_PROXY`/`NO_PROXY`, or keep `SM_OFFLINE=true` with manual imports and cached assets. Search/download endpoints are user-initiated; no background crawling.
- OBS never talks to providers directly; it only reaches the app on the LAN.

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
- **Secrets:** back up `SM_SECRET_KEY` separately (without it, encrypted SongSelect credentials cannot be restored).
- **Before migrations:** automatic DB copy to `/backups/pre-migrate-<version>.sqlite`; migrations run under a lock at startup.
- **Restore:** stop container → restore DB/media/assets → start; `/healthz` verifies schema version and directories.
- Volumes are the unit of restore; container image is replaceable.

## 10. Health and observability

- `GET /healthz` — process up, DB readable/writable, app schema current, library dirs present, Bible DBs openable, asset store writable; returns JSON detail but no secrets. Provider status is reported from configuration/cache only, without outbound calls.
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
- Provider credentials are encrypted with a master key from a secret, never logged, and revocable; licensed score/tab assets are served only to authenticated roles through signed URLs.
- Session cookies `HttpOnly`/`SameSite`/`Secure` behind TLS; output tokens hashed at rest.
- Keep the base image and Node patched; rebuild monthly and on CVEs.
- Optional: run behind a reverse proxy with request limits and TLS; keep the control port private and expose only the read-only `/display/*` listener to wider audiences.

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
4. **Provider egress** — is outbound HTTPS to SongSelect allowed on this network, and should it be proxied/allow-listed or kept offline with manual imports?
5. **Asset retention** — quota and retention for licensed PDFs/tabs, and whether assets are removed when a subscription lapses.
6. **Secret backup** — where to store the provider master key and who is responsible for restoring it?
