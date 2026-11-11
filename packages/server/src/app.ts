import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { Server } from "socket.io";
import { displayConfigSchema, gitSettingsSchema, liveCommandSchema, quickTextSchema, type PublicUser } from "@sm/shared";
import { COOKIE_NAME, CONTROL_DIST, DISPLAY_DIR, FONTS_DIR, GIT_ENABLED, OUTPUT_TOKEN } from "./config.js";
import { parseCookies, requireAuth, requireRole, userForToken } from "./auth.js";
import { live } from "./live.js";
import { getDisplayConfig, saveDisplayConfig } from "./display-config.js";
import { getGitSettings, saveGitSettings } from "./settings.js";
import { authRoutes } from "./routes/auth.js";
import { songRoutes } from "./routes/songs.js";
import { setlistRoutes } from "./routes/setlists.js";
import { liveRoutes } from "./routes/live.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { importRoutes } from "./routes/imports.js";
import { bibleRoutes } from "./routes/bible.js";
import { assetRoutes } from "./routes/assets.js";
import { transferRoutes } from "./routes/transfer.js";
import { fontRoutes } from "./routes/fonts.js";
import { churchsuiteRoutes } from "./routes/churchsuite.js";
import { settingsRoutes } from "./routes/settings.js";
import {
  configureGitAutoSync,
  exportAllToGit,
  gitStatus,
  initializeGitStorage,
  pushGit,
  syncGitFromRemotes,
} from "./git-store.js";

function sendHtml(reply: FastifyReply, file: string): FastifyReply {
  if (!fs.existsSync(file)) {
    return reply
      .code(503)
      .type("text/html")
      .send(
        `<!doctype html><html><body style="font-family:system-ui;background:#111;color:#eee;padding:2rem">
        <h1>Service Maestro</h1>
        <p>The UI has not been built yet. Run <code>npm run build</code> from the project root, then restart.</p>
        <p>Expected file: <code>${file}</code></p></body></html>`,
      );
  }
  return reply.type("text/html; charset=utf-8").send(fs.readFileSync(file));
}

export async function buildApp(): Promise<{ app: FastifyInstance; io: Server }> {
  const app = Fastify({ logger: { level: process.env.SM_LOG_LEVEL ?? "info" } });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 10 } });

  const controlAssets = path.join(CONTROL_DIST, "assets");
  if (fs.existsSync(controlAssets)) {
    await app.register(fastifyStatic, {
      root: controlAssets,
      prefix: "/assets/",
      decorateReply: false,
      cacheControl: true,
      maxAge: "1h",
    });
  }

  await app.register(fastifyStatic, {
    root: DISPLAY_DIR,
    prefix: "/display-assets/",
    decorateReply: false,
    cacheControl: true,
    maxAge: "5m",
  });

  await app.register(fastifyStatic, {
    root: FONTS_DIR,
    prefix: "/fonts/",
    decorateReply: false,
    cacheControl: true,
    maxAge: "1d",
  });

  await app.register(authRoutes);
  await app.register(songRoutes);
  await app.register(setlistRoutes);
  await app.register(liveRoutes);
  await app.register(dashboardRoutes);
  await app.register(importRoutes);
  await app.register(bibleRoutes);
  await app.register(assetRoutes);
  await app.register(transferRoutes);
  await app.register(fontRoutes);
  await app.register(churchsuiteRoutes);
  await app.register(settingsRoutes);

  app.get("/", async (_request, reply) => sendHtml(reply, path.join(CONTROL_DIST, "index.html")));
  app.get("/login", async (_request, reply) => sendHtml(reply, path.join(CONTROL_DIST, "index.html")));
  app.get("/musicians", async (_request, reply) => sendHtml(reply, path.join(CONTROL_DIST, "index.html")));
  app.get("/musicians/", async (_request, reply) => sendHtml(reply, path.join(CONTROL_DIST, "index.html")));
  app.get("/icon.svg", async (_request, reply) => {
    const file = path.join(CONTROL_DIST, "icon.svg");
    if (!fs.existsSync(file)) return reply.code(204).send();
    return reply.type("image/svg+xml").send(fs.readFileSync(file));
  });
  app.get("/favicon.ico", async (_request, reply) => reply.code(204).send());

  const displayPages: Record<string, string> = {
    main: "main.html",
    full: "full.html",
    "two-thirds": "two-thirds.html",
    two_thirds: "two-thirds.html",
    stage: "stage.html",
    chords: "chords.html",
  };

  app.get("/display/:page", async (request, reply) => {
    const page = (request.params as { page: string }).page;
    const file = displayPages[page];
    if (!file) return reply.code(404).send({ error: "Unknown display" });
    return sendHtml(reply, path.join(DISPLAY_DIR, file));
  });

  app.get("/obs-main", async (_request, reply) => sendHtml(reply, path.join(DISPLAY_DIR, "main.html")));
  app.get("/obs-mainfull", async (_request, reply) => sendHtml(reply, path.join(DISPLAY_DIR, "full.html")));
  app.get("/obs-two-thirds", async (_request, reply) => sendHtml(reply, path.join(DISPLAY_DIR, "two-thirds.html")));
  app.get("/obs-stage", async (_request, reply) => sendHtml(reply, path.join(DISPLAY_DIR, "stage.html")));
  app.get("/obs-chords", async (_request, reply) => sendHtml(reply, path.join(DISPLAY_DIR, "chords.html")));

  app.get("/api/health", async () => ({ ok: true, name: "service-maestro" }));

  app.get("/api/display/config", { preHandler: requireAuth }, async () => ({
    config: getDisplayConfig(),
  }));

  app.put(
    "/api/display/config",
    { preHandler: [requireAuth, requireRole("admin", "editor", "operator")] },
    async (request, reply) => {
      const parsed = displayConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid display config", issues: parsed.error.issues });
      }
      const config = saveDisplayConfig(parsed.data);
      const state = live.updateDisplayConfig(config);
      return { config, state };
    },
  );

  app.get("/api/git/status", { preHandler: requireAuth }, async () => {
    const settings = getGitSettings();
    return {
      enabled: GIT_ENABLED,
      ...settings,
      repositories: gitStatus(),
    };
  });

  app.put(
    "/api/git/settings",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async (request, reply) => {
      const parsed = gitSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid Git settings", issues: parsed.error.issues });
      }
      const settings = saveGitSettings(parsed.data);
      configureGitAutoSync();
      return { settings, repositories: gitStatus() };
    },
  );

  app.post(
    "/api/git/sync",
    { preHandler: [requireAuth, requireRole("admin", "editor", "operator")] },
    async () => {
      await syncGitFromRemotes();
      return { ok: true, repositories: gitStatus() };
    },
  );

  app.post(
    "/api/git/export",
    { preHandler: [requireAuth, requireRole("admin", "editor")] },
    async () => {
      await exportAllToGit();
      await pushGit();
      return { ok: true, repositories: gitStatus() };
    },
  );

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/") || request.url.startsWith("/socket.io")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return sendHtml(reply, path.join(CONTROL_DIST, "index.html"));
  });

  const io = new Server(app.server, {
    path: "/socket.io",
    cors: { origin: true, credentials: true },
  });

  io.use((socket, next) => {
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const user = userForToken(cookies[COOKIE_NAME]);
    if (user) {
      socket.data.user = user;
      socket.data.kind = "control";
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
    const kind = socket.data.kind as "control" | "output";
    socket.join(kind === "output" ? "outputs" : "control");
    socket.emit("live:snapshot", live.getState());

    if (kind === "control") {
      const user = socket.data.user as PublicUser;
      socket.on("live:command", (payload: unknown) => {
        if (!["admin", "editor", "operator"].includes(user.role)) return;
        const parsed = liveCommandSchema.safeParse(payload);
        if (parsed.success) live.command(parsed.data);
      });
      socket.on("live:quickText", (payload: unknown) => {
        if (!["admin", "editor", "operator"].includes(user.role)) return;
        const parsed = quickTextSchema.safeParse(payload);
        if (parsed.success) live.quickText(parsed.data.text);
      });
    }
  });

  live.attach(io);

  app.get("/api/live/state", { preHandler: requireAuth }, async () => ({ state: live.getState() }));

  await initializeGitStorage();

  return { app, io };
}
