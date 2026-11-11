# ChurchSuite Planning API analysis and sync design

Analysis of the ChurchSuite Planning API and a design for syncing upcoming services into Service Maestro set lists.

Source: <https://github.com/ChurchSuite/churchsuite-api/blob/master/src/planning.yaml> (OpenAPI 3.2.0, spec version **2.112.8**, base URL `https://api.churchsuite.com/v2`).

> **Credential test status (2026-11-11):** working. The current `.env` client credentials successfully obtain a `planning.read` token. The Planning API was explored against the real account:
>
> - Plans: 608 total plan records; published plans for 2026–2027 were retrieved.
> - Plan items and Planning types were retrieved.
> - This account primarily uses Planning **Worship** items (`type_id=4`, `ccli_tracking=true`) with song titles in `name` and `Key` / `Artist/Author` question responses, rather than `arrangement_id`/chart data.
>
> The ChurchSuite page now lists plans by date range, previews items, matches local songs by title/alternative title, and creates draft set lists; unmatched song and service items become editable text placeholders. Settings includes a global list of ChurchSuite plan object types that should become empty set-list items with no pages (seeded with Welcome, Misc, Countdown, Prayers and Announcement); their text is kept in the item notes.

## 1. What the API provides

The Planning module exposes read endpoints (and some write endpoints) for:

| Area | Endpoint | Use |
| --- | --- | --- |
| Plans | `GET /planning/plans` | List/filter services and events by date, status, site, name |
| Plan | `GET /planning/plans/{id}` | Plan metadata (date, time, site, status, identifier) |
| Plan items | `GET /planning/plan_items?plan_ids[]=…` | Running order for one or more plans |
| Songs | `GET /planning/songs`, `GET /planning/songs/{id}` | Song library (name, CCLI, copyright, administration) |
| Song arrangements | `GET /planning/song_arrangements`, `GET /planning/song_arrangements/{id}` | Versions of a song, with key, tempo, meter, **chart** |
| Library items | `GET /planning/library_items` | Non-song items (prayers, notices, etc.) |
| Templates | `GET /planning/templates`, `/template_items` | Reusable plan structures |
| Types | `GET /planning/types` | Categories for items |

Useful filters:

- `plans`: `starts_after`, `starts_before`, `status` (`draft`/`published`), `site_ids[]`, `q`, `order_by`, pagination (`per_page` max 250).
- `plan_items`: required `plan_ids[]`, `order_by=order:asc`, pagination.
- `songs`: `q` (name, CCLI, copyright, administration), `statuses[]`, `last_used_after`.
- `song_arrangements`: `song_ids[]`, `q`, pagination.

Rate limit: **120 requests per 60 seconds per account**, with `429` + `Retry-After`; handle backoff.

## 2. Authentication — what happened and what is needed

ChurchSuite supports two OAuth2 grants:

1. **Client Credentials** — for server-side apps using an **API-enabled user** secret. This is the right fit for Service Maestro.
2. **Authorization Code** — for OAuth Apps acting on behalf of a user, requiring a browser login, consent and a registered redirect URI.

The supplied identifier/secret was tried against:

```http
POST https://login.churchsuite.com/oauth2/token
Authorization: Basic <identifier:secret>
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=planning.read
```

Variants with `full_access`, no scope, and credentials in the body all returned the same `400 unauthorized_client`. This strongly suggests the credentials belong to an **OAuth App** (authorization-code only) rather than an API-enabled user, or that the API user does not have the client-credentials grant enabled.

To proceed, one of these is required:

- **Preferred:** an API-enabled ChurchSuite user’s identifier/secret (Account → Users → enable API access → My profile → Secrets), with permission to read Planning. `planning.read` is enough.
- **Alternative:** an OAuth App with a registered redirect URI and a user to complete the authorization-code consent flow (and ideally a refresh token).
- If the existing OAuth App is meant to support client credentials, ChurchSuite support may need to enable that grant for the client.

### Configuration (never in code)

Create `.env` next to `compose.yaml` (it is gitignored) and restart the container:

```sh
SM_CHURCHSUITE_CLIENT_ID=...          # or _FILE=/run/secrets/churchsuite_client_id
SM_CHURCHSUITE_CLIENT_SECRET=...      # or _FILE=/run/secrets/churchsuite_client_secret
SM_CHURCHSUITE_TOKEN_URL=https://login.churchsuite.com/oauth2/token
SM_CHURCHSUITE_SCOPES=planning.read
SM_CHURCHSUITE_API_URL=https://api.churchsuite.com/v2
SM_CHURCHSUITE_REDIRECT_URI=...       # authorization-code flow only
```

`docker compose` reads `.env` automatically and passes these values into the container. The
Settings page shows whether credentials are configured and has a **Test connection** button. The
exploration endpoints are:

```text
GET  /api/integrations/churchsuite/status
POST /api/integrations/churchsuite/test
GET  /api/integrations/churchsuite/plans?from=&to=&status=published
GET  /api/integrations/churchsuite/plans/:id/items
```

- Load from environment or Docker/Podman/Incus secrets; never bake into images, docs, logs or client-side code.
- Store the short-lived access token in memory only (or encrypted in SQLite until expiry); never log it.
- Rotate any secret that has been shared in chat. Use separate ChurchSuite credentials per environment.
- Request only `planning.read` unless two-way write-back is added later.

### `unauthorized_client` on client credentials

If the Settings page reports:

```text
ChurchSuite rejected the client_credentials grant.
```

the identifier/secret are almost certainly **OAuth App** credentials, which only support the
Authorization Code flow. Client Credentials requires a secret generated for an **API-enabled
ChurchSuite user**:

1. Log in as a user who can manage users/API settings.
2. Create or choose a least-privilege user with Planning read access.
3. Enable API access for that user, then log in as that user.
4. Open the profile and create an API secret.
5. Put that user's **identifier** and **secret** in `SM_CHURCHSUITE_CLIENT_ID` /
   `SM_CHURCHSUITE_CLIENT_SECRET` and restart.

The credentials currently in `.env` returned `unauthorized_client` for client credentials but
`invalid_grant` for a dummy authorization code, confirming they are OAuth App credentials rather
than an API-user secret.

## 3. Data model in the API

### Plan

Key fields:

- `id` (integer), `identifier` (string, stable public id), `name`
- `date` (`YYYY-MM-DD`), `time` (`HH:MM:SS`)
- `status`: `draft` | `published`
- `service_id`, `event_id`, `booking_id`, `template_id`
- `site_ids`, `all_sites`
- `modified_at` / `created_at`
- `note_categories` (named categories used on items)

### Plan item

- `id`, `plan_id`, `order`
- `type`: `song` | `item`
- `name` (display title)
- `arrangement_id` for songs, `library_item_id`/`type_id` for non-song items
- `duration`, `time_start`
- `settings`: `{ key, scale, tempo, meter }` — the **service key** for song items
- `notes`: array of `{ note_category_id, name, note }`
- `comment` (non-song items)
- `question_responses`: typed responses, including **Bible** (`book`, `version`, `reference`), Spotify, video, text, etc.
- `people` — personal data; **do not import unless needed**
- `created_at` / `modified_at`

### Song

- `id`, `name`, `ccli`, `copyright`, `administration`, `status`
- No lyrics/chart on the Song itself.

### Song arrangement

- `id`, `song_id`, `name`, `artist`
- `key`, `tempo`, `meter`, `scale`, `duration`
- **`chart`** — chords/lyrics, ChordPro-like (`VERSE 1:` headings, inline `[C]` chords)
- `spotify`, `links`
- Many arrangements can exist per song; names may equal the song name when unnamed.

## 4. Implications for syncing

1. **Plan items do not carry the song ID directly.** A song plan item has `arrangement_id`; fetch the arrangement to discover `song_id`, title, artist, key and chart. Plan item `name` is only a display string.
2. **The service key lives on the plan item** (`settings.key`), while the arrangement’s `key` is the default. Store the service key as the set-list item override.
3. **Charts are directly usable.** `chart` is close enough to ChordPro to import: section headings are uppercase lines (`VERSE 1:`) and chords are inline. The existing ChordPro parser can be extended for `VERSE 1:` headings and trailing `CCLI`/copyright text.
4. **Duplicate titles are expected.** The same song can have multiple arrangements, versions, keys and near-identical names. IDs are essential; titles alone are unsafe. A **matching dialog is mandatory**.
5. **Non-song items matter.** `type=item` entries (prayers, notices, readings, sermon) should become text placeholders or dynamic text items in the local set list, preserving order and notes.
6. **Bible references can be imported.** `question_responses` of type `bible` include `book` (abbreviation such as `JHN`), `version` (`ESV`) and `reference` (`3:16`). These can become Bible set-list items in a later phase.
7. **Personal data** (people assigned to items) should not be stored locally unless a specific need is agreed. Ignore/redact it.
8. **Time zones**: `date` and `time` are separate and carry no zone. Store the local church timezone in settings and treat plans as local wall time.

## 5. Sync workflow

```
Select upcoming plans
  → fetch plan + items
  → fetch arrangements (and songs if needed)
  → match each song item to a local song
  → review/adjust in the mapping dialog
  → create a DRAFT set list (never live automatically)
  → optionally apply to the running service after the current item
```

### Matching order

For each ChurchSuite song item (arrangement):

1. **Existing external mapping** — `provider=songselect/churchsuite`, arrangement/song ID. Reuse.
2. **CCLI number** — strongest automatic signal.
3. **Normalised title + artist** — exact after removing punctuation, case, key suffixes, “(live)”, “OHK”, etc.
4. **Normalised title only** — suggest, do not auto-link.
5. **Fuzzy title/artist** — trigram/Levenshtein with a confidence score; suggest candidates.
6. **No match** — create new song from the ChurchSuite chart, or create a placeholder.

Never auto-link ambiguous matches. Exact CCLI matches can be bulk-accepted; everything else needs confirmation.

## 6. Song-mapping dialog

A dedicated “Review ChurchSuite songs” dialog after choosing a plan:

```
┌────────────────────────────────────────────────────────────┐
│ Import “Sunday AM” — 15 Nov 2026                           │
│ 8 items · 5 songs · 2 unmatched                            │
├──────────────────────────────┬─────────────────────────────┤
│ CHURCHSUITE ITEM             │ LOCAL SONG                  │
│ 1. Amazing Grace             │ ● Linked: Amazing Grace     │
│    arr. “Amazing Grace”      │   CCLI 22025 · G            │
│    service key A · CCLI …    │                             │
│                              │                             │
│ 2. Blessed Assurance         │ ○ Exact CCLI match          │
│    arr. “Blessed Assurance…” │   Blessed Assurance (A)     │
│    key G                     │   CCLI 22324 · A            │
│                              │   [Use] [Choose another]    │
│                              │                             │
│ 3. Goodness of God (live)    │ ⚠ 3 possible matches        │
│    arr. “Goodness Of God”    │   Goodness Of God — Ab      │
│    key Ab                    │   Goodness Of God — Bb      │
│                              │   Goodness Of God — C       │
│                              │   [Select] [Create new]     │
│                              │                             │
│ 4. Sermon                    │ Non-song → placeholder      │
│    item · 30 min             │ [Keep as text placeholder]  │
└──────────────────────────────┴─────────────────────────────┘
[ ] Show unmatched only        [Auto-link exact CCLI]
                         [Cancel]  [Import draft set list]
```

Features:

- Show ChurchSuite **arrangement name/artist/key/CCLI** alongside candidates.
- Candidate rows show local title, author, CCLI, key(s), source/format and confidence.
- Actions per item: **Link** (selected candidate), **Create new from chart**, **Choose another**, **Skip**, **Placeholder**.
- “Remember this mapping” is implied by linking; store the external IDs.
- Bulk actions: auto-link exact CCLI, auto-link exact title+artist; still review.
- “Show unmatched only” and a final summary before import.
- Duplicate/version awareness: list all local versions with distinct keys/sources; never collapse them silently.
- On re-sync, show **changed items** (key changes, arrangement changes, added/removed items) and ask before updating the draft.
- The imported set list remains a draft; applying to live stays an explicit operator action (after-current/now).

## 7. Local data model additions

```sql
integration_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,                -- churchsuite
  label TEXT NOT NULL,
  credentials_enc BLOB,                  -- client id/secret or refresh token, encrypted
  access_token_enc BLOB,                 -- optional cached token
  token_expires_at TEXT,
  status TEXT NOT NULL,
  last_checked_at TEXT, last_error TEXT
);

external_plans (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,             -- plan id
  identifier TEXT,                       -- plan identifier
  name TEXT, date TEXT, time TEXT,
  status TEXT, modified_at TEXT,
  raw_json TEXT,
  last_fetched_at TEXT,
  UNIQUE(provider, external_id)
);

external_plan_links (
  setlist_id TEXT PRIMARY KEY REFERENCES setlists(id),
  external_plan_id TEXT NOT NULL REFERENCES external_plans(id),
  last_synced_at TEXT,
  external_modified_at TEXT
);

song_external_refs (
  id TEXT PRIMARY KEY,
  song_id TEXT NOT NULL REFERENCES songs(id),
  provider TEXT NOT NULL,                -- churchsuite
  external_song_id TEXT,
  external_arrangement_id TEXT,
  match_method TEXT,                     -- manual | ccli | title | imported
  confidence REAL,
  created_at TEXT,
  UNIQUE(provider, external_arrangement_id)
);

sync_runs (
  id TEXT PRIMARY KEY, provider TEXT,
  started_at TEXT, finished_at TEXT,
  status TEXT, report_json TEXT
);
```

- Reuse the existing `song_assets` table for imported ChurchSuite charts (`source='churchsuite'`).
- Store plan item notes as set-list item notes, excluding people/personal data by default.
- Add `external_plan_item_id` to `setlist_items` if re-sync diffing needs stable links.

## 8. API endpoints to add

```
GET  /api/integrations/churchsuite/status
POST /api/integrations/churchsuite/credentials     (server-side secret entry, encrypted)
POST /api/integrations/churchsuite/oauth/start      (authorization-code flow)
GET  /api/integrations/churchsuite/oauth/callback
POST /api/integrations/churchsuite/disconnect

GET  /api/integrations/churchsuite/plans?from=&to=&status=published&site=
GET  /api/integrations/churchsuite/plans/:id/preview
POST /api/integrations/churchsuite/plans/:id/import
POST /api/integrations/churchsuite/plans/:id/resync
```

Preview response (shape):

```jsonc
{
  "plan": { "id": 12, "identifier": "…", "name": "Sunday AM", "date": "2026-11-15", "time": "10:30:00" },
  "items": [
    {
      "externalItemId": 1, "order": 0, "type": "song", "name": "Goodness Of God",
      "arrangement": { "id": 31, "name": "Goodness Of God", "artist": "…", "key": "Ab", "ccli": "…", "songId": 5 },
      "serviceKey": "Ab",
      "matches": [
        { "songId": "…", "title": "Goodness Of God", "author": "…", "ccli": "…", "keys": ["Ab","A"], "confidence": 0.91, "method": "ccli" }
      ]
    }
  ]
}
```

Import body:

```jsonc
{
  "createDraft": true,
  "mappings": [
    { "externalItemId": 1, "action": "link", "songId": "…" },
    { "externalItemId": 2, "action": "create-from-chart", "importChart": true },
    { "externalItemId": 3, "action": "placeholder" },
    { "externalItemId": 4, "action": "skip" }
  ]
}
```

## 9. Re-sync and changes

- Store the plan’s `modified_at` and the imported item order.
- On re-sync:
  - fetch plan/items; compare to the stored mapping;
  - detect added/removed/reordered songs, arrangement/key changes, new notes;
  - show a diff; updating the draft is explicit;
  - applying to live remains the existing “after-current/now” action.
- Never overwrite a manually edited draft item without confirmation.
- Deleted/changed arrangements: show as unmatched and require a decision.

## 10. Security and personal data

- The ChurchSuite API exposes personal data (people assigned to items). The import should **ignore people** unless a future feature needs them.
- Store credentials/tokens encrypted with the app master key; support `_FILE` secrets for Docker/Podman/Incus.
- Never log tokens, secrets or raw personal data; redact API errors.
- Use `planning.read` only; add `planning.write` only if two-way sync is explicitly wanted.
- Rate-limit requests and honour `Retry-After`; cache plan/arrangement responses.
- Rotate the credential shared in chat, and use a dedicated least-privilege API user.
- ChurchSuite terms and data-protection policy apply; keep the sync server-side only.

## 11. Delivery phases

1. **Read-only import** — client credentials, upcoming plans, preview, mapping dialog, create draft set list.
2. **Mappings and re-sync** — persist external IDs, diff changes, update draft, apply-to-live integration.
3. **Charts and Bible items** — import arrangement `chart` as ChordPro/song asset; map Bible question responses to Bible set-list items.
4. **Scheduled sync** — optional periodic poll for new/changed plans with notifications; still never auto-live.

## 12. Open questions

1. Can the church create an **API-enabled user** for client credentials, or must we use an OAuth App (authorization code + redirect)?
2. Which sites / service types / date window should be synced by default?
3. Should **all** ChurchSuite songs be auto-created locally when unmatched, or only after the dialog?
4. How should duplicate arrangements be represented locally (one song with key versions, or separate songs)?
5. Should non-song items become placeholders, dynamic text items, or be ignored initially?
6. Should Bible question responses be imported automatically in phase 1?
7. Is the plan’s `settings.key` always authoritative over the arrangement key?
8. Auto-sync cadence: manual only, hourly, or on demand from the UI?
