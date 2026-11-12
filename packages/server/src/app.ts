import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { Server } from "socket.io";
import { displayConfigSchema, gitSettingsSchema, liveCommandSchema, quickTextSchema, type PublicUser } from "@sm/shared";
import {
  COOKIE_NAME,
  CONTROL_DIST,
  DISPLAY_DIR,
  GIT_ENABLED,
  LOG_LEVEL,
  OUTPUT_TOKEN,
  SSL_DIR,
  SSL_ENABLED,
  TRUST_PROXY,
} from "./config.js";
import { parseCookies, requireAuth, requirePermission, userForToken } from "./auth.js";
import { createOutputSocket, registerDisplayRoutes } from "./display-app.js";
import { sendHtmlFile } from "./send-html.js";
import { live } from "./live.js";
import { getDisplayConfig, saveDisplayConfig } from "./display-config.js";
import { getGitSettings, saveGitSettings } from "./settings.js";
import { getControlTlsStatus } from "./tls.js";
import { hasPermission } from "./users.js";
import { logActivity, logRequestActivity } from "./activity.js";
import { authRoutes } from "./routes/auth.js";
import { userRoutes } from "./routes/users.js";
import { activityRoutes } from "./routes/activity.js";
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
import { tarpRoutes } from "./routes/tarp.js";
import { backgroundRoutes } from "./routes/backgrounds.js";
import { brandingRoutes } from "./routes/branding.js";
import { stingerRoutes } from "./routes/stingers.js";
import { songSelectRoutes } from "./routes/songselect.js";
import { siteScrapingRoutes } from "./routes/site-scraping.js";
import {
  configureGitAutoSync,
  exportAllToGit,
  gitStatus,
  initializeGitStorage,
  pushGit,
  saveSharedSettingsToGit,
  syncGitFromRemotes,
} from "./git-store.js";

export async function buildApp(
  tls: { key: Buffer; cert: Buffer } | null,
): Promise<{
  app: FastifyInstance;
  io: Server;
  outputIo: Server;
}> {
  const app = Fastify({
    logger: { level: LOG_LEVEL },
    trustProxy: TRUST_PROXY,
    ...(tls ? { https: tls } : {}),
  });

  app.addHook("onResponse", async (request, reply) => {
    logRequestActivity(request, reply.statusCode);
  });

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
  await app.register(userRoutes);
  await app.register(activityRoutes);
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
  await app.register(tarpRoutes);
  await app.register(backgroundRoutes);
  await app.register(brandingRoutes);
  await app.register(stingerRoutes);
  await app.register(songSelectRoutes);
  await app.register(siteScrapingRoutes);

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

  app.get("/api/ssl/status", { preHandler: requireAuth }, async () => ({
    enabled: SSL_ENABLED,
    status: getControlTlsStatus(),
  }));

  app.get("/api/ssl/ca.crt", { preHandler: requireAuth }, async (_request, reply) => {
    const file = path.join(SSL_DIR, "ca.crt");
    if (!fs.existsSync(file)) {
      return reply.code(404).send({ error: "Local CA certificate not available" });
    }
    reply.header("content-type", "application/x-x509-ca-cert");
    reply.header("content-disposition", 'attachment; filename="service-maestro-ca.crt"');
    return reply.send(fs.readFileSync(file));
  });

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
    { preHandler: [requireAuth, requirePermission("settings")] },
    async (request, reply) => {
      const parsed = displayConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid display config", issues: parsed.error.issues });
      }
      const config = saveDisplayConfig(parsed.data);
      await saveSharedSettingsToGit().catch((error) =>
        request.log.warn({ err: error }, "shared settings save failed"),
      );
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
    { preHandler: [requireAuth, requirePermission("settings")] },
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
    { preHandler: [requireAuth, requirePermission("settings")] },
    async () => {
      await syncGitFromRemotes();
      return { ok: true, repositories: gitStatus() };
    },
  );

  app.post(
    "/api/git/export",
    { preHandler: [requireAuth, requirePermission("settings")] },
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
      if (!hasPermission(user, "live")) return;
      const parsed = liveCommandSchema.safeParse(payload);
      if (parsed.success) {
        logActivity({
          user,
          action: "live_command",
          module: "live",
          detail: JSON.stringify(parsed.data).slice(0, 2000),
        });
        live.command(parsed.data);
      }
    });
    socket.on("live:quickText", (payload: unknown) => {
      if (!hasPermission(user, "live")) return;
      const parsed = quickTextSchema.safeParse(payload);
      if (parsed.success) {
        logActivity({
          user,
          action: "live_quick_text",
          module: "live",
          detail: parsed.data.text.slice(0, 500),
        });
        live.quickText(parsed.data.text);
      }
    });
  });

  live.attach(io);
  const outputIo = createOutputSocket(app);

  app.get("/api/live/state", { preHandler: requireAuth }, async () => ({ state: live.getState() }));

  await initializeGitStorage();

  return { app, io, outputIo };
}
