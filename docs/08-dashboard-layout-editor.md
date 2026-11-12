# Dashboard layout editor (open source, self-hosted)

Design for a graphical, multi-user editor for the **control application's dashboard** — arranging widgets, pages and per-user layouts. Everything is open source and runs on your own server; no cloud service is required.

> Scope: the **control UI** (operators/editors), not the congregation display themes (covered in [03-content-model.md §5](03-content-model.md#5-themes-modular-theming)).

## 1. Recommendation

| Concern | Tool | License | Role |
| --- | --- | --- | --- |
| Grid dashboard layout | **react-grid-layout** | MIT | Drag, resize, compaction, breakpoints, serialisable layouts |
| Palette / drag interactions | **@dnd-kit/core** | MIT | Dragging widget types from a palette; touch-friendly |
| Collaborative editing | **Yjs** + **y-websocket** | MIT | CRDT document sync, presence, offline/reconnect |
| State/validation | **Zod** + React state | MIT | Widget prop schemas and layout validation |
| Optional text widget config | **TipTap** | MIT | Rich text inside text-oriented widgets only |

All run locally. No Liveblocks, Figma, Builder.io, Puck Cloud or other hosted service.

**Start with `react-grid-layout`.** It is the closest match to the existing dashboard mental model (widgets in a responsive grid), it serialises to plain JSON, and it avoids the complexity of a freeform page builder.

## 2. Why not the alternatives

- **Puck / GrapesJS / Craft.js** — page builders for arbitrary HTML composition. Powerful, but the dashboard is a **grid of typed widgets**, not free HTML. Using a page builder would make permissions, validation and responsive behaviour harder, and invites arbitrary markup.
- **Gridstack.js** — a solid MIT alternative to react-grid-layout, framework-agnostic; choose it only if React bindings become a constraint.
- **react-moveable** — for freeform pixel positioning/rotation; unnecessary for a dashboard grid. Could be added later for a "free canvas" page type.
- **Liveblocks / PartyKit / Firebase** — fast collaboration, but cloud/paid and data leaves your network. Rejected.
- **Automerge** — viable CRDT, but heavier integration; Yjs has the widest editor/ecosystem support and is well understood.

## 3. Layout model

A dashboard is a set of **pages**, each with a responsive grid and typed widget instances:

```jsonc
{
  "schemaVersion": 1,
  "breakpoints": { "lg": 12, "md": 8, "sm": 4 },
  "pages": [
    {
      "id": "control",
      "name": "Control",
      "icon": "camera-control",
      "order": 0,
      "layouts": {
        "lg": [
          { "i": "pages",   "x": 0, "y": 0, "w": 6, "h": 9, "minW": 4, "minH": 4 },
          { "i": "preview", "x": 6, "y": 0, "w": 6, "h": 9, "minW": 4, "minH": 4 }
        ],
        "md": [],
        "sm": []
      },
      "widgets": {
        "pages":   { "type": "pages",            "props": { "showSearch": true } },
        "preview": { "type": "display-preview",  "props": { "output": "mainfull" } }
      }
    }
  ]
}
```

Rules:

- Widget ids (`i`) are stable; layout and widget config are separate maps.
- Each breakpoint has its own layout array (react-grid-layout’s native model); missing breakpoints fall back with compaction.
- `schemaVersion` allows migrations; unknown widget types are preserved but rendered as a placeholder, never dropped.
- Widget props are validated by a Zod schema on the server and client.
- Layout JSON is versioned when published (see §7).

## 4. Widget registry

Only registered widget types can appear:

```ts
type WidgetDefinition<P> = {
  type: string;                 // "setlist", "pages", "display-preview", …
  title: string;
  icon: string;
  defaultSize: { w: number; h: number; minW: number; minH: number };
  schema: z.ZodType<P>;         // validated config
  roles: Role[];                // who may add/see it
  render: React.ComponentType<WidgetProps<P>>;
};
```

Initial registry:

| Widget | Purpose | Notes |
| --- | --- | --- |
| `pages` | Lyric/page table | same behaviour as the current Pages table |
| `setlist` | Set list / playlist queue | drag/delete/current item |
| `display-preview` | `/obs-mainfull` iframe | preview, not editable |
| `quick-text` | Free text entry | direct/setlist |
| `bible` | Translation/book/chapter/verse | passage preview |
| `notes` | Item notes | per-item |
| `transport` | Next/prev/blank/fade/transpose | permission-aware |
| `song-search` | Library search and site-download status | download status |
| `outputs` | Output presence/lag | read-only |
| `musician-readiness` | Missing scores/tabs | read-only |
| `clock` / `service-info` | Service date/time | read-only |

Widgets are normal React components, lazy-loaded, with a permission check and a config schema. **No user-supplied HTML or JavaScript.**

## 5. Editing experience

Enter **Customize** from the app bar (permission-gated):

- Grid overlay with snap lines and compaction.
- Drag to move, resize from corners, duplicate, remove, lock (prevent drag), hide.
- **Palette** on the right: widget types filtered by role; drag into the grid or click to add.
- **Config drawer** generated from the widget’s Zod schema.
- **Responsive switcher**: `lg` / `md` / `sm`; edit each layout, preview at real breakpoints.
- **Undo/redo** (local stack; Yjs UndoManager when collaborating).
- **Save state**: “Saved”, “Saving…”, “Offline, will sync”.
- **Publish** (admin) from personal/shared draft to the team default.
- **Reset to default** and “copy my layout to…” helpers.
- Keyboard: focus a widget, arrow keys move, `Shift`+arrows resize, `Delete` removes; ARIA labels on handles.
- Live data previews; editing never changes the live presentation state.

### Personal vs shared layouts

- Every user has a **personal layout** (autosaved) so they can rearrange their own control screen without affecting others.
- Admins can edit a **shared/role default** and publish it as the default for new users or a role.
- A user can “reset to shared default” at any time.
- Editing a shared layout is collaborative; editing a personal layout is single-user by default.

## 6. Collaboration with Yjs (self-hosted)

Use Yjs for shared-layout edit sessions only (not for the live presentation state, which remains server-authoritative).

Document shape:

```ts
Y.Doc
  meta:        Y.Map        // schemaVersion, title
  pages:       Y.Array      // ordered page metadata
  layouts:     Y.Map        // pageId -> Y.Map<breakpoint, Y.Map<widgetId, Y.Map>>
  widgets:     Y.Map        // widgetId -> Y.Map (type, props)
  selections:  awareness    // user, color, page, selected widget
```

- **Sync server**: `y-websocket` (MIT) mounted on the Fastify HTTP server at `/collab/dashboards/:id`; or **Hocuspocus** (MIT) if you prefer its auth/persistence hooks.
- **Auth**: WebSocket upgrade validates the session cookie and dashboard `edit` permission; read-only users join with `view` and cannot write.
- **Persistence**: debounce `Y.encodeStateAsUpdate` into SQLite (`collab_documents.state`), and snapshot to JSON on publish. Reconnect replays the update.
- **Presence**: avatars, colored selection outlines, “Alice is editing this widget”; optional follow mode.
- **Conflicts**: CRDT merges moves/resizes; soft-lock the widget being actively dragged to avoid two people fighting over the same tile.
- **Offline**: Yjs buffers local updates and syncs on reconnect; the UI shows an offline badge.
- **Undo**: Yjs `UndoManager` scoped to the local user.

If simultaneous editing is not required at first, ship personal layouts with optimistic locking (`If-Match`) and add Yjs in a later phase. The schema does not change.

## 7. Persistence

```sql
dashboards (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE,
  scope TEXT NOT NULL,                 -- global | role | personal
  owner_role TEXT, owner_user_id TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT
);

dashboard_versions (
  id TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL REFERENCES dashboards(id),
  version_no INTEGER NOT NULL,
  layout_json TEXT NOT NULL,
  published_by TEXT, published_at TEXT,
  UNIQUE(dashboard_id, version_no)
);

dashboard_layouts (                   -- personal/role working copy
  id TEXT PRIMARY KEY,
  dashboard_id TEXT NOT NULL REFERENCES dashboards(id),
  user_id TEXT, role TEXT,
  layout_json TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(dashboard_id, user_id, role)
);

collab_documents (
  dashboard_id TEXT PRIMARY KEY REFERENCES dashboards(id),
  state BLOB NOT NULL,                -- Yjs encoded update
  updated_at TEXT
);
```

- Personal layouts are rows in `dashboard_layouts`; autosave with `If-Match`.
- Published shared layouts are immutable `dashboard_versions`; the current default is the latest published version for its scope.
- `collab_documents` is the Yjs state for active shared editing; publish flushes and writes a version.
- Layout schema migrations run on startup; old layouts are upgraded or reset with a warning.

## 8. API and WebSocket

```
GET  /api/widgets                              registry (type/title/schema/defaults/roles)
GET  /api/dashboards                           visible dashboards
GET  /api/dashboards/:id/layout?scope=personal|shared
PUT  /api/dashboards/:id/layout/personal       autosave (If-Match)
POST /api/dashboards/:id/layout/publish        admin; creates a version
POST /api/dashboards/:id/layout/reset          reset personal to shared default
POST /api/dashboards/:id/layout/duplicate      copy personal/shared layout

WS   /collab/dashboards/:id                    Yjs sync + awareness (edit permission)
```

REST remains the fallback for saving layouts when WebSocket is unavailable.

## 9. Permissions

- `view` — use the dashboard; no layout changes.
- `edit-personal` — customize own layout.
- `edit-shared` — join collaborative shared-layout editing.
- `publish` — publish a shared default (admin).
- `manage-widgets` — add/remove widget types beyond role defaults (admin).
- Widget-level role checks (e.g. `transport` only for operators).

## 10. Security, accessibility and performance

- **No arbitrary HTML**: only registered widgets; props validated by schema; text props sanitized.
- Layout JSON size limits; reject unknown/oversized configs; never evaluate code.
- WebSocket auth and per-dashboard authorization; rate-limit messages.
- Live state is untouched by layout edits; the presentation remains server-authoritative.
- Accessibility: keyboard move/resize, focus outlines, ARIA labels, touch targets, reduced-motion support.
- Performance: lazy-load widgets, memoize by layout/props, throttle awareness, compact Yjs updates.

## 11. Delivery phases

1. **Grid foundation** — react-grid-layout, default dashboard, personal drag/resize/save, widget registry and config drawer.
2. **Full editor** — palette, breakpoints, duplicate/lock/reset, publish/versioning, keyboard/touch, permissions.
3. **Collaboration** — Yjs + y-websocket, presence, undo/redo, soft locks, persistence and offline.
4. **Optional** — custom page builder (Puck) for non-grid pages; only if a real need appears.

## 12. Open decisions

1. **Personal + shared layouts** — confirm both; who can publish shared defaults?
2. **Simultaneous editing** — required at launch, or personal layouts + conflict warning first?
3. **Widget set** — which widgets may each role add/configure? Any custom/composite widgets?
4. **Pages** — can users add/rename/reorder pages, or only arrange widgets on fixed pages?
5. **Default layout** — reproduce the current 7-page structure exactly, or start with a leaner default?
6. **Touch devices** — are tablets a target for the control dashboard (affects drag/resize ergonomics)?
