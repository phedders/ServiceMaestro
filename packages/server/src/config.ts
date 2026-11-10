import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");

export const HOST = process.env.WLM_HOST ?? "0.0.0.0";
export const PORT = Number(process.env.WLM_PORT ?? 8080);
export const DATA_DIR = path.resolve(process.env.WLM_DATA_DIR ?? path.join(packageRoot, "data"));
export const CONTROL_DIST = path.resolve(packageRoot, "../control/dist");
export const DISPLAY_DIR = path.resolve(packageRoot, "../display");
export const OUTPUT_TOKEN = process.env.WLM_OUTPUT_TOKEN ?? "dev-output";
export const ADMIN_PASSWORD = process.env.WLM_ADMIN_PASSWORD ?? "admin";
export const SESSION_DAYS = Number(process.env.WLM_SESSION_DAYS ?? 7);
export const COOKIE_NAME = "wlm_session";
