# Display templates, text formats and preview sizing

Immediate changes implemented on 2026-11-10.

## 1. Output roles and routes

| Role | Canonical route | Aliases | Chords |
| --- | --- | --- | --- |
| Lower-third / main (`lowerthird`) | `/display/lowerthird` | `/display/twothirds`, `/display/main`, `/display/lower`, `/obs-main`, `/obs-lower`, `/obs-lowerthird`, `/obs-twothirds` | hidden |
| Centered two-thirds | `/display/two-thirds` | `/display/two_thirds`, `/obs-two-thirds` | hidden |
| Full screen (`full`) | `/display/full` | `/display/fullscreen`, `/display/mainfull`, `/obs-mainfull`, `/obs-fullscreen` | hidden |
| Stage monitor | `/display/stage` | `/obs-stage` | hidden |
| Chords view | `/display/chords` | `/obs-chords` | visible |

All routes take the usual `?token=…` output token.

These are now **seeded default outputs**, not hard-coded routes. Manage them in **Menu → Outputs**. Each output has a stable ID and maps to `/display/<id>`. Aliases such as `main`, `twothirds`, `fullscreen` and `two_thirds` resolve through the output definitions. Removing an output removes its route and aliases on the display listener.

### Output definitions

An output definition contains:

- ID, label, description, template role, enabled flag and aliases.
- Fade mode (`none`, text-only or whole-template) and duration.
- Background colour and alpha.
- Layout: horizontal/vertical/text alignment, side/top/bottom padding, content max width and height.
- Lower-third panel: on/off, colour/alpha, padding, corner radius, border, max width/height.
- Text overrides: font family, colour, scale multiplier and line height.
- Content: current page only or current plus upcoming pages; meta/title, footer, chords, section labels and split-word visibility.
- Image max height and padding. Blank image values inherit the global/lower-third display settings.
- Optional **clock overlay**: on/off, digital or simple analogue (no numbers), font, size in `vw`, colour, one of nine screen positions, shadow/highlight and seconds (digital) or second hand (analogue). The clock is independent of the live content and remains visible while pages are blank or changing, so a stage/confidence monitor can show the speaker the time.

Definitions use `scope = "shared"` or `scope = "local"`. Shared definitions are written to `settings/shared.json` in the set lists repository and apply to every synced instance. Local definitions stay in this server’s database and are never written to the shared file. The Outputs page lists both and shows their scope.

The display client receives the effective output map with every live snapshot and applies the definition as CSS variables and visibility rules. Template lookup still uses the template role, so existing custom `main`/`two_thirds`/`full`/`stage`/`chords` HTML/CSS overrides continue to work. Changing an output’s template changes the underlying structure; reload an already-open display after that change.

## 2. Templating

Templates are HTML + CSS pairs. The server resolves them per output role and sends them with each live snapshot; the display page injects the template, CSS and content.

### Lookup order

1. per-service templates in the **set lists repo**:
   `templates/<setlist-id>/<role>.html` + `.css`
2. global templates in the **set lists repo**:
   `templates/<role>.html` + `.css`
3. **templates folder**: `SM_TEMPLATES_DIR` (default `/data/templates`)
4. **templates repo**: `<path>/templates/<role>.html` or `<path>/<role>.html`
5. built-in templates in `packages/display/templates`

The first HTML file found wins; CSS is read from the same directory. `full` uses its own whole-screen template and no longer reuses the two-thirds template.

### Files

```
templates/
  main.html / main.css
  two_thirds.html / two_thirds.css
  full.html / full.css          # optional
  stage.html / stage.css
  chords.html / chords.css
```

### Placeholders

Available in HTML:

- `{{content}}` — the rendered page HTML
- `{{footer}}` — footer text (escaped)
- `{{title}}` — current item title (escaped)
- `{{section}}` — page section label (escaped)
- `{{page}}`, `{{pageCount}}` — page numbers
- `{{role}}` — output role
- `{{meta}}` — ` · page / count` suffix for stage/chords

Templates are trusted configuration (admin-controlled). Content is server-rendered and sanitized; text HTML/Markdown/RST is sanitized server-side.

### Fade behaviour

Each output chooses its own fade mode:

- **No fade** — swap immediately.
- **Fade text only** — the default lower-third behaviour; the panel stays visible while its text/footer fade.
- **Fade whole output** — the default for the other outputs; the composed template fades out, swaps and fades back in.

The duration is configured per output. Blanking and idle states still use the template opacity transition. Custom templates should keep the `.sm-template` class and, for lower-third text fading, the `.sm-lowerthird-panel` wrapper.

## 3. Text item formats

The set-list editor has a **Text format** dropdown: **Markdown (default)**, **Plain text**, **HTML** or **reStructuredText**. A legacy `format:`/`type:`/`mode:` header (or YAML front matter) is extracted into the item’s `format` metadata the first time the item is edited/saved, and removed from the body.

Supported forms:

- `type: markdown`, `format: markdown`, `mode: markdown` (also `md`)
- `type: html`
- `type: rst` / `restructuredtext`
- `type: text` / `plain`

Or YAML front matter:

```text
---
type: html
---
<h1>Welcome</h1>
<p>Please stand.</p>
```

Page breaks: `<!-- page -->` / `<!--- page --->` or `<hr class="page-break">`. Plain text and songs also split at the display config’s max lines/words. Rich Markdown/HTML/RST items use explicit page markers as page boundaries.

The song and text editors provide two equivalent page authoring methods: **Insert page marker** writes `<!-- page -->` at the cursor, while **+ Add page box** creates a separate text box per page. Page boxes are joined with the same marker on save, so both methods work together.

Text items also carry a per-item **Alignment** setting: **Left** or **Centre**. The alignment is applied in the rendered page HTML so it works on every output and in the control preview.

Rendering:

- **Markdown** via `marked`
- **RST** via `rst2html`
- **HTML** as provided
- All rich output sanitized with `sanitize-html`: scripts, styles, iframes, event handlers and data URLs are removed; standard headings, lists, tables, code, links and images are allowed.
- Plain text remains escaped and line-based.

### Inline styling

A safe subset of inline CSS is allowed on elements:

`font-size`, `font-weight`, `font-style`, `text-decoration`, `text-align`, `line-height`, `color`, `background-color`.

Examples:

```html
This is <span style="font-size:200%">big</span>.
This is <strong>bold</strong> and <em>italic</em>.
```

The common typo `<style="font-size=200%">big</style>` is also accepted and treated as `<span style="font-size:200%">big</span>`; real `<style>` blocks remain disallowed.

Rich text uses a block container (`.text-html`), not the flex line container used for plain text, so `<strong>`/`<span>` do not introduce line breaks.

## 4. Display config (Live page)

A **Display config** panel on the Live page controls:

- **Global font** — built-in stacks plus Google Fonts imported from the Settings page; used by centered two-thirds and full-screen.
- **Text colour** — default text colour on all text-based presentation views.
- **Global text size** — 50–200% scale for centered two-thirds and full-screen.
- **Lower-third font** — independent font for the lower-third output.
- **Lower-third text size** — independent 50–200% scale for the lower-third output.
- **Max lines per page** — the number of lines after which a song/text/Bible item is split into another page.
- **Max words per page** — a second hard limit; pages split on whichever of max lines or max words is reached first.
- **Lower-third image max height** — percentage of the viewport used as the image height limit (default 30%).
- **Lower-third border padding** — the gap between the viewport bottom and the lower-third text/image area (default 48px). For images it is also subtracted from the maximum height. Images keep their aspect ratio and are never stretched. Text is shown in a dark 80%-opaque rounded panel with a lighter border. The panel remains visible while page text fades between pages, and fades out only for blank/idle states.
- **Smart page splits** — estimates a 1920×1080 landscape frame from the selected font size and limits lines per page to the estimated vertical coverage.
- **Smart wrap minimum words** — server-side line wrapping only alters a source line when it contains at least this many words (default 15). Shorter lines are left intact and wrap naturally in the browser.
- **Server smart wrap modules** — choose which content sources use server-side wrapping: Songs, Text and Bible. Bible items are tagged when added from the Bible module or the Set lists Bible panel; untagged text items use the Text setting.

Scope:

- The global font, text colour and size act as defaults/fallbacks. Each output can override its font, colour, scale and line height in **Menu → Outputs**. The lower-third defaults to the separate lower-third font and text-size settings.
- **Stage and chords** have their own output definitions. Their defaults keep the fixed stage/chords look, with stage hiding chords and chords showing them; either can be changed in Outputs.
- **Stage and chords default to showing the current page at the top and all following pages of the current queue below it**, so musicians can see what is coming next. The content area scrolls if needed; lower-third/centered two-thirds/full default to the current page only. Every output can choose either page mode.
- Page splitting (max lines, max words, smart estimates) and smart wrapping are shared by all outputs; `<!-- page -->` / `<!--- page --->` / `<hr class="page-break">` markers force additional breaks.
- Settings persist in the database and are broadcast to outputs immediately.
- The **Show** button reveals a blank screen. **Selecting a page** shows and fades it in; **selecting a set-list item** only queues its page list and leaves the current output unchanged.

## 4.1 Song text styling and split words

Songs can opt into **inline Markdown styling** metadata. Supported tags include `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` and `==highlight==`.

- Main/two-thirds (and full) render the styling.
- Stage and chords **ignore** the styling, showing plain text.
- SongSelect/SongPro split words like `can - not` or `sat - is - fied` are wrapped in `.lyric-split` spans. CSS hides those separators on lower-third/centered two-thirds/full/stage (so the words join to `cannot` / `satisfied`) and keeps them visible in the chords view.

## 4.2 Imported Google Fonts

The Settings page imports a family name or a `https://fonts.googleapis.com/css2?...` URL. The server downloads the CSS and woff2 files into `/data/fonts`, rewrites the URLs to `/display/fonts/<id>/…`, and serves a concatenated `/display/fonts/all.css`. Displays and the control preview therefore work offline after import, and all font requests stay inside the read-only `/display/*` tree.

Font files placed directly in `/data/fonts` (`.ttf`, `.otf`, `.woff`, `.woff2`, including normal subfolders) are detected automatically, grouped by family/weight/style inferred from the filenames, and registered as local fonts. Their generated `@font-face` rules are included in `all.css`; removing the files removes their local entries on the next scan. Local fonts are not added to the shared Google Fonts list.

Downloaded font names, families and original Google Fonts URLs are recorded in `settings/shared.json` in the **set lists repository**, together with team-wide app settings, display styling and the global background palette. Other instances that pull that repository apply those shared settings and show shared fonts that are not cached locally with a **Missing** highlight, a per-font **Download** button, and a bulk **Download missing** action. The shared font list is merged with the local cache, so removing a local font does not erase it from the team’s shared list.

## 5. Blank on session start

Starting a live session now sets `blank: true`. Outputs remain black/transparent until the operator presses **Show** or advances; the preview shows the **BLANK** state.

**Selecting a page** (from the Pages list or dashboard) is an explicit show: `blank` is cleared in the same command and the display fades the selected page in directly.

**Selecting a set-list item** only **queues** that item's page list. It does not change the live output, page, title or blank state; the Pages panel switches to the queued item and the first page is shown only when the operator clicks a page (or uses Show/Next as appropriate). The **Show** button remains for revealing the current live page without changing it.

Each item also has a **+** button in the Live Items panel. It appends that item’s rendered pages to the current live page queue without modifying the set-list entry. Appended pages survive display-config/transpose changes and restart with the session; changing to another item clears the appended queue.

## 6. Preview pane size

The Live page preview is no longer full-width: it sits beside the Transport panel at roughly the same height, with a maximum height of 280 px. The default dashboard layout gives Preview the same grid height as Transport (4 rows); existing saved layouts are unchanged, and **Reset** restores the new default.
