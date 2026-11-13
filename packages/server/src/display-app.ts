import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { Server } from "socket.io";
import {
  CONTROL_DIST,
  COOKIE_NAME,
  DISPLAY_DIR,
  DISPLAY_REQUIRE_TOKEN,
  FONTS_DIR,
  LOG_LEVEL,
  OUTPUT_TOKEN,
  SSL_DIR,
  TRUST_PROXY,
} from "./config.js";
import { parseCookies, userForToken } from "./auth.js";
import { imageMime, resolveImage } from "./images.js";
import { live } from "./live.js";
import { resolveDisplayOutput } from "./display-outputs.js";
import { installSecurityHeaders } from "./security.js";
import type { DisplayOutputEntry, DisplayOutputTemplate } from "@sm/shared";

export const OUTPUT_SOCKET_PATH = "/display/socket.ro.io";

const OUTPUT_HTML_FILES: Record<DisplayOutputTemplate, string> = {
  main: "main.html",
  two_thirds: "two-thirds.html",
  full: "full.html",
  stage: "stage.html",
  chords: "chords.html",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function outputShell(output: DisplayOutputEntry): string {
  const version = Math.max(
    fs.statSync(path.join(DISPLAY_DIR, "display.js")).mtimeMs,
    fs.statSync(path.join(DISPLAY_DIR, "display.css")).mtimeMs,
  ).toString(36);
  let html = fs
    .readFileSync(path.join(DISPLAY_DIR, OUTPUT_HTML_FILES[output.template]), "utf8")
    .replaceAll("/display/assets/display.js", `/display/assets/display.js?v=${version}`)
    .replaceAll("/display/assets/display.css", `/display/assets/display.css?v=${version}`);
  html = html.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>Service Maestro — ${escapeHtml(output.label)}</title>`,
  );
  return html.replace(/<body\b([^>]*)>/i, (_match, attributes: string) => {
    const cleaned = attributes
      .replace(/\sdata-target="[^"]*"/i, "")
      .replace(/\sdata-output="[^"]*"/i, "");
    return `<body${cleaned} data-target="${output.template}" data-output="${escapeHtml(output.id)}">`;
  });
}

export async function registerDisplayRoutes(
  app: FastifyInstance,
  options: { allowSessionImages?: boolean; requireToken?: boolean } = {},
): Promise<void> {
  const requireToken = options.requireToken !== false;
  await app.register(fastifyStatic, {
    root: DISPLAY_DIR,
    prefix: "/display/assets/",
    decorateReply: false,
    cacheControl: false,
    setHeaders(response) {
      // Revalidate display JS/CSS after deployments instead of relying on
      // browser heuristic caching, which otherwise keeps old transition code.
      response.header("cache-control", "no-cache");
    },
  });

  await app.register(fastifyStatic, {
    root: FONTS_DIR,
    prefix: "/display/fonts/",
    decorateReply: false,
    cacheControl: true,
    maxAge: "1d",
  });

  app.get("/display/icon.svg", async (_request, reply) => {
    const file = path.join(CONTROL_DIST, "icon.svg");
    if (!fs.existsSync(file)) return reply.code(204).send();
    return reply
      .type("image/svg+xml")
      .header("cache-control", "public, max-age=86400")
      .send(fs.readFileSync(file));
  });

  app.get("/display/favicon.ico", async (_request, reply) =>
    reply.redirect("/display/icon.svg"),
  );

  app.get("/display/ca.crt", async (_request, reply) => {
    const file = path.join(SSL_DIR, "ca.crt");
    if (!fs.existsSync(file)) {
      return reply.code(404).send({ error: "Local CA certificate not available" });
    }
    return reply
      .type("application/x-x509-ca-cert")
      .header("content-disposition", 'attachment; filename="service-maestro-ca.crt"')
      .header("cache-control", "public, max-age=86400")
      .send(fs.readFileSync(file));
  });

  app.get("/display/images/file", async (request, reply) => {
    const query = request.query as { path?: string; token?: string };
    const cookies = parseCookies(request.headers.cookie);
    const user = options.allowSessionImages ? userForToken(cookies[COOKIE_NAME]) : null;
    if (!user && requireToken && query.token !== OUTPUT_TOKEN) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const absolute = query.path ? resolveImage(query.path) : null;
    if (!absolute || !fs.existsSync(absolute)) {
      return reply.code(404).send({ error: "Image not found" });
    }
    const mime = imageMime(query.path!);
    reply.type(mime).header("cache-control", "private, max-age=300");
    if (mime === "image/svg+xml") {
      reply.header("content-security-policy", "sandbox");
      reply.header(
        "content-disposition",
        `attachment; filename="${path.basename(absolute).replace(/["\\]/g, "_")}"`,
      );
    }
    return reply.send(fs.createReadStream(absolute));
  });

  app.get("/display/:page", async (request, reply) => {
    const page = (request.params as { page: string }).page;
    const output = resolveDisplayOutput(page);
    if (!output) return reply.code(404).send({ error: "Unknown display" });
    return reply
      .type("text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .send(outputShell(output));
  });
}

export function createOutputSocket(
  app: FastifyInstance,
  options: { requireToken?: boolean } = {},
): Server {
  const requireToken = options.requireToken !== false;
  const io = new Server(app.server, {
    path: OUTPUT_SOCKET_PATH,
    cors: { origin: false, credentials: false },
  });

  io.use((socket, next) => {
    if (!requireToken) {
      socket.data.kind = "output";
      return next();
    }
    const auth = socket.handshake.auth as { outputToken?: string } | undefined;
    const query = socket.handshake.query as { token?: string } | undefined;
    const supplied = auth?.outputToken ?? query?.token;
    if (supplied && supplied === OUTPUT_TOKEN) {
      socket.data.kind = "output";
      return next();
    }
    return next(new Error("unauthorized"));
  });

  io.on("connection", (socket) => {
    socket.join("outputs");
    socket.emit("live:snapshot", live.getState());
  });

  live.attach(io);
  return io;
}

export async function buildDisplayApp(): Promise<{ app: FastifyInstance; io: Server }> {
  const app = Fastify({ logger: { level: LOG_LEVEL }, trustProxy: TRUST_PROXY });
  installSecurityHeaders(app, true);
  await registerDisplayRoutes(app, { requireToken: DISPLAY_REQUIRE_TOKEN });

  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({ error: "Not found" }),
  );

  const io = createOutputSocket(app, { requireToken: DISPLAY_REQUIRE_TOKEN });
  return { app, io };
}
