import type { DashboardLayout } from "@wlm/shared";

export const DEFAULT_LAYOUT: DashboardLayout = {
  version: 1,
  layouts: {
    lg: [
      { i: "pages", x: 0, y: 0, w: 6, h: 8, minW: 4, minH: 4 },
      { i: "preview", x: 6, y: 0, w: 6, h: 8, minW: 4, minH: 4 },
      { i: "setlist", x: 0, y: 8, w: 6, h: 8, minW: 4, minH: 4 },
      { i: "transport", x: 6, y: 8, w: 6, h: 4, minW: 4, minH: 3 },
      { i: "quicktext", x: 6, y: 12, w: 6, h: 4, minW: 4, minH: 3 },
    ],
  },
  widgets: {
    pages: { type: "pages" },
    preview: { type: "preview", props: { target: "full" } },
    setlist: { type: "setlist" },
    transport: { type: "transport" },
    quicktext: { type: "quicktext" },
  },
};
