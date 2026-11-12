# Service Maestro

A self-hosted server application for running church service visuals: manage song lyrics, set lists and dynamic text, then drive them onto **separate HTTP frontends** that OBS (or any browser) can use as sources.

> **Status: Phase 1 walking skeleton is implemented and runnable.**
> Live sessions, set lists, songs, Bible, quick text and OBS-ready outputs work end-to-end. The grid dashboard page is temporarily hidden while its live-control semantics are reworked. Importers, multi-user layout co-editing and the site-scraping download framework are designed but not yet fully built.
>
> Design documents:
>
> - [Analysis of the existing Node-RED system](docs/01-node-red-analysis.md)
> - [Architecture](docs/02-architecture.md)
> - [Content model](docs/03-content-model.md)
> - [Sample files](docs/04-sample-files.md)
> - [Container deployment](docs/05-container-deployment.md)
> - [Song resources, scores and tabs](docs/06-songselect-and-scores.md)
> - [Bible source formats](docs/07-bible-sources.md)
> - [Dashboard layout editor](docs/08-dashboard-layout-editor.md)
> - [Phase 1 status](docs/09-phase-1-status.md) — what is implemented and what is next.
> - [ChurchSuite planning sync](docs/10-churchsuite-sync.md) — API analysis, credential findings and song-matching design.
> - [Git-backed shared data](docs/11-git-data-sync.md) — songs/setlists/bibles repositories shared between instances.
> - [Waiting list](docs/12-waiting-list.md) — blocked items and what they need.
> - [Display templates and text formats](docs/13-display-templates.md) — templated outputs, Markdown/HTML/RST text items, blank start and preview sizing.
> - [Tarp presentation module](docs/14-tarp.md) — two-view presentation editor, themes, animations and set-list integration plan.
> - [Transition stingers](docs/15-stingers.md) — transparent SVG/image overlays, set-list/item/page overrides and live playback.

## Quick start

Requires Node.js 24+.

```sh
npm install
npm run build

# pick a real password — this seeds the first admin account
SM_ADMIN_PASSWORD='change-me' npm start
```

Open <https://localhost:8080> and sign in as `admin` with the password you set (default is `admin` if the variable is omitted — change it). The control interface is HTTPS-only. If no certificate is supplied, a local self-signed certificate is generated in `data/ssl`; the browser will show a trust warning until you install a trusted certificate.

### Development

```sh
# terminal 1: HTTPS API + HTTP displays on :8080
npm run dev -w @sm/server

# terminal 2: React control UI on :5173 with HTTPS API proxy
npm run dev -w @sm/control
```

Or `npm run dev` runs both (HTTPS server on 8080, control dev UI on 5173).

### Display outputs (OBS Browser Sources)

| Output | Canonical URL | Aliases |
| --- | --- | --- |
| Lower-third / main (`lowerthird`) | `/display/lowerthird?token=dev-output` | `/display/twothirds`, `/display/main`, `/display/lower`, `/obs-main`, `/obs-lower`, `/obs-lowerthird`, `/obs-twothirds` |
| Full screen (`full`) | `/display/full?token=dev-output` | `/display/fullscreen`, `/display/mainfull`, `/obs-mainfull`, `/obs-fullscreen` |
| Centered two-thirds | `/display/two-thirds?token=dev-output` | `/display/two_thirds`, `/obs-two-thirds` |
| Stage monitor (lyrics) | `/display/stage?token=dev-output` | `/obs-stage` |

The output token defaults to `dev-output`; set `SM_OUTPUT_TOKEN` in production. Displays receive a **full snapshot on connect**, so refreshing or reconnecting OBS never blanks the screen. The server sends a heartbeat every 15 seconds; a display that receives no heartbeat for 45 seconds reloads itself to recover the connection. The `/obs-*` aliases remain on the HTTPS control port for compatibility; use the `/display/*` paths through the plain-HTTP read-only display listener for OBS.

The **Menu** button in the navigation opens an **External links** list for every view plus Settings. Displays are also served by a separate **read-only listener** on `SM_DISPLAY_PORT` (default `8081`) over plain HTTP. It serves only the `/display/*` tree — views, `/display/assets`, `/display/fonts`, `/display/images/file`, `/display/icon.svg` and the read-only `/display/socket.ro.io` — with no login, control UI or API. A forward proxy can expose only `/display/*` from this port without exposing the control server. These replace the old `/display-assets`, `/fonts` and `/api/images/file` paths.

### Musicians view

Open <https://localhost:8080/musicians> to see the read-only musician view. It defaults to the current/next dated service, lets each musician open the set list on their own device, and shows lyrics, notes, score PDFs and tabs without touching the live session.

## What works now

- **Authentication and users** — multiple accounts with independent scrypt passwords, WebAuthn passkey login and registration, self-service password changes, admin password resets, and admin-controlled module write permissions. One seeded `admin`; sessions use secure HTTP-only cookies on the HTTPS-only control interface. An admin-only activity log records logins, failed logins, content changes, live commands, exports, PDF downloads and account actions.
- **Songs** — create/edit lyrics with inline chords (`A[C]mazing`), section labels (`[Verse 1]`), key, author, alternative titles, CCLI and copyright; optional inline Markdown styling; multiple named verse orders. Untagged lyrics receive sequential `[V1]`, `[V2]`, … labels split on blank lines when created or imported. **Simplify page IDs** on import or save converts spaced/long section names into unique compact IDs such as `[Verse 1]` → `[v1]`, using the conversion table in Settings. The song editor has **Add to current setlist** and **Add to live session** actions. Each song row has **Fix page names**, which applies the current page-ID shortcuts and unique minimisation to that song only. The library has a multi-select mode for deleting songs in bulk, with a select-all-shown option and Git-safe batch deletion.
- **DeDupe** — **Menu → DeDupe** scans the song library for songs with matching titles, CCLI numbers or identical lyrics. Each version has a full-lyrics eye preview and a line-level difference view against the reference version, marks versions that contain embedded chords, and estimates when two versions would be identical once chord symbols and section labels are ignored. The comparison popup can hide chords to show the actual lyric differences, and each version reports the number of lines that differ without chords plus a word-level estimate that ignores different word or line splits. Mark one version as **Preferred** (used as a tie-breaker by song matching and ChurchSuite imports), mark two versions as **Mark as Different** so they stop appearing as duplicates, or delete duplicate songs. The preferred and mark-as-different choices are available from the comparison popup and are saved in the song metadata and Git files. Each version and both sides of the comparison popup also have an **Edit** action that opens a quick song editor for metadata and lyric changes.
- **Library import** — scan a folder for OpenLP/OpenLyrics XML, ChordPro and plain-text files; preview titles/formats/warnings, then import. Duplicate CCLI/title matches are detected during the scan and can be **skipped**, **replaced**, or imported as a **duplicate** with an edited title/alternative titles. OpenLP `verseOrder` and ChordPro `{comment: …}` sections are honoured; bare headings such as `Verse 2` or `Chorus:` are also recognised as section labels. SongSelect legal footers and bar markers are removed.
- **Site scraper credentials** — each user can save encrypted personal credentials for SongSelect song downloads in **Settings → My account**. Server-level fallback credentials can be supplied under `songScraping` in `config.yaml`. A personal credential set overrides the server fallback, and secrets are never returned to the browser. The SongSelect adapter supports search, lyric preview, lyrics text, ChordPro, lead-sheet PDF and vocal-sheet PDF downloads from **Songs → Song site downloads**. **Import into Service Maestro** saves the files to the local song and attaches them as musician-view assets for any set list that uses the song. Songs and song items in set lists also have an **Update** action that checks SongSelect for missing files or changed ChordPro/lyrics and offers to refresh them; other site adapters can be added separately. See [06](docs/06-songselect-and-scores.md#capturing-a-browser-session-cookie) for how to capture and store a browser session cookie securely.
- **Scores and tabs for musicians** — upload PDFs, ChordPro, lyrics or images to a song; the standalone `/musicians` view lists upcoming/current services, opens a service read-only and renders lyrics plus PDFs with a bundled PDF.js viewer (page navigation, zoom, fit-to-width), text and image assets. It never changes the live session.
- **Images** — browse `SM_IMAGES_DIR` (default `library/images`) in a folder tree with a global search, upload images from the Images page or a set list, and add image items to set lists for output. Each image also has a **LIVE** button that displays it immediately on every output without changing the set list or live queue. Image items support scale-to-screen (default), 1:1, crop and stretch. A folder can be converted into a **multiple images** set-list item, with optional autoplay, a configurable delay (default 6 seconds) and **Single**, **Loop** or **Bounce** playback. Bounce runs forwards through every page, then backwards, and repeats. On the lower-third output images always keep their aspect ratio, sit in a bottom-anchored area, and are limited by a configurable maximum height (default 30% of the viewport) reduced by configurable padding (default 48px).
- **Backgrounds** — global background library in the **Menu**, with uploaded images/animated images plus built-in CSS and SVG animations ranging from subtle to wild. Each background can use its own palette or the global background colour theme. Set lists can choose a background, text/song items can override it, and Tarp pages can use them in either view.
- **Stingers** — transparent SVG and image transition overlays in the **Menu**. Set a default stinger on a set list, override it per item, and add per-page overrides. The display plays the stinger over the outgoing page and swaps to the incoming page while the animation covers the screen.
- **Tarp (in progress)** — reusable themes and 16:9/16:10/flex presentations with independent normal/lower-third pages. Flex fills the complete output viewport. The dual-view editor supports text, Markdown and image objects with drag/resize, layering and per-view settings. Set lists can create Tarp items with autoplay/Single/Loop/Bounce playback; normal pages render on full/two-thirds/stage outputs and the lower-third view renders on the lower-third output. Page transitions support **Animate objects** or **Migrate matching objects**; unchanged backgrounds are preserved without fading or restarting. Referenced Tarp presentations/themes are included in set-list export/import and persisted in the setlists Git repository. See [14](docs/14-tarp.md).
- **Bible** — reads the three real schema families found in the samples (MyBible `book`/`verse`, BibleDb `books`/`verses`, and JSON), sanitises ESV markup, and provides a translation/book/chapter/verse-range UI with **Paragraph** or **Line per verse** layout, **Add to current setlist** and **Add to live session**.
- **Set lists** — named, dated, with songs and text items; dates display in ISO `YYYY-MM-DD` form and new set lists default to a `YYYY-MM-DD-` name prefix for sortable names. Reorder with arrows or a drag handle; click an item to preview and edit its title, lyrics/text, format, alignment, key, transpose, verse order and notes. **Big Print PDF → Create PDF of the songs** downloads a printable song sheet with chord markers and slide labels removed; text size and columns can be overridden for that download, with font/size/column defaults in Settings. The Add song panel searches titles, first lines, alternative titles and optionally the full lyrics/body. Song edits stay local to the set list by default, with an explicit **Save to song library** option and **Send to live session** when that set list is live. Song items have an **ALT** button that finds local songs with similar titles; the popup shows metadata and a line-level **Difference** view against the current lyrics before switching versions.
- **Live sessions** — a set list is snapshotted when the session starts, so editing the set list afterwards cannot change the live output. Sessions start **blank** until the operator shows the first page.
- **Publish & apply** — publish a revision, then **apply after the current item** (safe during a service) or **apply now**; queued updates are shown to operators and persisted across restarts.
- **Templated outputs** — main/lowerthird, centered two-thirds, full, stage and chords; templates come from the set-list repo, a templates folder/repo, or built-in defaults, with fade-in/out changes. Stage and chords show the current page plus all following pages of the item, keeping the current page at the top.
- **Display config** — Live-page panel for font, text colour, text size, max lines, max words and smart page splits; applies to centered two-thirds/full, while the lower-third has separate font and text-size settings. Stage and chords keep their fixed style. Smart splits estimate 1080p coverage from font size and limit page line counts. Server-side smart wrap can be enabled per module (Songs, Text, Bible) and only alters lines at or above a configurable minimum word count (default 15); shorter lines wrap naturally in the browser.
- **Rich text items** — choose Markdown (default), plain text, HTML or RST in the editor; legacy `format:` headers are extracted into metadata. Text items also have a per-item **left/centre** alignment option. Pages can be authored with inline `<!-- page -->` markers or with separate page boxes in the editor; both serialize to the same page-break format. Page breaks and server-side sanitisation are supported.
- **Settings page** — personalise the local instance with a site logo and sidebar/top-menu background colour. Import Google Fonts by family name or CSS URL; files are cached in `/data/fonts` and served locally. Font files placed directly in `/data/fonts` are detected automatically and registered as local fonts. Team-wide settings and downloaded font names are recorded in `settings/shared.json` in the set lists repository, so another server applies the same display/style/page settings and highlights fonts it has not cached, with one-click or bulk download. ChurchSuite credential status, connection testing and the list of ChurchSuite object types imported as empty items live here too. The **Big Print PDF** panel sets the default font, text size and column count for printable song sheets. The **Song page IDs** table scans existing section names, lets you choose compact IDs, and **Fix songs** previews then bulk-applies the conversion to songs that still use spaced/long labels. Configurable keyboard shortcuts cover hide/show, page navigation and set-list item navigation, and a global setting chooses whether page navigation stops at item boundaries or continues into the previous/next item. A local **Live preview screen** setting emulates 1920×1080, 1920×1200, 2560×1440 or 3840×2160, scaling the display viewport down so preview font sizes and aspect ratio match the real output screen. The default Bible version used by the Bible module and set-list Bible panel is also selected here.
- **Export/import** — download a reference JSON or self-contained ZIP bundle (songs, text, PDF/tab assets) and import it as a new draft with a preview; matching uses CCLI/title and never affects a live service.
- **Live control** — switchable live preview for fullscreen, lower-third, two-thirds, stage or chords; next/previous, page show, item queue, append an item’s pages to the current live queue with its **+** button, blank, transpose, max-lines, footer and quick text. When the current item is an image list or Tarp presentation, the transport shows its autoplay state, playback mode and delay, and allows a temporary live-session override without changing the saved set list.
- **Help page** — built-in operator guide with service-day quick start, publish/apply guidance, item and image tips, display/OBS URLs, current keyboard shortcuts and troubleshooting.
- **Layout** — collapse the left sidebar or move navigation into a top bar; smaller screens automatically use the top-bar layout.
- **Song word joins** — SongSelect/SongPro split words such as `can - not` or `sat - is - fied` display joined on lower-third/centered two-thirds/stage and keep the split form in the chords view.
- **Dashboard** — the configurable widget dashboard page is currently hidden from the navigation; its widgets changed live output and need a safer design before it returns.
- **ChurchSuite planning** — browse published plans for a date range, review the plan’s service items, see local song matches and create a draft set list. Matched songs link to the library; if several local songs match, a comparison table shows title, author, CCLI, key, alternative titles and first lines so the operator can select the right version. Unmatched songs and named service items become editable text placeholders. When site credentials are available, unmatched song items show **Lookup song in SongSelect**, which searches and downloads lyrics, ChordPro, lead and vocal files without leaving the planner. Configurable plan object types (seeded with Welcome, Misc, Countdown, Prayers and Announcement) become empty set-list items with no pages; their ChurchSuite text is kept in the item notes. See [10](docs/10-churchsuite-sync.md).
- **Git-backed shared data** — designed: local-only repos by default with optional remote, auto-save/push on by default, separate songs/setlists/(optional LFS) Bibles repos, standard SSH or HTTP(S)+token URIs. See [11](docs/11-git-data-sync.md).
- **Displays** — vanilla HTML/CSS/JS, no CDN, snapshot-on-connect, transparent main output, full-screen, chord and stage lyric variants.
- **Persistence** — SQLite (WAL) for users, sessions, songs, set lists, session snapshots and dashboard layouts; the live session survives a restart.
- **Git-backed data (local foundation)** — songs and set lists are written to local Git repositories and committed automatically (`autoSave` default on); optional remotes, pull/push and Bibles/LFS are configurable. The Settings page shows repository status and can change auto-commit, auto-push, pull interval and fast-forward-vs-merge behaviour at runtime. See [11](docs/11-git-data-sync.md).
- **Container** — multi-stage Dockerfile, non-root UID 10001, health check, Compose file; image builds and runs.

## Configuration

Create `config.yaml` (or `.json`) from [`config.example.yaml`](config.example.yaml). The server loads it automatically from the working directory, the application root, or `/config/`; you can also set an explicit path:

```sh
SM_CONFIG_FILE=/config/config.yaml npm start
```

The file covers the server, data paths, SongSelect watcher, ChurchSuite and Git repositories. Environment variables always take precedence, so a container can keep only secrets and deployment-specific values in its environment. See [Git-backed shared data](docs/11-git-data-sync.md#3-configuration) for the repository layout and URI forms.

Listener ports are set with `SM_PORT` and `SM_DISPLAY_PORT`; both are read at startup and must be different.

The control interface is HTTPS by default. If a forward proxy terminates TLS and forwards plain HTTP to Service Maestro, set `SM_SSL_ENABLED=false`. Do not expose that HTTP control port directly; keep `SM_SECURE_COOKIES=true` so browsers still use Secure cookies through the proxy.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SM_PORT` | `8080` | Control HTTPS/WebSocket port (HTTP when TLS is disabled) |
| `SM_DISPLAY_PORT` | `8081` | Read-only display HTTP/WebSocket port; serves only `/display/*` |
| `SM_HOST` | `0.0.0.0` | Bind address |
| `SM_DATA_DIR` | `packages/server/data` | SQLite + runtime data |
| `SM_SONGS_DIR` | `samples/` (local) | Source directory scanned for OpenLP/ChordPro/text imports |
| `SM_BIBLE_DIR` | `samples/bible/` (local) | SQLite/JSON Bible translations |
| `SM_IMAGES_DIR` | `library/images/` (local) / `/library/images` (container) | Image library for backgrounds and slides |
| `SM_SONGSELECT_WATCH_DIR` | `/data/imports/songselect` | Watched SongSelect download folder |
| `SM_SONGSELECT_WATCH_ENABLED` | `true` | Enable the background SongSelect drop-folder watcher |
| `SM_SONGSELECT_WATCH_INTERVAL` | `10` | Seconds between watched-folder scans |
| `SM_ADMIN_PASSWORD` | `admin` | Password for the seeded admin |
| `SM_OUTPUT_TOKEN` | `dev-output` | Token required by display sockets |
| `SM_SECRET_KEY` | generated `data/secret.key` | Master key for encrypted site credentials |
| `SM_SONG_SCRAPING_PROVIDER` | `songselect` | Site scraping provider id |
| `SM_SONG_SCRAPING_BASE_URL` | `https://songselect.ccli.com` | Download-site base URL |
| `SM_SONG_SCRAPING_USERNAME` | unset | Optional server-level fallback username |
| `SM_SONG_SCRAPING_PASSWORD` | unset | Optional server-level fallback password |
| `SM_SONG_SCRAPING_COOKIE` | unset | Optional server-level fallback session cookie |
| `SM_LOG_LEVEL` | `info` | Fastify log level |
| `SM_SECURE_COOKIES` | `true` | Marks session cookies Secure; set to `0` only for special proxy setups |
| `SM_SSL_ENABLED` | `true` | Serve control over HTTPS; set `false` only behind a TLS-terminating forward proxy |
| `SM_SSL_DIR` | `/data/ssl` | Control HTTPS certificate directory |
| `SM_SSL_CERT_FILE` | `cert.pem` in `SM_SSL_DIR` | Trusted certificate/full-chain path |
| `SM_SSL_KEY_FILE` | `key.pem` in `SM_SSL_DIR` | Private key path |
| `SM_SSL_HOSTS` | unset | Extra comma-separated DNS names/IPs for a generated certificate |
| `SM_WEBAUTHN_RP_NAME` | `Service Maestro` | Passkey relying-party display name |
| `SM_WEBAUTHN_RP_ID` | derived from request | Passkey RP ID; set explicitly for a proxy/domain |
| `SM_WEBAUTHN_ORIGIN` | derived from request | Browser-facing HTTPS origin for passkeys |
| `SM_BRANDING_NAV_BACKGROUND` | unset | Default sidebar/top-menu background for this instance |
| `SM_BRANDING_LOGO_FILE` | unset | Default site logo file for this instance |
| `SM_GIT_ENABLED` | `true` | Enable local/remote Git persistence |
| `SM_GIT_AUTO_SAVE` | `true` | Write + commit on each song/set-list change |
| `SM_GIT_AUTO_PUSH` | `true` | Push after commit when a remote is configured |
| `SM_GIT_SONGS_PATH` | `/data/repos/songs` | Songs repo working tree |
| `SM_GIT_SETLISTS_PATH` | `/data/repos/setlists` | Set lists repo working tree |
| `SM_GIT_BIBLES_PATH` | `/data/repos/bibles` | Optional Bibles repo |
| `SM_CONFIG_FILE` | unset | YAML/JSON config; environment variables override file values |
| `SM_TEMPLATES_DIR` | `/data/templates` | Display template folder (after the set-list repo lookup) |
| `SM_FONTS_DIR` | `/data/fonts` | Imported Google Fonts plus manually placed local fonts |
| `SM_CHURCHSUITE_CLIENT_ID` | unset | ChurchSuite OAuth client id / API user identifier |
| `SM_CHURCHSUITE_CLIENT_SECRET` | unset | ChurchSuite OAuth secret (prefer Docker secrets in production) |
| `SM_CHURCHSUITE_TOKEN_URL` | `https://login.churchsuite.com/oauth2/token` | Token endpoint |
| `SM_CHURCHSUITE_SCOPES` | `planning.read` | Requested scopes |
| `SM_CHURCHSUITE_API_URL` | `https://api.churchsuite.com/v2` | API base URL |

## Docker / Podman

```sh
docker build -t service-maestro .
docker run --rm -p 8080:8080 -p 8081:8081 \
  -e SM_ADMIN_PASSWORD='change-me' \
  -e SM_OUTPUT_TOKEN='a-long-random-output-token' \
  -v "$PWD/data:/data" \
  service-maestro
```

Open the control interface at <https://localhost:8080>; the display listener remains at <http://localhost:8081/display/>. Certificates live in `./data/ssl` and a self-signed pair is generated automatically when needed.

Or `docker compose up -d` / `podman-compose up -d`. The container runs as UID/GID 10001; ensure the mounted data directory is writable by that user (`chown -R 10001:10001 ./data`, or use Incus `shift=true`).

Copy `.env.example` to `.env` next to `compose.yaml` for local credentials. Docker Compose reads that file automatically; never commit it. ChurchSuite credentials belong under `SM_CHURCHSUITE_CLIENT_ID` and `SM_CHURCHSUITE_CLIENT_SECRET`, and the Settings page can test the connection.

See [05-container-deployment.md](docs/05-container-deployment.md) for Incus/LXC, read-only root filesystem, backups and hardening.

## Project structure

```
service-maestro/
├── packages/
│   ├── shared/       TypeScript types + Zod schemas
│   ├── server/       Fastify API, SQLite, Socket.IO, live state, rendering
│   ├── control/      React + Vite operator UI (dashboard temporarily hidden) + standalone musicians view
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
- Site scraper adapters, CCLI reporting and backups/scan jobs.
- User/role management beyond the seeded admin; output tokens are currently a single shared token.

The next step is Git asset persistence/conflict handling or the theme editor. See the [architecture phases](docs/02-architecture.md#14-phased-delivery).
