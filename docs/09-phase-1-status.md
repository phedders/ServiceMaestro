# Phase 1 status — walking skeleton

Implemented and verified on 2026-11-10. This is the working foundation described in [02-architecture.md §14](02-architecture.md#14-phased-delivery).

## What runs

```sh
npm install
npm run build
SM_ADMIN_PASSWORD='change-me' npm start
# https://localhost:8080  (self-signed certificate generated in data/ssl unless supplied)
```

- Login: seeded `admin` / `SM_ADMIN_PASSWORD`.
- Displays: `/display/lowerthird`, `/display/full`, `/display/stage` and `/display/chords` (with `/display/twothirds`, `/display/main`, `/display/lower`, `/display/fullscreen` and `/display/mainfull` aliases), `?token=dev-output`. A read-only listener on `SM_DISPLAY_PORT` (default `8081`) serves only the `/display/*` tree; `/obs-*` compatibility aliases remain on the control port.
- Docker image builds and runs as UID 10001; health check passes.

## Implemented

| Area | What is in place |
| --- | --- |
| Auth | Local users, scrypt hashes, DB-backed sessions, HTTP-only cookie, roles (`admin`, `editor`, `operator`, `musician`, `viewer`) |
| Songs | Create/edit/list/delete; title, alternative titles, author, key, CCLI, copyright, lyrics with inline `[C]` chords and `[Verse 1]` labels; optional inline Markdown styling; multiple saved verse orders; add to current setlist or live session |
| Library import | Folder scan for OpenLP XML, ChordPro and plain text; preview + warnings; duplicate CCLI/title review with skip/replace/duplicate (editable title and alternative titles); OpenLP `verseOrder` and ChordPro comment sections honoured; legal footers/bar markers removed |
| Bible | Schema detection for MyBible `book`/`verse`, BibleDb `books`/`verses` and JSON; sanitised verses; translation/book/chapter/from-to UI; **Add to current setlist** and **Add to live session** |
| Scores/tabs | Per-song asset upload (PDF, ChordPro, lyrics, image); authenticated file route; standalone `/musicians` service list with lyrics, notes and PDF.js viewer (page nav, zoom, fit-to-width) |
| Images | Folder-tree browser for `SM_IMAGES_DIR`, global search, upload from Images page or set-list editor, image set-list items rendered on live outputs, safe output-token file serving |
| Set lists | Named/dated services with compact `YYYYMMDD` dates and `YYYYMMDD-` default names; songs and text items; arrow/drag-handle reorder; inline preview then edit title, lyrics/text, format, alignment, key, transpose, verse order and notes; song edits local by default with **Save to song library**; **Send to live session** when the set list is live; published revisions |
| Display config | Live-page font/colour/size/max-lines/max-words/smart-page-split panel; styles apply to lower-third/centered two-thirds, stage/chords fixed; 1080p coverage estimate avoids overflow |
| Fonts/settings | Settings page imports Google Fonts by family/URL; CSS and woff2 cached in `/data/fonts`; ChurchSuite credential status and connection test; Git repository status plus runtime auto-commit/auto-push/pull-interval/merge settings; configurable live keyboard shortcuts; global page-boundary navigation setting |
| ChurchSuite | Planning API credentials and connection test; dedicated ChurchSuite page lists published/draft plans by date, previews service items, matches local songs by title/alternative title and creates draft set lists with text placeholders for unmatched service items |
| Export/import | Reference JSON and self-contained ZIP bundles (songs/text/assets); preview then import as a new draft, with song matching by CCLI/title |
| Git local persistence | Songs/setlists written to local Git repos and committed; `autoSave`/`autoPush` configurable (default true); optional remotes, startup import/export, pull interval; Bibles repo optional (LFS in container) |
| Live sessions | Snapshot-on-start; starts blank; page selection shows/fades; item selection only queues pages; **+** appends an item’s pages to the current live queue without changing the set list; publish/apply after-current or now; queued updates survive restarts; next/prev, page/item navigation, blank, transpose, max lines, footer, quick text |
| Display templates | main, two-thirds, full, stage, chords; HTML/CSS lookup from set-list repo, templates folder/repo or built-ins; fade in/out |
| Rich text | Format dropdown (Markdown default, plain, HTML, RST); legacy headers extracted into metadata; per-item left/centre alignment; inline page markers or multiple page boxes; sanitised render, page breaks |
| Song presentation | Optional inline Markdown styling ignored on stage/chords; SongSelect/SongPro `-` split-word joins on presentation views |
| Outputs | Vanilla HTML/CSS/JS; snapshot-on-connect over Socket.IO; transparent main, full-screen, lyrics-only stage and chord view; output-only `/display/socket.ro.io`; read-only display listener with all assets under `/display/*`; legacy `/obs-*` aliases on the control port |
| Help | Built-in operator guide covering quick start, live control, publishing, content types, OBS output URLs, current shortcuts and troubleshooting |
| Layout | Collapsible sidebar, optional top-bar navigation, automatic top-bar layout on small screens |
| Dashboard | Page temporarily hidden from navigation — its widgets changed live output and need a safer design. Layout service remains for later work. |
| Rendering | Server-side page splitting by lines/words with smart 1080p estimates, chord transposition (slash chords), HTML escaping, section labels |
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
GET  /api/fonts                      POST /api/fonts/import      DELETE /api/fonts/:id
GET  /api/integrations/churchsuite/status
POST /api/integrations/churchsuite/test
GET  /api/integrations/churchsuite/plans[/:id/items]
GET  /api/songs/:id/assets          POST /api/songs/:id/assets (multipart)
GET  /api/assets/:id/file           DELETE /api/assets/:id
GET  /musicians                      standalone read-only musician view
```

Socket.IO: `live:snapshot` events to `control` and `outputs` rooms; commands over REST (socket commands also accepted).

## Deliberate Phase 1 shortcuts

- **Set list revisions** are represented by the **live session snapshot** rather than a full revision table. Editing a set list cannot affect a running service; publishing/applying revisions is still to come.
- **One shared output token** (`SM_OUTPUT_TOKEN`), no per-output tokens or presence yet.
- **One seeded admin**; user management UI is not built.
- **Song versions/arrangements** are not yet immutable; a song has one lyrics field plus a verse-order override.
- **Dashboard** is temporarily hidden from the navigation because its widgets changed live output; its personal-layout service remains for a safer Phase 2 redesign.
- **Chord rendering** is inline in the chords view; the stage view shows lyrics only. A proper two-row chord layout is a later refinement.
- **No CSRF tokens** or per-output auth yet; do not expose the app directly to the public internet.

## Verification

```sh
npm run typecheck
npm run build
npm test          # render, importer, Bible, verse-order, text-format, page-marker, smart-split and transfer tests (29 tests)
```

Manual smoke test used: login → create song → add named verse orders and inline Markdown metadata → import/export song and set-list metadata → create set list → add song/text with a legacy format header → edit format and verse order → drag items by handle and arrows → click item preview to edit title/lyrics locally → save to song library → start live (blank) → show/select page (reveals and fades) → display `/display/two-thirds`, `/display/stage` and `/display/chords` from templates → configure font/colour/size/max-lines/max-words/smart splitting → verify long Bible text wraps into multiple pages and split words join on main/stage but stay split on chords → markdown quick text with page markers → Bible add to current setlist and add to live session → import Google Font and verify local CSS/font files under `/data/fonts` → toggle sidebar/top-bar layout → ChurchSuite status/test with configured credentials → restart server (state restored) → scan/import sample songs → upload vocal/lead PDF assets → standalone `/musicians` set list list, lyrics and PDF.js viewer/zoom/page nav → publish revision → apply after-current/now → export JSON/bundle → import as new draft with assets → local Git repos created and committed → restart with a fresh DB rebuilt songs/set lists from Git → Docker build/run.

## Next

1. Git asset persistence, remote sync hardening and conflict UI.
2. Immutable song versions/arrangements.
3. Dynamic text themes.
4. Dashboard palette/publish, then Yjs co-editing.
5. SongSelect provider and CCLI reporting.
6. ChurchSuite planning sync refinement (review/override mappings, re-sync diffs) — see [10-churchsuite-sync.md](10-churchsuite-sync.md).
