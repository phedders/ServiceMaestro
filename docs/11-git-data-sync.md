# Git-backed shared data (songs, set lists, Bibles)

Requirement: **song data and set lists live in folders that are checked into Git**, and the configuration specifies remote Git repositories for **songs**, **set lists** and (optionally) **Bibles**. Two independent instances can then use the same data: for example, a personal instance creates a set list, pushes it, and the church live system pulls it.

Repositories may be accessed over **SSH or HTTP(S) using a standard Git URI**; the URI itself selects the transport. The Bible repository is optional.

This document defines the storage model, sync behaviour, configuration and risks. It is a design; it is not implemented yet.

## 1. Principles

1. **Files are the source of truth.** Songs, set lists and Bibles are stored as files in their repositories. SQLite becomes an index/cache plus local live-session state, not the authoritative library.
2. **Separate repositories per data type.** Songs, set lists and Bibles have independent remotes, branches and permissions. Bibles are **optional** and normally read-only; when enabled they use **Git LFS**.
3. **Stable IDs.** Every song, set list, item and revision uses a UUID that survives export, import, Git pulls and instance changes. Titles are not identifiers.
4. **Pull before read/write; push after change.** Writes are committed locally and pushed when possible. Remote changes are pulled periodically; offline instances keep local commits and retry.
5. **Never force-push.** Conflicts are surfaced, not discarded. Live sessions are pinned to a specific revision/commit and are unaffected by later pulls.
6. **No secrets in repository content.** Credentials may be supplied in a standard remote URI or via SSH keys; they live only in the mounted configuration/secrets, are never committed, and are redacted from logs and API responses.

## 2. Repository layouts

### Songs repository

```
songs/
  <song-id>.json
  assets/
    <song-id>/
      <sha256>.<ext>          # PDF scores, tabs, ChordPro originals, images
manifest.json?                 # optional repository metadata/version
```

`<song-id>.json`:

```jsonc
{
  "schemaVersion": 1,
  "id": "a8e0…",
  "title": "Amazing Grace",
  "author": "John Newton",
  "copyright": "Public Domain",
  "ccli": "22025",
  "key": "G",
  "verseOrder": "V1 C V2 C",
  "lyrics": "[Verse 1]\nA[C]mazing grace…",
  "source": { "format": "chordpro", "path": "chordpro/amazing-grace-G.txt" },
  "assets": [
    { "id": "…", "kind": "score_pdf", "title": "Lead sheet", "key": "G",
      "path": "assets/a8e0…/3f2c….pdf", "sha256": "3f2c…", "mime": "application/pdf" }
  ],
  "createdAt": "…", "updatedAt": "…"
}
```

- Assets live beside songs so one clone carries lyrics and scores.
- Large PDFs are usually small; if the repo grows, enable Git LFS for `assets/**` (see §8).
- Deletions are soft: `"deletedAt"` plus a tombstone, or remove the file and record the tombstone in a `deleted/` index; a hard delete can be resurrected by another instance otherwise.

### Set lists repository

```
setlists/
  <setlist-id>.json              # current draft/head
  revisions/
    <setlist-id>/
      <revision-no>.json         # published immutable revision
  deleted/
    <setlist-id>.json            # tombstones, optional
```

`<setlist-id>.json`:

```jsonc
{
  "schemaVersion": 1,
  "id": "7c1e…",
  "name": "Sunday AM",
  "serviceDate": "2026-11-15",
  "serviceTime": "10:30",
  "notes": "",
  "items": [
    {
      "id": "item-uuid",
      "position": 0,
      "kind": "song",
      "songId": "a8e0…",
      "titleSnapshot": "Amazing Grace",
      "keyOverride": "A",
      "transpose": 2,
      "maxLines": 4,
      "verseOrder": "V1 C V2 C",
      "notes": ""
    },
    {
      "id": "item-uuid-2",
      "position": 1,
      "kind": "text",
      "title": "Welcome",
      "content": "Welcome to church.",
      "maxLines": 4,
      "notes": ""
    }
  ],
  "updatedAt": "…",
  "updatedBy": "user-or-instance"
}
```

- Item order is explicit (`position`).
- Song references use stable song IDs; the songs repository must be pulled first.
- Published revisions contain the **resolved snapshot** (song lyrics/metadata as of publish) so a set list remains reproducible even if the song changes later.
- The local live session stores the revision ID and commit SHA it pinned.

### Bibles repository

```
bible/
  NASB.sqlite
  NET.sqlite
  NET.json
  ESVGSB.SQLite3
```

- Read-only for the application; the instance may fetch/pull but must not rewrite.
- Git LFS is recommended because SQLite files are 10–25 MB each and Git history grows quickly.

## 3. Configuration

Prefer a mounted config file (for example `/config/config.yaml`) with environment overrides. Remotes use **standard Git URIs**; the transport is selected by the URI scheme.

```yaml
git:
  enabled: true
  workDir: /data/repos
  author:
    name: Web Lyric Master
    email: wlm@example.local
  pullIntervalSeconds: 60
  pushDebounceSeconds: 2
  conflictPolicy: fail        # fail | keep-local | keep-remote
  sshKeyFile: /run/secrets/git_ssh_key
  knownHostsFile: /run/secrets/git_known_hosts

repositories:
  songs:
    remote: git@github.com:oakhall/songs.git
    # or: ssh://git@github.com:22/oakhall/songs.git
    # or: https://x-access-token:<token>@github.com/oakhall/songs.git
    branch: main
    path: /data/repos/songs
    mode: read-write
  setlists:
    remote: git@github.com:oakhall/setlists.git
    branch: main
    path: /data/repos/setlists
    mode: read-write
  bibles:
    optional: true             # app runs normally without this repo
    remote: git@github.com:oakhall/bibles.git
    branch: main
    path: /data/repos/bibles
    mode: read-only
    lfs: required              # required | auto | off
```

### Remote URI forms

| Transport | Example | Notes |
| --- | --- | --- |
| SSH (scp-like) | `git@github.com:oakhall/songs.git` | Uses `sshKeyFile` + `knownHostsFile` |
| SSH URL | `ssh://git@git.example.org:2222/oakhall/songs.git` | Port supported |
| HTTPS token | `https://x-access-token:<token>@github.com/oakhall/songs.git` | Token is part of the standard URI |
| HTTPS user/token | `https://user:<token>@git.example.org/oakhall/songs.git` | For servers that require a username |
| HTTP (LAN only) | `http://git.internal/oakhall/songs.git` | Allowed but not recommended outside a trusted network |

- No separate “auth mode” switch is needed: if the URI is `ssh:`/scp-like, SSH keys are used; if it is `https:`/`http:`, the URI userinfo/token is used.
- Tokens/keys are **never** shown in the UI or logs; the remote is redacted in `/api/git/status`.
- If a token is embedded in the URI, protect the config file (`chmod 600`, mounted secret). Prefer a Docker/Podman/Incus secret for the whole config file or for `WLM_GIT_<REPO>_REMOTE_FILE`.
- Git stores the remote URL in `.git/config`; the repository directory is under the protected `/data` volume and must not be exported or committed.

Environment equivalents:

```sh
WLM_GIT_ENABLED=true
WLM_GIT_SONGS_REMOTE=...
WLM_GIT_SONGS_BRANCH=main
WLM_GIT_SETLISTS_REMOTE=...
WLM_GIT_SETLISTS_BRANCH=main
WLM_GIT_BIBLES_REMOTE=          # optional; leave unset to disable
WLM_GIT_BIBLES_OPTIONAL=true
WLM_GIT_BIBLES_LFS=required
WLM_GIT_SSH_KEY_FILE=/run/secrets/git_ssh_key
WLM_GIT_KNOWN_HOSTS_FILE=/run/secrets/git_known_hosts
```

Rules:

- SSH deploy keys are per-repository and least-privilege: read-only for Bibles, read-write for songs/setlists.
- HTTPS tokens should be scoped to the repository and read-only where possible.
- The app commits with a configured author identity; signed commits are optional.
- A missing **optional** repository is not fatal: the app logs a warning and continues with local/other data.

## 4. Sync behaviour

### Startup

1. For each configured repository:
   - clone into `git.workDir/<repo>` if absent;
   - otherwise `git fetch` and fast-forward to the configured branch.
2. Rebuild the SQLite index from the files (songs, set lists, Bibles).
3. If a repository is unreachable, start from the cached clone; report degraded status.
4. Never start a live session automatically from a newly pulled set list.

### Writes

1. Write the JSON file (and assets) atomically (temp file + rename).
2. Commit with a message including the entity and action, e.g. `setlist: update 7c1e "Sunday AM"`.
3. Push to the configured branch. On failure:
   - keep the local commit;
   - retry with backoff;
   - show a “not pushed” status in the UI.
4. Update the SQLite index after the file write.

### Pulls

- Poll `git fetch` every `pullIntervalSeconds` (default 60), or on demand.
- Fast-forward only. If not possible, a conflict is reported.
- On changed files:
  - re-read only changed paths;
  - upsert/soft-delete the SQLite index;
  - reload the Bible catalog if the Bibles repo changed;
  - broadcast library/set-list changes to connected control clients.
- Live sessions are **never** changed by a pull; they remain pinned to their revision/commit.

### Two-instance flow

```
Personal instance                         Church live instance
───────────────                           ────────────────────
create/edit song
  write songs/<id>.json
  commit + push ───────────────────────▶ pull
                                          index song in SQLite
create set list
  write setlists/<id>.json
  publish revision
  commit + push ───────────────────────▶ pull set list + revision
                                          choose set list
                                          start live (pins revision + commit)
                                          apply after-current as normal
```

- A personal instance can prepare the service; the church instance pulls and runs it.
- If the church instance edits the same set list, the next push from either side may conflict. The default is to **fail the push**, keep the local commit, and show the conflict. A new revision/copy can be created to resolve it.
- Song IDs and asset IDs are globally stable; duplicate imports are avoided by ID/hash.

## 5. SQLite as an index, not the source

Add cache/index fields:

```sql
songs (
  ...,
  repo TEXT,                 -- songs
  repo_path TEXT,            -- songs/<id>.json
  content_hash TEXT,
  repo_commit TEXT,
  indexed_at TEXT
);

setlists (
  ...,
  repo TEXT, repo_path TEXT, content_hash TEXT, repo_commit TEXT, indexed_at TEXT
);

repo_state (
  name TEXT PRIMARY KEY,     -- songs | setlists | bibles
  path TEXT, remote TEXT, branch TEXT,
  last_pull_at TEXT, last_push_at TEXT,
  local_commit TEXT, remote_commit TEXT,
  status TEXT, last_error TEXT
);
```

- The file is written first; SQLite updates follow. If indexing fails, the next startup scan repairs it.
- Live sessions, output tokens, dashboard layouts, users and sessions remain local SQLite state and are **not** committed.
- Import/export bundles remain useful for ad-hoc sharing; the Git repositories are the continuous-sharing mechanism.

## 6. File format and compatibility

- Every file has `schemaVersion`; readers reject newer major versions and migrate older ones.
- IDs are UUIDs; slugs are only for filenames.
- Set list revision files include resolved song snapshots and a `contentHash` so missing/changed songs are detectable.
- Song assets are content-addressed by SHA-256 and referenced from the song file.
- A repository-level `manifest.json` may record generator/version and layout migration information.

## 7. Conflict policy

- **Default: fail closed.** Refuse to push if the remote branch moved and a fast-forward is not possible; keep the local commit, report a conflict with the changed paths, and let an editor resolve.
- **Set lists:** prefer creating a new revision or a copy (`Sunday AM (conflict copy)`) rather than merging JSON automatically.
- **Songs:** the same song ID means the same entity; a concurrent edit conflict must be resolved manually. Never silently overwrite lyrics.
- **Bibles:** read-only; if local edits exist, refuse to pull/rebase and warn.
- No force pushes, no automatic deletion of remote history.

## 8. Large files, optional Bibles and Git LFS

- PDFs/tabs are typically 50–200 KB; fine in normal Git. Song assets can optionally use LFS if they grow.
- The **Bibles repository is optional**. Without it, the app uses a local `WLM_BIBLE_DIR` mount. When configured, prefer Git LFS because SQLite files are 10–25 MB each and Git history grows quickly.
- Repository setting: `lfs: required | auto | off` (default `required` for Bibles).
  - `required`: if `git-lfs` is unavailable or `git lfs pull` fails, the Bibles repo is marked unhealthy and a clear warning is shown; the app keeps using the last cached files if present.
  - `auto`: use LFS when `.gitattributes` or the remote indicates it, otherwise plain Git.
  - `off`: never invoke LFS.
- On clone/pull: run `git lfs install --local` (once) and `git lfs pull` when LFS is required/auto. Check `git lfs version` at startup; expose the result in `/api/git/status`.
- Enable `.gitattributes` in the Bibles (and optionally songs assets) repository:

```
*.sqlite filter=lfs diff=lfs merge=lfs -text
*.sqlite3 filter=lfs diff=lfs merge=lfs -text
assets/**/*.pdf filter=lfs diff=lfs merge=lfs -text
```

- If LFS is unavailable and Bibles are required, accept the size or keep Bibles out of Git and use the existing read-only directory mount; the configuration allows `bibles.optional: true` or omitting the remote.

## 9. Container and security

- Add `git`, `git-lfs` and `openssh-client` to the runtime image (small compared to the app).
- Mount the SSH key and known-hosts file as secrets, e.g.:

```yaml
secrets:
  git_ssh_key:
    file: ./secrets/git_ssh_key
services:
  web-lyric-master:
    secrets:
      - git_ssh_key
    environment:
      WLM_GIT_SSH_KEY_FILE: /run/secrets/git_ssh_key
      WLM_GIT_KNOWN_HOSTS_FILE: /config/known_hosts
```

- For HTTPS-token remotes, pass the full URI through the config secret rather than putting it in the image or Compose file:

```yaml
secrets:
  git_config:
    file: ./secrets/wlm-config.yaml
services:
  web-lyric-master:
    secrets:
      - git_config
    environment:
      WLM_CONFIG_FILE: /run/secrets/wlm-config.yaml
```

- Run Git as UID 10001; the repositories live under the writable `/data` volume.
- Never print tokens/keys; redact remote URLs (userinfo) in logs and API responses.
- Commit author identity is configurable; no personal secrets in commits.
- Set list/song content may be copyrighted; repositories must remain private, with access limited to the church/team.
- The Bibles repository can be omitted entirely; if configured with LFS, startup verifies `git-lfs` before declaring sync healthy.

## 10. API and CLI

```
GET  /api/git/status
POST /api/git/sync                 # pull all, then push pending
POST /api/git/repos/:name/pull
POST /api/git/repos/:name/push
GET  /api/git/conflicts
POST /api/git/conflicts/:id/resolve
```

CLI (same container):

```sh
wlm git status
wlm git sync
wlm git pull songs
wlm git push setlists
```

## 11. Delivery phases

1. **Repository foundation** — config, clone/pull/push, `repo_state`, song JSON write/read, set list JSON write/read, startup index rebuild; assets for songs.
2. **Sharing workflow** — set-list revisions in Git, periodic pull, change detection, UI status, conflict reporting.
3. **Bibles and LFS** — read-only Bibles repo (LFS optional), catalog reload after pull.
4. **Operational polish** — retry queue, conflicts UI, manual sync, backups, docs.

## 12. Decisions and open questions

Resolved:

1. **Bibles repository is optional**; when configured it is read-only and uses Git LFS (`lfs: required` by default).
2. **Access is by standard Git URI** — SSH (scp-like or `ssh://`) or HTTP(S) with userinfo/token. No separate auth-mode setting.
3. **Songs, set lists and Bibles are separate repositories** so they can have independent permissions, branches and LFS policy.
4. **Live sessions/users/dashboards/tokens stay local** in SQLite and are never committed.

Outstanding:

1. Actual remote URIs/branches and whether SSH deploy keys or HTTPS tokens will be used for each repo.
2. Should every save auto-commit/push, or should there be an explicit “Sync now” with background retry?
3. Conflict policy for set lists: manual resolution, create-copy, or last-write-wins (not recommended)?
4. Are imported/edited songs allowed to write to the songs repo, or is the songs repo curated and the app read-only?
5. How should two instances prevent duplicate song creation when both import the same external source? (Stable IDs/content hash + pull-before-write.)
6. Should song assets also use LFS, or only the optional Bibles repo?
