import fs from "node:fs";
import path from "node:path";
import type { DisplayTemplate } from "@sm/shared";
import { DISPLAY_DIR, GIT_REPOS, TEMPLATES_DIR } from "./config.js";

const ROLES = ["main", "two_thirds", "full", "stage", "chords"] as const;
type Role = (typeof ROLES)[number];

const TEMPLATE_NAMES: Record<Role, string[]> = {
  main: ["lowerthird", "twothirds", "lower", "main"],
  two_thirds: ["two_thirds"],
  full: ["full", "fullscreen", "mainfull"],
  stage: ["stage"],
  chords: ["chords"],
};

const FALLBACK_HTML = (role: string) =>
  `<div class="sm-template sm-${role}"><div class="sm-content">{{content}}</div><div class="sm-footer">{{footer}}</div></div>`;

const FALLBACK_CSS = `
.sm-template { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4vh 5vw; gap: 2vh; }
.sm-content { width: 100%; text-align: center; }
.sm-footer { color: rgba(255,255,255,.65); font-size: .35em; }
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
    for (const name of TEMPLATE_NAMES[role]) {
      const htmlFile = path.join(dir, `${name}.html`);
      if (!fs.existsSync(htmlFile)) continue;
      try {
        const html = fs.readFileSync(htmlFile, "utf8");
        const cssFile = path.join(dir, `${name}.css`);
        const css = fs.existsSync(cssFile) ? fs.readFileSync(cssFile, "utf8") : "";
        return { html, css };
      } catch {
        // Try the next location/name.
      }
    }
  }
  return null;
}

export function resolveTemplate(role: Role, setlistId: string | null): DisplayTemplate {
  const direct = readTemplate(role, setlistId);
  if (direct) return direct;
  return { html: FALLBACK_HTML(role), css: FALLBACK_CSS };
}

export function resolveTemplates(setlistId: string | null): Record<string, DisplayTemplate> {
  return Object.fromEntries(ROLES.map((role) => [role, resolveTemplate(role, setlistId)]));
}
