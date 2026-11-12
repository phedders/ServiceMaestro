# Tarp — presentation module

Tarp is a lightweight presentation system for building simple, animated slides with two coordinated layouts per page:

- **Normal view** for 16:9 or 16:10 full-screen output.
- **Lower-third view** for the transparent YouTube/OBS speaker overlay.

Each page, object and theme is reusable from the set-list system. A set-list **Tarp** item references a presentation and supports the same autoplay, Single/Loop/Bounce mode and delay options as image lists.

## 1. Scope and principles

- Keep the editor simple: text, images, backgrounds and timed object animations.
- Every object exists in both views but has independent position, size, visibility and animation settings per view.
- Use normalized coordinates (0–1) so a layout adapts to the chosen normal aspect ratio and the lower-third strip without absolute-pixel assumptions.
- Themes are global and reusable; pages can inherit a theme or override background, fonts and colours.
- Tarp pages are presentation pages, not set-list items. A set-list item references a Tarp presentation.
- Editing a presentation never changes a running live session until the set list is published and applied.

## 2. Data model (proposed)

```ts
type TarpAspect = "16:9" | "16:10";

interface TarpTheme {
  id: string;
  name: string;
  background: TarpBackground;
  fontFamily: string;
  headingFontFamily: string | null;
  textColor: string;
  accentColor: string;
  headingColor: string;
  updatedAt: string;
}

interface TarpPresentation {
  id: string;
  name: string;
  aspect: TarpAspect;
  themeId: string | null;
  pages: TarpPage[];
  createdAt: string;
  updatedAt: string;
}

interface TarpPage {
  id: string;
  position: number;
  name: string;
  themeId: string | null;          // inherits presentation theme when null
  startFromPrevious: boolean;
  transition: TarpPageTransition | null;
  normal: TarpView;
  lowerthird: TarpView;
}

interface TarpView {
  background: TarpBackground | null; // null = inherit theme/presentation
  fontFamily: string | null;         // null = inherit theme
  textColor: string | null;          // null = inherit theme
  objects: TarpObject[];
}

interface TarpObject {
  id: string;                        // shared identity across both views
  kind: "text" | "image";
  content: string;                   // text or library image path
  locked: boolean;
  visible: boolean;
  normal: TarpObjectPlacement;
  lowerthird: TarpObjectPlacement;
}

interface TarpObjectPlacement {
  x: number;                         // 0–1
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  fontSize?: number | null;          // text only
  fontWeight?: number | null;
  textAlign?: "left" | "center" | "right";
  fit?: "contain" | "cover";         // image only
  animations: TarpAnimation[];
}

interface TarpAnimation {
  id: string;
  type: "fade-in" | "fade-out" | "slide-in" | "move" | "scale" | "rotate";
  delayMs: number;
  durationMs: number;
  easing: string;
  from: Partial<TarpObjectPlacement> | null;
  to: Partial<TarpObjectPlacement> | null;
}

interface TarpPageTransition {
  type: "cut" | "fade" | "move";
  durationMs: number;
  easing: string;
}
```

Objects use the same `id` in both views. Adding an object adds it to both, initially mirrored; the editor can then adjust each view independently.

`startFromPrevious` copies the previous page's objects and lets matching object IDs animate from the previous page's placement into the new page's placement. For new objects, normal enter animations apply.

## 3. Storage

Proposed SQLite tables:

- `tarp_themes` — theme JSON and metadata.
- `tarp_presentations` — name, aspect, theme, timestamps.
- `tarp_pages` — presentation id, position, page JSON containing both views and animation data.

Set-list items gain a `tarp` kind. Its content JSON mirrors the image-list pattern:

```json
{
  "presentationId": "...",
  "autoplay": false,
  "mode": "loop",
  "delaySeconds": 6
}
```

The presentation itself is library data, not duplicated into the set list. Export/import and Git persistence need to include referenced Tarp presentations, themes and images.

## 4. Rendering and outputs

- Build one Tarp page HTML per presentation page.
- The page carries both layouts with target classes. The lower-third output shows the lowerthird layer; full-screen, two-thirds and stage use the normal layer.
- Lower-third output remains transparent around the Tarp content.
- Animations are CSS/JS driven on page entry. The server owns page sequencing and autoplay; displays own in-page object animation.
- The normal view is letterboxed/responsive inside its output container. Editor and output use normalized coordinates.
- Reuse the existing autoplay scheduler for Tarp items: page advance, Single/Loop/Bounce mode, delay and pause-on-blank behave like image lists.

## 5. Editor experience

- Tarp page in the main navigation with presentation library and theme library.
- Presentation editor:
  - Page thumbnail rail and add/duplicate/delete page.
  - Normal canvas and lower-third canvas side by side, or tabs on smaller screens.
  - Objects can be added as text or image and then dragged, resized, aligned, layered and edited.
  - Per-view inspector: position, size, rotation, opacity, text/image settings, visibility.
  - "Copy from other view" and "reset to other view" actions.
  - Theme selector with per-page overrides for background, fonts and colours.
  - Animation timeline per object, with preview/play controls.
- The editor should preview against a neutral YouTube speaker image so the lower-third composition is understandable.

## 6. Implementation sections

### Section 1 — Model, storage and APIs
- Shared Zod types.
- DB migrations and CRUD routes for themes, presentations and pages.
- Set-list `tarp` item schema and content persistence.
- No editor UI yet.

### Section 2 — Global themes
- Theme list and editor.
- Colour/font/background controls and live preview.
- Seed a small set of built-in themes.

### Section 3 — Presentation library and page shell
- Tarp navigation page.
- Create/rename/duplicate/delete presentations.
- Page list, add/duplicate/delete/reorder pages.
- Aspect-ratio selection and theme assignment.

### Section 4 — Dual-view canvas editor
- Normal/lowerthird canvases.
- Text and image objects.
- Drag/resize/snap/layers, per-view placement.
- Inspector and object duplication.

### Section 5 — Styling and backgrounds
- Theme inheritance and page/object overrides.
- Background colour, gradient or image.
- Text styling, image fit and alignment.

### Section 6 — Rendering and live outputs
- Target-aware page renderer.
- Live preview switcher option for Tarp.
- Normal and lower-third output behavior.
- Ensure long text, images and lower-third height constraints behave predictably.

### Section 7 — Set-list integration and autoplay
- Add Tarp item picker to set-list editor.
- Autoplay, Single/Loop/Bounce mode and delay controls.
- Page sequencing through the existing live service.
- Queue/publish/revision behavior.

### Section 8 — Animations and page transitions
- Per-object timed animations.
- Page preview playback.
- Optional clone-from-previous-page workflow and matching-object transitions.
- Reduced-motion fallback: show final state immediately.

### Section 9 — Persistence, import/export and Git
- Include referenced presentations and themes in exports/bundles and Git repositories.
- Decide whether Tarp library data lives in the existing set-list repository or a dedicated `tarp` repository.
- Handle missing assets gracefully.

### Section 10 — Hardening
- Validation and sanitisation of text/HTML/image paths.
- Tests for schemas, CRUD, rendering, autoplay and animations.
- Manual OBS checks for transparency, aspect ratios and lower-third safe areas.
- Documentation and operator guidance.

## 7. Decisions to confirm before Section 1

1. Normal aspect ratio: support both 16:9 and 16:10 per presentation, default **16:9**.
2. Lower-third canvas aspect: use a normalized wide strip (default 16:3) with safe-area guides.
3. Tarp item behaviour: one Tarp presentation per set-list item, with autoplay default off, playback mode default Loop and delay default 6 seconds.
4. Stage output: use the normal view; chords output continues to show chord content, not Tarp.
5. Initial object set: **text and images**, with shape support deferred.

If these defaults are accepted, implementation should start with Sections 1–2 so themes and storage are stable before building the editor.

## 8. Implementation status

- **Section 1 — model, storage and APIs:** implemented. Themes, presentations and pages have SQLite tables and authenticated CRUD routes. Pages store independent normal/lower-third views and object animation/placement data.
- **Section 2 — global themes:** implemented. The Tarp page includes theme CRUD, colour/font controls, colour/gradient/image backgrounds and a live theme preview. Three starter themes are seeded.
- **Section 3 — presentation shell:** implemented. Presentation create/rename/delete, theme/aspect selection, page add/delete and page inventory are in place.
- **Section 4 — dual-view canvas editor:** implemented. Normal and lower-third canvases, text/Markdown/image objects, drag and resize, layers, visibility/locking and per-view placement controls are in place. Page names, per-page theme overrides and “use previous page as starting point” are editable; transition playback remains for Section 8.
- **Set-list item shell:** implemented. The unified **Add** selector can create Tarp items referencing a presentation, with autoplay, Single/Loop/Bounce mode and delay fields.
- **Section 6 — live output:** implemented. Each Tarp presentation page renders both views; full/two-thirds/stage outputs use the normal view and the lower-third output uses the lower-third view. Theme/page/global backgrounds, text, Markdown, images, placement, rotation, opacity, fonts, colours and image fit render on live outputs. Tarp items now participate in the normal live page scheduler and autoplay.
- **Backgrounds:** global background library implemented with uploaded images/animated images, seeded CSS/SVG animations and a global colour theme. Set lists, text/song overrides and Tarp page views can reference them.
- Next: per-object animation playback, page transitions and Tarp library export/import/Git persistence.
