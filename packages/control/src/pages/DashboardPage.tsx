import { useEffect, useMemo, useState } from "react";
import { Responsive, WidthProvider, type Layout, type Layouts } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { DashboardLayout, LiveState } from "@sm/shared";
import { api, ApiError } from "../api";
import { SlidePreview } from "../components/SlidePreview";
import { Transport } from "../components/Transport";
import { ItemList, PageList } from "../components/LivePanels";
import { QuickText } from "../components/QuickText";

const ResponsiveGridLayout = WidthProvider(Responsive);

function stacked(items: Layout[], cols: number): Layout[] {
  let y = 0;
  return items.map((item) => {
    const next: Layout = {
      ...item,
      x: 0,
      y,
      w: cols,
      minW: Math.min(item.minW ?? 1, cols),
    };
    y += item.h;
    return next;
  });
}

function layoutsFrom(layout: DashboardLayout): Layouts {
  return {
    lg: layout.layouts.lg,
    md: layout.layouts.md ?? stacked(layout.layouts.lg, 8),
    sm: layout.layouts.sm ?? stacked(layout.layouts.lg, 4),
  };
}

export default function DashboardPage({
  live,
  onCommand,
  onQuickText,
  notify,
}: {
  live: LiveState;
  onCommand: (payload: Record<string, unknown>) => void;
  onQuickText: (text: string) => void;
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [dashboard, setDashboard] = useState<DashboardLayout | null>(null);
  const [layouts, setLayouts] = useState<Layouts>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .layout()
      .then((result) => {
        setDashboard(result.layout);
        setLayouts(layoutsFrom(result.layout));
      })
      .catch((error) => notify(error instanceof ApiError ? error.message : "Could not load layout", "error"));
  }, []);

  const widgetIds = useMemo(() => {
    if (!dashboard) return [];
    return [...new Set(layouts.lg?.map((item) => item.i) ?? Object.keys(dashboard.widgets))];
  }, [dashboard, layouts]);

  function renderWidget(id: string) {
    const widget = dashboard?.widgets[id];
    if (!widget) return <p className="muted">Unknown widget</p>;
    switch (widget.type) {
      case "pages":
        return <PageList live={live} onCommand={onCommand} />;
      case "setlist":
        return <ItemList live={live} onCommand={onCommand} />;
      case "preview":
        return <SlidePreview live={live} compact />;
      case "transport":
        return <Transport live={live} onCommand={onCommand} compact />;
      case "quicktext":
        return <QuickText onSend={onQuickText} />;
      default:
        return <p className="muted">Widget type “{widget.type}” is not available yet.</p>;
    }
  }

  async function save() {
    if (!dashboard) return;
    setSaving(true);
    try {
      const next: DashboardLayout = {
        version: 1,
        layouts: {
          lg: (layouts.lg ?? []) as Layout[],
          md: (layouts.md ?? []) as Layout[],
          sm: (layouts.sm ?? []) as Layout[],
        },
        widgets: dashboard.widgets,
      };
      const result = await api.saveLayout(next);
      setDashboard(result.layout);
      setEditing(false);
      notify("Dashboard layout saved");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save layout", "error");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    try {
      const result = await api.resetLayout();
      setDashboard(result.layout);
      setLayouts(layoutsFrom(result.layout));
      notify("Layout reset to default");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not reset layout", "error");
    }
  }

  if (!dashboard) return <div className="panel">Loading dashboard…</div>;

  return (
    <section className="dashboard-page">
      <div className="dashboard-toolbar panel">
        <div>
          <h2>Dashboard layout</h2>
          <p className="muted">Drag widgets by their title bar and resize from the corner. Saved per user.</p>
        </div>
        <div className="button-row">
          {editing ? (
            <>
              <button className="button ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="button primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save layout"}
              </button>
            </>
          ) : (
            <>
              <button className="button ghost" onClick={reset}>
                Reset
              </button>
              <button className="button primary" onClick={() => setEditing(true)}>
                Customise
              </button>
            </>
          )}
        </div>
      </div>

      <div className={`dashboard-grid ${editing ? "editing" : ""}`}>
        <ResponsiveGridLayout
          className="layout"
          layouts={layouts}
          breakpoints={{ lg: 1200, md: 900, sm: 600 }}
          cols={{ lg: 12, md: 8, sm: 4 }}
          rowHeight={30}
          margin={[12, 12]}
          isDraggable={editing}
          isResizable={editing}
          draggableHandle=".widget-head"
          onLayoutChange={(_current: Layout[], all: Layouts) => setLayouts(all)}
        >
          {widgetIds.map((id) => (
            <div key={id} className="grid-widget">
              <div className="widget-head">
                <span>{dashboard.widgets[id]?.type ?? id}</span>
                <span className="widget-handle">⠿</span>
              </div>
              <div className="widget-body">{renderWidget(id)}</div>
            </div>
          ))}
        </ResponsiveGridLayout>
      </div>
    </section>
  );
}
