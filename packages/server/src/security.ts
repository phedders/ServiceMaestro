import type { FastifyInstance, FastifyRequest } from "fastify";
import type { IncomingHttpHeaders } from "node:http";
import { SSL_ENABLED, TRUST_PROXY, WEBAUTHN_ORIGIN } from "./config.js";
import { getControlTlsStatus } from "./tls.js";

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requestHost(headers: IncomingHttpHeaders): string | undefined {
  return (
    (TRUST_PROXY ? firstHeader(headers["x-forwarded-host"]) : undefined) ??
    firstHeader(headers.host)
  );
}

function requestProtocol(
  headers: IncomingHttpHeaders,
  fallback: "http" | "https",
): string {
  const forwarded = TRUST_PROXY
    ? firstHeader(headers["x-forwarded-proto"])?.split(",")[0]?.trim()
    : undefined;
  return forwarded || fallback;
}

function normaliseOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function originAllowed(
  origin: string | undefined,
  headers: IncomingHttpHeaders,
  fallbackProtocol: "http" | "https",
): boolean {
  if (!origin) return true;
  const parsed = normaliseOrigin(origin);
  if (!parsed) return false;
  const configured = WEBAUTHN_ORIGIN ? normaliseOrigin(WEBAUTHN_ORIGIN) : null;
  if (configured && parsed === configured) return true;
  const host = requestHost(headers);
  if (!host) return false;
  const url = new URL(parsed);
  return url.host === host && url.protocol === `${requestProtocol(headers, fallbackProtocol)}:`;
}

export function requestOriginAllowed(request: FastifyRequest): boolean {
  const origin = firstHeader(request.headers.origin);
  return originAllowed(origin, request.headers, request.protocol as "http" | "https");
}

export function installSecurityHeaders(app: FastifyInstance, display: boolean): void {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", display ? "SAMEORIGIN" : "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header(
      "permissions-policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
    reply.header("cross-origin-resource-policy", "same-origin");
    if (!reply.getHeader("content-security-policy")) {
      reply.header(
        "content-security-policy",
        [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          "connect-src 'self' ws: wss:",
          "media-src 'self' blob: https:",
          "worker-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          `frame-ancestors ${display ? "'self'" : "'none'"}`,
        ].join("; "),
      );
    }
    if (!display && SSL_ENABLED && !getControlTlsStatus()?.selfSigned) {
      reply.header("strict-transport-security", "max-age=15552000");
    }
    return payload;
  });
}
