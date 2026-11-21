# Shell CLI

`tools/sm` is a dependency-free Python 3 command-line client for the Service Maestro
HTTP API. It can run one-shot transport commands, call any API endpoint, or stay open
as an interactive keyboard transport.

Python 3.8+ and its standard library are the only requirements.

## Install

Run it directly from the repository:

```sh
tools/sm --help
```

Or link it onto your `PATH`:

```sh
mkdir -p ~/.local/bin
ln -s "$PWD/tools/sm" ~/.local/bin/sm
sm --help
```

### Debian package

Build a standalone architecture-independent package:

```sh
make deb
```

This writes `dist/service-maestro-cli_<version>_all.deb`. Install or upgrade it with:

```sh
sudo apt install ./dist/service-maestro-cli_0.2.1_all.deb
```

The package depends only on `python3 (>= 3.8)` and installs:

- `/usr/bin/sm`
- `/usr/share/man/man1/sm.1.gz`
- `/usr/share/bash-completion/completions/sm`
- `/usr/share/doc/service-maestro-cli/README.md`

Set `VERSION` when building a package with a different version:

```sh
make deb VERSION=1.2.3
```

## Configure and log in

```sh
export SM_URL=https://service-maestro.local:8080
sm login --username operator
```

The password is prompted without echo. The resulting `sm_session` cookie is saved in
`~/.config/service-maestro/cli.json` with mode `0600`. Override the location with
`SM_CLI_CONFIG` or `--config`.

For a locally generated/self-signed certificate:

```sh
sm --insecure login --username operator
```

The choice is saved for later commands; use `--secure` to force verification again.
Set `SM_INSECURE=1` when using environment-only configuration.

Environment alternatives:

| Variable | Meaning |
| --- | --- |
| `SM_URL` | Base URL, default `https://localhost:8080` |
| `SM_COOKIE` | Existing `sm_session` cookie value or full `sm_session=...` header |
| `SM_USERNAME` | Username; can trigger automatic re-login |
| `SM_PASSWORD` | Password for automatic login/re-login |
| `SM_INSECURE` | `1` to skip TLS verification |
| `SM_CLI_CONFIG` | Alternate config file path |

If a command receives a `401`, the CLI retries once after logging in when both
`SM_USERNAME` and `SM_PASSWORD` are available. Otherwise run `sm login` again.

## Common commands

| Command | Action |
| --- | --- |
| `sm --version` | Show the installed CLI version |
| `sm status` | Show the current live session, item, page, blank state and controls |
| `sm setlists [search]` | List set lists with IDs, dates and names |
| `sm songs [search]` | List songs; use `--limit` to change the count |
| `sm start "Sunday morning"` | Start a set list by ID or unique name/date match |
| `sm start <id> --rehearsal` | Start in rehearsal mode |
| `sm apply "Sunday morning"` | Queue a set list to apply after the current live item |
| `sm apply <id> --now` | Replace the live session immediately |
| `sm stop` | Stop the live session |
| `sm next` / `sm prev` | Move one page, crossing item boundaries per the live-navigation setting |
| `sm next-half` / `sm prev-half` | Scroll half a page forward or back (aliases `half-next` / `half-prev`) |
| `sm setfade` / `sm setscroll` | Set the fullscreen page transition to fade or scroll |
| `sm page 3` / `sm page -2` | Move by a page delta |
| `sm goto-page 4` | Jump to a zero-based page index |
| `sm goto-item 2` | Jump to a zero-based queue item |
| `sm blank` / `sm blank on` / `sm blank off` | Toggle or set output blanking |
| `sm show` | Unblank the output |
| `sm transpose -1` | Transpose the current song by semitones |
| `sm lines 5` | Set lines per page |
| `sm footer "Welcome"` / `sm footer --clear` | Set or clear the footer |
| `sm bible-verses` / `sm bible-verses off` | Toggle or set Bible verse numbers |
| `sm quick-text "Please stand"` | Show transient quick text; omit the text or use `-` to pipe stdin |
| `sm autoplay on --mode loop --delay 8` | Override the current image-list/Tarp autoplay |
| `sm autoplay --reset` | Restore the saved autoplay settings |
| `sm items` | List the live queue |

`sm start` accepts an exact set-list ID or a unique part of its name/date. If several
match, the CLI prints the candidates instead of guessing.

Add `--json` to print the raw live state, or `--quiet` to suppress result output.

## Interactive keyboard control

```sh
sm control
```

This opens a terminal view that refreshes from `/api/live` once a second and sends
commands immediately as keys are pressed.

| Key | Action |
| --- | --- |
| `n`, `Space`, `Enter`, `→` | Next page / next item at the boundary |
| `p`, `Backspace`, `←` | Previous page / previous item at the boundary |
| `N`, `PageDown` / `P`, `PageUp` | Next / previous half page |
| `j`, `↓` / `k`, `↑` | Next / previous live item |
| `b` | Toggle blank |
| `s` | Show/unblank |
| `[` / `]` | Transpose down / up one semitone |
| `-` / `+` | Fewer / more lines per page |
| `v` | Toggle Bible verse numbers |
| `a` / `A` | Toggle autoplay / reset the temporary autoplay override |
| `f` | Prompt for footer text |
| `x` | Prompt for transient quick text |
| `g` / `i` | Prompt for a one-based page / item number |
| `r` | Refresh immediately |
| `?` | Show or hide the full shortcut list |
| `q` | Quit and restore the terminal |

The display shows the current set list, item, page (with a `½` marker while a half-page
preview is active), blank state, transpose, line count,
Bible verse setting, footer, autoplay and nearby queue items.

## Call any API endpoint

The CLI exposes the authenticated HTTP API directly:

```sh
sm api GET /api/live
sm api POST /api/live/command '{"type":"page","delta":1}'
sm api POST /api/live/quick-text '{"text":"Welcome","mode":"direct"}'
sm api GET /api/setlists
sm api POST /api/live/start '{"setlistId":"<id>","status":"live"}'
sm api POST /api/integrations/churchsuite/plans/123/sync-preview '{}'
```

The request body must be JSON. Use `@file.json` to read it from a file, or `-` to read
it from stdin:

```sh
jq -n --arg id "$SETLIST_ID" '{setlistId:$id,status:"live"}' |
  sm api POST /api/live/start -
```

Responses are printed as indented JSON.

## Security notes

- The config file contains a live session cookie. It is written with mode `0600`, but
  keep it out of backups, screenshots and chat.
- Prefer `SM_PASSWORD` or the interactive prompt over `--password`, which can appear in
  shell history and process listings.
- `--insecure` disables certificate verification and should only be used with the
  local development certificate.
- `sm logout` calls `/api/auth/logout` when possible and removes the saved cookie.
