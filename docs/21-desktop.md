# Windows and macOS desktop packages

`make desktop` builds portable desktop packages for Windows and macOS. Each package
contains the compiled Service Maestro application, the official Node.js runtime,
static assets and a small Go launcher. End users do not need Node.js, Docker or a
package manager.

## Build

Requirements on the build machine:

- Node.js 24 and npm
- Python 3.8+
- Go 1.22+
- ImageMagick (`magick` or `convert`) for application icons
- Network access to download the Node.js runtimes from `nodejs.org`

Build all default targets:

```sh
make desktop
```

Or build one platform:

```sh
make desktop-windows
make desktop-macos
python3 packaging/desktop/build.py --target linux-x64
```

Outputs are written to `dist/desktop/`:

```text
ServiceMaestro-windows-x64.zip
ServiceMaestro-macos-arm64.zip
ServiceMaestro-macos-x64.zip
```

A Linux tarball can be built explicitly for testing or local use:

```sh
python3 packaging/desktop/build.py --target linux-x64
```

The build script reuses downloaded Node runtimes from `dist/cache/` and rebuilds
the application once before packaging all targets. Use `--no-build` to skip
`npm run build` when the existing `dist` output is current.

The official Node.js prebuilt `better-sqlite3` binaries are included in the
dependency package, so the same application staging can be packaged for every
target from one build machine. The launcher is cross-compiled with Go and does not
use cgo.

## Windows installation

The ZIP contains:

- `ServiceMaestro.exe` — run directly, or use the installer
- `Install Service Maestro.cmd` — installs to `%LOCALAPPDATA%\Service Maestro`,
  creates Desktop/Start Menu shortcuts and registers an uninstaller
- `Stop Service Maestro.cmd`
- `Uninstall Service Maestro.cmd`
- `runtime/` — bundled Node.js
- `app/` — Service Maestro application files

Quick start:

1. Extract the ZIP.
2. Double-click `Install Service Maestro.cmd`, or run `ServiceMaestro.exe`
   directly.
3. The launcher starts the server and opens the browser.
4. Log in as `admin` with the password in
   `%LOCALAPPDATA%\ServiceMaestro\credentials.txt`.
5. Close the launcher console or use `Stop Service Maestro.cmd` to stop it.

The ZIP is unsigned. Windows SmartScreen may show a warning; use **More info → Run
anyway**, or sign the launcher and installer before distributing it.

## macOS installation

The ZIP contains `Service Maestro.app` and a short README.

1. Open the ZIP.
2. Drag `Service Maestro.app` to Applications.
3. Double-click it. If macOS blocks the unsigned app, right-click it and choose
   **Open** the first time.
4. A small dialog shows the local URL and first-run login. Choose **Open Browser**.
5. Choose **Quit Service Maestro** in that dialog to stop the server.

The app is built for both Apple silicon (`macos-arm64`) and Intel (`macos-x64`).
The package is unsigned and not notarized. Sign and notarize it with an Apple
Developer ID before distributing it widely.

## Data, credentials and logs

| Platform | Data directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\ServiceMaestro` |
| macOS | `~/Library/Application Support/Service Maestro` |
| Linux | `~/.config/service-maestro` |

The launcher creates `data/`, `library/songs`, `library/bible`,
`library/images`, `imports/songselect`, `logs` and `ssl` in that folder.

First-run credentials are written to `credentials.txt` in the same folder. The
password is only used when the admin user is first created; change it in the web
UI after logging in.

The server log is at:

```text
<data directory>/logs/service-maestro.log
```

Updating a desktop installation does not remove the data folder: replace the
application files through the installer, or replace the macOS app in
Applications.

## Ports and network exposure

By default the launcher:

- binds only to `127.0.0.1`;
- picks the first free control/display port starting at `6111`/`6112`; and
- uses HTTP on localhost to avoid self-signed certificate prompts.

Advanced users can set environment variables before launching:

```text
SM_HOST=0.0.0.0          # expose to the local network
SM_PORT=8080             # fixed control port
SM_DISPLAY_PORT=8081     # fixed display port
SM_SSL_ENABLED=true      # enable HTTPS; requires a usable certificate/OpenSSL
SM_GIT_ENABLED=true      # enable Git-backed sync; requires git installed
```

Do not expose the desktop build directly to the internet. Use the normal
container/reverse-proxy deployment for public or untrusted networks, trusted TLS
certificates and WebAuthn origin/RP ID configuration.

## Stopping and uninstalling

- Windows: close the launcher console, use the **Stop Service Maestro** shortcut,
  or run `ServiceMaestro.exe --stop`.
- macOS: choose **Quit Service Maestro** in the launcher dialog.
- Linux: press Ctrl+C in the launcher terminal, or run `./ServiceMaestro --stop`.

Uninstalling leaves the data folder in place so songs, set lists and settings are
not lost. Delete it manually for a complete reset.

## CI release workflow

`.github/workflows/desktop.yml` builds the Windows/macOS desktop ZIPs, the CLI
Debian package and the server `.deb`, `.rpm` and `.src.rpm` on a release tag, then
uploads them to the GitHub release. The workflow can also be started manually from
the Actions tab.
