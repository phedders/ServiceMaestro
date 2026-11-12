import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import type {
  LivePage,
  TarpBackground,
  TarpObject,
  TarpObjectPlacement,
  TarpPage,
  TarpPresentationDetail,
  TarpTheme,
  TarpView,
} from "@sm/shared";
import { OUTPUT_TOKEN } from "./config.js";
import { getBackground } from "./backgrounds.js";
import { escapeHtml } from "./render.js";
import { getTarpPresentation, getTarpTheme } from "./tarp.js";

const DEFAULT_FONT = '"Clear Sans", "Segoe UI", system-ui, -apple-system, sans-serif';

function imageUrl(relative: string): string {
  return `/display/images/file?path=${encodeURIComponent(relative)}&token=${encodeURIComponent(OUTPUT_TOKEN)}`;
}

function backgroundStyle(background: TarpBackground | null): string {
  if (!background) return "";
  if (background.type === "color") return `background:${background.color};`;
  if (background.type === "gradient") {
    return `background:linear-gradient(${background.angle}deg,${background.from},${background.to});`;
  }
  return `background-image:url('${imageUrl(background.path)}');background-size:cover;background-position:center;`;
}

function markdownHtml(content: string): string {
  const html = marked.parse(content, { async: false }) as string;
  return sanitizeHtml(html, {
    allowedTags: [
      "p",
      "br",
      "strong",
      "em",
      "s",
      "mark",
      "code",
      "pre",
      "blockquote",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "a",
    ],
    allowedAttributes: {
      a: ["href", "target", "rel"],
      "*": ["class"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
    },
  });
}

function placementStyle(place: TarpObjectPlacement, view: TarpView, theme: TarpTheme | null): string {
  return [
    `left:${(place.x * 100).toFixed(4)}%`,
    `top:${(place.y * 100).toFixed(4)}%`,
    `width:${(place.width * 100).toFixed(4)}%`,
    `height:${(place.height * 100).toFixed(4)}%`,
    `transform:rotate(${place.rotation}deg)`,
    `opacity:${place.opacity}`,
    `color:${escapeHtml(place.color ?? view.textColor ?? theme?.textColor ?? "#ffffff")}`,
    `font-family:${escapeHtml(place.fontFamily ?? view.fontFamily ?? theme?.fontFamily ?? DEFAULT_FONT)}`,
    `font-size:${((place.fontSize ?? 0.06) * 100).toFixed(4)}cqh`,
    place.fontWeight ? `font-weight:${place.fontWeight}` : "",
    `text-align:${place.textAlign}`,
  ]
    .filter(Boolean)
    .join(";");
}

function renderObject(
  object: TarpObject,
  view: TarpView,
  theme: TarpTheme | null,
  viewKey: "normal" | "lowerthird",
): string {
  if (!object.visible) return "";
  const place = object[viewKey];
  const style = placementStyle(place, view, theme);
  if (object.kind === "text") {
    return `<div class="tarp-object tarp-object-text" style="${style}">${escapeHtml(object.content)}</div>`;
  }
  if (object.kind === "markdown") {
    return `<div class="tarp-object tarp-object-markdown" style="${style}">${markdownHtml(object.content)}</div>`;
  }
  if (!object.content.trim()) return "";
  return `<div class="tarp-object tarp-object-image" style="${style}"><img src="${escapeHtml(imageUrl(object.content))}" alt="" style="object-fit:${place.fit};" /></div>`;
}

function renderView(
  view: TarpView,
  theme: TarpTheme | null,
  viewKey: "normal" | "lowerthird",
): string {
  const libraryBackground = view.backgroundId ? getBackground(view.backgroundId) : null;
  const background = libraryBackground
    ? `<div class="tarp-background">${libraryBackground.render}</div>`
    : `<div class="tarp-background" style="${backgroundStyle(view.background ?? theme?.background ?? null)}"></div>`;
  const objects = view.objects
    .map((object) => renderObject(object, view, theme, viewKey))
    .join("");
  return `${background}${objects}`;
}

export function renderTarpPages(presentationId: string): LivePage[] {
  const presentation = getTarpPresentation(presentationId);
  if (!presentation) return [];
  return presentation.pages.map((page: TarpPage, index) => {
    const theme = getTarpTheme(page.themeId ?? presentation.themeId ?? "");
    const aspect = presentation.aspect === "16:10" ? 1.6 : 16 / 9;
    return {
      index,
      section: page.name,
      html: `<div class="tarp-page-root">
        <div class="tarp-normal-layer">
          <div class="tarp-canvas tarp-canvas-normal" style="--tarp-ratio:${aspect};--tarp-accent:${escapeHtml(theme?.accentColor ?? "#63c7ff")}">
            ${renderView(page.normal, theme, "normal")}
          </div>
        </div>
        <div class="tarp-lowerthird-layer">
          <div class="tarp-canvas tarp-canvas-lowerthird" style="--tarp-accent:${escapeHtml(theme?.accentColor ?? "#63c7ff")}">
            ${renderView(page.lowerthird, theme, "lowerthird")}
          </div>
        </div>
      </div>`,
    };
  });
}
