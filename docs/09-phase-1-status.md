# Phase 1 status — walking skeleton

Implemented and verified on 2026-11-10. This is the working foundation described in [02-architecture.md §14](02-architecture.md#14-phased-delivery).

## What runs

```sh
npm install
npm run build
WLM_ADMIN_PASSWORD='change-me' npm start
# http://localhost:8080
```

- Login: seeded `admin` / `WLM_ADMIN_PASSWORD`.
- Displays: `/display/main`, `/display/full`, `/display/stage` (and `/obs-*` aliases), `?token=dev-output`.
- Docker image builds and runs as UID 10001; health check passes.

## Implemented

| Area | What is in place |
| --- | --- |
| Auth | Local users, scrypt hashes, DB-backed sessions, HTTP-only cookie, roles (`admin`, `editor`, `operator`, `musician`, `viewer`) |
| Songs | Create/edit/list/delete; title, author, key, CCLI, copyright, lyrics with inline `[C]` chords and `[Verse 1]` labels |
| Library import | Folder scan for OpenLP XML, ChordPro and plain text; preview + warnings; duplicate CCLI/title skip; OpenLP `verseOrder` and ChordPro comment sections honoured; legal footers/bar markers removed |
| Bible | Schema detection for MyBible `book`/`verse`, BibleDb `books`/`verses` and JSON; sanitised verses; translation/book/chapter/from-to UI; **Add to current setlist** and **Add to live session** |
| Scores/tabs | Per-song asset upload (PDF, ChordPro, lyrics, image); authenticated file route; standalone `/musicians` service list with lyrics, notes and PDF.js viewer (page nav, zoom, fit-to-width) |
| Set lists | Named/dated services; songs and text items; arrow/drag-handle reorder; inline preview then edit title, lyrics/text, key, transpose, verse order and notes; song edits local by default with **Save to song library**; published revisions |
| Display config | Live-page font/colour/size/max-lines panel; styles apply to main/two-thirds, stage/chords fixed; max lines drives page splitting |
| Export/import | Reference JSON and self-contained ZIP bundles (songs/text/assets); preview then import as a new draft, with song matching by CCLI/title |
| Git local persistence | Songs/setlists written to local Git repos and committed; `autoSave`/`autoPush` configurable (default true); optional remotes, startup import/export, pull interval; Bibles repo optional (LFS in container) |
| Live sessions | Snapshot-on-start; starts blank; page selection shows/fades; item selection only queues pages; publish/apply after-current or now; queued updates survive restarts; next/prev, page/item navigation, blank, transpose, max lines, footer, quick text || Display templates | main, two-thirds, full, stage, chords; HTML/CSS lookup from set-list repo, templates folder/repo or built-ins; fade in/out |
| Rich text | First-line/front-matter `type: markdown|html|rst|text`, sanitised render, page breaks |
| Outputs | Vanilla HTML/CSS/JS; snapshot-on-connect over Socket.IO; transparent main, full-screen, stage with chords; legacy `/obs-*` aliases |
| Dashboard | Page temporarily hidden from navigation — its widgets changed live output and need a safer design. Layout service remains for later work. |
| Rendering | Server-side page splitting, chord transposition (slash chords), HTML escaping, section labels |
| Container | Multi-stage Dockerfile, Compose, non-root user, health check, read-only-root-friendly layout |

## API summary

```
POST /api/auth/login | logout          GET  /api/auth/me
GET/POST/PATCH/DELETE /api/songs…
GET/POST/PATCH/DELETE /api/setlists…  POST /api/setlists/:id/items
POST /api/setlists/:id/items/:itemId/save-to-inventory
POST /api/setlists/:id/reorder       GET /api/setlists/:id/revisions
POST /api/setlists/:id/publish
GET  /api/setlists/:id/export        POST /api/setlists/import[/preview]
GET  /api/live                        POST /api/live/start
POST /api/live/command                POST /api/live/quick-text
POST /api/live/apply                  POST /api/live/stop
GET/PUT/POST /api/dashboard/layout…
GET  /api/bible/translations|books|chapter|passage
POST /api/bible/reload
GET  /api/songs/:id/assets          POST /api/songs/:id/assets (multipart)
GET  /api/assets/:id/file           DELETE /api/assets/:id
GET  /musicians                      standalone read-only musician view
```

Socket.IO: `live:snapshot` events to `control` and `outputs` rooms; commands over REST (socket commands also accepted).

## Deliberate Phase 1 shortcuts

- **Set list revisions** are represented by the **live session snapshot** rather than a full revision table. Editing a set list cannot affect a running service; publishing/applying revisions is still to come.
- **One shared output token** (`WLM_OUTPUT_TOKEN`), no per-output tokens or presence yet.
- **One seeded admin**; user management UI is not built.
- **Song versions/arrangements** are not yet immutable; a song has one lyrics field plus a verse-order override.
- **Dashboard** is temporarily hidden from the navigation because its widgets changed live output; its personal-layout service remains for a safer Phase 2 redesign.
- **Chord rendering** is inline (chords above the following syllable in the stage view); a proper two-row chord layout is a later refinement.
- **No CSRF tokens** or per-output auth yet; do not expose the app directly to the public internet.

## Verification

```sh
npm run typecheck
npm run build
npm test          # render, importer, Bible, verse-order, text-format, page-marker and transfer tests (22 tests)
```

Manual smoke test used: login → create song → create set list → add song/text → drag items by handle and arrows → click item preview to edit title/lyrics locally → save to song library → start live (blank) → show/select page (reveals and fades) → display `/display/two-thirds` and `/display/chords` from templates → configure font/colour/size/max-lines (main/two-thirds only) → markdown quick text with page markers → Bible add to current setlist and add to live session → restart server (state restored) → scan/import 146 sample files (135 imported, 11 duplicates skipped) → Bible translation/book/chapter/range → upload vocal/lead PDF assets → standalone `/musicians` set list list, lyrics and PDF.js viewer/zoom/page nav → publish revision → apply after-current/now → export JSON/bundle → import as new draft with assets → local Git repos created and committed → restart with a fresh DB rebuilt songs/set lists from Git → Docker build/run.

## Next

1. Git asset persistence, remote sync hardening and conflict UI.
2. Immutable song versions/arrangements.
3. Dynamic text themes.
4. Dashboard palette/publish, then Yjs co-editing.
5. SongSelect provider and CCLI reporting.
6. ChurchSuite planning sync (pending working API credentials) — see [10-churchsuite-sync.md](10-churchsuite-sync.md).
