# Web Lyric Master

A self-hosted server application for running church service visuals: manage song lyrics, set lists and dynamic text, then drive them onto **separate HTTP frontends** that OBS (or any browser) can use as sources.

> **Status: Phase 1 walking skeleton is implemented and runnable.**
> Live sessions, set lists, songs, quick text, OBS-ready outputs and a per-user grid dashboard work end-to-end. Importers, Bible, scores, multi-user layout co-editing and the SongSelect provider are designed but not yet built.
>
> Design documents:
>
> - [Analysis of the existing Node-RED system](docs/01-node-red-analysis.md)
> - [Architecture](docs/02-architecture.md)
> - [Content model](docs/03-content-model.md)
> - [Sample files](docs/04-sample-files.md)
> - [Container deployment](docs/05-container-deployment.md)
> - [SongSelect, scores and tabs](docs/06-songselect-and-scores.md)
> - [Bible source formats](docs/07-bible-sources.md)
> - [Dashboard layout editor](docs/08-dashboard-layout-editor.md)
> - [Phase 1 status](docs/09-phase-1-status.md) — what is implemented and what is next.

## Quick start

Requires Node.js 24+.

```sh
npm install
npm run build

# pick a real password — this seeds the first admin account
WLM_ADMIN_PASSWORD='change-me' npm start
```

Open <http://localhost:8080> and sign in as `admin` with the password you set (default is `admin` if the variable is omitted — change it).

### Development

```sh
# terminal 1: API + displays on :8080
npm run dev -w @wlm/server

# terminal 2: React control UI on :5173 with API proxy
npm run dev -w @wlm/control
```

Or `npm run dev` runs both (server on 8080, control on 5173).

### Display outputs (OBS Browser Sources)

| Output | New URL | Legacy alias |
| --- | --- | --- |
| Main / lower third | `/display/main?token=dev-output` | `/obs-main?token=dev-output` |
| Full screen | `/display/full?token=dev-output` | `/obs-mainfull?token=dev-output` |
| Stage monitor (chords) | `/display/stage?token=dev-output` | `/obs-stage?token=dev-output` |

The output token defaults to `dev-output`; set `WLM_OUTPUT_TOKEN` in production. Displays receive a **full snapshot on connect**, so refreshing or reconnecting OBS never blanks the screen.

## What works now

- **Authentication** — local accounts, scrypt password hashing, HTTP-only sessions. One seeded `admin`; user management is next.
- **Songs** — create/edit lyrics with inline chords (`A[C]mazing`), section labels (`[Verse 1]`), key, author, CCLI and copyright.
- **Library import** — scan a folder for OpenLP/OpenLyrics XML, ChordPro and plain-text files; preview titles/formats/warnings, then import. Duplicate CCLI/title entries are skipped. OpenLP `verseOrder` and ChordPro `{comment: …}` sections are honoured; SongSelect legal footers and bar markers are removed.
- **Set lists** — named, dated, with songs and text items; reorder; per-item key, transpose, max lines and notes.
- **Live sessions** — a set list is snapshotted when the session starts, so editing the set list afterwards cannot change the live output.
- **Live control** — next/previous, page/item navigation, blank, transpose, max-lines, footer and quick text.
- **Dashboard** — drag/resize widgets (pages, preview, set list, transport, quick text) with **react-grid-layout**; personal layout saved to SQLite. Shared/published layouts and Yjs co-editing are next.
- **Displays** — vanilla HTML/CSS/JS, no CDN, snapshot-on-connect, transparent main output, full-screen and stage-with-chords variants.
- **Persistence** — SQLite (WAL) for users, sessions, songs, set lists, session snapshots and dashboard layouts; the live session survives a restart.
- **Container** — multi-stage Dockerfile, non-root UID 10001, health check, Compose file; image builds and runs.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `WLM_PORT` | `8080` | HTTP/WebSocket port |
| `WLM_HOST` | `0.0.0.0` | Bind address |
| `WLM_DATA_DIR` | `packages/server/data` | SQLite + runtime data |
| `WLM_SONGS_DIR` | `samples/` (local) | Source directory scanned for OpenLP/ChordPro/text imports |
| `WLM_ADMIN_PASSWORD` | `admin` | Password for the seeded admin |
| `WLM_OUTPUT_TOKEN` | `dev-output` | Token required by display sockets |
| `WLM_LOG_LEVEL` | `info` | Fastify log level |
| `WLM_SECURE_COOKIES` | unset | Set to `1` when serving over HTTPS |

## Docker / Podman

```sh
docker build -t web-lyric-master .
docker run --rm -p 8080:8080 \
  -e WLM_ADMIN_PASSWORD='change-me' \
  -e WLM_OUTPUT_TOKEN='a-long-random-output-token' \
  -v "$PWD/data:/data" \
  web-lyric-master
```

Or `docker compose up -d` / `podman-compose up -d`. The container runs as UID/GID 10001; ensure the mounted data directory is writable by that user (`chown -R 10001:10001 ./data`, or use Incus `shift=true`).

See [05-container-deployment.md](docs/05-container-deployment.md) for Incus/LXC, read-only root filesystem, backups and hardening.

## Project structure

```
web-lyric-master/
├── packages/
│   ├── shared/       TypeScript types + Zod schemas
│   ├── server/       Fastify API, SQLite, Socket.IO, live state, rendering
│   ├── control/      React + Vite operator UI + react-grid-layout dashboard
│   └── display/      Vanilla OBS display pages (main / full / stage)
├── docs/             Design documents
├── samples/          Git-ignored real inputs (Bible, ChordPro, OpenLP, SongSelect)
├── Dockerfile
├── compose.yaml
└── package.json      npm workspaces
```

## Gap to the full design

Not yet implemented:

- Bible adapters, PDF scores/tabs and the musician UI.
- Song versions/arrangements and the full song editor; the importer currently normalises into the single lyrics field.
- Set list revision history + apply-to-live (today live isolation is guaranteed by the session snapshot).
- Dynamic text themes and the full theme editor.
- Dashboard widget palette/publish and Yjs co-editing.
- SongSelect provider, CCLI reporting and backups/scan jobs.
- User/role management beyond the seeded admin; output tokens are currently a single shared token.

The next step is Phase 2 (song authoring + scores), starting with the sample-backed ChordPro/OpenLP/text importers. See the [architecture phases](docs/02-architecture.md#14-phased-delivery).
