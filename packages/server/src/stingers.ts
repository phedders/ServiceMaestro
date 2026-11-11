import { randomUUID } from "node:crypto";
import type { StingerAsset, StingerInput, StingerKind } from "@sm/shared";
import { OUTPUT_TOKEN } from "./config.js";
import { db } from "./db.js";

interface StingerRow {
  id: string;
  name: string;
  kind: StingerKind;
  preset: string | null;
  image_path: string | null;
  duration_ms: number;
  created_at: string;
  updated_at: string;
}

export const BUILTIN_STINGERS: Array<{
  id: string;
  name: string;
  kind: "svg";
  preset: string;
  durationMs: number;
}> = [
  { id: "stinger-iris-bloom", name: "Iris Bloom", kind: "svg", preset: "iris-bloom", durationMs: 1200 },
  { id: "stinger-shutter-split", name: "Shutter Split", kind: "svg", preset: "shutter-split", durationMs: 1050 },
  { id: "stinger-diagonal-sweep", name: "Diagonal Sweep", kind: "svg", preset: "diagonal-sweep", durationMs: 1000 },
  { id: "stinger-liquid-morph", name: "Liquid Morph", kind: "svg", preset: "liquid-morph", durationMs: 1300 },
  { id: "stinger-glitch-mosaic", name: "Glitch Mosaic", kind: "svg", preset: "glitch-mosaic", durationMs: 900 },
  { id: "stinger-prism-fold", name: "Prism Fold", kind: "svg", preset: "prism-fold", durationMs: 1050 },
  { id: "stinger-neon-vortex", name: "Neon Vortex", kind: "svg", preset: "neon-vortex", durationMs: 1200 },
  { id: "stinger-bubble-rise", name: "Bubble Rise", kind: "svg", preset: "bubble-rise", durationMs: 1250 },
  { id: "stinger-pixel-cascade", name: "Pixel Cascade", kind: "svg", preset: "pixel-cascade", durationMs: 900 },
  { id: "stinger-curtain-call", name: "Curtain Call", kind: "svg", preset: "curtain-call", durationMs: 1150 },
  { id: "stinger-supernova", name: "Supernova", kind: "svg", preset: "supernova", durationMs: 950 },
];

const KNOWN_PRESETS = new Map(BUILTIN_STINGERS.map((preset) => [preset.preset, preset]));

function durationStyle(durationMs: number): string {
  return `${durationMs}ms`;
}

function irisBloom(durationMs: number): string {
  const dur = durationStyle(durationMs);
  return `<svg class="sm-stinger-fill" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="smStIrisGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0ea5e9"/>
        <stop offset="0.52" stop-color="#6d28d9"/>
        <stop offset="1" stop-color="#db2777"/>
      </linearGradient>
      <mask id="smStIrisMask">
        <rect width="1600" height="900" fill="white"/>
        <circle cx="800" cy="450" r="1200" fill="black">
          <animate attributeName="r" values="1200;0;0;1200" keyTimes="0;0.44;0.60;1" dur="${dur}" repeatCount="indefinite"/>
        </circle>
      </mask>
    </defs>
    <rect width="1600" height="900" fill="url(#smStIrisGrad)" mask="url(#smStIrisMask)"/>
    <g fill="none" stroke="#ffffff" stroke-width="2" opacity="0.7">
      <circle cx="800" cy="450" r="260">
        <animate attributeName="r" values="260;0;0;260" keyTimes="0;0.44;0.60;1" dur="${dur}" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;0.85;0.85;0" keyTimes="0;0.44;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      </circle>
      <circle cx="800" cy="450" r="390" stroke-dasharray="10 18">
        <animate attributeName="r" values="390;0;0;390" keyTimes="0;0.44;0.60;1" dur="${dur}" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;0.5;0.5;0" keyTimes="0;0.44;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      </circle>
    </g>
  </svg>`;
}

function shutterSplit(durationMs: number): string {
  const dur = durationStyle(durationMs);
  return `<svg class="sm-stinger-fill" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="smStShutterTop" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0f172a"/>
        <stop offset="0.62" stop-color="#0e7490"/>
        <stop offset="1" stop-color="#38bdf8"/>
      </linearGradient>
      <linearGradient id="smStShutterBottom" x1="1" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#111827"/>
        <stop offset="0.55" stop-color="#7c3aed"/>
        <stop offset="1" stop-color="#f472b6"/>
      </linearGradient>
      <pattern id="smStShutterLines" width="90" height="90" patternUnits="userSpaceOnUse">
        <path d="M0 90 L90 0" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2"/>
      </pattern>
    </defs>
    <g>
      <animateTransform attributeName="transform" type="translate" values="0 -470;0 0;0 0;0 -470" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      <rect x="0" y="-10" width="1600" height="480" fill="url(#smStShutterTop)"/>
      <rect x="0" y="-10" width="1600" height="480" fill="url(#smStShutterLines)"/>
    </g>
    <g>
      <animateTransform attributeName="transform" type="translate" values="0 470;0 0;0 0;0 470" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      <rect x="0" y="440" width="1600" height="480" fill="url(#smStShutterBottom)"/>
      <rect x="0" y="440" width="1600" height="480" fill="url(#smStShutterLines)"/>
    </g>
    <rect x="0" y="445" width="1600" height="8" fill="#ffffff" opacity="0.88">
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
    </rect>
  </svg>`;
}

function diagonalSweep(durationMs: number): string {
  const dur = durationStyle(durationMs);
  return `<svg class="sm-stinger-fill" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="smStSweepMain" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#082f49"/>
        <stop offset="0.48" stop-color="#0369a1"/>
        <stop offset="1" stop-color="#22d3ee"/>
      </linearGradient>
      <linearGradient id="smStSweepAccent" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#7c3aed"/>
        <stop offset="1" stop-color="#f472b6"/>
      </linearGradient>
    </defs>
    <g>
      <animateTransform attributeName="transform" type="translate" values="-2100 -120;0 0;0 0;2100 120" keyTimes="0;0.44;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      <polygon points="0,0 2240,0 1880,900 -360,900" fill="url(#smStSweepMain)"/>
      <g stroke="#ffffff" stroke-opacity="0.18" stroke-width="2">
        <path d="M240 0 L60 900"/><path d="M560 0 L380 900"/><path d="M880 0 L700 900"/>
        <path d="M1200 0 L1020 900"/><path d="M1520 0 L1340 900"/><path d="M1840 0 L1660 900"/>
      </g>
    </g>
    <g opacity="0.82">
      <animateTransform attributeName="transform" type="translate" values="-2500 120;0 0;0 0;2500 -120" keyTimes="0;0.44;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      <polygon points="300,0 520,0 120,900 -100,900" fill="url(#smStSweepAccent)"/>
    </g>
  </svg>`;
}

function liquidMorph(durationMs: number): string {
  const dur = durationStyle(durationMs);
  const circles: Array<[number, number, number, string]> = [
    [120, 140, 520, "#0e7490"],
    [540, 80, 470, "#0891b2"],
    [980, 160, 520, "#6d28d9"],
    [1450, 120, 500, "#7c3aed"],
    [260, 620, 560, "#0f766e"],
    [760, 500, 590, "#0ea5e9"],
    [1180, 680, 540, "#a21caf"],
    [1540, 640, 520, "#db2777"],
    [520, 900, 500, "#7c3aed"],
    [1120, 940, 540, "#0e7490"],
  ];
  return `<svg class="sm-stinger-fill" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    ${circles
      .map(
        ([cx, cy, r, color], index) =>
          `<circle cx="${cx}" cy="${cy}" r="0" fill="${color}" opacity="${index % 3 === 0 ? "1" : "0.94"}">
            <animate attributeName="r" values="0;${r};${r};0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
          </circle>`,
      )
      .join("")}
    <g fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2">
      <circle cx="800" cy="450" r="250">
        <animate attributeName="r" values="0;250;250;0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      </circle>
      <circle cx="800" cy="450" r="420" stroke-dasharray="6 20">
        <animate attributeName="r" values="0;420;420;0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      </circle>
    </g>
  </svg>`;
}

function glitchMosaic(durationMs: number): string {
  const dur = durationStyle(durationMs);
  const colors = ["#0ea5e9", "#a855f7", "#f43f5e", "#facc15", "#22d3ee", "#7c3aed"];
  const tiles: string[] = [];
  const cols = 8;
  const rows = 5;
  const width = 1600 / cols;
  const height = 900 / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const color = colors[(row * cols + col) % colors.length];
      tiles.push(
        `<rect x="${col * width}" y="${row * height}" width="${width + 1}" height="${height + 1}" fill="${color}">
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
        </rect>`,
      );
    }
  }
  return `<svg class="sm-stinger-fill" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    ${tiles.join("")}
    <g fill="#ffffff" opacity="0.88">
      <rect x="0" y="270" width="1600" height="10">
        <animate attributeName="opacity" values="0;0.95;0.95;0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      </rect>
      <rect x="0" y="620" width="1600" height="6">
        <animate attributeName="opacity" values="0;0.75;0.75;0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      </rect>
    </g>
  </svg>`;
}

function prismFold(durationMs: number): string {
  const dur = durationStyle(durationMs);
  return `<svg class="sm-stinger-fill" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="smStPrismL" x1="0" y1="0" x2="1" y2="0.7">
        <stop offset="0" stop-color="#082f49"/>
        <stop offset="0.55" stop-color="#0284c7"/>
        <stop offset="1" stop-color="#67e8f9"/>
      </linearGradient>
      <linearGradient id="smStPrismR" x1="1" y1="0" x2="0" y2="0.7">
        <stop offset="0" stop-color="#3b0764"/>
        <stop offset="0.5" stop-color="#7c3aed"/>
        <stop offset="1" stop-color="#f472b6"/>
      </linearGradient>
    </defs>
    <g>
      <animateTransform attributeName="transform" type="translate" values="-940 0;0 0;0 0;-940 0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      <polygon points="0,0 980,0 840,900 0,900" fill="url(#smStPrismL)"/>
      <polygon points="0,0 730,0 590,900 0,900" fill="#ffffff" opacity="0.07"/>
      <path d="M180 0 L80 900 M360 0 L260 900 M540 0 L440 900" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2"/>
    </g>
    <g>
      <animateTransform attributeName="transform" type="translate" values="940 0;0 0;0 0;940 0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      <polygon points="620,0 1600,0 1600,900 760,900" fill="url(#smStPrismR)"/>
      <polygon points="870,0 1600,0 1600,900 1010,900" fill="#ffffff" opacity="0.07"/>
      <path d="M1180 0 L1280 900 M1360 0 L1460 900 M1540 0 L1600 780" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2"/>
    </g>
    <rect x="770" y="0" width="60" height="900" fill="#ffffff" opacity="0">
      <animate attributeName="opacity" values="0;0.85;0.85;0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
    </rect>
  </svg>`;
}

function neonVortex(durationMs: number): string {
  const dur = durationStyle(durationMs);
  const wedges = Array.from({ length: 24 }, (_, index) => {
    const angle = (index / 24) * Math.PI * 2;
    const half = Math.PI / 48;
    const radius = 1180;
    const x1 = 800 + Math.cos(angle - half) * radius;
    const y1 = 450 + Math.sin(angle - half) * radius;
    const x2 = 800 + Math.cos(angle + half) * radius;
    const y2 = 450 + Math.sin(angle + half) * radius;
    return `<polygon points="800,450 ${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="${index % 2 ? "#22d3ee" : "#a855f7"}" opacity="0.32"/>`;
  }).join("");
  return `<svg class="sm-stinger-fill" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <radialGradient id="smStVortexCore" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#67e8f9"/>
        <stop offset="0.32" stop-color="#0e7490"/>
        <stop offset="0.68" stop-color="#4c1d95"/>
        <stop offset="1" stop-color="#020617"/>
      </radialGradient>
    </defs>
    <circle cx="800" cy="450" r="0" fill="url(#smStVortexCore)">
      <animate attributeName="r" values="0;1050;1050;0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
    </circle>
    <g opacity="0">
      <animate attributeName="opacity" values="0;0.9;0.9;0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      <animateTransform attributeName="transform" type="rotate" values="0 800 450;360 800 450" dur="${dur}" repeatCount="indefinite"/>
      ${wedges}
      <circle cx="800" cy="450" r="430" fill="none" stroke="#e0f2fe" stroke-opacity="0.5" stroke-width="2" stroke-dasharray="8 22"/>
      <circle cx="800" cy="450" r="660" fill="none" stroke="#67e8f9" stroke-opacity="0.28" stroke-width="2"/>
    </g>
    <circle cx="800" cy="450" r="0" fill="none" stroke="#ffffff" stroke-width="5" opacity="0">
      <animate attributeName="r" values="0;760;760;0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.55;0.55;0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
    </circle>
  </svg>`;
}

function bubbleRise(durationMs: number): string {
  const dur = durationStyle(durationMs);
  const colors = ["#0e7490", "#0284c7", "#0f766e", "#7c3aed", "#a21caf", "#db2777"];
  const bubbles: string[] = [];
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      const index = row * 10 + col;
      const x = 80 + col * 160;
      const y = 80 + row * 160;
      const radius = 120 + (index % 3) * 8;
      bubbles.push(`<g>
        <animateTransform attributeName="transform" type="translate" values="0 200;0 0;0 0;0 -220" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
        <circle cx="${x}" cy="${y}" r="0" fill="${colors[index % colors.length]}" opacity="0.96">
          <animate attributeName="r" values="0;${radius};${radius};0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
        </circle>
        <circle cx="${x - radius * 0.28}" cy="${y - radius * 0.28}" r="0" fill="#ffffff" opacity="0.3">
          <animate attributeName="r" values="0;${(radius * 0.18).toFixed(1)};${(radius * 0.18).toFixed(1)};0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
        </circle>
      </g>`);
    }
  }
  return `<svg class="sm-stinger-fill" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    ${bubbles.join("")}
  </svg>`;
}

function pixelCascade(durationMs: number): string {
  const dur = durationStyle(durationMs);
  const colors = ["#0f172a", "#0e7490", "#0369a1", "#4c1d95", "#7c3aed", "#9d174d", "#0f766e"];
  const tiles: string[] = [];
  const cols = 16;
  const rows = 9;
  const width = 1600 / cols;
  const height = 900 / rows;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const start = (0.02 + ((col + row) / (cols + rows - 2)) * 0.2).toFixed(3);
      const color = colors[(row * 3 + col) % colors.length];
      tiles.push(
        `<rect x="${col * width}" y="${row * height}" width="${width + 1}" height="${height + 1}" fill="${color}" opacity="0">
          <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;${start};0.42;0.60;1" dur="${dur}" repeatCount="indefinite"/>
          <animateTransform attributeName="transform" type="translate" values="-60 -60;0 0;0 0;40 40" keyTimes="0;${start};0.60;1" dur="${dur}" repeatCount="indefinite"/>
        </rect>`,
      );
    }
  }
  return `<svg class="sm-stinger-fill" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    ${tiles.join("")}
    <g fill="#ffffff" opacity="0">
      <animate attributeName="opacity" values="0;0.9;0.9;0" keyTimes="0;0.42;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      <rect x="0" y="294" width="1600" height="8"/>
      <rect x="0" y="594" width="1600" height="4"/>
    </g>
  </svg>`;
}

function curtainCall(durationMs: number): string {
  const dur = durationStyle(durationMs);
  return `<svg class="sm-stinger-fill" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="smStCurtainL" x1="0" y1="0" x2="1" y2="0.15">
        <stop offset="0" stop-color="#27060f"/>
        <stop offset="0.55" stop-color="#881337"/>
        <stop offset="0.82" stop-color="#e11d48"/>
        <stop offset="1" stop-color="#fda4af"/>
      </linearGradient>
      <linearGradient id="smStCurtainR" x1="1" y1="0" x2="0" y2="0.15">
        <stop offset="0" stop-color="#27060f"/>
        <stop offset="0.55" stop-color="#881337"/>
        <stop offset="0.82" stop-color="#e11d48"/>
        <stop offset="1" stop-color="#fda4af"/>
      </linearGradient>
    </defs>
    <g>
      <animateTransform attributeName="transform" type="translate" values="-860 0;0 0;0 0;-860 0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      <rect x="0" y="0" width="840" height="900" fill="url(#smStCurtainL)"/>
      <path d="M120 0 C190 220 150 520 230 900 M330 0 C280 260 360 600 300 900 M520 0 C590 300 520 620 610 900" fill="none" stroke="#ffffff" stroke-opacity="0.1" stroke-width="26"/>
      <rect x="0" y="0" width="840" height="900" fill="url(#smStCurtainL)" opacity="0.28"/>
    </g>
    <g>
      <animateTransform attributeName="transform" type="translate" values="860 0;0 0;0 0;860 0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      <rect x="760" y="0" width="840" height="900" fill="url(#smStCurtainR)"/>
      <path d="M1480 0 C1410 220 1450 520 1370 900 M1270 0 C1320 260 1240 600 1300 900 M1080 0 C1010 300 1080 620 990 900" fill="none" stroke="#ffffff" stroke-opacity="0.1" stroke-width="26"/>
      <rect x="760" y="0" width="840" height="900" fill="url(#smStCurtainR)" opacity="0.28"/>
    </g>
    <rect x="786" y="0" width="28" height="900" fill="#facc15" opacity="0">
      <animate attributeName="opacity" values="0;0.92;0.92;0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
    </rect>
  </svg>`;
}

function supernova(durationMs: number): string {
  const dur = durationStyle(durationMs);
  const rays = Array.from({ length: 32 }, (_, index) => {
    const angle = (index / 32) * Math.PI * 2;
    const half = Math.PI / 64;
    const radius = 1200;
    const x1 = 800 + Math.cos(angle - half) * radius;
    const y1 = 450 + Math.sin(angle - half) * radius;
    const x2 = 800 + Math.cos(angle + half) * radius;
    const y2 = 450 + Math.sin(angle + half) * radius;
    return `<polygon points="800,450 ${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}" fill="${index % 2 ? "#fbbf24" : "#fb7185"}" opacity="0.34"/>`;
  }).join("");
  return `<svg class="sm-stinger-fill" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <radialGradient id="smStNovaCore" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#fffbeb"/>
        <stop offset="0.22" stop-color="#fde047"/>
        <stop offset="0.48" stop-color="#fb923c"/>
        <stop offset="0.74" stop-color="#be123c"/>
        <stop offset="1" stop-color="#3b0764"/>
      </radialGradient>
    </defs>
    <circle cx="800" cy="450" r="0" fill="url(#smStNovaCore)">
      <animate attributeName="r" values="0;1050;1050;0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
    </circle>
    <g opacity="0">
      <animate attributeName="opacity" values="0;0.95;0.95;0" keyTimes="0;0.42;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      <animateTransform attributeName="transform" type="rotate" values="-20 800 450;40 800 450" dur="${dur}" repeatCount="indefinite"/>
      ${rays}
    </g>
    <circle cx="800" cy="450" r="0" fill="#ffffff" opacity="0">
      <animate attributeName="r" values="0;250;250;0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;0.95;0.95;0" keyTimes="0;0.43;0.60;1" dur="${dur}" repeatCount="indefinite"/>
    </circle>
  </svg>`;
}

function renderPreset(preset: string, durationMs: number): string {
  if (preset === "iris-bloom") return irisBloom(durationMs);
  if (preset === "shutter-split") return shutterSplit(durationMs);
  if (preset === "diagonal-sweep") return diagonalSweep(durationMs);
  if (preset === "liquid-morph") return liquidMorph(durationMs);
  if (preset === "glitch-mosaic") return glitchMosaic(durationMs);
  if (preset === "prism-fold") return prismFold(durationMs);
  if (preset === "neon-vortex") return neonVortex(durationMs);
  if (preset === "bubble-rise") return bubbleRise(durationMs);
  if (preset === "pixel-cascade") return pixelCascade(durationMs);
  if (preset === "curtain-call") return curtainCall(durationMs);
  if (preset === "supernova") return supernova(durationMs);
  return `<svg class="sm-stinger-fill" viewBox="0 0 1600 900" aria-hidden="true"></svg>`;
}

function renderStinger(row: StingerRow): string {
  if (row.kind === "svg" && row.preset) return renderPreset(row.preset, row.duration_ms);
  if (row.kind === "image" && row.image_path) {
    const url = `/display/images/file?path=${encodeURIComponent(row.image_path)}&token=${encodeURIComponent(OUTPUT_TOKEN)}`;
    const token = row.id.replace(/[^a-z0-9_-]/gi, "");
    return `<style>
      @keyframes smStingerImageFade${token}{0%,100%{opacity:0;transform:scale(1.025)}12%{opacity:.96}44%,60%{opacity:1;transform:scale(1)}88%{opacity:.96}}
      .sm-stinger-image-${token}{position:absolute;inset:0;background-size:cover;background-position:center;animation:smStingerImageFade${token} ${row.duration_ms}ms ease-in-out infinite}
    </style><div class="sm-stinger-fill sm-stinger-image-${token}" style="background-image:url('${url}')"></div>`;
  }
  return `<svg class="sm-stinger-fill" viewBox="0 0 1600 900" aria-hidden="true"></svg>`;
}

function mapRow(row: StingerRow): StingerAsset {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    preset: row.preset,
    imagePath: row.image_path,
    durationMs: row.duration_ms,
    render: renderStinger(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listStingers(): StingerAsset[] {
  return (
    db.prepare("SELECT * FROM stingers ORDER BY name COLLATE NOCASE").all() as StingerRow[]
  ).map(mapRow);
}

export function getStinger(id: string): StingerAsset | null {
  const row = db.prepare("SELECT * FROM stingers WHERE id = ?").get(id) as
    | StingerRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function createStinger(input: StingerInput): StingerAsset {
  if (input.kind === "svg") {
    const preset = input.preset ? KNOWN_PRESETS.get(input.preset) : undefined;
    if (!preset) throw new Error("Unknown SVG stinger preset");
  }
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  db.prepare(
    `INSERT INTO stingers
     (id, name, kind, preset, image_path, duration_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.kind,
    input.preset ?? null,
    input.imagePath ?? null,
    input.durationMs,
    timestamp,
    timestamp,
  );
  return getStinger(id)!;
}

export function updateStinger(id: string, input: StingerInput): StingerAsset | null {
  if (!getStinger(id)) return null;
  if (input.kind === "svg") {
    const preset = input.preset ? KNOWN_PRESETS.get(input.preset) : undefined;
    if (!preset) throw new Error("Unknown SVG stinger preset");
  }
  db.prepare(
    `UPDATE stingers SET name = ?, kind = ?, preset = ?, image_path = ?, duration_ms = ?,
     updated_at = ? WHERE id = ?`,
  ).run(
    input.name,
    input.kind,
    input.preset ?? null,
    input.imagePath ?? null,
    input.durationMs,
    new Date().toISOString(),
    id,
  );
  return getStinger(id);
}

export function deleteStinger(id: string): boolean {
  const remove = db.transaction(() => {
    db.prepare("UPDATE setlists SET stinger_id = NULL WHERE stinger_id = ?").run(id);
    db.prepare("UPDATE setlist_items SET stinger_id = NULL WHERE stinger_id = ?").run(id);
    const rows = db
      .prepare("SELECT id, stinger_overrides_json FROM setlist_items WHERE stinger_overrides_json IS NOT NULL")
      .all() as Array<{ id: string; stinger_overrides_json: string }>;
    const update = db.prepare("UPDATE setlist_items SET stinger_overrides_json = ? WHERE id = ?");
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.stinger_overrides_json) as Record<string, unknown>;
        let changed = false;
        for (const [page, value] of Object.entries(parsed)) {
          if (value === id) {
            delete parsed[page];
            changed = true;
          }
        }
        if (changed) {
          update.run(Object.keys(parsed).length ? JSON.stringify(parsed) : null, row.id);
        }
      } catch {
        // Ignore malformed legacy override maps.
      }
    }
    return db.prepare("DELETE FROM stingers WHERE id = ?").run(id).changes > 0;
  });
  return remove();
}

function seedBuiltInStingers(): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO stingers
     (id, name, kind, preset, image_path, duration_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
  );
  const timestamp = new Date().toISOString();
  for (const preset of BUILTIN_STINGERS) {
    insert.run(
      preset.id,
      preset.name,
      preset.kind,
      preset.preset,
      preset.durationMs,
      timestamp,
      timestamp,
    );
  }
}

seedBuiltInStingers();
