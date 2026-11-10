# Sample files: received and needed

Real inputs are collected in `samples/` (git-ignored, so third-party lyrics/scores stay out of version control). The first batch is analysed below; add the missing formats as they become available:

```
samples/
├── openlp/                 OpenLyrics XML
├── chordpro/               bulk ChordPro downloads
├── songselect-chordpro/    SongSelect ChordPro download
├── songselect-text/        SongSelect lyrics text
├── songselect-score/       SongSelect vocal score PDF
├── songselect-tabs/        SongSelect lead-sheet PDF (not guitar tablature)
├── songselect-pdf/         other SongSelect PDFs (currently empty)
├── songs-text/             plain-text lyrics and notes
├── bible/                  SQLite + JSON translations
├── scores/                 additional score samples (currently empty)
├── tabs/                   guitar-tab samples (currently empty)
└── setlists/               existing playlist export (optional)
```

## What has arrived (2026-11-10)

- **OpenLP:** one OpenLyrics 0.8 file (`openlp/…Crown Him…xml`), no chords, with `verseOrder` and multiple titles.
- **ChordPro:** 102 SongSelect files in `chordpro/` plus a SongSelect download in `songselect-chordpro/` (multiple keys per song; `{comment: V1}` section labels, `verse_order` variants, CCLI metadata). `chordpro/node_modules/` is a local parser install, **not** input; the scanner ignores it.
- **SongSelect downloads:** a lyrics text file, a **vocal score PDF** and a **lead-sheet PDF**. The `songselect-tabs` file is currently a lead sheet, **not guitar tablature** — tell us if real tabs are expected.
- **Plain text:** ~40 files in `songs-text/` — mostly unlabelled lyrics, a few HTML study notes/sermon outlines (`Q20230621.txt`, `talk-20250928pm.txt`), which need import-as-text/skip handling.
- **Bible:** `NASB.sqlite`, `NET.sqlite`, `ESVGSB.SQLite3`, `NET.json` — two SQLite schema families plus a JSON export; analysed in [07-bible-sources.md](07-bible-sources.md).
- **Still needed:** actual guitar-tab samples, more score types/keys if available, an existing playlist/set-list export (optional), and SongSelect access details.

> Correction: the earlier **WordPro** requirement was a mistake for **ChordPro**. There is no WordPro parser or sample dependency.

The sections below remain the checklist for the missing formats.

## 1. Songs — OpenLP, ChordPro and plain text

### OpenLP (OpenLP-style XML)

- Export or copy real song files, exactly as the current system consumes them.
- If you know which flavour it is, note it in a `notes.txt`:
  - OpenLyrics (`<song><lyrics><verse name="v1">…`),
  - OpenLP's own song import XML,
  - or a custom schema.
- Include at least one song with **chords** and one with **multiple verses/chorus/bridge**, plus any copyright/CCLI fields you use.

### Plain text

- 2–3 files showing your conventions:
  - how stanzas are separated (blank lines?),
  - how sections are labelled (e.g. `[Verse 1]`, `CHORUS:`),
  - how chords are written (chord line above lyrics, inline `[C]`, or no chords),
  - any metadata header (title/author/copyright).

### ChordPro

- 2–3 `.cho` / `.chordpro` files downloaded from SongSelect or another source (as permitted by the licence).
- Note the directives your files use: `{key}`, `{capo}`, `{start_of_chorus}`, `{soc}`, `{new_page}`, `{comment}`, `{ccli}`, etc.
- Include one file with inline chords and one with a chord line above the lyrics if you have both.
- Note whether you also need ChordPro **export** (round-trip), or import only.

### Also useful

- A screenshot or export of how one song appears in the current Songs/Song Editor pages.
- A playlist file, if playlists are stored as files rather than in Node-RED context — our export/import format can be compared against it.
- One dynamic text item as used today (announcements, liturgy, notices), including any HTML or styling conventions.

## 2. Scores and guitar tabs

Received:

- `songselect-score/Before The Throne Of God Above-vocal-D.pdf` — vocal score, A4, 2 pages, selectable text.
- `songselect-tabs/Before The Throne Of God Above-lead-D.pdf` — **lead sheet** (melody + chords), A4, 2 pages. This is not guitar tablature.

Still useful:

- Actual **guitar tabs** in the formats you use: text/ASCII, PDF or image; note capo/key metadata.
- Additional score types/keys if you use them (chord chart, full score, different key).
- Say whether scores/tabs are downloaded from SongSelect, another licensed provider, or produced/uploaded by the team.
- Note whether musicians should be able to **print/download** or view only.
- Confirm your SongSelect subscription tier and whether you have (or could get) API/partner access. **Do not put account passwords in the samples folder** — we will design an encrypted connection flow.
- Include your CCLI licence/copyright details if usage reporting is required.

## 3. Bible — SQLite

- One real `.db` per translation you want first (e.g. `NIV2011.db`, `ESV.db`).
- If the files are large, a schema dump plus a few sample rows is enough:

```sh
sqlite3 NIV2011.db '.schema' > schema.sql
sqlite3 NIV2011.db "SELECT * FROM <verses-table> LIMIT 20;" > sample-rows.txt
```

- Tell us the table/column meanings if they are not obvious (book numbering, verse text encoding, testament/apocrypha handling).
- Note whether the DBs are read-only and where they live in production.

## 4. Display look (optional but helpful)

- Screenshots of the current main, full-screen and stage outputs at the real 1920×1080 canvas.
- Fonts currently used (ClearSans files were referenced at `/static/ClearSans-*.woff`).
- Footer text conventions and any lower-third layout requirements.
- Any theme/branding samples for dynamic text (logo, colours, background).

## 5. Deployment environment

- Which runtimes are in use: Docker, Podman (rootless?), Incus (system containers or OCI app containers?), plain LXC — and versions.
- Whether the app may write to the images directory (uploads) or it is curated on the host.
- Host paths and UID/GID expectations for bind-mounted data.
- Whether TLS is terminated by a reverse proxy, and the hostname users/OBS will use.

## 6. Answers we still need

- **Auth:** local user accounts (default), one shared operator password, or SSO via reverse proxy?
- **Visual design:** reproduce the current look or start fresh with themes?
- **Export scope:** revision-level export enough for v1, or also full history/archive and CSV/print?
- **Live apply:** confirm "apply after the current item" as the default, with "apply now" as an explicit override.
- **Integration scope for v1:** lyrics/Bible/images only, or also OBS scene/transition and QLC+ lighting cues?
- **SongSelect:** partner/API credentials, website-only subscription, or both; has CCLI confirmed any assisted retrieval is permitted?
- **Musician access:** named accounts/roles, shared service link, or both; view-only or print/download?

## What we will do with the samples

- Write parser tests against them and implement the importers (Phase 2).
- Implement the Bible adapter against the real schema (Phase 3).
- Keep the files in the git-ignored `samples/` directory; nothing is published or committed.
