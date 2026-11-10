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
| Bible | Schema detection for MyBible `book`/`verse`, BibleDb `books`/`verses` and JSON; sanitised verses; translation/book/chapter/from-to UI; display as quick text |
| Scores/tabs | Per-song asset upload (PDF, ChordPro, lyrics, image); authenticated signed-style file route; musician page with PDF.js viewer, page nav, zoom and fit-to-width |
| Set lists | Named/dated services; songs and text items; reorder; per-item key, transpose, max lines, notes |
| Live sessions | Snapshot-on-start; next/prev, page/item goto, blank, transpose, max lines, footer, quick text; persisted across restarts |
| Outputs | Vanilla HTML/CSS/JS; snapshot-on-connect over Socket.IO; transparent main, full-screen, stage with chords; legacy `/obs-*` aliases |
| Dashboard | `react-grid-layout`; pages, preview, set-list, transport and quick-text widgets; drag/resize; personal layout saved in SQLite; reset to default |
| Rendering | Server-side page splitting, chord transposition (slash chords), HTML escaping, section labels |
| Container | Multi-stage Dockerfile, Compose, non-root user, health check, read-only-root-friendly layout |

## API summary

```
POST /api/auth/login | logout          GET  /api/auth/me
GET/POST/PATCH/DELETE /api/songs…
GET/POST/PATCH/DELETE /api/setlists…  POST /api/setlists/:id/items
POST /api/setlists/:id/reorder
GET  /api/live                        POST /api/live/start
POST /api/live/command                POST /api/live/quick-text
POST /api/live/stop
GET/PUT/POST /api/dashboard/layout…
GET  /api/bible/translations|books|chapter|passage
POST /api/bible/reload
GET  /api/songs/:id/assets          POST /api/songs/:id/assets (multipart)
GET  /api/assets/:id/file           DELETE /api/assets/:id
```

Socket.IO: `live:snapshot` events to `control` and `outputs` rooms; commands over REST (socket commands also accepted).

## Deliberate Phase 1 shortcuts

- **Set list revisions** are represented by the **live session snapshot** rather than a full revision table. Editing a set list cannot affect a running service; publishing/applying revisions is still to come.
- **One shared output token** (`WLM_OUTPUT_TOKEN`), no per-output tokens or presence yet.
- **One seeded admin**; user management UI is not built.
- **No song versions/arrangements yet** — the importer normalises into the single lyrics field; set list revisions are next.
- **Dashboard** supports personal layouts only; widget palette, shared publishing and Yjs co-editing are Phase 2/3.
- **Chord rendering** is inline (chords above the following syllable in the stage view); a proper two-row chord layout is a later refinement.
- **No CSRF tokens** or per-output auth yet; do not expose the app directly to the public internet.

## Verification

```sh
npm run typecheck
npm run build
npm test          # render/transposition, importer and Bible adapter tests (12 tests)
```

Manual smoke test used: login → create song → create set list → add song/text → start live → display `/display/full` → next/previous/quick text → dashboard drag/save → restart server (state restored) → scan/import 146 sample files (135 imported, 11 duplicates skipped) → Bible translation/book/chapter/range → display passage → upload vocal/lead PDF assets → musician page PDF.js viewer/zoom/page nav → Docker build/run.

## Next

1. Song versions/arrangements and set list revisions + apply-to-live.
2. Dynamic text themes.
3. Dashboard palette/publish, then Yjs co-editing.
4. SongSelect provider and CCLI reporting.
