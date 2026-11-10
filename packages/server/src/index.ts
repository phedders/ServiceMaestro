import { buildApp } from "./app.js";
import { HOST, PORT } from "./config.js";
import { shutdownGit } from "./git-store.js";

const { app, io } = await buildApp();

try {
  await app.listen({ host: HOST, port: PORT });
  app.log.info(`Web Lyric Master listening on http://${HOST}:${PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} received, shutting down`);
  shutdownGit();
  io.close();
  await app.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
