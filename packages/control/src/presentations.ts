import type { ExternalPresentation, PresentationProvider } from "@sm/shared";

export interface ParsedPresentation {
  name: string;
  provider: PresentationProvider;
  openUrl: string;
  embedUrl: string;
  warning: string | null;
}

export function presentationProviderLabel(provider: PresentationProvider): string {
  switch (provider) {
    case "canva":
      return "Canva";
    case "powerpoint":
      return "PowerPoint";
    case "google_slides":
      return "Google Slides";
    case "other":
      return "External";
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function httpUrl(value: string): URL {
  const normalized = value.startsWith("//") ? `https:${value}` : value;
  const url = new URL(normalized);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP(S) presentation links are supported");
  }
  return url;
}

function providerFor(url: URL): PresentationProvider {
  const host = url.hostname.toLowerCase();
  if (host === "canva.com" || host.endsWith(".canva.com")) return "canva";
  if (
    host === "docs.google.com" &&
    url.pathname.startsWith("/presentation/")
  ) {
    return "google_slides";
  }
  if (
    host.includes("sharepoint.com") ||
    host.includes("onedrive.live.com") ||
    host.includes("1drv.ms") ||
    host.includes("officeapps.live.com") ||
    host.includes("powerpoint.cloud.microsoft")
  ) {
    return "powerpoint";
  }
  return "other";
}

export function presentationWarning(
  presentation: Pick<ExternalPresentation, "provider" | "embedUrl">,
): string | null {
  if (
    presentation.provider === "powerpoint" &&
    !/[?&]action=embedview(?:&|$)/i.test(presentation.embedUrl) &&
    !/embed\.aspx/i.test(presentation.embedUrl)
  ) {
    return "This looks like a normal SharePoint/OneDrive share link. It may require sign-in and can block framing. Use PowerPoint’s “Embed this Presentation” iframe code for embedded playback, or use Open in new window.";
  }
  return null;
}

function canvaDesignId(url: URL): string | null {
  return url.pathname.match(/^\/design\/([^/]+)/)?.[1] ?? null;
}

function googleSlidesId(url: URL): string | null {
  return url.pathname.match(/^\/presentation\/d\/([^/]+)/)?.[1] ?? null;
}

export function parsePresentationInput(
  input: string,
  requestedName: string,
): ParsedPresentation {
  const value = decodeHtmlEntities(input.trim());
  if (!value) throw new Error("Paste a presentation link or embed code");

  const iframeSource = value.match(/<iframe[^>]*\bsrc=["']([^"']+)["']/i)?.[1] ?? null;
  const canvaEmbedId =
    value.match(/data-design-id=["']([^"']+)["']/i)?.[1] ??
    value.match(/canva\.com\/design\/([^/?"']+)/i)?.[1] ??
    null;
  if (!iframeSource && !canvaEmbedId && (/[<>]/.test(value) || value.includes("\n"))) {
    throw new Error("Paste a share URL or an iframe embed code with an HTTPS src");
  }

  if (canvaEmbedId && !iframeSource) {
    return {
      name: requestedName.trim() || "Canva presentation",
      provider: "canva",
      openUrl: `https://www.canva.com/design/${canvaEmbedId}/view`,
      embedUrl: `https://www.canva.com/design/${canvaEmbedId}/view?embed`,
      warning: null,
    };
  }

  const source = iframeSource ?? value;
  const url = httpUrl(source);
  const provider = providerFor(url);
  let openUrl = url.toString();
  let embedUrl = url.toString();
  let warning: string | null = null;

  if (provider === "canva") {
    const id = canvaDesignId(url);
    if (id) {
      openUrl = `https://www.canva.com/design/${id}/view`;
      embedUrl = `https://www.canva.com/design/${id}/view?embed`;
    }
  } else if (provider === "google_slides") {
    const id = googleSlidesId(url);
    if (id) {
      openUrl = `https://docs.google.com/presentation/d/${id}/present`;
      embedUrl = `https://docs.google.com/presentation/d/${id}/embed?start=false&loop=false&delayms=3000`;
    }
  } else if (provider === "powerpoint") {
    warning = presentationWarning({ provider, embedUrl });
  }

  const defaultName =
    provider === "canva"
      ? "Canva presentation"
      : provider === "powerpoint"
        ? "PowerPoint presentation"
        : provider === "google_slides"
          ? "Google Slides presentation"
          : "External presentation";

  return {
    name: requestedName.trim() || defaultName,
    provider,
    openUrl,
    embedUrl,
    warning,
  };
}

export function presentationToInput(
  presentation: ParsedPresentation,
): Omit<ExternalPresentation, "id"> {
  return {
    name: presentation.name,
    provider: presentation.provider,
    openUrl: presentation.openUrl,
    embedUrl: presentation.embedUrl,
  };
}
