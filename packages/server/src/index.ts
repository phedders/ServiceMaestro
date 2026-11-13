import { buildApp } from "./app.js";
import { startActivityRetention } from "./activity.js";
import {
  ADMIN_PASSWORD,
  DISPLAY_PORT,
  HOST,
  OUTPUT_TOKEN,
  PORT,
  SSL_ENABLED,
} from "./config.js";
import { buildDisplayApp } from "./display-app.js";
import { startHeartbeat } from "./heartbeat.js";
import { shutdownGit } from "./git-store.js";
import { startMqttBridge, stopMqttBridge } from "./mqtt-bridge.js";
import { startSongSelectWatcher } from "./songselect-watch.js";
import { prepareControlTls } from "./tls.js";

if (PORT === DISPLAY_PORT) {
  console.error("[sm] SM_PORT and SM_DISPLAY_PORT must be different ports");
  process.exit(1);
}

const tls = SSL_ENABLED
  ? await prepareControlTls().catch((error: Error) => {
      console.error(`[sm] Could not start HTTPS control interface: ${error.message}`);
      process.exit(1);
    })
  : null;
const { app, io, outputIo } = await buildApp(tls);
if (ADMIN_PASSWORD === "admin") {
  app.log.warn(
    "SM_ADMIN_PASSWORD is still the default value. Change the admin password before exposing this instance.",
  );
}
if (OUTPUT_TOKEN === "dev-output") {
  app.log.warn(
    "SM_OUTPUT_TOKEN is still the default value. Set a strong output token before exposing displays.",
  );
}
if (tls) {
  for (const warning of tls.status.warnings) app.log.warn(warning);
} else {
  app.log.warn(
    "Control HTTPS is disabled. Serve the control interface only through a TLS-terminating forward proxy.",
  );
}
const display = await buildDisplayApp();
startMqttBridge(app);
const stopHeartbeats = [
  startHeartbeat(io),
  startHeartbeat(outputIo),
  startHeartbeat(display.io),
];
const stopSongSelectWatcher = startSongSelectWatcher();
const stopActivityRetention = startActivityRetention();

try {
  await app.listen({ host: HOST, port: PORT });
  app.log.info(
    `Service Maestro control listening on ${SSL_ENABLED ? "https" : "http"}://${HOST}:${PORT}`,
  );
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
  stopMqttBridge();
  stopSongSelectWatcher();
  stopActivityRetention();
  stopHeartbeats.forEach((stop) => stop());
  io.close();
  outputIo.close();
  display.io.close();
  await Promise.all([app.close(), display.app.close()]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
