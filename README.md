# Service Maestro

Service Maestro is a self-hosted church service presentation system. It manages songs,
set lists, Bible passages, text, images and presentations, then drives them onto separate
browser-based outputs for projectors, confidence monitors and OBS.

Everything runs on your own server. The control interface, live state and data stay local;
there is no required cloud service.

## What it does

### Songs and service planning

- Song library with chords, section labels, keys, alternative titles, CCLI and verse orders.
- OpenLP/OpenLyrics, ChordPro and plain-text importers.
- SongSelect search, lyric/ChordPro/lead/vocal downloads and automatic update checks.
- Set lists with drag reordering, per-item edits, and printable Big Print song sheets (portrait, landscape or saddle-stitch booklet) and chord charts in PDF, Word (DOCX) or OpenDocument (ODF).
- ChurchSuite plan import, song matching, service-time inference and repeatable sync.
- Bible passage import with paragraph or line-per-verse layouts and optional verse numbers.
- Export/import of reference JSON or self-contained set-list bundles.

### Live control

- Snapshot-based live sessions: editing a set list never changes the running service.
- Previous/next, blank/show, page selection, item queue, transpose, line count, footer,
  quick text, Bible verse-number toggle and item autoplay controls.
- Keyboard shortcuts, optional USB clicker mappings, MQTT controls and a shell CLI.
- Fade or scroll transitions for page changes, with per-output settings and a fullscreen transport override.
- Publish revisions and safely apply updates after the current item or immediately.
- Per-user accounts, passkey login, module permissions and an activity log.

### Displays and media

- Lower-third, full-screen, centered two-thirds, stage and chords outputs.
- Plain-HTML display pages for OBS Browser Sources and ordinary browsers.
- Configurable templates, fonts, colours, backgrounds, fades, clocks and page limits.
- Global and per-item backgrounds, transition stingers, images and image-sequence playback.
- Tarp presentations with independent normal and lower-third layouts.
- External Canva/PowerPoint/Google Slides presentation embedding or window launching.
- Standalone musicians view with lyrics, notes, score PDFs and tabs on personal devices.

## Install

### Docker / Podman

Run the published image:

```sh
docker run -d --name service-maestro --restart unless-stopped \
  -p 8080:8080 -p 8081:8081 \
  -e SM_ADMIN_PASSWORD='replace-me' \
  -e SM_OUTPUT_TOKEN='replace-with-a-long-random-token' \
  -v "$PWD/data:/data" \
  -v "$PWD/library/songs:/library/songs:ro" \
  -v "$PWD/library/bible:/library/bible:ro" \
  -v "$PWD/library/images:/library/images" \
  ghcr.io/phedders/servicemaestro:latest
```

If the GHCR package is private, run `docker login ghcr.io` first.

Or build from a checkout with Compose:

```sh
cp .env.example .env
# edit .env: set SM_ADMIN_PASSWORD, SM_OUTPUT_TOKEN, integrations and paths
docker compose up -d --build
```

`compose.yaml` publishes ports `6111` and `6112` by default; edit it if you need
`8080`/`8081`. See [container deployment](docs/05-container-deployment.md) for Podman,
Incus/LXC, backups, reverse proxies and hardening.

### Debian / RPM server packages

Native packages bundle Node.js and install a systemd service:

```sh
sudo apt install ./service-maestro-server_<version>_amd64.deb
# or
sudo dnf install ./service-maestro-server-<version>-1.x86_64.rpm
```

The initial admin password is generated at `/etc/service-maestro/admin-password`.
Data lives under `/var/lib/service-maestro`; configuration lives under
`/etc/service-maestro`.

Hosted APT and DNF repositories are published at
[phedders.github.io/ServiceMaestro-Packages](https://phedders.github.io/ServiceMaestro-Packages/):

```sh
# Debian / Ubuntu
echo "deb [trusted=yes] https://phedders.github.io/ServiceMaestro-Packages/apt ./" | sudo tee /etc/apt/sources.list.d/service-maestro.list
sudo apt update
sudo apt install service-maestro-server service-maestro-cli

# Fedora / RHEL / Rocky
sudo tee /etc/yum.repos.d/service-maestro.repo <<'EOF'
[service-maestro]
name=Service Maestro
baseurl=https://phedders.github.io/ServiceMaestro-Packages/rpm/
enabled=1
gpgcheck=0
EOF
sudo dnf install service-maestro-server
```

The repositories are currently unsigned. You can also download packages directly
from the release/package bundle, or build them with:

```sh
make server-packages
```

See [native server packages](docs/22-server-packages.md).

### Windows and macOS desktop

Download the ZIP for your platform from GitHub releases:

- `ServiceMaestro-windows-x64.zip`
- `ServiceMaestro-macos-arm64.zip` (Apple silicon)
- `ServiceMaestro-macos-x64.zip` (Intel)

On Windows, run `ServiceMaestro.exe` or `Install Service Maestro.cmd`. On macOS, drag
`Service Maestro.app` to Applications. Both packages bundle Node.js and open the browser
automatically. See [desktop packages](docs/21-desktop.md).

Build desktop packages locally with `make desktop`.

### From source

Requires Node.js 24+:

```sh
npm ci
npm run build
SM_ADMIN_PASSWORD='change-me' npm start
```

The control interface is at <https://localhost:8080>; displays are served at
<http://localhost:8081/display/>.

### Optional shell CLI

The repository includes a dependency-free Python client for the HTTP API:

```sh
tools/sm --help
tools/sm --insecure login --username admin
tools/sm control
```

A Debian package can be built with `make deb`. See [shell CLI](docs/20-cli.md).

## First run

1. Open `https://<server>:8080` and sign in as `admin`.
2. Use the first-run password:
   - Docker/source: `SM_ADMIN_PASSWORD`
   - Native packages: `/etc/service-maestro/admin-password`
   - Desktop builds: the first-run dialog or `credentials.txt` in the data folder
3. Change the password under **Settings → My account**.
4. Open **Menu → Outputs** and copy the display URLs into your projector browser or OBS.
5. Open the musicians view at `/musicians` when needed.

Default display URLs:

| Output | URL |
| --- | --- |
| Lower-third / main | `http://<server>:8081/display/lowerthird` |
| Full screen | `http://<server>:8081/display/full` |
| Centered two-thirds | `http://<server>:8081/display/two-thirds` |
| Stage monitor | `http://<server>:8081/display/stage` |
| Chords | `http://<server>:8081/display/chords` |

Outputs, aliases, templates, fades and sizing are configurable under **Menu → Outputs**.
The control interface uses HTTPS. A generated self-signed certificate produces a browser
warning until you install a trusted certificate.

## Essential configuration

Configuration can come from environment variables, a YAML/JSON file, or both. Environment
variables take precedence. Start from [`.env.example`](.env.example) and
[`config.example.yaml`](config.example.yaml).

| Variable | Default | Purpose |
| --- | --- | --- |
| `SM_ADMIN_PASSWORD` | `admin` | Password for the seeded `admin` account |
| `SM_OUTPUT_TOKEN` | `dev-output` | Shared token for control-origin display endpoints |
| `SM_HOST` | `0.0.0.0` | Bind address |
| `SM_PORT` | `8080` | Control HTTPS/API port |
| `SM_DISPLAY_PORT` | `8081` | Read-only display HTTP port |
| `SM_DATA_DIR` | `packages/server/data` (source), `/data` (container) | SQLite database and runtime data |
| `SM_IMAGES_DIR` | `library/images` (source), `/library/images` (container) | Image library |
| `SM_SONGS_DIR` | `samples/` (source), `/library/songs` (container) | Source folder for bulk song imports |
| `SM_BIBLE_DIR` | `samples/bible/` (source), `/library/bible` (container) | Bible translation files |
| `SM_CONFIG_FILE` | auto-detected | Explicit YAML/JSON configuration file |
| `SM_SSL_ENABLED` | `true` | HTTPS on the control listener |
| `SM_SSL_DIR` | `SM_DATA_DIR/ssl` | Generated/local certificate directory |
| `SM_SSL_CERT_FILE` / `SM_SSL_KEY_FILE` | `cert.pem` / `key.pem` | Trusted certificate and key |
| `SM_WEBAUTHN_RP_ID` | derived | Passkey relying-party hostname |
| `SM_WEBAUTHN_ORIGIN` | derived | Exact browser URL for passkeys |
| `SM_GIT_ENABLED` | `true` (`false` in desktop builds) | Git-backed song/set-list persistence |
| `SM_SECURE_COOKIES` | `true` | Secure session cookies |
| `SM_TRUST_PROXY` | `false` | Trust forwarded headers from a reverse proxy |

For public or untrusted networks:

- Put Service Maestro behind a trusted reverse proxy or install a trusted certificate.
- Keep `SM_SECURE_COOKIES=true`.
- Set `SM_WEBAUTHN_RP_ID` and `SM_WEBAUTHN_ORIGIN` explicitly to the public hostname.
- Do not expose the plain-HTTP control port directly.
- Restrict the display listener to the network that needs it.

See [HTTPS certificates and passkeys](docs/05-container-deployment.md#41-https-certificate-options)
and [Git-backed shared data](docs/11-git-data-sync.md) for the full options.

## Data and backups

| Install type | Data location |
| --- | --- |
| Docker/Podman | mounted `/data` volume |
| Debian/RPM | `/var/lib/service-maestro` |
| Windows | `%LOCALAPPDATA%\ServiceMaestro` |
| macOS | `~/Library/Application Support/Service Maestro` |

Back up the data directory. It contains the SQLite database, uploads, fonts, SSL material
and local Git repositories. Songs and set lists can also be synced between instances with
Git; see [Git-backed shared data](docs/11-git-data-sync.md).

## Documentation

| Topic | Document |
| --- | --- |
| Architecture and data model | [docs/02-architecture.md](docs/02-architecture.md) |
| Container deployment, HTTPS, reverse proxies, passkeys | [docs/05-container-deployment.md](docs/05-container-deployment.md) |
| Songs, SongSelect, scores and tabs | [docs/06-songselect-and-scores.md](docs/06-songselect-and-scores.md) |
| Bible source formats | [docs/07-bible-sources.md](docs/07-bible-sources.md) |
| ChurchSuite planning sync | [docs/10-churchsuite-sync.md](docs/10-churchsuite-sync.md) |
| Git-backed shared data | [docs/11-git-data-sync.md](docs/11-git-data-sync.md) |
| Display templates and text formats | [docs/13-display-templates.md](docs/13-display-templates.md) |
| Tarp presentations | [docs/14-tarp.md](docs/14-tarp.md) |
| Transition stingers | [docs/15-stingers.md](docs/15-stingers.md) |
| MQTT bridge | [docs/16-mqtt.md](docs/16-mqtt.md) |
| USB clicker remotes | [docs/17-clicker.md](docs/17-clicker.md) |
| External presentations | [docs/18-external-presentations.md](docs/18-external-presentations.md) |
| Archives, duplicates and users | [docs/23-utility-pages.md](docs/23-utility-pages.md) |
| WebSocket API | [docs/19-websockets.md](docs/19-websockets.md) |
| Shell CLI | [docs/20-cli.md](docs/20-cli.md) |
| Windows/macOS desktop packages | [docs/21-desktop.md](docs/21-desktop.md) |
| Native Linux server packages and `publish-all` | [docs/22-server-packages.md](docs/22-server-packages.md) |

## Building and publishing

```sh
make image              # application container image
make deb                # CLI Debian package
make server-packages    # server .deb, .rpm and .src.rpm
make desktop            # Windows and macOS desktop ZIPs
make package-bundle     # all packages plus SHA256SUMS
make publish-all        # build everything and push the image and package bundle to GHCR
```

`make publish-all` pushes:

- `ghcr.io/phedders/servicemaestro:<version>`
- `ghcr.io/phedders/servicemaestro-packages:<version>`

Set `GHCR_TOKEN` or `GITHUB_TOKEN` before publishing. See
[native server packages](docs/22-server-packages.md#publish-everything-to-ghcr).
