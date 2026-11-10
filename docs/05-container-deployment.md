# Container deployment

Design for running Web Lyric Master as a **lightweight, single-process container** on Docker, Podman, Incus or plain LXC. The application must not require Docker-in-Docker, host networking, privileged mode, systemd inside an OCI container, or external services (no Redis/Postgres).

See [02-architecture.md](02-architecture.md) for the application design and [03-content-model.md](03-content-model.md) for set list export/import, which doubles as the portable backup format.

## 1. Constraints the design guarantees

- **One process** (Node.js) owns HTTP, WebSockets, SQLite and background scans. No sidecars.
- **One writable volume** (`/data`); library directories can be mounted read-only.
- **One TCP port** (8080) with normal HTTP + WebSocket upgrades.
- **No privileged operations**, no kernel modules, no FUSE, no Docker socket, no host PID/network namespaces.
- **Runs as a non-root user** with a fixed UID/GID; no files created as root on bind mounts.
- **Read-only root filesystem** is supported (`/tmp` as tmpfs, config read-only, data writable).
- **Offline by default**: fonts, JS and CSS are bundled; no CDN calls.
- **Graceful shutdown** on SIGTERM/SIGINT; SQLite WAL checkpoint and clean close.

## 2. Image design

| Item | Choice |
| --- | --- |
| Base (build) | `node:24-bookworm` + build tools for native modules |
| Base (runtime) | `node:24-bookworm-slim` |
| Why Debian slim (not Alpine) | `better-sqlite3` and `sharp` ship glibc prebuilds; musl builds add risk and size. |
| Init | `tini` as PID 1 (reaps zombies, forwards signals) |
| User | `wlm` UID/GID **10001** (numeric, no login shell) |
| Locale/TZ | `TZ` env, `tzdata` installed |
| Port | `8080` (unprivileged) |
| Healthcheck | `GET /healthz` |
| Architectures | `linux/amd64`, `linux/arm64` |
| Target size | ~200–300 MB compressed (fonts/media excluded — they live in `/data` or `/library`) |

Multi-stage sketch (to be committed with the code):

```dockerfile
FROM node:24-bookworm AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates tzdata git git-lfs openssh-client \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 10001 wlm && useradd -u 10001 -g wlm -M -s /usr/sbin/nologin wlm
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
USER 10001:10001
EXPOSE 8080
ENV NODE_ENV=production WLM_PORT=8080 WLM_DATA_DIR=/data
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
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
| `WLM_PORT` | `8080` | HTTP/WS port |
| `WLM_HOST` | `0.0.0.0` | Bind address |
| `WLM_PUBLIC_URL` | — | Absolute URL used in generated links |
| `WLM_DATA_DIR` | `/data` | Writable state |
| `WLM_SONGS_DIR` | `/library/songs` | Song sources |
| `WLM_BIBLE_DIR` | `/library/bible` | Bible SQLite files |
| `WLM_IMAGES_DIR` | `/library/images` | Images and uploads |
| `WLM_CONFIG_FILE` | `/config/config.json` | Optional structured config |
| `WLM_TZ` | `Europe/London` | Service dates/times and logs |
| `WLM_SESSION_SECRET` / `_FILE` | generated at first start | Cookie signing |
| `WLM_SECRET_KEY` / `_FILE` | generated at first start | Master key for encrypted provider credentials (SongSelect) |
| `WLM_PROVIDERS_ENABLED` | `false` | Enable external song providers; each provider still needs credentials |
| `WLM_OFFLINE` | `false` | Disable all outbound provider calls while keeping cached assets |
| `HTTPS_PROXY`, `NO_PROXY` | unset | Egress proxy for provider access |
| `WLM_MAX_ASSET_MB` | `100` | Per-file cap for PDFs/tabs/ChordPro |
| `WLM_OUTPUT_LEGACY_TOKEN` / `_FILE` | unset | Optional token-free legacy `/obs-*` access (disabled by default) |
| `WLM_MAX_IMPORT_MB` | `200` | Set list/media import cap |
| `WLM_LOG_LEVEL` | `info` | `debug`/`info`/`warn`/`error` |
| `WLM_TRUST_PROXY` | `false` | Honour `X-Forwarded-*` behind TLS proxy |

Secrets are never printed; `_FILE` variants allow Docker/Podman secrets and Incus/LXC files. Git repositories use `WLM_GIT_*` remotes (`ssh://` or `https://token@…`), SSH key/known-hosts secrets, and optional Git LFS for Bibles — see [11-git-data-sync.md](11-git-data-sync.md).

## 5. Docker / Podman

`compose.yaml` (works unchanged with `docker compose` and `podman-compose`):

```yaml
services:
  web-lyric-master:
    image: ghcr.io/example/web-lyric-master:0.1
    container_name: web-lyric-master
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      WLM_TZ: Europe/London
      WLM_PUBLIC_URL: http://10.181.1.10:8080
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
incus launch docker:ghcr.io/example/web-lyric-master:0.1 wlm

incus config device add wlm data disk source=/srv/wlm/data path=/data shift=true
incus config device add wlm songs disk source=/srv/wlm/songs path=/library/songs shift=true readonly=true
incus config device add wlm bible disk source=/srv/wlm/bible path=/library/bible shift=true readonly=true
incus config device add wlm images disk source=/srv/wlm/images path=/library/images shift=true
incus config device add wlm proxy proxy listen=tcp:0.0.0.0:8080 connect=tcp:127.0.0.1:8080
```

This mode runs the container image as a single application (no systemd), exactly like Docker/Podman.

### Option B — Incus/LXC system container (recommended when OCI mode is unavailable)

Run a normal Debian container and a systemd unit; the app is the same Node build.

```sh
incus launch images:debian/12 wlm
incus exec wlm -- bash -c 'apt-get update && apt-get install -y curl ca-certificates tini tzdata git git-lfs openssh-client'

# Install a pinned Node 24 runtime (official binary tarball avoids distro lag)
incus exec wlm -- bash -c '
  set -e
  NODE_VERSION=24.x.y   # pin an exact release and verify its SHA256
  curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
  tar -xJf "node-v${NODE_VERSION}-linux-x64.tar.xz" -C /opt
  ln -sf "/opt/node-v${NODE_VERSION}-linux-x64" /opt/node
  ln -sf /opt/node/bin/node /usr/local/bin/node
  ln -sf /opt/node/bin/npm /usr/local/bin/npm'

incus exec wlm -- useradd -r -u 10001 -U -M -s /usr/sbin/nologin wlm
# copy /opt/wlm (dist + node_modules), /config, systemd unit
incus file push -r ./deploy/opt/wlm wlm/opt/
incus file push ./deploy/wlm.service wlm/etc/systemd/system/wlm.service
incus exec wlm -- systemctl daemon-reload
incus exec wlm -- systemctl enable --now wlm

incus config device add wlm data disk source=/srv/wlm/data path=/data shift=true
incus config device add wlm songs disk source=/srv/wlm/songs path=/library/songs shift=true readonly=true
incus config device add wlm bible disk source=/srv/wlm/bible path=/library/bible shift=true readonly=true
incus config device add wlm images disk source=/srv/wlm/images path=/library/images shift=true
incus config device add wlm proxy proxy listen=tcp:0.0.0.0:8080 connect=tcp:127.0.0.1:8080
```

`/etc/systemd/system/wlm.service`:

```ini
[Unit]
Description=Web Lyric Master
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=wlm
Group=wlm
EnvironmentFile=/config/wlm.env
ExecStart=/usr/local/bin/node /opt/wlm/dist/server.js
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

- Expose only `8080`. OBS Browser Sources point at `http://<host>:8080/display/main?token=…` (and legacy `/obs-main` aliases).
- WebSockets use normal HTTP upgrade; if a reverse proxy is added, enable upgrade headers and set generous read timeouts (long-lived output sockets).
- TLS is optional and best terminated by Caddy/nginx/Traefik in front. Set `WLM_PUBLIC_URL` and `WLM_TRUST_PROXY=true` accordingly.
- LAN-only deployments can skip TLS; output tokens still prevent casual access.
- No mDNS/discovery is required; outputs are plain URLs.
- **Outbound HTTPS is optional** and only needed for SongSelect/providers: allow egress to CCLI/SongSelect through `HTTPS_PROXY`/`NO_PROXY`, or keep `WLM_OFFLINE=true` with manual imports and cached assets. Search/download endpoints are user-initiated; no background crawling.
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
- **Set lists:** scheduled `wlm backup --all` producing reference JSON + bundles (see content model §12).
- **Secrets:** back up `WLM_SECRET_KEY` separately (without it, encrypted SongSelect credentials cannot be restored).
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
- Optional: run behind a reverse proxy with request limits and TLS; expose only 8080 on the LAN.

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
6. Backup command (`wlm backup --all`) and documented restore.
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
