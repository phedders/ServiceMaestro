# SongSelect integration, ChordPro, scores and guitar tabs

Design for pulling song resources from CCLI SongSelect into the library and presenting ChordPro, PDF scores and guitar tabs to musicians.

> Implementation status: ChordPro import, per-song asset uploads (PDF/ChordPro/lyrics/image), authenticated asset serving and the musician PDF viewer are implemented. A watched-folder import is implemented for CCLI SongSelect downloader output; automated SongSelect search/download itself remains opt-in/not built, per the constraints below.

> **Important constraint (researched 2026-11):** CCLI has **retired the SongSelect API Partner Program and is not accepting new partners**; ChordPro downloads are reported to be available **directly on songselect.ccli.com** (Premium), not through the partner API, and the terms of use govern automated access. This design therefore treats SongSelect as a **pluggable provider** and defaults to **authorized/manual import**; no scraping or paywall bypass is part of the design. A church must use its own SongSelect subscription and comply with CCLI's terms.

References:

- CCLI SongSelect terms of use — <https://songselect.ccli.com/about/termsofuse>
- SongSelect Partner API (notice: program retired) — <https://documenter.getpostman.com/view/604633/TzseGkmA>
- SongSelect features / ChordPro — <https://ccli.com/songselect>
- ChordPro availability note — <https://www.worshipfuel.com/equip/songselect-chordpro-format-and-expanded-search-more-new-features/>

## 1. What this module does

- Search an external provider (SongSelect where permitted) from the song library.
- Preview metadata, keys and available resources.
- Import **ChordPro** into the structured song model.
- Download/store **PDF scores** (lead sheet, chord chart, vocal sheet, full score) and show them to musicians.
- Attach and display **guitar tabs** (text/ASCII, PDF or image).
- Keep licensing metadata, access control and CCLI usage reporting.

It does **not** publish or redistribute SongSelect content outside the church's licensed use, and it has no public/unauthenticated asset URLs.

## 2. Provider architecture

All external access sits behind one interface so the rest of the app is independent of SongSelect's availability or licensing model:

```ts
type Capability = 'search' | 'metadata' | 'chordpro' | 'score_pdf' | 'guitar_tab' | 'usage_report';

interface SongProvider {
  id: string;                          // songselect-api | manual | ...
  label: string;
  capabilities: Set<Capability>;
  status(): Promise<ProviderStatus>;   // configured / authorised / expired / disabled
  search(query: SearchQuery): Promise<ExternalSongSummary[]>;
  getSong(externalId: string): Promise<ExternalSongDetail>;
  listAssets(externalId: string, opts?: { key?: string }): Promise<ExternalAsset[]>;
  downloadAsset(asset: ExternalAsset): Promise<DownloadedAsset>;
}
```

Providers:

| Provider | Capabilities | Notes |
| --- | --- | --- |
| `songselect-api` | metadata, PDFs, usage (as permitted) | Only usable with existing partner/API credentials. Adapter is config-driven; not assumed available. |
| `songselect-session` | optional | **Feature-flagged and disabled by default.** A user-driven browser-assist flow, only if CCLI confirms it is permitted. No background crawling, no bulk export. |
| `manual` | chordpro, score_pdf, guitar_tab | Drag/drop, file picker, or watch folder; same import pipeline. Always available. |
| `local` | search | The app's own library (always searched first). |
| tab provider (future) | guitar_tab | Only with a licensed source; no scraping of tab sites. |

Capabilities drive the UI: if a provider cannot return ChordPro, the button is hidden rather than failing mid-flow.

### Normalised external model

```jsonc
{
  "provider": "songselect-api",
  "externalId": "123456",
  "title": "Amazing Grace",
  "authors": ["John Newton"],
  "copyright": "Public Domain",
  "ccliSongNo": "22025",
  "keys": ["G", "A"],
  "assets": [
    { "externalId": "a1", "kind": "chordpro", "key": null, "format": "text" },
    { "externalId": "a2", "kind": "score_pdf", "key": "G", "format": "pdf",
      "title": "Lead Sheet" },
    { "externalId": "a3", "kind": "guitar_tab", "key": "G", "format": "text" }
  ],
  "url": "https://songselect.ccli.com/songs/…"
}
```

## 3. Search and import flow

1. **Local-first search.** Typing searches the app library immediately; a provider search runs only when the operator explicitly selects "Search SongSelect" (avoids accidental external queries).
2. **Provider search** — query, page, filters (`has ChordPro`, `has score`, `has tab`, key). Results show title, authors, CCLI number, keys and availability badges.
3. **Preview** — metadata, which assets exist in which keys, license note.
4. **Add to library** — choose the key(s) and assets to fetch. A background job downloads and imports:
   - ChordPro → parsed into a new song version (sections, chords, arrangement) and stored as a raw asset.
   - PDF → stored as a key-specific score asset (no parsing).
   - Tab → stored as a tab asset (text/PDF/image).
5. **Deduplicate** — match existing songs by CCLI number, provider id, then title+authors; offer "attach assets to existing song" vs "import as new version".
6. **Report** — imported/attached/skipped, missing assets, license warnings. Failed downloads are retryable.
7. If no provider is configured, the same import dialog accepts **files from disk** (the compliant fallback).

### Watched folder fallback (implemented)

Service Maestro can watch a local folder for CCLI SongSelect downloader `.txt` output:

- Default folder: `/data/imports/songselect` (`SM_SONGSELECT_WATCH_DIR`).
- The watcher scans every `SM_SONGSELECT_WATCH_INTERVAL` seconds (default 10).
- It strips CCLI legal/metadata lines, expands inline `[Verse 1] first line` labels into proper section headings, removes `//`/divider lines, and imports the song.
- It tracks each file and SHA-256 in `songselect_watch_files`, updates songs when a re-download changes the same file, and skips title/CCLI duplicates.
- Settings → **SongSelect drop folder** shows the path, watcher status, pending files and recent results, with **Scan now** and **Force rescan** actions.
- This keeps credentials and the CCLI browser session outside Service Maestro.

Jobs are persisted in SQLite with progress, retries and rate limiting. No Redis required.

## 4. ChordPro import

The sample set now contains **102 SongSelect ChordPro files** (CRLF, UTF-8, one song in multiple keys). They differ from the textbook format in important ways; the importer must handle both.

### Metadata directives observed

`title`, `subtitle`, `artist`, `composer`, `copyright`, `ccli`, `ccli_license`, `key`, `capo`, `tempo`, `time`, `duration`, `footer`, `alternate_title`, `source`, `notes`, `keychange`, `checked`, `verified`, plus order variants `verse_order`, `verse-order`, `verse_order2`, `verse_oder`, `verse_order_fuse`.

- `{ccli}` is the **song number**; `{ccli_license}` is the church's **licence number**.
- `{footer}` is the SongSelect legal footer — store it as licensing metadata, never render it as lyrics.
- `{checked}`/`{verified}` are internal review notes.
- `{keychange}` marks a modulation; keep it as metadata (and warn if it affects later sections).
- Unknown directives stay in `raw_source` and are reported, never dropped.

### Sections and verse order

These files do **not** use `{start_of_chorus}`. Sections are marked with **`{comment: V1}`**, `{comment: Chorus 1a}`, `{comment: Pre-Chorus}`, `{comment: Intro}`, etc., and the order is given by a verse-order directive:

```
{verse_order: V1 T V2 T V3 Int V4 E O}
{verse-order: Intro Verse1 Chorus Verse2 Interlude Bridge Chorus Ending}
```

Requirements:

- Treat a `{comment}` as a **section label** when it matches the verse order or a known section pattern (`V1`, `Verse 1`, `C`, `Chorus`, `B`, `Bridge`, `T`, `Turnaround`, `I`, `Intro`, `E`, `Ending`, `O`, `Outro`, `P`, `Pre-Chorus`, `Tag`, `Instrumental`, …); otherwise keep it as a note.
- Normalize aliases: `Verse1` ≡ `Verse 1` ≡ `V1`; `Chorus1` ≡ `Chorus 1` ≡ `C1`; `Pre-Chorus` ≡ `P`; `C1A` ≡ `C1a`; case-insensitive matching.
- Preserve the **raw verse order** and the normalized arrangement; warn when a token in the order has no matching section, or a section is unreferenced.
- Support `verse_order2`, `verse_oder`, `verse_order_fuse` as alternate arrangements (expose them as named arrangements).
- If no order is present, use source order and mark it as implicit.

### Chords and musical tokens

- Inline chords: `[C]`, `[G/B]`, `[B5]`, `[E2]`, `[G#m7]`, `[N.C.]`; slash chords are supported.
- **Bar/repeat markers** appear in brackets and are not chords: `[|]`, `[||:]`, `[:||]`. Keep them as rhythm/bar tokens in the chords view or strip them from lyric text; never transpose them.
- Chord-only lines belong to the following lyric line; chord spacing is approximate and may include multiple spaces for alignment.
- Chords may be lowercase or use unusual suffixes; preserve unknown tokens and flag them.

### Normalization rules

- Decode UTF-8 (with/without BOM) and normalize CRLF/CR to LF.
- Merge consecutive `{comment}` labels into one section; blank lines end the section body.
- Duplicate labels are allowed; section identity is by occurrence, and arrangements reference section ids.
- Keep the raw ChordPro file as an asset; parse into the structured model (sections, lines, chord positions) for editing/display.
- Strip trailing body text that merely repeats `CCLI Song #…`, `© …` and the SongSelect footer (already available as metadata).
- Filenames carry a key suffix but are not reliable; read `{key}` and use the filename only as a hint. Multiple files for the same song in different keys are **one library song with multiple key-specific sources/assets**, deduplicated by CCLI song number and title+authors.
- Support `{new_page}` / `{column_break}` / `---` as explicit breaks, even though the sample set mostly relies on automatic pagination.

### Output

- The parsed model is what the editor, stage and congregation outputs use, so transposition and pagination stay consistent.
- The song editor can export ChordPro again (round-trip); the original file is retained for fidelity.
- Validation surfaces: unknown directives, unmatched verse-order tokens, chord tokens that are really bar markers, duplicate/ambiguous section labels, key mismatches, and missing CCLI metadata.

## 5. PDF scores

### Observed samples

The first SongSelect PDFs are A4, 2-page, selectable-text PDFs generated by IronPdf:

- `songselect-score/…-vocal-D.pdf` — vocal score (melody, lyrics, chords).
- `songselect-tabs/…-lead-D.pdf` — lead sheet. **This is not guitar tablature**, despite the folder name; the UI must label asset types from metadata, not folder names.

Future PDFs may be scanned images or have no text layer, so the viewer must not depend on text extraction.

### Storage and access

- Asset path: `/data/assets/songs/<songId>/<sha256>.<ext>` (never a user-supplied path).
- Signed, short-lived URLs for the viewer; no directory listing; no unauthenticated static serving.
- Metadata: key, score type (lead sheet / chord chart / vocal / full score / other), page count, provider, external id, license note, checksum, size.
- Multiple scores per song are allowed (different keys, arrangements, publishers).

### Viewer

- **PDF.js** bundled locally (no CDN), rendered in the musician UI.
- Page navigation, jump-to-page, zoom, fit width/page, rotate, fullscreen, print/download (if enabled by an admin), remember last page per user.
- Tablet-friendly controls; keyboard shortcuts; dark background.
- If no score exists for the selected key, show available keys, then fall back to the transposed ChordPro/lyrics with a warning — never silently show the wrong key.
- Scores are for the musician UI only; they are not sent to congregation outputs.

### Musician UI

- Route `/musicians` (role `musician`, or a scoped service link).
- Shows the current service/set list, current and next item, and one-tap access to:
  - the score PDF for the current key,
  - the ChordPro view (transposed, chords visible),
  - guitar tabs,
  - item notes and verse order.
- Big touch targets, works on tablets, optional PWA/offline cache of the current service's assets.
- "Readiness" indicator: which set list items are missing score/tab assets.

## 6. Guitar tabs

- Asset kind `guitar_tab`; formats: **text/ASCII**, **PDF**, **image**.
- Text tabs use a monospace viewer with font size, wrap toggle, fullscreen and print; chord tokens can be transposed, but fret numbers/tablature are **never** transposed (a warning explains this).
- PDF/image tabs use the same viewer as scores.
- Multiple tab versions per song are allowed (studio/live/acoustic), with a label and key/capo metadata.
- Sources: a provider capability, manual upload/paste, a `{start_of_tab}` block in a ChordPro file, or a future licensed tab provider. No scraping of tab sites is designed in.
- The current `songselect-tabs` sample is a **lead sheet**, not tablature; real tab samples are still needed to validate the text-tab viewer.
- Search/filter by `has tab`; tabs attach to a song version or song head, and can be pinned in a set list.

## 7. Data model additions

```sql
-- Provider configuration (one row per church/provider, not per user)
provider_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,                  -- songselect-api | songselect-session | ...
  label TEXT NOT NULL,
  credentials_enc BLOB,                    -- AES-256-GCM encrypted JSON/session
  status TEXT NOT NULL,                    -- configured | authorised | expired | disabled
  last_checked_at TEXT, last_error TEXT,
  created_by TEXT, created_at TEXT,
  UNIQUE(provider, label)
);

external_songs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL, authors_json TEXT, copyright TEXT,
  ccli_song_no TEXT, url TEXT, metadata_json TEXT,
  last_seen_at TEXT,
  UNIQUE(provider, external_id)
);

song_external_refs (
  song_id TEXT NOT NULL REFERENCES songs(id),
  external_song_id TEXT NOT NULL REFERENCES external_songs(id),
  match_confidence REAL, matched_by TEXT,
  PRIMARY KEY(song_id, external_song_id)
);

song_assets (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES songs(id),
  song_version_id TEXT REFERENCES song_versions(id),   -- optional
  kind TEXT NOT NULL,                                  -- chordpro | score_pdf | guitar_tab | lyrics | image
  format TEXT NOT NULL,                                -- text | pdf | png | jpg
  key TEXT, capo INTEGER,
  title TEXT, label TEXT,                              -- "Lead Sheet", "Studio tab"
  provider TEXT, external_asset_id TEXT,
  path TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL, pages INTEGER,
  license_note TEXT,
  downloaded_at TEXT, created_by TEXT,
  visibility TEXT NOT NULL DEFAULT 'musicians'          -- musicians | operators | private
);

asset_jobs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL, external_asset_id TEXT,
  song_id TEXT, asset_id TEXT,
  status TEXT NOT NULL, progress INTEGER DEFAULT 0,
  error TEXT, requested_by TEXT,
  created_at TEXT, started_at TEXT, finished_at TEXT
);

usage_events (
  id TEXT PRIMARY KEY,
  service_session_id TEXT, song_id TEXT, ccli_song_no TEXT,
  used_at TEXT, report_status TEXT, report_reference TEXT
);
```

- Assets are immutable by checksum; replacing a file creates a new row.
- Deletion is soft while referenced by a pinned set list revision.
- `usage_events` feed CCLI reporting (manual export initially, official API if available).

## 8. API

```
GET    /api/providers                         capability/status list
POST   /api/providers/:id/connect             configure credentials (encrypted)
POST   /api/providers/:id/disconnect
GET    /api/providers/:id/search?q=&key=&has=chordpro|score|tab
GET    /api/providers/:id/songs/:externalId
GET    /api/providers/:id/songs/:externalId/assets
POST   /api/providers/:id/assets/:assetId/download   -> asset job
GET    /api/jobs/:id                          progress/result

GET    /api/songs/:id/assets                  grouped by kind/key
POST   /api/songs/:id/assets                  manual upload (multipart)
PATCH  /api/songs/:id/assets/:assetId         label/key/visibility
DELETE /api/songs/:id/assets/:assetId         soft delete
GET    /api/assets/:id/file                   signed, range-capable, auth required

GET    /api/musicians/services                current/recent services
GET    /api/musicians/services/:id            set list + assets readiness
POST   /api/usage/report                      CCLI export (CSV/JSON)
```

Rate limits apply per provider and per user; downloads are user-initiated or explicitly queued.

## 9. UI

- **Library → Songs**
  - search bar with a provider toggle ("My library" / "SongSelect") and filters for ChordPro, score, tab;
  - result cards with availability badges and key selector;
  - import wizard: choose key(s), assets, attach-to-existing vs new version; progress + report.
- **Song detail / editor**
  - tabs: Lyrics/ChordPro · Arrangements · Assets · Scores · Tabs · Versions;
  - raw ChordPro download/re-import; attach PDFs/tabs; set preferred keys.
- **Musicians**
  - service selector, song list, score viewer, ChordPro view, tab viewer, notes;
  - offline cache for the active service; print/download where licensed.
- **Control**
  - "musician readiness" per item (score/tab present, key available);
  - warnings when a set list uses a key with no score.
- **Settings → Integrations**
  - provider status, encrypted credentials, license/CCLI number, egress settings;
  - explicit explanation of authorized use and a link to CCLI terms.

## 10. Licensing, security and compliance

- Use only an authorized SongSelect account/subscription and the access method CCLI permits. Do not bypass paywalls, share accounts, or bulk-scrape.
- Credentials are encrypted at rest with a master key (`SM_SECRET_KEY` / file), never logged, and can be revoked.
- Assets are stored locally for the church's licensed use; access is limited to authenticated roles; URLs are signed and short-lived.
- No redistribution: no public links, no external sharing, no embedding in public pages.
- Record CCLI song number, usage date/service, and reporting status; export for CCLI reporting. Automated reporting only if an authorized API exists.
- Audit downloads, imports and asset access; rate-limit; honour provider retry/backoff.
- Admin can disable score download/print for musicians if the license requires view-only.
- Deleting a song/license removes or hides its assets according to policy and law.
- If CCLI changes or withdraws API access, the provider adapter is disabled with a clear status; cached assets remain available under the licence.

## 11. Container and network impact

- The integration requires **optional outbound HTTPS** (SongSelect/CCLI). Provide `HTTPS_PROXY`/`NO_PROXY`, an egress allow-list, and a global "offline mode" that disables providers but keeps cached assets.
- PDF.js and all viewer assets are bundled; no CDN.
- Assets live in `/data/assets` (writable, backed up, quota-controlled); large scores/tabs can dominate storage.
- Credentials/master key live in `/data` or a mounted secret; back them up separately from the DB.
- `/healthz` reports provider status without making external calls; an explicit "test connection" action does.
- The media/asset volume is included in backups and restore procedures.

## 12. Failure modes and UX

| Failure | Behaviour |
| --- | --- |
| Partner API unavailable/retired | Provider shows `unsupported`; manual import remains; existing assets unaffected. |
| Session/subscription expired | Status `expired`; prompt to re-authenticate; no background retries that could lock the account. |
| 2FA / interactive login required | Session-assist flow pauses for the user; never stores one-time codes. |
| Rate limited | Job backs off with visible retry time; no parallel hammering. |
| Asset missing for key | Show available keys; fall back to transposed ChordPro with a warning. |
| PDF too large / storage full | Reject with a clear error before download; keep existing assets. |
| Licence/terms changed | Admin banner; disable provider; export usage data. |
| Manual file unsupported | Validation report with line/format details; no partial import. |

## 13. Delivery phases

- **Phase 2 (song authoring)**: ChordPro import (file/manual) + PDF/tab asset upload + asset storage, in the song editor.
- **Phase 3 (text/themes)**: musician UI for scores/tabs/ChordPro, readiness indicators, signed asset serving, PDF.js viewer.
- **Phase 4 (Bible/images)**: unaffected, but shares the asset/media infrastructure.
- **Phase 6 (integrations, opt-in)**: SongSelect provider adapter — partner API if credentials exist; otherwise an explicitly permitted assisted flow or manual-only. CCLI usage reporting.
- If CCLI grants access/partnership earlier, the adapter can ship as soon as credentials are available.

## 14. Open questions

1. **SongSelect access** — does the church have (a) existing partner/API credentials, (b) a Premium/Advanced website subscription only, or (c) both? This determines whether automated search can exist at all.
2. **Permission** — has CCLI confirmed that any assisted/session-based retrieval is permitted? Without that, the module ships manual-import only.
3. **Asset scope** — which PDF types matter (lead sheet, chord chart, vocal sheet, full score) and which keys?
4. **Guitar tabs** — are these expected from SongSelect, another licensed provider, or manual upload? SongSelect's advertised resource set centres on lyrics/chords/lead/vocal sheets.
5. **Musician access** — named accounts/roles, a shared service link, or both? View-only vs print/download?
6. **CCLI reporting** — is CSV export enough, or is automated reporting required?
7. **Retention** — may downloaded assets be kept after a subscription lapses, or must they be removed?
