import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("allows HTTPS presentation iframes without allowing external scripts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-security-"));
  const emptyEnv = path.join(dir, "empty.env");
  const config = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(config, "{}\n");

  const script = `
    const { default: Fastify } = await import("fastify");
    const base = process.env.SM_MODULE_BASE;
    const { installSecurityHeaders } = await import(base + "security.js");
    const app = Fastify();
    installSecurityHeaders(app, false);
    app.get("/", async () => ({ ok: true }));
    const response = await app.inject({ method: "GET", url: "/" });
    console.log(JSON.stringify({
      status: response.statusCode,
      csp: response.headers["content-security-policy"],
      xFrameOptions: response.headers["x-frame-options"],
    }));
  `;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SM_ENV_FILE: emptyEnv,
      SM_CONFIG_FILE: config,
      SM_DATA_DIR: dir,
      SM_GIT_ENABLED: "false",
      SM_SSL_ENABLED: "false",
      SM_MODULE_BASE: moduleBase,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);

  assert.equal(data.status, 200);
  assert.match(data.csp, /frame-src 'self' https:/);
  assert.match(data.csp, /script-src 'self'(?:;|$)/);
  assert.match(data.csp, /frame-ancestors 'none'/);
  assert.equal(data.xFrameOptions, "DENY");
});
