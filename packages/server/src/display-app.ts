import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { Server } from "socket.io";
import {
  CONTROL_DIST,
  COOKIE_NAME,
  DISPLAY_DIR,
  FONTS_DIR,
  LOG_LEVEL,
  OUTPUT_TOKEN,
  SSL_DIR,
  TRUST_PROXY,
} from "./config.js";
import { parseCookies, userForToken } from "./auth.js";
import { imageMime, resolveImage } from "./images.js";
import { live } from "./live.js";

export const OUTPUT_SOCKET_PATH = "/display/socket.ro.io";

const DISPLAY_PAGES: Record<string, string> = {
  main: "main.html",
  lower: "main.html",
  lowerthird: "main.html",
  twothirds: "main.html",
  "two-thirds": "two-thirds.html",
  two_thirds: "two-thirds.html",
  full: "full.html",
  fullscreen: "full.html",
  mainfull: "full.html",
  stage: "stage.html",
  chords: "chords.html",
};

export async function registerDisplayRoutes(
  app: FastifyInstance,
  options: { allowSessionImages?: boolean } = {},
): Promise<void> {
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
    if (!user && query.token !== OUTPUT_TOKEN) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    const absolute = query.path ? resolveImage(query.path) : null;
    if (!absolute || !fs.existsSync(absolute)) {
      return reply.code(404).send({ error: "Image not found" });
    }
    reply
      .type(imageMime(query.path!))
      .header("cache-control", "private, max-age=300");
    return reply.send(fs.createReadStream(absolute));
  });

  app.get("/display/:page", async (request, reply) => {
    const page = (request.params as { page: string }).page;
    const file = DISPLAY_PAGES[page];
    if (!file) return reply.code(404).send({ error: "Unknown display" });
    const displayJs = path.join(DISPLAY_DIR, "display.js");
    const displayCss = path.join(DISPLAY_DIR, "display.css");
    const version = Math.max(
      fs.statSync(displayJs).mtimeMs,
      fs.statSync(displayCss).mtimeMs,
    ).toString(36);
    const html = fs
      .readFileSync(path.join(DISPLAY_DIR, file), "utf8")
      .replaceAll("/display/assets/display.js", `/display/assets/display.js?v=${version}`)
      .replaceAll("/display/assets/display.css", `/display/assets/display.css?v=${version}`);
    return reply
      .type("text/html; charset=utf-8")
      .header("cache-control", "no-store")
      .send(html);
  });
}

export function createOutputSocket(app: FastifyInstance): Server {
  const io = new Server(app.server, {
    path: OUTPUT_SOCKET_PATH,
    cors: { origin: true, credentials: false },
  });

  io.use((socket, next) => {
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
  await registerDisplayRoutes(app);

  app.setNotFoundHandler(async (_request, reply) =>
    reply.code(404).send({ error: "Not found" }),
  );

  const io = createOutputSocket(app);
  return { app, io };
}
