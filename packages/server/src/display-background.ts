import type { DisplayBackground } from "@sm/shared";
import { OUTPUT_TOKEN } from "./config.js";
import { getBackground } from "./backgrounds.js";
import { resolveImage } from "./images.js";

function patternCss(background: Extract<DisplayBackground, { type: "pattern" }>): string {
  const { background: base, foreground } = background;
  switch (background.preset) {
    case "stripes":
      return `repeating-linear-gradient(45deg, ${foreground} 0 10px, ${base} 10px 20px)`;
    case "dots":
      return `radial-gradient(${foreground} 1.5px, transparent 1.7px) 0 0 / 22px 22px, ${base}`;
    case "grid":
      return `linear-gradient(${foreground} 1px, transparent 1px) 0 0 / 32px 32px, linear-gradient(90deg, ${foreground} 1px, transparent 1px) 0 0 / 32px 32px, ${base}`;
    case "waves":
      return `repeating-radial-gradient(circle at 50% 65%, ${base} 0 14px, ${foreground} 15px 17px, ${base} 18px 30px)`;
  }
}

export function renderDisplayBackground(background: DisplayBackground): string | null {
  switch (background.type) {
    case "none":
      return null;
    case "color":
      return `<div class="sm-bg-fill" style="background:${background.color}"></div>`;
    case "gradient":
      return `<div class="sm-bg-fill" style="background:linear-gradient(${background.angle}deg, ${background.from}, ${background.to})"></div>`;
    case "pattern":
      return `<div class="sm-bg-fill" style="background:${patternCss(background)}"></div>`;
    case "asset":
      return getBackground(background.backgroundId)?.render ?? null;
    case "image": {
      const relative = background.path.replace(/\\/g, "/").replace(/^\/+/, "");
      if (!resolveImage(relative)) return null;
      const url = `/display/images/file?path=${encodeURIComponent(relative)}&token=${encodeURIComponent(OUTPUT_TOKEN)}`;
      return `<div class="sm-bg-fill sm-bg-image" style="background-image:url('${url}');background-size:cover;background-position:center"></div>`;
    }
  }
}
