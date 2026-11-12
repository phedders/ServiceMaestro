# Song resources, site downloads, scores and guitar tabs

Design for bringing SongPro, lead-sheet, chord, lyric and score files into the song library, and for presenting ChordPro, PDF scores and guitar tabs to musicians.

> Implementation status: ChordPro import, per-song asset uploads (PDF/ChordPro/lyrics/image), authenticated asset serving, the musician PDF viewer and the SongSelect drop-folder watcher are implemented. Encrypted per-user site credentials are implemented. The SongSelect adapter is implemented and verified live for search, lyrics, ChordPro, lead-sheet PDF and vocal-sheet PDF downloads. Other site adapters are not implemented yet.

## 1. Scope and constraints

- Service Maestro does not expose or redistribute song content outside the church's licensed use.
- Each church remains responsible for using an authorised SongSelect account and complying with CCLI and SongSelect terms.
- Never bypass a paywall, share accounts, or run bulk background crawling.
- Manual file import and the drop folder remain available regardless of whether a site adapter is configured.
- Site access is user-initiated; downloaded assets are private to the configured Service Maestro instance.

## 2. Site scraping framework

The framework separates credentials, provider metadata and site-specific download logic.

### Artifact kinds

| Kind | Purpose |
| --- | --- |
| `songpro` | SongPro / SongPro-style source file |
| `chord` | ChordPro download |
| `lead` | Lead sheet PDF |
| `vocal` | Vocal sheet PDF |
| `lyrics` | Lyrics text file |

### Credentials

Credentials are resolved in this order:

1. **Per-user credentials** saved by the signed-in Service Maestro user.
2. **Server-level fallback credentials** from the main config file or environment.

Personal credentials override the server fallback. They are encrypted with AES-256-GCM before being written to SQLite and are never returned to the browser. Usernames may be shown back to their owner for identification; passwords and session cookies are write-only. SongSelect uses CCLI’s central login with a browser challenge, so the working adapter uses a signed-in session cookie rather than replaying the password.

The encryption key comes from `SM_SECRET_KEY`. If it is omitted, Service Maestro generates `secret.key` in the data directory with owner-only permissions. Back up that file with the rest of the data volume; losing it makes saved site credentials unreadable.

### Server-level fallback

```yaml
songScraping:
  provider: songselect
  baseUrl: https://songselect.ccli.com
  username: example@church.org
  password: ${SONG_SITE_PASSWORD}
  # Optional alternative to username/password:
  # cookie: "session-cookie-value"
```

Environment variables take precedence:

| Variable | Purpose |
| --- | --- |
| `SM_SONG_SCRAPING_PROVIDER` | Provider id; defaults to `songselect` |
| `SM_SONG_SCRAPING_BASE_URL` | Base URL for the download site |
| `SM_SONG_SCRAPING_USERNAME` | Server fallback username |
| `SM_SONG_SCRAPING_PASSWORD` | Server fallback password |
| `SM_SONG_SCRAPING_COOKIE` | Server fallback session cookie |
| `SM_SECRET_KEY` | Master key for encrypted credentials |

`_FILE` variants are supported for secret values.

### Capturing a browser session cookie

SongSelect uses CCLI’s central login and a browser challenge, so password-only automation is not reliable. Sign in normally in a desktop browser, then copy the **Cookie request header** for a SongSelect request.

**Chrome, Edge, Chromium, Vivaldi**

1. Sign in at <https://songselect.ccli.com/>.
2. Open Developer Tools (`F12`, `Ctrl+Shift+I`, or `Cmd+Option+I`).
3. Open the **Network** tab and filter for `GetProfileDetails`.
4. Reload the page if the request is not listed.
5. Select the `api/user/GetProfileDetails` request.
6. In **Headers → Request Headers**, find **Cookie** and copy its value.
7. If the header is collapsed, use **Show more**; you can also right-click the **Cookie** header and choose **Copy value**.

**Firefox**

1. Sign in at <https://songselect.ccli.com/>.
2. Open **Tools → Browser Tools → Web Developer Tools** (`F12` or `Ctrl+Shift+I`).
3. Open the **Network** tab and reload the page.
4. Select the `GetProfileDetails` request.
5. In **Headers → Request Headers**, copy the complete **Cookie** value.

**Alternative: Application/Storage panel**

In Chromium DevTools, **Application → Storage → Cookies → https://songselect.ccli.com** lists the cookies. The Network request header is preferred because it includes HttpOnly cookies and gives the exact `name=value; name=value` format the adapter expects. If you copy individual cookies, include every session/auth cookie for the CCLI domains and join them with `; `.

### Storing the cookie

Paste the copied header into **Settings → My account → Song site credentials → Session cookie** for a personal credential, or into the server-level fallback:

```yaml
songScraping:
  provider: songselect
  baseUrl: https://songselect.ccli.com
  cookie: 'name=value; other=name=value'
```

For containers, prefer a secret file:

```text
SM_SONG_SCRAPING_COOKIE_FILE=/run/secrets/songselect-cookie
```

### Cookie security and expiry

- Treat the cookie like a password: it grants access to the signed-in account until it expires or is revoked.
- Never commit it, paste it into tickets/chat, include it in screenshots, or store it in shared notes.
- The local `data/config.yaml` is git-ignored, but backups of that file must still be protected.
- Prefer **Settings → My account** (encrypted at rest) or a Docker/container secret over a plaintext config file.
- The cookie will expire or may rotate. If search/download reports that the session is not signed in, repeat the capture above.
- Signing out of SongSelect in the browser can invalidate the cookie.
- Remove personal credentials with **Remove** in the account panel. For server-level credentials, delete the cookie from the config file and restart the service.

### Adapter interface

A site adapter receives resolved credentials and a request, then returns downloaded files. It does not read credentials directly from the database.

```ts
interface SiteScraperAdapter {
  id: string;
  search(input: {
    credentials: SiteScraperCredentials;
    query: string;
  }): Promise<SiteScraperSearchResult[]>;
  download(input: {
    credentials: SiteScraperCredentials;
    song: SiteScraperSearchResult;
    kinds: Array<"songpro" | "chord" | "lead" | "vocal" | "lyrics">;
  }): Promise<
    Array<{
      kind: "songpro" | "chord" | "lead" | "vocal" | "lyrics";
      filename: string;
      mime: string;
      data: Buffer;
      sourceUrl?: string;
    }>
  >;
}
```

### SongSelect adapter (implemented and verified)

The adapter uses the signed-in session cookie and these confirmed endpoints:

```text
GET  /api/user/GetProfileDetails
POST /api/GetSongSearchResults
GET  /api/GetSongDetails?songNumber=…&slug=…
GET  /api/GetSongChordPro?songNumber=…&key=…&style=Standard&columns=1
GET  /api/GetSongLeadPdf?songNumber=…&transposeKey=…&…&renderer=pipeline
GET  /api/GetSongVocalPdf?songNumber=…&transposeKey=…&…&renderer=pipeline
```

Confirmed output formats:

- Lyrics → UTF-8 `.txt` generated from the song-details payload.
- Chords → the **Download ChordPro** content (`.cho`), not the chord PDF.
- Lead → PDF.
- Vocal → PDF.
- Multiple selected kinds are bundled as a ZIP.

Adapters should:

- log in only when a session cookie is missing or expired;
- rate-limit requests and stop on authentication failures;
- avoid storing secrets in logs;
- use a descriptive user-agent and obey the site's terms;
- return files with stable, safe filenames;
- distinguish lead sheets, chord charts and lyric files by content/metadata, not just folder names.

### Account UI

**Settings → My account → Song site credentials** lets each user:

- see whether personal or server credentials will be used;
- save a username/password or session cookie;
- remove personal credentials and fall back to the server set;
- see the artifact kinds supported by the provider.

**Songs → Song site downloads** searches the configured site and offers an eye-button lyric preview plus **Lyrics**, **ChordPro**, **Lead PDF**, **Vocal PDF**, **All files** and **Import all**. Downloads are saved through the browser. **Import all** creates or updates the local song by CCLI number, attaches the ChordPro/lyrics/PDF files as song assets and saves the song so the files appear in the musician view whenever the song is used in a set list. Administrators do not see other users' passwords or cookies.

## 3. SongSelect drop folder

Service Maestro watches a local folder for downloadable lyrics/text files:

- Default folder: `/data/imports/songselect` (`SM_SONGSELECT_WATCH_DIR`).
- The watcher scans every `SM_SONGSELECT_WATCH_INTERVAL` seconds (default 10).
- It strips CCLI legal/metadata lines, expands inline `[Verse 1] first line` labels into proper section headings, removes `//`/divider lines, and imports the song.
- It tracks each file and SHA-256 in `songselect_watch_files`, updates songs when a re-download changes the same file, and skips title/CCLI duplicates.
- Settings → **SongSelect drop folder** shows the path, watcher status, pending files and recent results, with **Scan now** and **Force rescan** actions.
- The watcher is independent of site credentials. A future adapter can write downloaded text/ChordPro files here, while PDFs are attached as song assets.

## 4. ChordPro import

The sample set contains 102 SongSelect ChordPro files (CRLF, UTF-8, one song in multiple keys). They differ from the textbook format in important ways; the importer handles both.

### Metadata directives observed

`title`, `subtitle`, `artist`, `composer`, `copyright`, `ccli`, `ccli_license`, `key`, `capo`, `tempo`, `time`, `duration`, `footer`, `alternate_title`, `source`, `notes`, `keychange`, `checked`, `verified`, plus order variants `verse_order`, `verse-order`, `verse_order2`, `verse_oder`, `verse_order_fuse`.

- `{ccli}` is the song number; `{ccli_license}` is the church's licence number.
- `{footer}` is the legal footer — store it as licensing metadata, never render it as lyrics.
- `{checked}`/`{verified}` are internal review notes.
- `{keychange}` marks a modulation; keep it as metadata and warn if it affects later sections.
- Unknown directives stay in the raw source and are reported, never dropped.

### Sections and verse order

These files do not use `{start_of_chorus}`. Sections are marked with `{comment: V1}`, `{comment: Chorus 1a}`, `{comment: Pre-Chorus}`, `{comment: Intro}`, etc., and order is given by a verse-order directive:

```text
{verse_order: V1 T V2 T V3 Int V4 E O}
{verse-order: Intro Verse1 Chorus Verse2 Interlude Bridge Chorus Ending}
```

Requirements:

- Treat a `{comment}` as a section label when it matches the verse order or a known section pattern (`V1`, `Verse 1`, `C`, `Chorus`, `B`, `Bridge`, `T`, `Turnaround`, `I`, `Intro`, `E`, `Ending`, `O`, `Outro`, `P`, `Pre-Chorus`, `Tag`, `Instrumental`, …); otherwise keep it as a note.
- Normalize aliases: `Verse1` ≡ `Verse 1` ≡ `V1`; `Chorus1` ≡ `Chorus 1` ≡ `C1`; `Pre-Chorus` ≡ `P`; `C1A` ≡ `C1a`; case-insensitive matching.
- Preserve the raw verse order and the normalized arrangement; warn when a token has no matching section or a section is unreferenced.
- Support `verse_order2`, `verse_oder`, `verse_order_fuse` as alternate arrangements.
- If no order is present, use source order and mark it as implicit.

### Chords and musical tokens

- Inline chords: `[C]`, `[G/B]`, `[B5]`, `[E2]`, `[G#m7]`, `[N.C.]`; slash chords are supported.
- Bar/repeat markers appear in brackets and are not chords: `[|]`, `[||:]`, `[:||]`. Keep them as rhythm/bar tokens in the chords view or strip them from lyric text; never transpose them.
- Chord-only lines belong to the following lyric line; chord spacing is approximate and may include multiple spaces for alignment.
- Chords may be lowercase or use unusual suffixes; preserve unknown tokens and flag them.

### Normalization rules

- Decode UTF-8 (with/without BOM) and normalize CRLF/CR to LF.
- Merge consecutive `{comment}` labels into one section; blank lines end the section body.
- Duplicate labels are allowed; section identity is by occurrence, and arrangements reference section ids.
- Keep the raw ChordPro file as an asset; parse into the structured model (sections, lines, chord positions) for editing/display.
- Strip trailing body text that merely repeats `CCLI Song #…`, `© …` and the legal footer.
- Filenames carry a key suffix but are not reliable; read `{key}` and use the filename only as a hint. Multiple files for the same song in different keys are one library song with multiple key-specific sources/assets, deduplicated by CCLI song number and title+authors.
- Support `{new_page}` / `{column_break}` / `---` as explicit breaks.

### Output

- The parsed model drives the editor, stage and congregation outputs, so transposition and pagination stay consistent.
- The song editor can export ChordPro again; the original file is retained for fidelity.
- Validation surfaces: unknown directives, unmatched verse-order tokens, chord tokens that are really bar markers, duplicate/ambiguous section labels, key mismatches, and missing CCLI metadata.

## 5. PDF scores

### Observed samples

The first PDFs are A4, 2-page, selectable-text PDFs:

- `songselect-score/…-vocal-D.pdf` — vocal score (melody, lyrics, chords).
- `songselect-tabs/…-lead-D.pdf` — lead sheet. This is not guitar tablature, despite the folder name; label asset types from metadata, not folder names.

Future PDFs may be scanned images or have no text layer, so the viewer must not depend on text extraction.

### Storage and access

- Asset path: `/data/assets/songs/<songId>/<sha256>.<ext>` (never a user-supplied path).
- Signed, short-lived URLs for the viewer; no directory listing; no unauthenticated static serving.
- Metadata: key, score type (lead sheet / chord chart / vocal / full score / other), page count, source, external id, licence note, checksum, size.
- Multiple scores per song are allowed (different keys, arrangements, publishers).

### Viewer

- PDF.js bundled locally (no CDN), rendered in the musician UI.
- Page navigation, jump-to-page, zoom, fit width/page, rotate, fullscreen, print/download (if enabled by an admin), remember last page per user.
- Tablet-friendly controls; keyboard shortcuts; dark background.
- If no score exists for the selected key, show available keys, then fall back to the transposed ChordPro/lyrics with a warning — never silently show the wrong key.
- Scores are for the musician UI only; they are not sent to congregation outputs.

### Musician UI

- Route `/musicians` (role `musician`, or a scoped service link).
- Shows the current service/set list, current and next item, and one-tap access to the score PDF, ChordPro view, tabs and item notes.
- Big touch targets, works on tablets, optional PWA/offline cache of the current service's assets.
- Readiness indicator for set-list items missing score/tab assets.

## 6. Guitar tabs

- Asset kind `guitar_tab`; formats: text/ASCII, PDF or image.
- Text tabs use a monospace viewer with font size, wrap toggle, fullscreen and print; chord tokens can be transposed, but fret numbers/tablature are never transposed.
- PDF/image tabs use the same viewer as scores.
- Multiple tab versions per song are allowed, with a label and key/capo metadata.
- Sources: manual upload/paste, a `{start_of_tab}` block in ChordPro, or a licensed download adapter.
- The current `songselect-tabs` sample is a lead sheet, not tablature; real tab samples are still needed to validate the text-tab viewer.
- Search/filter by `has tab`; tabs attach to a song version or song head, and can be pinned in a set list.

## 7. Data model additions

```sql
-- Encrypted site credentials, one row per user/provider.
site_credentials (
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  username TEXT,
  secret_encrypted TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, provider)
);

-- Drop-folder watcher state.
songselect_watch_files (
  path TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  song_id TEXT,
  message TEXT,
  processed_at TEXT NOT NULL
);

-- Per-song assets.
song_assets (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL,
  kind TEXT NOT NULL,           -- score_pdf | guitar_tab | chordpro | lyrics | image
  title TEXT NOT NULL,
  key TEXT,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  source TEXT,
  source_url TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
```

Site credentials are local to the server and are not written to the shared Git repositories.

## 8. Security and operations

- Encrypt secrets at rest; never log passwords, cookies or decrypted payloads.
- Keep the encryption key (`SM_SECRET_KEY` or `data/secret.key`) outside backups that are shared publicly.
- Downloaded files retain their licensing metadata and are served only to authenticated users.
- Site adapters must handle expired sessions by prompting for credentials rather than retrying indefinitely.
- Optional outbound HTTPS is only needed when a site adapter is used. Manual import and the drop folder work offline.
- If a site changes its markup or withdraws access, disable the adapter and keep downloaded assets available under the licence.

## 9. Delivery phases

1. **Done:** manual ChordPro/OpenLP/text import, song assets, viewer, drop-folder watcher.
2. **Done:** encrypted per-user site credentials, server fallback configuration and adapter interface.
3. **Next:** implement the SongSelect download adapter, map artifact kinds to song assets and add a review/import dialog.
4. **Later:** additional site adapters, richer score metadata, readiness reporting and usage export.
