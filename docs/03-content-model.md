# Content model: set lists, songs, dynamic text and themes

Detailed design for the authoring side of Web Lyric Master, following the new requirements:

> Implementation status: set-list publish/apply-to-live with queued updates, per-item verse order and song verse-order overrides are implemented. Full immutable song versions/arrangements and dynamic text themes remain future work.

- **Everything is based around the set list for a service.**
- **Set lists are named and dated, and editing one must never affect the live/current service.**
- **A song editor** accepts text with optional embedded HTML, manages pages, embedded chords, and stores metadata for page/verse selection and order, default/preferred keys and chord transposition.
- **A dynamic text editor** for presentation aids, with HTML support and modular theming.

See [02-architecture.md](02-architecture.md) for the server/display architecture. This document defines the content model and the rules that make live-safe editing possible.

## 1. Core principle: definition vs live instance

A **set list** is the durable, named, dated definition of a service. A **live session** is an immutable snapshot of one revision of that set list, plus a small amount of mutable playback state (current item/page, blank/fade, etc.).

```
 Set list "2026-11-15 AM" (durable)
   ├── revision 1  (immutable)
   ├── revision 2  (immutable)
   └── revision 3  (head / draft)          ← editors work here

 Live session "Sunday AM"
   └── pinned revision 2                   ← the operator drives this
         + playback state (current item, page, blank, …)
```

Rules:

1. **The live session never reads the draft revision.** It pins an immutable revision at start.
2. **Every edit creates a new revision.** Editing a set list is always editing a draft; the live service is unaffected.
3. **Applying changes to live is explicit.** The editor shows *"Live is running revision 2; you are editing revision 3"* and offers:
   - **Apply after current item** (default, safe during a service) — the live queue is replaced from the next item onward; the currently displayed item is not cut.
   - **Apply now** — replace immediately, with a confirmation.
   - **Push single change** — e.g. update one song's key without touching the rest.
4. **Rehearsal is a live session too**, with `status = rehearsal`, so the same rules apply and switching to `live` is one action.
5. **Duplicate a set list** to create next week's service from this week's (`Copy to new date`). Duplication copies revisions' items but never the live state.
6. **Archiving, not deleting**, for anything referenced by a live session or history.

This gives the "edit without affecting live" guarantee by construction rather than by permissions alone.

## 2. Set list model

### Metadata

- `name` — required, free text (e.g. "Sunday AM", "Carols by Candlelight").
- `service_date` — required, local date; `service_time` optional (AM/PM services on the same day are separate set lists).
- `notes`, `location`, `tags` optional.
- `status`: `draft` | `ready` | `archived`.
- `created_by`, timestamps.

### Items

Ordered list; each item has a kind:

| Kind | References | Per-item settings |
| --- | --- | --- |
| `song` | song version + arrangement | key override, transpose, verse order override, max lines, notes |
| `text` | text item version | theme override, page breaks, notes |
| `bible` | translation + reference | from/to verses, translation, theme |
| `image` | image id | fit (`contain`/`cover`), background, notes |
| `placeholder` | — | title/notes only (e.g. "Sermon", "Offering") |

A **placeholder** is useful for service plans: it keeps the order meaningful without creating output. It is skipped by `next`/`prev` unless explicitly focused.

- Per-item **snapshot title** is stored for stable display even if the library entry is renamed later.
- **Same song twice** with different keys/arrangements is allowed.
- Deleting an item in the draft never removes it from the pinned live revision.

### Revision data

Each revision stores a full ordered item list (not a diff). Diffs are computed for the "what will change" preview when applying to live:

- added / removed / reordered items,
- key or arrangement changes,
- text/theme version changes,
- warnings (e.g. "song version is newer than the pinned one").

### Concurrency

- Each revision has a `revision_no`; edits require `If-Match: <revision_no>`.
- A revision can be exported and imported without touching other set lists or live sessions (see §12).
- Multi-user editing shows presence on the set list page ("Alice is editing").
- A stale write returns `409 Conflict` with a per-item diff rather than silently overwriting.
- Structural edits during a live service are allowed on the draft but never auto-applied.

## 3. Song model

### 3.1 Input and canonical form

The editor accepts **text with optional embedded HTML** and **embedded chords**. Input can be typed, pasted, imported from OpenLP/ChordPro files, or fetched through an authorized SongSelect provider; the original source is preserved alongside the normalized version. On save, the server normalizes it to a structured document:

```jsonc
{
  "sections": [
    {
      "label": "v1",
      "role": "verse",
      "lines": [
        {
          "parts": [
            { "text": "A", "chord": null },
            { "text": "mazing grace, how ", "chord": "G" },
            { "text": "sweet the sound", "chord": null }
          ]
        }
      ]
    }
  ]
}
```

Why structured, not raw HTML:

- transposition can rewrite chords without touching text or markup;
- page splitting can count lines reliably;
- the stage output can show chord positions;
- the main output can hide chords without a second document;
- HTML can be sanitized once.

**Chords are attached to a character position**, not stored as `<span>` soup. Rendering to HTML happens at display time, identically on every output.

### 3.2 Accepted chord syntaxes

- Inline `[C]` / `[G/B]` before a syllable: `A[C]mazing grace`.
- Inline `{C}` (alternate, for users who paste from other tools).
- Chord line above a lyric line:

  ```
  G       C        D
  Amazing grace, how sweet the sound
  ```

  The importer aligns chords to the nearest character in the lyric line.

Unknown chord tokens are kept as text and flagged in the validation panel; they are never silently dropped.

### 3.3 Embedded HTML

Allowed inline formatting inside lyric text:

- `b`, `i`, `u`, `em`, `strong`, `small`, `sup`, `sub`, `br`
- `span` with a small allow-list of classes (e.g. `soft`, `accent`)
- character entities

Disallowed: `script`, `style`, `iframe`, `object`, `link`, event handlers, inline `style` attributes, external URLs. Block-level tags (`div`, `p`, `h1`…) are not allowed inside a lyric line — they would break pagination; the editor converts pasted blocks into sections/lines. This is enforced server-side, not only in the editor.

### 3.4 Sections, pages and arrangements

- **Sections** have a label (`v1`, `c1`, `b1`, `intro`, `ending`), a role, and an order.
- Duplicate labels are allowed internally (unique section ids); display labels can repeat.
- **Default arrangement**: the ordered list of sections (`v1 c1 v2 c1 v3 c1 e1`).
- **Alternative arrangements** are named presets ("Full", "Short", "Acoustic", "Communion") with their own order and page breaks.
- A **set list item** picks an arrangement and may override the verse order for that item only.
- **Pagination**:
  - automatic: `max_lines` per page (per set list item, default from song metadata);
  - explicit breaks: `---` on its own line, or a per-section break marker in the editor;
  - explicit breaks win over automatic splitting;
  - the editor previews the resulting pages as slide thumbnails;
  - page boundaries are recomputed server-side whenever layout settings change, so all outputs agree.

### 3.5 Keys and chord translation

Metadata:

- `original_key` — the key the chords are written in (auto-detected, editable).
- `default_key` — the key the song is normally played in.
- `preferred_keys` — ordered list of usable keys for this arrangement (e.g. `["G","A"]`).
- `capo` — optional, shown as a hint on the stage output.
- `tempo`, `time_signature` — optional metadata.

Rules:

- The **written key** is the source of truth; everything else is derived.
- A set list item stores `key_override` (target key) or `transpose_semitones`. `key_override` is preferred because singers think in keys, not semitones.
- **Chord translation** in v1 = transposition by semitones, with correct handling of sharps/flats and slash chords (reuse the chord table from the current system, extended).
- Optional display modes (design decision): Nashville numbers (`1 4 5`) and Roman numerals (`I IV V`) derived from the target key. Keys are displayed on the stage output, not the congregation output.
- Transposition never mutates the stored song; it is applied at render time per set list item.
- The editor shows: original key, default key, preferred keys, and a "transpose to…" preview.

### 3.6 Song versions

Songs are versioned so a set list can pin exactly what was rehearsed:

- Editing and saving creates a new **immutable song version**.
- `songs.head_version_id` points at the latest.
- A set list item stores `song_version_id` (plus `arrangement_id`).
- If the library has a newer version, the set list editor shows *"New version available"* with a diff/preview; nothing changes until the item is updated.
- Deleting a song soft-deletes it; versions referenced by set lists remain resolvable.

### 3.7 Song editor UX

Layout (desktop):

```
┌──────────────┬──────────────────────────────┬────────────────────┐
│ Sections     │ Source editor                │ Preview / pages    │
│ v1  verse    │ (text + [C] chords + HTML)   │ slide thumbnails   │
│ c1  chorus   │                              │ 1920×1080 render   │
│ v2  verse    │  --------------------------  │                    │
│ b1  bridge   │  toolbar: chord, bold, …     │ page count, breaks │
└──────────────┴──────────────────────────────┴────────────────────┘
```

- **Paste from anywhere**: plain text, chord-over-lyrics, OpenLP XML, ChordPro.
- **Section detection**: blank lines → stanzas; `[Verse 1]`/`CHORUS` recognised; manual split/merge.
- **Chord tools**: detect chord lines, align to lyrics, chord palette, "remove chords", "show as Nashville".
- **Arrangement builder**: drag section chips into a verse order; save as named arrangement; set default.
- **Page controls**: max lines slider, insert/remove page breaks, live thumbnail preview, warnings for overlong lines.
- **Key controls**: original key detector + manual override, default key, preferred keys, transpose preview.
- **Metadata panel**: title, alternate title, authors, copyright, CCLI, language, tags.
- **Validation panel**: unknown chords, unsupported HTML, line overflow, unreferenced sections, duplicate labels.
- **Autosave draft** + explicit "Save version"; "Restore previous version".
- **Assets tab**: attach/download ChordPro, PDF scores and guitar tabs; set key/type/visibility (see §3.8).

### 3.8 Scores, tabs and external assets

Songs can carry non-lyric resources for musicians:

- **ChordPro** — the raw file (for fidelity/round-trip) plus the parsed version used by the editor/display.
- **PDF scores** — lead sheet, chord chart, vocal sheet or full score, usually key-specific.
- **Guitar tabs** — text/ASCII, PDF or image, with key/capo metadata.

Rules:

- Assets are attached to a song (optionally a song version), immutable by checksum, and never parsed as trusted HTML.
- A set list item pins the asset(s) available for that service/key; the musician UI shows the score for the current key, falling back to transposed ChordPro with a warning.
- Assets are licensed content: encrypted provider credentials, authenticated access, signed URLs, audit trail and CCLI usage reporting.
- External search/download is always through a provider adapter; manual upload is the guaranteed path when no authorized provider exists.

Full design: [06-songselect-and-scores.md](06-songselect-and-scores.md).

## 4. Dynamic text items

Purpose: announcements, liturgy, prayers, sermon points, notices — the "simple presentation aid" case.

### 4.1 Model

- `text_item` — title + metadata.
- `text_item_version` — immutable content snapshot:
  - `body_html` (sanitized),
  - optional `subtitle`, `footer`,
  - `theme_id` + `theme_version_id` (default theme for the item),
  - `page_breaks_json` (explicit breaks),
  - `created_by`, `created_at`.

Set list items reference a text item version and may override the theme version for that service only.

### 4.2 Editor

- **WYSIWYG** editor (TipTap/ProseMirror) for headings, bold/italic, lists, quotes, links (optional), and images; plus a **source/HTML view** for precise control.
- **Page breaks** via a visible break marker, rendered as slide separators; automatic splitting can be enabled with "keep headings with next block".
- **Slide thumbnails** for the whole item, with the theme applied.
- **Theme picker** with a 16:9 live preview.
- **Send preview** to a display output (operator-only) without adding it to the live set list.
- Same HTML allow-list as songs, plus block-level elements (`h1`–`h3`, `p`, `ul`, `ol`, `li`, `blockquote`, `hr`, `img` from managed media only). Scripts, styles, iframes and external URLs remain forbidden.

### 4.3 Why a separate editor (not just quick text)

The existing system has "quick text" (blank lines → pages). That stays as a shortcut, but authored text items add: named reuse, versioning, themes, explicit page control, and safe HTML. Quick text creates a transient `text_item` under the hood, so everything shares one renderer.

## 5. Themes (modular theming)

A theme is a **versioned, reusable presentation definition** used by text items (and later optionally by songs).

### 5.1 Theme structure

```jsonc
{
  "name": "Morning Welcome",
  "kind": "text",
  "tokens": {
    "colors": { "background": "#000", "text": "#fff", "accent": "#e0b34c" },
    "fonts":  { "heading": "ClearSans-Bold", "body": "ClearSans-Regular" },
    "sizes":  { "heading": "6vw", "body": "3.6vw", "footer": "2vw" },
    "spacing": { "padding": "6vw", "gap": "2vw" },
    "background": { "type": "color", "value": "#000" },
    "safeArea": "5%"
  },
  "layout": {
    "regions": ["background", "header", "body", "footer"],
    "slots": { "header": "{{title}}", "body": "{{body}}", "footer": "{{footer}}" },
    "modules": ["logo", "rule", "page-number"]
  },
  "css": "/* scoped, sanitized CSS */",
  "assets": { "logo": "media/logos/church.svg", "background": null }
}
```

- **Tokens** cover colors, fonts, sizes, spacing, background (color/gradient/image), alignment and safe area.
- **Layout** is a fixed set of regions with slots; **modules** (logo, rule, page number, background pattern) can be enabled/ordered per theme. This is the "modular" part without allowing arbitrary page templates.
- **CSS** is optional and admin-only. It is scoped to the theme root, `@import`/external `url()` are stripped, and it cannot include scripts or target other apps. Most users only touch tokens/modules.
- **Assets** (fonts, logos, backgrounds) are served locally from the media library; no external CDNs.

### 5.2 Theme lifecycle

- Built-in themes ship read-only; "Duplicate" creates an editable copy.
- Saving creates a new **immutable theme version**.
- Text item versions pin a theme version; set list items may override with another pinned version.
- Editing a theme never changes a live service until the change is explicitly applied (same rule as set lists).
- Import/export a theme as JSON; importing validates tokens/assets/CSS allow-list.

### 5.3 Rendering

- The server renders slots + sanitized content into the theme layout once per slide.
- The display client only applies the resulting sanitized HTML/CSS variables; no theme logic on the client.
- Themes are previewed at the real 16:9 canvas size so `vw` sizes behave like OBS.

## 6. Data model (revisioned)

```sql
-- Set lists ------------------------------------------------------------
setlists (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  service_date TEXT NOT NULL, service_time TEXT,
  location TEXT, notes TEXT, tags_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',         -- draft | ready | archived
  head_revision_id TEXT,
  created_by TEXT, created_at TEXT, updated_at TEXT
);

setlist_revisions (
  id TEXT PRIMARY KEY, setlist_id TEXT NOT NULL REFERENCES setlists(id),
  revision_no INTEGER NOT NULL, note TEXT,
  created_by TEXT, created_at TEXT,
  UNIQUE(setlist_id, revision_no)
);

setlist_items (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES setlist_revisions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,                            -- song | text | bible | image | placeholder
  title_snapshot TEXT NOT NULL,
  song_version_id TEXT, arrangement_id TEXT,
  key_override TEXT, transpose_semitones INTEGER DEFAULT 0,
  verse_order_override TEXT,
  text_version_id TEXT, theme_version_id TEXT,
  image_id TEXT, bible_ref_json TEXT,
  max_lines INTEGER, notes TEXT, style_json TEXT
);

service_sessions (
  id TEXT PRIMARY KEY,
  setlist_id TEXT REFERENCES setlists(id),
  revision_id TEXT REFERENCES setlist_revisions(id),
  name TEXT, status TEXT NOT NULL,               -- rehearsal | live | ended
  started_at TEXT, ended_at TEXT, created_by TEXT
);

-- Songs ----------------------------------------------------------------
songs (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, alternate_title TEXT,
  copyright TEXT, ccli TEXT, language TEXT,
  head_version_id TEXT, deleted_at TEXT,
  created_at TEXT, updated_at TEXT
);

song_versions (
  id TEXT PRIMARY KEY, song_id TEXT NOT NULL REFERENCES songs(id),
  version_no INTEGER NOT NULL,
  source_format TEXT, source_path TEXT, source_hash TEXT, raw_source TEXT,
  original_key TEXT, default_key TEXT, preferred_keys_json TEXT, capo INTEGER,
  tempo INTEGER, time_signature TEXT, metadata_json TEXT,
  created_by TEXT, created_at TEXT,
  UNIQUE(song_id, version_no)
);

song_sections (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES song_versions(id) ON DELETE CASCADE,
  label TEXT NOT NULL, role TEXT NOT NULL, position INTEGER NOT NULL,
  lines_json TEXT NOT NULL                        -- structured parts + chord positions
);

song_arrangements (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES song_versions(id) ON DELETE CASCADE,
  name TEXT NOT NULL, is_default INTEGER DEFAULT 0,
  section_order_json TEXT NOT NULL,
  page_breaks_json TEXT
);

-- Dynamic text ---------------------------------------------------------
text_items (
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  head_version_id TEXT, deleted_at TEXT,
  created_at TEXT, updated_at TEXT
);

text_item_versions (
  id TEXT PRIMARY KEY, text_item_id TEXT NOT NULL REFERENCES text_items(id),
  version_no INTEGER NOT NULL,
  body_html TEXT NOT NULL, subtitle TEXT, footer TEXT,
  theme_id TEXT, theme_version_id TEXT,
  page_breaks_json TEXT, metadata_json TEXT,
  created_by TEXT, created_at TEXT,
  UNIQUE(text_item_id, version_no)
);

-- Themes ---------------------------------------------------------------
themes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,  -- text | song | image
  builtin INTEGER DEFAULT 0, head_version_id TEXT,
  created_at TEXT, updated_at TEXT
);

theme_versions (
  id TEXT PRIMARY KEY, theme_id TEXT NOT NULL REFERENCES themes(id),
  version_no INTEGER NOT NULL,
  tokens_json TEXT NOT NULL, layout_json TEXT NOT NULL,
  css TEXT, assets_json TEXT,
  created_by TEXT, created_at TEXT,
  UNIQUE(theme_id, version_no)
);
```

`live_state` remains session-scoped and small:

```sql
live_state (
  session_id TEXT PRIMARY KEY REFERENCES service_sessions(id),
  current_item_id TEXT, item_index INTEGER, page_index INTEGER,
  max_lines INTEGER, key_override TEXT, transpose INTEGER,
  blank INTEGER DEFAULT 0, footer TEXT,
  version INTEGER NOT NULL, updated_at TEXT
);
```

Score/tab assets and provider tables (`song_assets`, `asset_jobs`, `provider_accounts`, `external_songs`, `song_external_refs`, `usage_events`) are defined in [06-songselect-and-scores.md §7](06-songselect-and-scores.md#7-data-model-additions). Assets are immutable by checksum and referenced from set list items by id.

## 7. API sketch

Set lists:

```
GET    /api/setlists?from=&to=
POST   /api/setlists                          { name, service_date, service_time }
GET    /api/setlists/:id                      head + revision list
POST   /api/setlists/:id/revisions            create draft from head
GET    /api/setlists/:id/revisions/:no
PATCH  /api/setlists/:id/revisions/:no        items/order/settings (If-Match)
POST   /api/setlists/:id/revisions/:no/apply-to-live  { mode: "after-current" | "now" }
POST   /api/setlists/:id/duplicate            { name, service_date, service_time }
POST   /api/sessions                          { setlist_id, revision_no, status }
```

Songs:

```
POST   /api/songs                             { title, source_text, metadata }
POST   /api/songs/:id/versions                save new immutable version
GET    /api/songs/:id/versions/:no
POST   /api/songs/:id/preview                 render pages for given key/max lines
CRUD   /api/songs/:id/versions/:no/arrangements
POST   /api/songs/import                      (later: sample-driven importers)
```

Text and themes:

```
POST   /api/text-items
POST   /api/text-items/:id/versions
POST   /api/text-items/:id/preview            render slides with theme
GET    /api/themes
POST   /api/themes                             create / duplicate
POST   /api/themes/:id/versions
POST   /api/themes/:id/preview
POST   /api/themes/import                      JSON, validated
```

Scores and providers:

```
GET    /api/songs/:id/assets                   ChordPro, PDFs, tabs (by kind/key)
POST   /api/songs/:id/assets                   manual upload / paste
GET    /api/providers/:id/search               authorized SongSelect search
POST   /api/providers/:id/assets/:asset/download
GET    /api/assets/:id/file                    authenticated, signed, range-capable
GET    /api/musicians/services/:id             service + score readiness
```

Provider access, licensing and failure handling are in [06-songselect-and-scores.md](06-songselect-and-scores.md).

Concurrency everywhere: `If-Match` on head/revision numbers; `409` with a diff payload. Set list export/import endpoints and file formats are defined in §12.

## 8. UI structure

```
Library
  Songs          song list + song editor + arrangements + versions + assets/scores
  Text           text items + editor + preview
  Themes         theme list + token/module editor + CSS (admin)
  Images
  Bible
  Providers      SongSelect/session status (authorized integrations only)

Musicians
  Services       current/recent set lists; current + next song
  Scores         PDF viewer, ChordPro view, guitar tabs, notes; offline cache

Set Lists
  Calendar/list  named + dated services; duplicate; archive; export/import (JSON or bundle)
  Editor         draft revision, drag/drop, live badge, diff preview, apply-to-live

Live (Control)
  Current service: pages, set list queue, quick text, next/prev, blank/fade
  "Edit service" creates/opens a draft — never mutates the pinned revision
  Read-only live set list; no structural editing here

Admin
  Users/roles, outputs/tokens, import/scan, provider credentials, settings
```

Roles:

- `admin` — users, themes, provider credentials, settings, scans.
- `editor` — library songs/text/themes, assets and set list drafts.
- `operator` — start/stop session, apply to live, drive playback, quick text.
- `musician` — view the service set list, scores, ChordPro and tabs for their role.
- `viewer` — read-only dashboards/preview.
- outputs — token-only access to display pages.

## 9. Edge cases and invariants

- **Live isolation**: no code path may mutate a pinned revision or a pinned song/text/theme version.
- **Import isolation**: an imported set list is always a new draft; import can never modify a pinned revision, start a session, or overwrite an existing library item without explicit confirmation.
- **Apply after current item** keeps the current item on screen; if the current item is removed in the new revision, the next `next` moves to the new queue.
- **Deleting** a song/text item/theme/version still referenced by a pinned revision is blocked (soft delete/archive).
- **Duplicate labels** are allowed; arrangements reference section ids, not labels.
- **Manual page breaks** always win; automatic splitting fills the remaining space.
- **Transposition** is display-only; stored chords never change.
- **Sanitization** happens on write *and* on render (defence in depth).
- **Time zone**: `service_date`/`service_time` stored with a configured IANA zone; rendered in local time.
- **Quick text** creates a text item + version behind the scenes, so pages/themes apply uniformly.
- **Bible and images** follow the same pinning rule when added to a revision.
- **Scores/tabs** are licensed assets: immutable, checksummed, authenticated, signed-URL access, and pinned in revisions; they are never served publicly or embedded in congregation output.
- **Key-specific assets**: if a score/tab is unavailable for the selected key, show the available keys and fall back to transposed ChordPro with a warning; never silently show a different key.
- **Guitar tabs**: chord symbols may be transposed; tablature fret numbers are never transposed, and the UI states why.
- **Provider failure** (expired session, retired API, rate limit, offline) never removes cached assets; it disables only new searches/downloads.

## 10. Revised delivery phases

> OpenLP, ChordPro, plain-text, Bible and first SongSelect/score samples are available; more score variants and real guitar-tab samples are still pending. These phases supersede §14 of the architecture where they differ.

1. **Set list foundation** — named/dated set lists, revisions, live sessions, draft vs pinned, apply-to-live; manual song/text items; display outputs with snapshot-on-connect; revision export/import (reference JSON); container image and deployment files.
2. **Song authoring + scores** — text/HTML/chord editor, pages, arrangements, keys/transposition, immutable versions; ChordPro import; PDF/tab assets and musician UI; importers when samples arrive.
3. **Dynamic text + themes** — text editor, page breaks, modular themes, theme versions, previews; self-contained bundle export/import.
4. **Bible + images** — SQLite adapters and reference UI; image scan/serve/output; bundle media.
5. **Production polish** — roles, presence, audit, backups, compatibility aliases.
6. **SongSelect integration (opt-in)** — authorized provider adapter, encrypted credentials, CCLI reporting; manual import remains the supported fallback. See [06-songselect-and-scores.md](06-songselect-and-scores.md).

## 11. Open decisions

1. **Live apply default** — confirm "after current item" as the default, with "apply now" as an explicit override.
2. **Song pinning** — confirm immutable versions pin into set lists (recommended) vs always following the latest library version.
3. **Chord translation scope** — semitone/key transposition only for v1, or also Nashville/Roman numeral display and capo hints.
4. **Theme CSS** — allow scoped admin CSS (recommended) or restrict to tokens/modules only.
5. **Authentication** — local accounts (default), shared operator password, or SSO.
6. **Export scope** — is revision-level export enough, or must "all revisions / archive" and CSV/print be in v1?
7. **SongSelect access** — partner/API credentials, website-only subscription, or both; has CCLI confirmed any assisted retrieval is permitted?
8. **Score assets** — which PDF types/keys, and are guitar tabs expected from SongSelect, another licensed provider, or manual upload?
9. **Musician access** — named `musician` accounts, a shared service link, or both; view-only or print/download?
10. **Licensing/reporting** — CCLI usage export only, or automated reporting where an authorized API exists; asset retention after a subscription lapses?

## 12. Set list export / import

Export/import serves four needs: **backup**, **moving a service between installs**, **reusing a set list as a template**, and **archiving past services** with their exact content. It must not weaken live isolation: an import always creates a **new set list draft** and never touches a running session or an existing set list by default.

### 12.1 Two formats

| Format | Extension | Contents | Use |
| --- | --- | --- | --- |
| Reference | `.wlm-setlist.json` | Set list revision + stable references (ids, versions, hashes), no embedded content | Fast share within the same server/backup; human-readable |
| Bundle | `.wlm-bundle.zip` | `manifest.json` + full song/text/theme resources + media files + checksums | Portable transfer, archive, restore to a different server |
| CSV (optional, later) | `.csv` | title, kind, order, key | Planning/spreadsheet and print workflows |

The reference format is the canonical schema; the bundle is a ZIP whose `manifest.json` is the same document plus a `resources` section pointing at files inside the archive.

### 12.2 Reference schema (v1)

```jsonc
{
  "format": "wlm.setlist",
  "formatVersion": 1,
  "exportedAt": "2026-11-10T14:30:00Z",
  "generator": "web-lyric-master/0.1.0",
  "timezone": "Europe/London",
  "scope": {
    "revisionNo": 3,
    "includeHistory": false,
    "selfContained": false
  },
  "setlist": {
    "id": "0c0f…",
    "name": "Sunday AM",
    "serviceDate": "2026-11-15",
    "serviceTime": "10:30",
    "location": "Main Hall",
    "notes": "Communion after the sermon",
    "tags": ["sunday", "communion"]
  },
  "items": [
    {
      "position": 0,
      "kind": "song",
      "titleSnapshot": "Amazing Grace",
      "songId": "7a1e…",
      "songVersionNo": 2,
      "arrangementName": "Default",
      "keyOverride": "A",
      "transposeSemitones": 2,
      "verseOrderOverride": null,
      "maxLines": 4,
      "notes": "Start quiet"
    },
    {
      "position": 1,
      "kind": "text",
      "titleSnapshot": "Welcome",
      "textItemId": "91bc…",
      "textVersionNo": 4,
      "themeId": "2d77…",
      "themeVersionNo": 3,
      "notes": ""
    },
    {
      "position": 2,
      "kind": "bible",
      "titleSnapshot": "John 3:16–21",
      "bible": { "translation": "NIV2011", "book": 43, "chapter": 3, "from": 16, "to": 21 }
    },
    {
      "position": 3,
      "kind": "image",
      "titleSnapshot": "Notices",
      "imageId": "aabb…",
      "settings": { "fit": "cover" }
    }
  ],
  "references": {
    "songs": [
      { "id": "7a1e…", "versionNo": 2, "title": "Amazing Grace", "contentHash": "sha256:…" }
    ],
    "textItems": [
      { "id": "91bc…", "versionNo": 4, "title": "Welcome", "contentHash": "sha256:…" }
    ],
    "themes": [
      { "id": "2d77…", "versionNo": 3, "name": "Morning Welcome", "contentHash": "sha256:…" }
    ],
    "images": [
      { "id": "aabb…", "filename": "2026/11/notices.png", "mime": "image/png", "sha256": "…" }
    ]
  },
  "checksum": "sha256:…"      // canonical JSON without this field, bundle: manifest checksum
}
```

Bundle layout:

```
wlm-bundle.zip
├── manifest.json                 # schema above + resources paths
├── resources/
│   ├── songs/<songId>-v<no>.json
│   ├── text/<textItemId>-v<no>.json
│   └── themes/<themeId>-v<no>.json
├── media/
│   ├── images/<sha256>.<ext>
│   └── fonts/<sha256>.<ext>      # only if theme ships fonts
└── checksums.sha256
```

Content resources use the same structures as the internal version objects, so restoring preserves arrangements, keys, sections, theme tokens and CSS exactly.

### 12.3 Export options

- **Revision** (default) — one revision, current draft or pinned live revision.
- **All revisions** — full history for audit/archive.
- **Template** — strips service date/time, clears notes optionally, and can regenerate ids; useful for "new service from this plan".
- **Self-contained** — include all referenced resources and media; otherwise references only.
- **Redact** — remove CCLI/copyright? (No — keep licensing metadata; optional redaction of internal notes only.)

Export is always allowed, including while live. The export is a snapshot and cannot affect state.

### 12.4 Import behavior

1. **Validate first** — schema, `formatVersion` major, size/entry caps, HTML sanitization, asset MIME/magic bytes, checksums, path traversal and symlink checks.
2. **Dry run / preview** — the UI and CLI show:
   - resources that will be created vs matched vs remapped,
   - set list items and any missing references,
   - warnings (newer schema, ignored fields, unsupported item kind).
3. **Match/remap resources** in this order:
   - by **id** if the same id exists and content hash matches → reuse;
   - same id, different content → create a new id (never silently overwrite);
   - by **content hash** → reuse as duplicate;
   - by **source path / title + author** (optional) → offer merge;
   - otherwise create new.
4. **Set lists are always imported as a new draft**:
   - new id, name suffixed `(imported)` if a name collision exists,
   - revision 1 (or full history if included),
   - never applied to a live session,
   - optional **shift to date** (e.g. next Sunday) and "use as template".
5. **Transactional write** — resources then set list in one DB transaction; media files staged and renamed; failures roll back and leave no half-import.
6. **Report** — imported/remapped/skipped counts, missing refs, new ids, warnings; downloadable JSON report and an audit entry.
7. **Bundle-only guarantees** — a bundle with all resources must import without any pre-existing library.

### 12.5 API and CLI

```
GET  /api/setlists/:id/export?revision=3&format=json|bundle&history=false
GET  /api/setlists/:id/revisions/:no/export?format=json|bundle
POST /api/setlists/import              multipart JSON/ZIP; ?dryRun=true
GET  /api/imports/:jobId               progress/report
POST /api/exports                      async bundle build for large media
GET  /api/exports/:jobId/download
```

```
wlm setlist export <id-or-name> --revision 3 --format bundle --out service.zip
wlm setlist import service.zip --dry-run
wlm setlist import service.zip --conflict copy --shift-to 2026-11-22
wlm backup --all --out backups/2026-11-10.zip
```

CLI runs in the same container (`docker exec` / `podman exec` / `incus exec`), reusing the same service layer as the API.

### 12.6 UI

- Set list list: **Export** action per row (JSON / bundle) and an **Import** button.
- Export dialog: revision or history, bundle vs reference, estimated size, download.
- Import wizard: drop file → validation report → conflict choices → date shift/template → import → result summary.
- A coloured banner warns if a live session exists; imports still only create drafts.
- The same export is offered from the live Control page for the pinned revision ("download what is running").

### 12.7 Security and limits

- Imported documents are **untrusted**: sanitize all HTML, reject scripts/styles/iframes, validate images by decoding headers, cap uncompressed size and entry count, reject nested/absolute/symlink paths.
- Bundles carry checksums, not signatures, in v1. Optional signing (e.g. Ed25519) can be added without changing the schema.
- Import is rate-limited and audited (who, filename, checksum, result).
- No import can start a live session or modify a pinned revision.
- Media is deduplicated by SHA-256; quotas apply to the media store.

### 12.8 Compatibility and testing

- `formatVersion` follows major.minor: same major imports; newer major is rejected with a clear message; older majors are migrated by explicit upgrade functions.
- Golden round-trip tests: export → import into an empty DB → export again → identical canonical JSON (ids remapped only where documented).
- Fixtures: reference JSON, bundle with images/fonts, malformed ZIP, zip bomb, HTML injection, conflicting ids, missing refs.
- Export doubles as the backup format for set lists; the container backup job also snapshots the database and media store (see [05-container-deployment.md](05-container-deployment.md)).

