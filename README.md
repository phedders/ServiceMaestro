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
> - [ChurchSuite planning sync](docs/10-churchsuite-sync.md) — API analysis, credential findings and song-matching design.
> - [Git-backed shared data](docs/11-git-data-sync.md) — songs/setlists/bibles repositories shared between instances.
> - [Waiting list](docs/12-waiting-list.md) — blocked items and what they need.
> - [Display templates and text formats](docs/13-display-templates.md) — templated outputs, Markdown/HTML/RST text items, blank start and preview sizing.

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
- **Scores and tabs for musicians** — upload PDFs, ChordPro, lyrics or images to a song; a musician page lists the service songs and renders PDFs with a bundled PDF.js viewer (page navigation, zoom, fit-to-width), plus text/image assets.
- **Bible** — reads the three real schema families found in the samples (MyBible `book`/`verse`, BibleDb `books`/`verses`, and JSON), sanitises ESV markup, and provides a translation/book/chapter/verse-range UI with “Display now”.
- **Set lists** — named, dated, with songs and text items; reorder; per-item key, transpose, max lines, verse order and notes.
- **Live sessions** — a set list is snapshotted when the session starts, so editing the set list afterwards cannot change the live output. Sessions start **blank** until the operator shows the first page.
- **Publish & apply** — publish a revision, then **apply after the current item** (safe during a service) or **apply now**; queued updates are shown to operators and persisted across restarts.
- **Templated outputs** — main, two-thirds, full, stage and chords; templates come from the set-list repo, a templates folder/repo, or built-in defaults, with fade-in/out changes.
- **Display config** — Live-page panel for font, text colour, text size and max lines per page; applies to main/two-thirds, while stage and chords keep their fixed style.
- **Rich text items** — first-line `type: markdown|html|rst|text` or YAML front matter, with page breaks and server-side sanitisation.
- **Export/import** — download a reference JSON or self-contained ZIP bundle (songs, text, PDF/tab assets) and import it as a new draft with a preview; matching uses CCLI/title and never affects a live service.
- **Live control** — next/previous, page show, item queue, blank, transpose, max-lines, footer and quick text.
- **Dashboard** — drag/resize widgets (pages, preview, set list, transport, quick text) with **react-grid-layout**; personal layout saved to SQLite. Shared/published layouts and Yjs co-editing are next.
- **ChurchSuite planning sync** — designed: pull upcoming published services, match songs in a review dialog, and create a draft set list; pending working API credentials (see [10](docs/10-churchsuite-sync.md)).
- **Git-backed shared data** — designed: local-only repos by default with optional remote, auto-save/push on by default, separate songs/setlists/(optional LFS) Bibles repos, standard SSH or HTTP(S)+token URIs. See [11](docs/11-git-data-sync.md).
- **Displays** — vanilla HTML/CSS/JS, no CDN, snapshot-on-connect, transparent main output, full-screen and stage-with-chords variants.
- **Persistence** — SQLite (WAL) for users, sessions, songs, set lists, session snapshots and dashboard layouts; the live session survives a restart.
- **Git-backed data (local foundation)** — songs and set lists are written to local Git repositories and committed automatically (`autoSave` default on); optional remotes, pull/push and Bibles/LFS are configurable. See [11](docs/11-git-data-sync.md).
- **Container** — multi-stage Dockerfile, non-root UID 10001, health check, Compose file; image builds and runs.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `WLM_PORT` | `8080` | HTTP/WebSocket port |
| `WLM_HOST` | `0.0.0.0` | Bind address |
| `WLM_DATA_DIR` | `packages/server/data` | SQLite + runtime data |
| `WLM_SONGS_DIR` | `samples/` (local) | Source directory scanned for OpenLP/ChordPro/text imports |
| `WLM_BIBLE_DIR` | `samples/bible/` (local) | SQLite/JSON Bible translations |
| `WLM_ADMIN_PASSWORD` | `admin` | Password for the seeded admin |
| `WLM_OUTPUT_TOKEN` | `dev-output` | Token required by display sockets |
| `WLM_LOG_LEVEL` | `info` | Fastify log level |
| `WLM_SECURE_COOKIES` | unset | Set to `1` when serving over HTTPS |
| `WLM_GIT_ENABLED` | `true` | Enable local/remote Git persistence |
| `WLM_GIT_AUTO_SAVE` | `true` | Write + commit on each song/set-list change |
| `WLM_GIT_AUTO_PUSH` | `true` | Push after commit when a remote is configured |
| `WLM_GIT_SONGS_PATH` | `/data/repos/songs` | Songs repo working tree |
| `WLM_GIT_SETLISTS_PATH` | `/data/repos/setlists` | Set lists repo working tree |
| `WLM_GIT_BIBLES_PATH` | `/data/repos/bibles` | Optional Bibles repo |
| `WLM_CONFIG_FILE` | unset | YAML/JSON config with `git.repositories` and URIs |
| `WLM_TEMPLATES_DIR` | `/data/templates` | Display template folder (after the set-list repo lookup) |

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

- Song assets (PDF/tab files) in the songs Git repository; Git conflict UI; remote sync exists but has not been exercised against a live remote.
- Song versions/arrangements beyond the single lyrics field and verse-order override.
- Dynamic text themes and the full theme editor.
- Dashboard widget palette/publish and Yjs co-editing.
- SongSelect provider, CCLI reporting and backups/scan jobs.
- User/role management beyond the seeded admin; output tokens are currently a single shared token.

The next step is Git asset persistence/conflict handling or the theme editor. See the [architecture phases](docs/02-architecture.md#14-phased-delivery).
