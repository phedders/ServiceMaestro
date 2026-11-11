import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { Server } from "socket.io";
import { displayConfigSchema, gitSettingsSchema, liveCommandSchema, quickTextSchema, type PublicUser } from "@sm/shared";
import { COOKIE_NAME, CONTROL_DIST, DISPLAY_DIR, GIT_ENABLED, OUTPUT_TOKEN } from "./config.js";
import { parseCookies, requireAuth, requireRole, userForToken } from "./auth.js";
import { createOutputSocket, registerDisplayRoutes } from "./display-app.js";
import { sendHtmlFile } from "./send-html.js";
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
import { imageRoutes } from "./routes/images.js";
import {
  configureGitAutoSync,
  exportAllToGit,
  gitStatus,
  initializeGitStorage,
  pushGit,
  syncGitFromRemotes,
} from "./git-store.js";

export async function buildApp(): Promise<{
  app: FastifyInstance;
  io: Server;
  outputIo: Server;
}> {
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
  await app.register(imageRoutes);

  app.get("/", async (_request, reply) => sendHtmlFile(reply, path.join(CONTROL_DIST, "index.html")));
  app.get("/login", async (_request, reply) => sendHtmlFile(reply, path.join(CONTROL_DIST, "index.html")));
  app.get("/musicians", async (_request, reply) => sendHtmlFile(reply, path.join(CONTROL_DIST, "index.html")));
  app.get("/musicians/", async (_request, reply) => sendHtmlFile(reply, path.join(CONTROL_DIST, "index.html")));
  app.get("/icon.svg", async (_request, reply) => {
    const file = path.join(CONTROL_DIST, "icon.svg");
    if (!fs.existsSync(file)) return reply.code(204).send();
    return reply.type("image/svg+xml").send(fs.readFileSync(file));
  });
  app.get("/favicon.ico", async (_request, reply) => reply.code(204).send());

  await registerDisplayRoutes(app, { allowSessionImages: true });

  app.get("/obs-main", async (_request, reply) => sendHtmlFile(reply, path.join(DISPLAY_DIR, "main.html")));
  app.get("/obs-lower", async (_request, reply) => sendHtmlFile(reply, path.join(DISPLAY_DIR, "main.html")));
  app.get("/obs-lowerthird", async (_request, reply) => sendHtmlFile(reply, path.join(DISPLAY_DIR, "main.html")));
  app.get("/obs-twothirds", async (_request, reply) => sendHtmlFile(reply, path.join(DISPLAY_DIR, "main.html")));
  app.get("/obs-mainfull", async (_request, reply) => sendHtmlFile(reply, path.join(DISPLAY_DIR, "full.html")));
  app.get("/obs-fullscreen", async (_request, reply) => sendHtmlFile(reply, path.join(DISPLAY_DIR, "full.html")));
  app.get("/obs-two-thirds", async (_request, reply) => sendHtmlFile(reply, path.join(DISPLAY_DIR, "two-thirds.html")));
  app.get("/obs-stage", async (_request, reply) => sendHtmlFile(reply, path.join(DISPLAY_DIR, "stage.html")));
  app.get("/obs-chords", async (_request, reply) => sendHtmlFile(reply, path.join(DISPLAY_DIR, "chords.html")));

  app.get("/api/health", async () => ({ ok: true, name: "service-maestro" }));

  app.get("/api/display/views", { preHandler: requireAuth }, async () => {
    const token = encodeURIComponent(OUTPUT_TOKEN);
    return {
      views: [
        { id: "lowerthird", label: "Lower third", url: `/display/lowerthird?token=${token}` },
        { id: "full", label: "Full screen", url: `/display/full?token=${token}` },
        { id: "two-thirds", label: "Centered two-thirds", url: `/display/two-thirds?token=${token}` },
        { id: "stage", label: "Stage", url: `/display/stage?token=${token}` },
        { id: "chords", label: "Chords", url: `/display/chords?token=${token}` },
        { id: "musicians", label: "Musicians view", url: "/musicians" },
      ],
    };
  });

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
    if (
      request.url.startsWith("/api/") ||
      request.url.startsWith("/socket.io") ||
      request.url === "/display" ||
      request.url.startsWith("/display/") ||
      request.url.startsWith("/display-assets") ||
      request.url.startsWith("/fonts/")
    ) {
      return reply.code(404).send({ error: "Not found" });
    }
    return sendHtmlFile(reply, path.join(CONTROL_DIST, "index.html"));
  });

  const io = new Server(app.server, {
    path: "/socket.io",
    cors: { origin: true, credentials: true },
  });

  io.use((socket, next) => {
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const user = userForToken(cookies[COOKIE_NAME]);
    if (!user) return next(new Error("unauthorized"));
    socket.data.user = user;
    return next();
  });

  io.on("connection", (socket) => {
    socket.join("control");
    socket.emit("live:snapshot", live.getState());

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
  });

  live.attach(io);
  const outputIo = createOutputSocket(app);

  app.get("/api/live/state", { preHandler: requireAuth }, async () => ({ state: live.getState() }));

  await initializeGitStorage();

  return { app, io, outputIo };
}
