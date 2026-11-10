# Architecture: Web Lyric Master

Status: **design agreed; Phase 1 walking skeleton implemented, plus sample-backed importers, Bible adapters, song assets and the musician PDF viewer** (see [09-phase-1-status.md](09-phase-1-status.md)) — Node.js + TypeScript, Fastify/Socket.IO, SQLite, React control UI with a per-user react-grid-layout dashboard, and vanilla display outputs. Old OBS URLs are aliased. OpenLP, ChordPro, plain-text, Bible and first score/text samples have arrived; additional PDF-score and guitar-tab samples are still pending. Content authoring is detailed in [03-content-model.md](03-content-model.md); SongSelect/scores in [06-songselect-and-scores.md](06-songselect-and-scores.md); Bible schemas in [07-bible-sources.md](07-bible-sources.md); the dashboard layout editor in [08-dashboard-layout-editor.md](08-dashboard-layout-editor.md); container packaging in [05-container-deployment.md](05-container-deployment.md). Based on [01-node-red-analysis.md](01-node-red-analysis.md).

## 1. Goals

Build a self-hosted server application that:

- manages a **library of songs** imported from local directories in multiple formats: OpenLP-style XML, ChordPro and plain text;
- optionally searches authorized **CCLI SongSelect** accounts and imports ChordPro, PDF scores and guitar tabs (see [06-songselect-and-scores.md](06-songselect-and-scores.md));
- serves **scores, ChordPro and guitar tabs** to a dedicated musician UI;
- serves Bible passages from **SQLite database files** (one or more translations);
- manages **images/slides** from local directories;
- lets **multiple operators** build and drive a service (set lists, live lyrics, Bible, text, images) from one web frontend;
- renders the live output on **separate, independent HTTP frontends** designed to be loaded as OBS Browser Sources (main, full-screen, stage), with optional extra outputs;
- keeps displays correct through refreshes/reconnects, and works on a LAN without internet access when external providers are disabled.

Non-goals (v1): replacing the ChurchSuite planning service, DMX/lighting desk control, audio mixing, camera/alarm control. The architecture leaves hooks for OBS scene control and media/lighting cues later.

## 2. Key design principles

1. **Server-authoritative live state.** The server owns the current item, page, text, image, and settings. Every output receives a full snapshot on connect, then incremental patches. A refresh or reconnect never blanks the screen.
2. **Outputs are dumb and reliable.** Display pages are small, framework-free HTML/CSS/JS with no CDN dependencies. They render state; they do not contain business logic.
3. **Library ≠ live.** Songs/set lists/Bible/images are durable data; the live session is a state machine on top of a set list.
4. **Import, don't mutate sources.** Source directories remain the system of record for lyrics; imports are idempotent and track source path + hash. Edits made in the UI are stored in the app DB with provenance.
5. **Normalize once.** All formats are converted to one internal song model (sections + lines + chord markup) at import time; page splitting and transposition happen server-side so every output agrees.
6. **Secure by default.** Authenticated control UI, revocable output tokens, sanitized HTML, strict media path handling, read-only Bible DB access.
7. **LAN-first.** No external fonts/CDNs required; ship fonts and assets.

## 3. Recommended stack

> **Decision: Node.js 24 + TypeScript end-to-end.** The observed system already speaks WebSockets/JSON and the team's environment is Node-friendly; TypeScript gives shared types between server, control UI and display clients.

| Layer | Choice | Why |
| --- | --- | --- |
| Runtime | Node.js 24 LTS | Already installed (v24.22.2); great WS/HTTP story. |
| Server | **Fastify** + `@fastify/websocket` or **Socket.IO** for control | Fast static/media serving; typed schemas; WebSocket rooms. |
| Language | TypeScript (strict) | Shared protocol types; safer refactors. |
| App DB | **SQLite** via `better-sqlite3` (WAL) | Zero-ops, single file, transactional; easy backup. |
| Bible DBs | `better-sqlite3` **read-only** connections | Matches the stated SQLite source files; no copying. |
| Control UI | **React + Vite + TypeScript** (MUI or Tailwind) | Mature multi-user SPA; fast dev; good tables/forms. |
| Dashboard layout | **react-grid-layout** (MIT) + **@dnd-kit/core** (MIT) | Responsive grid, drag/resize, JSON layouts; see [08](08-dashboard-layout-editor.md). |
| Co-editing | **Yjs** (MIT) + **y-websocket** (MIT), self-hosted | CRDT layout sync, presence, offline; no cloud service. |
| Display frontends | Plain HTML/CSS/vanilla JS bundled by Vite (separate entries) | Tiny, OBS-friendly, no framework or CDN. |
| Realtime | **Socket.IO** for `/control`; raw WebSocket or plain JSON for `/output/*` | Rooms + presence for operators; minimal for outputs. |
| Auth | `argon2` password hashes, signed session cookie (HttpOnly), output tokens | Local users, no external IdP. |
| SongSelect / scores | Provider adapters, encrypted credentials, `pdfjs-dist` viewer, signed asset URLs | Authorized imports only; see [06-songselect-and-scores.md](06-songselect-and-scores.md). |
| Validation | Zod schemas shared via `packages/shared` | One schema for REST + WS. |
| Tests | Vitest (unit/integration), Playwright (control → output) | Covers parsers, state, sync. |
| Packaging | Docker image + compose; or systemd + `node dist/server.js` | Single process, mounted data volumes. |

Alternative if the team prefers Python: FastAPI + SQLAlchemy/SQLite + React. The architecture is unchanged; only the runtime and DB driver change.

Repository layout (monorepo, npm workspaces):

```
web-lyric-master/
├── package.json                 # workspaces
├── packages/
│   ├── shared/                  # TS types + Zod schemas (protocol, models)
│   ├── server/
│   │   ├── src/
│   │   │   ├── app.ts           # Fastify setup
│   │   │   ├── db/              # app migrations + repositories
│   │   │   ├── library/         # songs, set lists, images
│   │   │   ├── importers/       # openlp.ts, chordpro.ts, text.ts
│   │   │   ├── bible/           # adapter + schema detection + queries
│   │   │   ├── live/            # state machine, commands, outputs
│   │   │   ├── auth/
│   │   │   └── media/
│   │   └── migrations/
│   ├── control/                 # React operator UI
│   └── display/                 # Vite multi-page output clients
│       ├── main.html
│       ├── full.html
│       ├── stage.html
│       └── src/
└── data/                        # git-ignored, mounted in production
    ├── songs/{openlp,chordpro,text}/
    ├── bible/*.db
    ├── images/
    └── app.sqlite
```

## 4. Data model (application SQLite)

The authoritative schema is in [03-content-model.md §6](03-content-model.md#6-data-model-revisioned). It is revisioned so that a live service can pin exact content. Summary of the entity groups:

| Group | Tables | Purpose |
| --- | --- | --- |
| Set lists | `setlists`, `setlist_revisions`, `setlist_items`, `service_sessions`, `live_state` | Named/dated definitions, immutable revisions, pinned live sessions, playback state |
| Songs | `songs`, `song_versions`, `song_sections`, `song_arrangements` | Library head, immutable versions, structured lyrics/chords, named arrangements |
| Scores/assets | `song_assets`, `asset_jobs` | ChordPro, PDF scores, guitar tabs; checksums and signed access |
| Integrations | `provider_accounts`, `external_songs`, `song_external_refs`, `usage_events` | Encrypted credentials, external ids, CCLI usage reporting |
| Dynamic text | `text_items`, `text_item_versions` | Reusable presentation text with sanitized HTML and page breaks |
| Themes | `themes`, `theme_versions` | Modular tokens/layout/CSS, versioned and pinned |
| Media | `images` | Scanned images, dimensions, thumbnails |
| Bible | `bible_translations` (registry only) | External SQLite files opened read-only; not copied |
| Auth/ops | `users`, `outputs`, `settings` | Accounts/roles, output tokens, configuration |
| Dashboards | `dashboards`, `dashboard_versions`, `dashboard_layouts`, `collab_documents` | Personal/shared widget layouts, published versions, Yjs state (see [08](08-dashboard-layout-editor.md)) |

Key invariants:

- **Set list revisions and content versions are immutable.** Editors write new revisions/versions; `head_*` pointers track the latest; live sessions and set list items pin specific ids.
- **Items store per-service overrides** (key, transpose, verse order, arrangement, theme, max lines, notes) without mutating the library.
- **Bible data remains in the provided SQLite files**, queried through adapters and never rewritten.
- **Downloaded assets are immutable and licensed.** ChordPro/PDF/tab files are checksummed, access-controlled and audited; they are never served publicly.
- **Deletes are soft** for anything referenced by a revision, so history and live sessions remain resolvable.

## 5. Song import pipeline

Configured roots (defaults):

```
data/songs/openlp/     *.xml  (OpenLP/OpenLyrics)
data/songs/chordpro/   *.cho, *.chordpro, *.crd, *.txt  (ChordPro)
data/songs/text/       *.txt  (plain text)
```

Pipeline:

1. `scan` walks the roots, computing a content hash. It ignores hidden files, editor swap/lock files (`.swp`, `.swo`, `.kate-swp`, `~`), `node_modules/`, `package.json`/lock files and unsupported extensions.
2. Picks a parser by extension/directory:
   - **OpenLP/OpenLyrics XML** — the sample is OpenLyrics 0.8: `<properties><titles><title>`, `<copyright>`, `<verseOrder>`, `<authors>`, and `<lyrics><verse name="v1"><lines>` with `<br/>` line breaks. Support multiple titles (main + alternate), arbitrary section labels (`v1`, `c1`, `b1`), repeated sections and optional `<chords>`.
   - **Plain text** — stanzas separated by blank lines; optional `[Verse 1]` labels; chord lines detected by a chord-token heuristic. Real samples are mostly unlabelled lyrics, but some files contain HTML study notes or sermon outlines — the import dialog must let the user import as a song or a text item, or skip.
   - **ChordPro** — parse directives, `{comment: …}` section labels, verse-order variants, inline chords/bar markers, capo/key and page breaks; keep the raw file as an asset. Detailed rules are in [06-songselect-and-scores.md §4](06-songselect-and-scores.md#4-chordpro-import).
3. Normalize into a **new song version** (`song_versions`, `song_sections`, default `song_arrangements`). Chords are stored as structured tokens, not raw HTML; arrangements preserve section order and page breaks.
4. Upsert by `source_path`: skip unchanged hashes; a changed source file creates a new immutable version on the library head, while set lists pinned to older versions remain untouched. Conflicts with in-app edits are reported, never overwritten silently.
5. A **preview/dry-run** mode and a "Scan now" admin action; optional `fs.watch` with debounce.
6. Manual songs (`source_format = manual`) have no source path and are never overwritten by a scan.
7. **Provider imports** (SongSelect/manual upload) enter the same pipeline: ChordPro is parsed into a version; PDF scores and guitar tabs are attached as licensed assets rather than parsed. Provider access, licensing and failure handling are specified in [06-songselect-and-scores.md](06-songselect-and-scores.md).

Plain-text example:

```
# Amazing Grace
[Verse 1]
A        mazing grace, how D sweet the sound
That saved a E wretch like A me
```

## 6. Bible service

The real sample files use two schema families plus a JSON export; details and mappings are in [07-bible-sources.md](07-bible-sources.md).

- **Schema A** — `book`/`verse`/`comment`/`metadata` (NASB, NET): 66 books, verse text plain, optional HTML study comments.
- **Schema B** — `books`/`verses`/`info`/`stories`/`introductions` (ESV Global Study Bible): 10-based book ids with deuterocanonical gaps, verse text with `<pb/>` and `<f>…</f>` markers to sanitize.
- **Schema C** — JSON verse arrays (NET export): accepted as an import source, not queried per request.

On startup:

1. Scan `data/bible/` for SQLite/JSON files and open SQLite **read-only**.
2. Detect the schema from `sqlite_master` (`verse`+`book` vs `verses`+`books`), then choose an adapter; unknown schemas fail with a diagnostic, never guess.
3. Normalize book ids to the canonical 1–66 order (Schema B maps through its `books` table; never divide by 10).
4. Build a **normalized cache** (`bible_verses` in the app DB or `/data/cache/bible/<code>.sqlite`) with indexes, refreshed when the source hash/mtime changes. Source files are never written.
5. Expose one internal interface:

```ts
interface BibleTranslation {
  code: string; name: string;
  books(): Book[];                     // canonical order + source id
  chapters(book: number): number;
  verses(book: number, chapter: number): { number: number; text: string }[];
  passage(ref: BibleRef): Verse[];     // book, chapter, from, to
}
```

- Sanitize verse text: escape first, strip `<pb/>` and footnote markers (`<f>…</f>`) for projection, optionally expose study comments/notes separately; never inject a source's `html_style`.
- Exclude books marked absent (deuterocanon in the ESV file), and report missing/extra books and verse counts.
- Cache book/chapter metadata; query passages on demand. Return verse-numbered HTML built from the sanitized text.
- UI mirrors the observed flow: Translation → Book → Chapter → From/To → preview → send to output or add to set list.

## 7. Live state machine

```ts
type LiveState = {
  sessionId: string;
  setlistId: string;
  revisionId: string;         // pinned immutable revision
  currentItemId: string | null;
  itemIndex: number;
  pageIndex: number;          // page within the current item
  maxLinesPerPage: number;
  mode: 'lyrics' | 'bible' | 'text' | 'image' | 'blank' | 'logo';
  textStyle: { fontFamily: string; fontSizeScale: number; };
  keyOverride: string | null; // per current item
  transpose: number;          // derived from key override
  showChords: boolean;        // stage outputs
  footer: string;
  version: number;
  updatedAt: string;
};

type RenderedSlide = {
  itemId: string;
  pages: { index: number; html: string; section: string }[];
  pageIndex: number;
};
```

Rules:

- The **server derives slides** from the current item (page splitting by `maxLinesPerPage`, transposition applied to chord tokens, sanitized HTML rendered once).
- A **session pins a set list revision** and the content/theme versions referenced by it. Nothing the live session reads is mutable.
- **Editing a set list or library item never affects a running session.** Applying changes is an explicit operator action (`after-current` by default, `now` with confirmation), which switches the session to a new revision and broadcasts a snapshot.
- Commands are validated against the pinned revision; `next`/`prev` move by page first, then item; `goto` selects item/page.
- Every state change increments a version and is broadcast as a snapshot/delta to all outputs. Outputs acknowledge receipt; the server exposes "output lag/offline" to the control UI.
- A blank/fade command is itself state, so a refresh keeps the screen blanked rather than revealing content.
- Set list imports always create drafts; no import path can modify a pinned revision or start a session.

## 8. HTTP surfaces

| Route | Purpose | Auth |
| --- | --- | --- |
| `/` | Control SPA | session cookie |
| `/login`, `/logout` | Auth | — |
| `/api/songs`, `/api/songs/:id`, `/api/songs/:id/versions`, `/api/songs/:id/preview` | Song library, versions, arrangements, render preview | editor |
| `/api/providers/*` | SongSelect/provider status, search, assets, download jobs | editor/admin |
| `/api/songs/:id/assets`, `/api/assets/:id/file` | ChordPro/PDF/tab assets and signed file access | editor/musician |
| `/api/musicians/services`, `/api/musicians/services/:id` | Musician service view and score readiness | musician |
| `/api/usage/report` | CCLI usage export | admin |
| `/api/widgets`, `/api/dashboards/*` | Dashboard layout registry, personal/shared layouts, publish | per dashboard role |
| `/collab/dashboards/:id` (WS) | Yjs collaborative layout editing + presence | edit permission |
| `/api/text-items`, `/api/text-items/:id/versions`, `/preview` | Dynamic text authoring | editor |
| `/api/themes`, `/api/themes/:id/versions`, `/preview` | Modular themes | editor/admin |
| `/api/setlists`, `/api/setlists/:id/revisions/:no`, `/apply-to-live`, `/duplicate` | Named/dated set lists, drafts, apply-to-live | editor/operator |
| `/api/setlists/:id/export`, `/api/setlists/import` | Reference JSON / bundle export and import | editor/operator |
| `/api/sessions` | Start/stop rehearsal/live sessions | operator |
| `/api/bible/translations`, `/books`, `/chapters`, `/passage` | Bible data | operator |
| `/api/images`, `/api/images/upload`, `/api/scan` | Media + import | operator/admin |
| `/api/live/*` | Commands (POST fallback) | operator |
| `/media/...` | Images/thumbnails/fonts | output token or signed path |
| `/display/main` | Lower-third / main lyric output | `?token=` or `?key=` |
| `/display/full` | Full-screen output | `?token=` |
| `/display/stage` | Stage monitor (chords, notes, next) | `?token=` |
| `/display/image` | Image/slide output | `?token=` |
| `/musicians` | Musician UI: set list, ChordPro, scores, tabs | session + `musician` role |
| `/healthz`, `/metrics` | Ops | local |

Set list export/import formats, conflict handling and the bundle layout are defined in [03-content-model.md §12](03-content-model.md#12-set-list-export--import).

Output URLs should accept stable, revocable per-output tokens (stored hashed), e.g.:

```
http://lyrics.local/display/main?token=main-hall-7f3c...
http://lyrics.local/display/stage?token=stage-monitor-...
```

### Legacy compatibility aliases

Existing OBS Browser Sources must keep working without edits. The following routes are first-class aliases of the new frontends:

| Legacy URL | Serves |
| --- | --- |
| `/obs-main` | `main` frontend (transparent lower-third / lyric area) |
| `/obs-mainfull` | `full` frontend (full-screen) |
| `/obs-stage` | `stage` frontend |
| `/obs.css` | compatibility stylesheet URL (redirect to the versioned display CSS) |
| `/obs-main.js` | compatibility client URL (redirect to the bundled display client) |

Aliases use the same token query parameter, e.g. `/obs-main?token=…`. If no token is supplied, a configured legacy token may be accepted (disabled by default). They never expose a second code path: the alias rewrites to the same handler and renderer.

Query options for OBS: `theme`, `font`, `scale`, `showChords`, `background=transparent|black`, `fit=contain|cover`, `debug=1`.

## 9. Realtime protocol (Socket.IO `/control`)

Server → clients:

- `state:snapshot` — full `LiveState` + current rendered slide + set list + outputs presence.
- `state:delta` — changed fields, version, timestamp.
- `library:changed`, `setlist:changed`, `scan:progress`, `output:presence`.
- `toast` — for scan/import errors.

Client → server:

```jsonc
{ "type": "goto",        "itemId": "...", "page": 0 }
{ "type": "next" } | { "type": "prev" }
{ "type": "page",        "delta": 1 }
{ "type": "blank",       "value": true }
{ "type": "quickText",   "body": "…", "mode": "direct|setlist" }
{ "type": "transpose",   "semitones": 2 }
{ "type": "maxLines",    "value": 4 }
{ "type": "style",       "fontFamily": "Oxygen" }
{ "type": "footer",      "text": "…" }
{ "type": "image",       "imageId": "..." }
{ "type": "bible",       "translation": "NIV2011", "ref": { "book": 7, "chapter": 1, "from": 1, "to": 18 } }
```

Server → output sockets (raw WS or Socket.IO room): always send `state:snapshot` on connect, then `state:delta`:

```jsonc
{
  "v": 42,
  "mode": "lyrics",
  "html": "<div class=\"slide\">…</div>",
  "pageIndex": 1,
  "pageCount": 7,
  "footer": "…",
  "style": { "fontFamily": "Oxygen", "scale": 1.0 },
  "blank": false
}
```

No arbitrary HTML/CSS from operators. Content is sanitized at import/render time; styles come from a fixed, named set.

## 10. Display frontends

- **`main`** — transparent background, lower third/lyric area + footer; OBS scene where camera is visible behind.
- **`full`** — opaque or transparent full-frame lyrics; chords hidden.
- **`stage`** — current line + next lines, chords visible, per-item notes/verse order, maybe clock; no transparency assumption.
- **`image`** — renders the selected image/slide with fit mode; can be combined with `main` in OBS.
- Shared client (`display/src/display.ts`): connect WS, apply snapshot, re-render text with DOM APIs (no `innerHTML` from network beyond sanitized server HTML), handle resize/`vw`, reconnect with backoff, optional `?debug` overlay showing version/latency.
- Fonts served locally (`/media/fonts`), CSS variables for theme; CSS is versioned and cache-busted.
- Fallback HTTP polling if WS fails; show a clear "offline" indicator only in debug mode.

## 11. Images / notices

- Scan `data/images/**`; generate thumbnails (`sharp`) into `data/cache/thumbs`.
- Serve `/media/images/<id>` and `/media/thumbs/<id>`; never expose filesystem paths.
- Notices list in the control UI uses `{ id, title, thumbnail }`; "send to output" sets image mode + id.
- Upload (optional) writes to a configured incoming dir; same scan pipeline indexes it.
- Slides that are text-only can be uploaded as SVG/PNG later; for now images are files.

## 12. Security

- Argon2id password hashing; session cookie `HttpOnly`, `SameSite=Lax`, `Secure` when TLS.
- CSRF protection on state-changing REST; origin checks on WS handshakes.
- Output tokens: random 256-bit, stored as hash, revocable per output; never the same as user sessions.
- Sanitize all lyric/Bible/text HTML server-side (allow-list: `b`, `i`, `em`, `strong`, `br`, `span.chord`, small set of classes). Escape all text.
- Path safety: resolve media paths against the configured root; reject traversal and symlinks outside the root.
- Bible DBs opened read-only; app DB backed up before migrations.
- Rate limits on login and scan endpoints; audit log of live commands (who/what/when).
- **Provider credentials** (SongSelect) are AES-256-GCM encrypted with a master key, never logged, revocable; no shared accounts; automated access only where CCLI authorizes it.
- **Licensed assets** (ChordPro/PDF/tabs) require authentication, use signed short-lived URLs, and are never exposed via public static paths; CCLI usage is recorded for reporting.
- **Dashboard layouts** are schema-validated JSON containing only registered widget types; no arbitrary HTML/JS. WebSocket layout edits require session auth and dashboard permissions.
- Optional reverse-proxy TLS (Caddy/nginx) in deployment docs.

## 13. Testing & ops

- Unit: parsers (OpenLP/ChordPro/text), chord detection, transposition, page splitting, Bible schema detection, theme token rendering.
- Integration: state machine transitions, snapshot-on-connect, set list revision pinning, apply-to-live, import idempotency, export/import round-trip.
- ChordPro/PDF/tab: parser fixtures, asset checksum/access control, viewer smoke tests, provider failure/backoff, license gating.
- Dashboard layout: schema validation/permissions, drag/resize/save, breakpoint fallbacks, keyboard access, two-client Yjs convergence and reconnect.
- E2E: operator advances slides → `/display/main` and `/display/stage` show the same page; refresh output mid-service recovers; edit a draft while live without changing the output.
- CI: typecheck, lint, tests, multi-arch image build, smoke test in Docker and Podman.
- Ops: `/healthz` (DB + Bible DBs readable), structured logs, graceful shutdown, backups, migrations under a lock.
- Container packaging, volumes, Incus/LXC and hardening are detailed in [05-container-deployment.md](05-container-deployment.md).

## 14. Phased delivery

**Phase 1 — set list foundation + container**
- Monorepo, Fastify server, SQLite app DB, session auth.
- Named/dated set lists, immutable revisions, live sessions, draft vs pinned, apply-to-live.
- Manual song/text entry, set list export/import (reference JSON), snapshot-on-connect outputs.
- Control UI shell with a **grid dashboard** (`react-grid-layout`), default pages, personal drag/resize/save.
- `main`/`full`/`stage` outputs; Dockerfile, compose/Quadlet, Incus profile.

**Phase 2 — song authoring + scores**
- Text/HTML/chord editor: pages, arrangements, key/transposition, immutable versions.
- OpenLP/OpenLyrics, ChordPro and text importers (all sample-backed).
- PDF score and guitar-tab asset upload/storage; musician UI with ChordPro/PDF/tab viewers and service readiness.
- Dashboard editor: widget palette, config drawer, breakpoints, duplicate/lock/reset, publish/versioning.
- Multi-user presence and conflict handling.

**Phase 3 — dynamic text + themes**
- WYSIWYG text editor, page breaks, modular themes and theme versions.
- Self-contained bundle export/import with songs, text, themes and media.
- Dashboard co-editing: Yjs + y-websocket, presence, undo/redo, soft locks, offline sync.

**Phase 4 — Bible + images**
- Schema detection + adapters; translation/book/chapter/verse-range UI; passage rendering; add-to-set-list.
- Image scan/thumbnail/serve; notices picker; image output; upload.

**Phase 5 — production polish**
- Output tokens/presence/lag, role permissions, audit log, scheduled backups.
- Optional: OBS WebSocket integration (scene/transition), QLC+ cue hooks, ChurchSuite plan links.

**Phase 6 — SongSelect integration (opt-in)**
- Provider adapters and encrypted credentials.
- Partner API if the church has credentials; otherwise manual import as the supported path.
- Any assisted/session flow only after CCLI confirms it is permitted; CCLI usage reporting/export.
- See [06-songselect-and-scores.md](06-songselect-and-scores.md).

## 15. Decisions

Resolved:

1. **Stack** — Node.js 24 + TypeScript end-to-end; Fastify + Socket.IO, SQLite (`better-sqlite3`), React + Vite control UI, vanilla display pages (see §3).
2. **OBS URL stability** — keep `/obs-main`, `/obs-mainfull`, `/obs-stage` as aliases of `/display/main`, `/display/full`, `/display/stage` (see §8).
3. **Content model** — set lists are the unit of work; named/dated, revisioned, editable without touching live; versioned songs/text/themes; detailed in [03-content-model.md](03-content-model.md).
4. **Set list export/import** — reference JSON plus self-contained bundle with media, preview/conflict handling, never touching live; defined in [03-content-model.md §12](03-content-model.md#12-set-list-export--import).
5. **Container target** — single process, single writable volume, one port; runs on Docker, Podman (rootless), Incus and LXC; detailed in [05-container-deployment.md](05-container-deployment.md).
6. **Song resources** — provider abstraction with manual import as the guaranteed path; ChordPro parsing, PDF score and guitar-tab assets, and a dedicated musician UI; SongSelect access only where CCLI permits it. Detailed in [06-songselect-and-scores.md](06-songselect-and-scores.md).
7. **Dashboard layout editor** — open-source, self-hosted: `react-grid-layout` + `@dnd-kit/core` for the grid, Yjs + y-websocket for collaborative editing; no cloud services. Detailed in [08-dashboard-layout-editor.md](08-dashboard-layout-editor.md).

Outstanding (sample files tracked in [04-sample-files.md](04-sample-files.md)):

1. **Sample songs** — real OpenLP, ChordPro and plain-text files are present; more score/tab examples are welcome.
2. **Bible licensing** — the schema is known from the samples; confirm the translations are licensed for local display/storage.
3. **SongSelect access** — existing partner/API credentials, website-only subscription, or both? Has CCLI confirmed any assisted retrieval is permitted?
4. **Score assets** — which PDF types/keys, and are guitar tabs expected from SongSelect, another licensed provider, or manual upload?
5. **Authentication** — local user accounts (default assumption), one shared operator password, or SSO via reverse proxy?
6. **Musician access** — named account with `musician` role, shared service link, or both; view-only vs print/download?
7. **Visual design** — reproduce the current look (ClearSans/Oxygen, vw sizes, transparent main) or start fresh with themes?
8. **Live apply semantics** — confirm `after-current` as the default and `now` as an explicit override.
9. **Export scope** — revision-level only in v1, or also full history/archive and CSV/print?
10. **Container specifics** — Incus OCI mode vs system container; writable image uploads; TLS via proxy; outbound access for providers.
11. **Dashboard editor** — personal + shared layouts, whether simultaneous co-editing is needed at launch, which widgets each role may add, and whether pages are user-editable.

Implementation can start now; only additional score/tab fixtures and provider access details are outstanding.
