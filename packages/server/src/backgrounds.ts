import { randomUUID } from "node:crypto";
import type {
  BackgroundAsset,
  BackgroundColors,
  BackgroundInput,
  BackgroundKind,
} from "@sm/shared";
import { OUTPUT_TOKEN } from "./config.js";
import { db } from "./db.js";

interface BackgroundRow {
  id: string;
  name: string;
  kind: BackgroundKind;
  preset: string | null;
  image_path: string | null;
  use_global_colors: number;
  colors_json: string;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_BACKGROUND_COLORS: BackgroundColors = {
  background: "#07111f",
  primary: "#4cc2ff",
  secondary: "#a78bfa",
  accent: "#fb7185",
};

export const BUILTIN_BACKGROUNDS: Array<{
  id: string;
  name: string;
  kind: "css" | "svg";
  preset: string;
  colors: BackgroundColors;
  useGlobalColors: boolean;
}> = [
  {
    id: "background-aurora",
    name: "Aurora Wash",
    kind: "css",
    preset: "aurora",
    colors: { background: "#06131d", primary: "#2dd4bf", secondary: "#818cf8", accent: "#f0abfc" },
    useGlobalColors: false,
  },
  {
    id: "background-silk",
    name: "Silk Mesh",
    kind: "css",
    preset: "silk",
    colors: { background: "#120b24", primary: "#a78bfa", secondary: "#f472b6", accent: "#67e8f9" },
    useGlobalColors: false,
  },
  {
    id: "background-ripples",
    name: "Soft Ripples",
    kind: "css",
    preset: "ripples",
    colors: { background: "#061019", primary: "#38bdf8", secondary: "#7dd3fc", accent: "#e0f2fe" },
    useGlobalColors: false,
  },
  {
    id: "background-neon-grid",
    name: "Neon Grid",
    kind: "css",
    preset: "neon-grid",
    colors: { background: "#05010f", primary: "#f0abfc", secondary: "#22d3ee", accent: "#facc15" },
    useGlobalColors: false,
  },
  {
    id: "background-stardust",
    name: "Star Dust",
    kind: "svg",
    preset: "stardust",
    colors: { background: "#030712", primary: "#e0f2fe", secondary: "#7dd3fc", accent: "#fef3c7" },
    useGlobalColors: false,
  },
  {
    id: "background-orbits",
    name: "Orbital Drift",
    kind: "svg",
    preset: "orbits",
    colors: { background: "#08111f", primary: "#38bdf8", secondary: "#c084fc", accent: "#fbbf24" },
    useGlobalColors: false,
  },
  {
    id: "background-confetti",
    name: "Confetti Storm",
    kind: "svg",
    preset: "confetti",
    colors: { background: "#12061a", primary: "#f472b6", secondary: "#22d3ee", accent: "#facc15" },
    useGlobalColors: false,
  },
];

const KNOWN_PRESETS = new Map(
  BUILTIN_BACKGROUNDS.map((preset) => [preset.preset, preset.kind]),
);

function hexAlpha(color: string, alpha: string): string {
  return `${color}${alpha}`;
}

function cssPreset(preset: string, colors: BackgroundColors): string {
  const background = colors.background;
  const primary = colors.primary;
  const secondary = colors.secondary;
  const accent = colors.accent;

  if (preset === "aurora") {
    return `<style>
      .sm-bg-aurora{position:absolute;inset:-12%;background:
        radial-gradient(circle at 24% 32%, ${hexAlpha(primary, "88")}, transparent 42%),
        radial-gradient(circle at 76% 64%, ${hexAlpha(secondary, "77")}, transparent 40%),
        radial-gradient(circle at 52% 84%, ${hexAlpha(accent, "55")}, transparent 42%),
        ${background};filter:saturate(1.15);animation:smBgAurora 26s ease-in-out infinite alternate}
      @keyframes smBgAurora{0%{transform:scale(1) translate3d(-2%,-1%,0)}100%{transform:scale(1.12) translate3d(2%,2%,0)}}
    </style><div class="sm-bg-fill sm-bg-aurora"></div>`;
  }
  if (preset === "silk") {
    return `<style>
      .sm-bg-silk{position:absolute;inset:-20%;background:
        radial-gradient(ellipse at 20% 30%, ${hexAlpha(primary, "99")}, transparent 35%),
        radial-gradient(ellipse at 80% 22%, ${hexAlpha(secondary, "88")}, transparent 32%),
        radial-gradient(ellipse at 62% 80%, ${hexAlpha(accent, "77")}, transparent 38%),
        ${background};filter:blur(22px) saturate(1.3);animation:smBgSilk 18s ease-in-out infinite alternate}
      @keyframes smBgSilk{0%{transform:rotate(-3deg) scale(1)}50%{transform:rotate(2deg) scale(1.08)}100%{transform:rotate(-1deg) scale(1.03)}}
    </style><div class="sm-bg-fill sm-bg-silk"></div>`;
  }
  if (preset === "ripples") {
    return `<style>
      .sm-bg-ripples{position:absolute;inset:0;background:
        radial-gradient(circle at 50% 52%, transparent 0 12%, ${hexAlpha(primary, "55")} 12.5% 13%, transparent 13.5% 22%, ${hexAlpha(secondary, "44")} 22.5% 23%, transparent 23.5% 34%, ${hexAlpha(accent, "33")} 34.5% 35%, transparent 35.5%),
        ${background};animation:smBgRipples 9s ease-in-out infinite}
      @keyframes smBgRipples{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.08);opacity:1}}
    </style><div class="sm-bg-fill sm-bg-ripples"></div>`;
  }
  return `<style>
    .sm-bg-neon{position:absolute;inset:0;background:
      linear-gradient(${hexAlpha(primary, "77")} 2px, transparent 2px) 0 0/64px 64px,
      linear-gradient(90deg, ${hexAlpha(secondary, "66")} 2px, transparent 2px) 0 0/64px 64px,
      radial-gradient(circle at 50% 116%, ${hexAlpha(accent, "99")}, transparent 48%),
      ${background};filter:saturate(1.35);animation:smBgGrid 3s linear infinite}
    .sm-bg-neon::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,${hexAlpha(background, "99")},transparent 26%,transparent 72%,${hexAlpha(background, "aa")});animation:smBgNeonPulse 2.4s ease-in-out infinite}
    @keyframes smBgGrid{from{background-position:0 0,0 0,center,0 0}to{background-position:0 64px,64px 0,center,0 0}}
    @keyframes smBgNeonPulse{0%,100%{opacity:.55}50%{opacity:.9}}
  </style><div class="sm-bg-fill sm-bg-neon"></div>`;
}

function svgPreset(preset: string, colors: BackgroundColors): string {
  if (preset === "orbits") {
    return `<style>
      .sm-bg-orbits .orbit{transform-origin:800px 450px;animation:smBgOrbit 20s linear infinite}
      .sm-bg-orbits .orbit.rev{animation-direction:reverse;animation-duration:28s}
      .sm-bg-orbits .orbit.slow{animation-duration:36s}
      @keyframes smBgOrbit{to{transform:rotate(360deg)}}
    </style><div class="sm-bg-fill sm-bg-orbits"><svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
      <rect width="1600" height="900" fill="${colors.background}"/>
      <g class="orbit"><ellipse cx="800" cy="450" rx="520" ry="250" fill="none" stroke="${hexAlpha(colors.primary, "66")}" stroke-width="2" stroke-dasharray="5 16"/><circle cx="1320" cy="450" r="12" fill="${colors.primary}"/></g>
      <g class="orbit rev"><ellipse cx="800" cy="450" rx="350" ry="520" fill="none" stroke="${hexAlpha(colors.secondary, "55")}" stroke-width="2"/><circle cx="800" cy="-70" r="9" fill="${colors.secondary}"/></g>
      <g class="orbit slow"><ellipse cx="800" cy="450" rx="700" ry="170" fill="none" stroke="${hexAlpha(colors.accent, "55")}" stroke-width="2" stroke-dasharray="2 14"/><circle cx="1500" cy="450" r="7" fill="${colors.accent}"/></g>
      <circle cx="800" cy="450" r="150" fill="url(#smOrbGlow)" opacity=".65"/>
      <defs><radialGradient id="smOrbGlow"><stop stop-color="${hexAlpha(colors.primary, "66")}"/><stop offset="1" stop-color="${hexAlpha(colors.background, "00")}"/></radialGradient></defs>
    </svg></div>`;
  }
  if (preset === "confetti") {
    const pieces = Array.from({ length: 34 }, (_, index) => {
      const x = 30 + ((index * 137) % 1540);
      const color = [colors.primary, colors.secondary, colors.accent][index % 3];
      const delay = (index % 11) * 0.6;
      const duration = 7 + (index % 7) * 0.8;
      const rotation = 240 + (index % 5) * 140;
      return `<rect x="${x}" y="-40" width="${7 + (index % 4) * 2}" height="${18 + (index % 3) * 5}" rx="2" fill="${hexAlpha(color, "dd")}" transform="rotate(${index * 23} ${x} 0)">
        <animateTransform attributeName="transform" type="translate" values="0 -80; 0 980" dur="${duration}s" begin="${delay}s" repeatCount="indefinite"/>
        <animateTransform attributeName="transform" type="rotate" values="0 ${x} 0;${rotation} ${x} 0" dur="${duration}s" begin="${delay}s" repeatCount="indefinite" additive="sum"/>
      </rect>`;
    }).join("");
    return `<div class="sm-bg-fill sm-bg-confetti"><svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
      <rect width="1600" height="900" fill="${colors.background}"/>${pieces}
    </svg></div>`;
  }
  const stars = Array.from({ length: 46 }, (_, index) => {
    const x = 20 + ((index * 211) % 1560);
    const y = 20 + ((index * 127) % 860);
    const r = 1 + (index % 3) * 0.7;
    const color = [colors.primary, colors.secondary, colors.accent][index % 3];
    const duration = 3 + (index % 6);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}">
      <animate attributeName="opacity" values="0.15;0.95;0.15" dur="${duration}s" begin="${(index % 9) * 0.4}s" repeatCount="indefinite"/>
      <animateTransform attributeName="transform" type="translate" values="0 0;${index % 2 ? 18 : -14} ${-12 - (index % 5) * 4};0 0" dur="${duration + 5}s" repeatCount="indefinite"/>
    </circle>`;
  }).join("");
  return `<div class="sm-bg-fill sm-bg-stars"><svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" width="100%" height="100%">
    <rect width="1600" height="900" fill="${colors.background}"/>${stars}
  </svg></div>`;
}

function renderBackground(row: BackgroundRow, theme: BackgroundColors): string {
  const ownColors = JSON.parse(row.colors_json) as BackgroundColors;
  const colors = row.use_global_colors ? theme : ownColors;
  if (row.kind === "image" && row.image_path) {
    const url = `/display/images/file?path=${encodeURIComponent(row.image_path)}&token=${encodeURIComponent(OUTPUT_TOKEN)}`;
    return `<div class="sm-bg-fill sm-bg-image" style="background-image:url('${url}');background-size:cover;background-position:center"></div>`;
  }
  if (row.kind === "css" && row.preset) return cssPreset(row.preset, colors);
  if (row.kind === "svg" && row.preset) return svgPreset(row.preset, colors);
  return `<div class="sm-bg-fill" style="background:${colors.background}"></div>`;
}

function mapRow(row: BackgroundRow, theme: BackgroundColors): BackgroundAsset {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    preset: row.preset,
    imagePath: row.image_path,
    useGlobalColors: Boolean(row.use_global_colors),
    colors: JSON.parse(row.colors_json) as BackgroundColors,
    render: renderBackground(row, theme),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getBackgroundColors(): BackgroundColors {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'background_colors'").get() as
    | { value: string }
    | undefined;
  if (!row) return DEFAULT_BACKGROUND_COLORS;
  try {
    const parsed = JSON.parse(row.value) as Partial<BackgroundColors>;
    return {
      background: parsed.background ?? DEFAULT_BACKGROUND_COLORS.background,
      primary: parsed.primary ?? DEFAULT_BACKGROUND_COLORS.primary,
      secondary: parsed.secondary ?? DEFAULT_BACKGROUND_COLORS.secondary,
      accent: parsed.accent ?? DEFAULT_BACKGROUND_COLORS.accent,
    };
  } catch {
    return DEFAULT_BACKGROUND_COLORS;
  }
}

export function saveBackgroundColors(colors: BackgroundColors): BackgroundColors {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('background_colors', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(JSON.stringify(colors), new Date().toISOString());
  return getBackgroundColors();
}

export function listBackgrounds(): BackgroundAsset[] {
  const theme = getBackgroundColors();
  return (
    db.prepare("SELECT * FROM backgrounds ORDER BY name COLLATE NOCASE").all() as BackgroundRow[]
  ).map((row) => mapRow(row, theme));
}

export function getBackground(id: string): BackgroundAsset | null {
  const row = db.prepare("SELECT * FROM backgrounds WHERE id = ?").get(id) as
    | BackgroundRow
    | undefined;
  return row ? mapRow(row, getBackgroundColors()) : null;
}

export function createBackground(input: BackgroundInput): BackgroundAsset {
  if (input.kind !== "image") {
    const presetKind = input.preset ? KNOWN_PRESETS.get(input.preset) : undefined;
    if (!presetKind || presetKind !== input.kind) {
      throw new Error("Unknown animated background preset");
    }
  }
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO backgrounds
     (id, name, kind, preset, image_path, use_global_colors, colors_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.kind,
    input.preset ?? null,
    input.imagePath ?? null,
    input.useGlobalColors ? 1 : 0,
    JSON.stringify(input.colors ?? DEFAULT_BACKGROUND_COLORS),
    timestamp,
    timestamp,
  );
  return getBackground(id)!;
}

export function updateBackground(id: string, input: BackgroundInput): BackgroundAsset | null {
  if (!getBackground(id)) return null;
  db.prepare(
    `UPDATE backgrounds SET name = ?, kind = ?, preset = ?, image_path = ?,
     use_global_colors = ?, colors_json = ?, updated_at = ? WHERE id = ?`,
  ).run(
    input.name,
    input.kind,
    input.preset ?? null,
    input.imagePath ?? null,
    input.useGlobalColors ? 1 : 0,
    JSON.stringify(input.colors ?? DEFAULT_BACKGROUND_COLORS),
    new Date().toISOString(),
    id,
  );
  return getBackground(id);
}

export function deleteBackground(id: string): boolean {
  const remove = db.transaction(() => {
    db.prepare("UPDATE setlists SET background_id = NULL WHERE background_id = ?").run(id);
    db.prepare("UPDATE setlist_items SET background_id = NULL WHERE background_id = ?").run(id);
    return db.prepare("DELETE FROM backgrounds WHERE id = ?").run(id).changes > 0;
  });
  return remove();
}

function seedBuiltInBackgrounds(): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO backgrounds
     (id, name, kind, preset, image_path, use_global_colors, colors_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  );
  const timestamp = new Date().toISOString();
  for (const preset of BUILTIN_BACKGROUNDS) {
    insert.run(
      preset.id,
      preset.name,
      preset.kind,
      preset.preset,
      preset.useGlobalColors ? 1 : 0,
      JSON.stringify(preset.colors),
      timestamp,
      timestamp,
    );
  }
}

seedBuiltInBackgrounds();
