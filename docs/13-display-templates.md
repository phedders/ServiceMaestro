# Display templates, text formats and preview sizing

Immediate changes implemented on 2026-11-10.

## 1. Output roles and routes

| Role | Route | Legacy alias | Chords |
| --- | --- | --- | --- |
| Main / lower third | `/display/main` | `/obs-main` | hidden |
| Two-thirds | `/display/two-thirds` (also `/display/two_thirds`) | `/obs-two-thirds` | hidden |
| Full screen | `/display/full` | `/obs-mainfull` | hidden |
| Stage monitor | `/display/stage` | `/obs-stage` | visible |
| Chords view | `/display/chords` | `/obs-chords` | visible |

All routes take the usual `?token=…` output token.

## 2. Templating

Templates are HTML + CSS pairs. The server resolves them per output role and sends them with each live snapshot; the display page injects the template, CSS and content.

### Lookup order

1. per-service templates in the **set lists repo**:
   `templates/<setlist-id>/<role>.html` + `.css`
2. global templates in the **set lists repo**:
   `templates/<role>.html` + `.css`
3. **templates folder**: `WLM_TEMPLATES_DIR` (default `/data/templates`)
4. **templates repo**: `<path>/templates/<role>.html` or `<path>/<role>.html`
5. built-in templates in `packages/display/templates`

The first HTML file found wins; CSS is read from the same directory. `full` falls back to `two_thirds` if no `full` template exists.

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

### Default fade

The display client fades the composed tree out, swaps content, and fades it back in using the `.wlm-fading` body class and a CSS transition on `.wlm-template`. Blanking uses the same opacity transition. Custom templates should keep the `.wlm-template` class to inherit the fade.

## 3. Text item formats

A text item's first line can select the renderer:

```text
type: markdown
# Welcome

**Please stand** as we begin.
```

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

Page breaks: `<!-- page -->` or `<hr class="page-break">`. Text mode keeps the blank-line/max-lines pagination.

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

## 4. Blank on session start

Starting a live session now sets `blank: true`. Outputs remain black/transparent until the operator presses **Show** or advances; the preview shows the **BLANK** state.

**Selecting a page or item** (from the Pages/Items lists or the dashboard) counts as an explicit show: `blank` is cleared in the same command and the display fades the selected page in directly. The **Show** button remains for revealing the current page without changing it.

## 5. Preview pane size

The Live page preview is no longer full-width: it sits beside the Transport panel at roughly the same height, with a maximum height of 280 px. The default dashboard layout gives Preview the same grid height as Transport (4 rows); existing saved layouts are unchanged, and **Reset** restores the new default.
