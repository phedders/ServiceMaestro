import { buildApp } from "./app.js";
import { DISPLAY_PORT, HOST, PORT } from "./config.js";
import { buildDisplayApp } from "./display-app.js";
import { shutdownGit } from "./git-store.js";

const { app, io, outputIo } = await buildApp();
const display = await buildDisplayApp();

try {
  await app.listen({ host: HOST, port: PORT });
  app.log.info(`Service Maestro control listening on http://${HOST}:${PORT}`);
  await display.app.listen({ host: HOST, port: DISPLAY_PORT });
  display.app.log.info(`Service Maestro displays listening on http://${HOST}:${DISPLAY_PORT}/display/`);
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
  outputIo.close();
  display.io.close();
  await Promise.all([app.close(), display.app.close()]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
