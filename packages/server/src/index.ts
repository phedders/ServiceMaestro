import { buildApp } from "./app.js";
import { DISPLAY_PORT, HOST, PORT } from "./config.js";
import { buildDisplayApp } from "./display-app.js";
import { startHeartbeat } from "./heartbeat.js";
import { shutdownGit } from "./git-store.js";
import { startSongSelectWatcher } from "./songselect-watch.js";
import { prepareControlTls } from "./tls.js";

if (PORT === DISPLAY_PORT) {
  console.error("[sm] SM_PORT and SM_DISPLAY_PORT must be different ports");
  process.exit(1);
}

const tls = await prepareControlTls().catch((error: Error) => {
  console.error(`[sm] Could not start HTTPS control interface: ${error.message}`);
  process.exit(1);
});
const { app, io, outputIo } = await buildApp(tls);
for (const warning of tls.status.warnings) app.log.warn(warning);
const display = await buildDisplayApp();
const stopHeartbeats = [
  startHeartbeat(io),
  startHeartbeat(outputIo),
  startHeartbeat(display.io),
];
const stopSongSelectWatcher = startSongSelectWatcher();

try {
  await app.listen({ host: HOST, port: PORT });
  app.log.info(`Service Maestro control listening on https://${HOST}:${PORT}`);
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
  stopSongSelectWatcher();
  stopHeartbeats.forEach((stop) => stop());
  io.close();
  outputIo.close();
  display.io.close();
  await Promise.all([app.close(), display.app.close()]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
