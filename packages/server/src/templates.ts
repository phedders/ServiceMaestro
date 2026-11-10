import fs from "node:fs";
import path from "node:path";
import type { DisplayTemplate } from "@wlm/shared";
import { DISPLAY_DIR, GIT_REPOS, TEMPLATES_DIR } from "./config.js";

const ROLES = ["main", "two_thirds", "full", "stage", "chords"] as const;
type Role = (typeof ROLES)[number];

const FALLBACK_HTML = (role: string) =>
  `<div class="wlm-template wlm-${role}"><div class="wlm-content">{{content}}</div><div class="wlm-footer">{{footer}}</div></div>`;

const FALLBACK_CSS = `
.wlm-template { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4vh 5vw; gap: 2vh; }
.wlm-content { width: 100%; text-align: center; }
.wlm-footer { color: rgba(255,255,255,.65); font-size: .35em; }
`;

function directories(setlistId: string | null): string[] {
  const safeSetlist = setlistId?.replace(/[^a-zA-Z0-9-]/g, "");
  const dirs = [
    path.join(GIT_REPOS.setlists.path, "templates"),
    TEMPLATES_DIR,
    path.join(GIT_REPOS.templates.path, "templates"),
    GIT_REPOS.templates.path,
    path.join(DISPLAY_DIR, "templates"),
  ];
  if (safeSetlist) {
    dirs.unshift(path.join(GIT_REPOS.setlists.path, "templates", safeSetlist));
  }
  return dirs;
}

function readTemplate(role: Role, setlistId: string | null): DisplayTemplate | null {
  for (const dir of directories(setlistId)) {
    const htmlFile = path.join(dir, `${role}.html`);
    if (!fs.existsSync(htmlFile)) continue;
    try {
      const html = fs.readFileSync(htmlFile, "utf8");
      const cssFile = path.join(dir, `${role}.css`);
      const css = fs.existsSync(cssFile) ? fs.readFileSync(cssFile, "utf8") : "";
      return { html, css };
    } catch {
      // Try the next location.
    }
  }
  return null;
}

export function resolveTemplate(role: Role, setlistId: string | null): DisplayTemplate {
  const direct = readTemplate(role, setlistId);
  if (direct) return direct;
  if (role === "full") {
    const twoThirds = readTemplate("two_thirds", setlistId);
    if (twoThirds) return twoThirds;
  }
  return { html: FALLBACK_HTML(role), css: FALLBACK_CSS };
}

export function resolveTemplates(setlistId: string | null): Record<string, DisplayTemplate> {
  return Object.fromEntries(ROLES.map((role) => [role, resolveTemplate(role, setlistId)]));
}
