# 15 — Transition stingers

Stingers are transparent overlay animations played while the live output changes pages. They cover the outgoing page, the new page is committed while the animation is opaque, and the animation opens to reveal it.

## Library

**Menu → Stingers** manages the global library.

- Built-in SVG presets: Iris Bloom, Shutter Split, Diagonal Sweep, Liquid Morph, Glitch Mosaic, Prism Fold, Neon Vortex, Bubble Rise, Pixel Cascade, Curtain Call and Supernova.
- Image stingers can be uploaded as PNG, GIF, WebP, AVIF or SVG. Transparent and animated files keep their transparency.
- Each stinger has a duration in milliseconds. The display removes the overlay when the duration completes.
- Previews use a checkerboard so transparent regions are visible.

The library is stored in the `stingers` table. Built-in records are seeded with `INSERT OR IGNORE`.

## Assignment and overrides

Resolution order, highest first:

1. Page override (`stinger_overrides_json` on a set-list item, keyed by the 1-based page number).
2. Item override (`stinger_id` on a set-list item).
3. Set-list default (`stinger_id` on the set list).

The item editor exposes a **Stinger override** select and a collapsible **Page stinger overrides** editor. Page overrides can choose **No stinger** explicitly, which suppresses the item and set-list defaults for that page.

`__none__` is the shared sentinel used by item and page overrides.

## Live playback

`LivePage.stinger` carries the resolved stinger render and duration for each generated page. On the display:

- The stinger is played only when the displayed page key changes; initial load, blank and idle do not play one.
- The overlay is fixed above the page.
- The new page is committed at 45% of the stinger duration.
- The overlay is removed at the full duration.
- Only the `full` and `two_thirds` outputs play stingers. The lower-third (`main`), stage and chords outputs stay usable during transitions.
- Without a stinger, the existing 240 ms fade is used.

## Persistence

Set-list and item stinger fields survive revisions, JSON/bundle export/import and Git-backed set-list import. Custom uploaded stinger files live in the image library and are referenced by path; the stinger definitions themselves are not bundled with a set list.
