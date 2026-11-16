import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("saves clicker mappings per user and rejects duplicate buttons", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-clicker-"));
  const emptyEnv = path.join(dir, "empty.env");
  const config = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(config, "{}\n");

  const script = `
    const { default: Fastify } = await import("fastify");
    const base = process.env.SM_MODULE_BASE;
    const { db } = await import(base + "db.js");
    const { createSession } = await import(base + "auth.js");
    const { COOKIE_NAME } = await import(base + "config.js");
    const { clickerRoutes } = await import(base + "routes/clicker.js");

    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("clicker-second-user", "clicker-second-user", "unused", "operator", now);
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    const adminCookie = COOKIE_NAME + "=" + createSession(admin.id).token;
    const secondCookie =
      COOKIE_NAME + "=" + createSession("clicker-second-user").token;

    const app = Fastify();
    await app.register(clickerRoutes);
    const request = async (cookie, method, url, payload) => {
      const response = await app.inject({
        method,
        url,
        headers: {
          cookie,
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
        },
        payload: payload === undefined ? undefined : JSON.stringify(payload),
      });
      return {
        status: response.statusCode,
        body: response.body ? JSON.parse(response.body) : null,
      };
    };

    const initial = await request(adminCookie, "GET", "/api/clicker");
    const mapping = {
      name: "Logitech R400",
      vendorId: 0x046d,
      productId: 0xc538,
      buttons: [
        { id: "PageDown", label: "PageDown", action: "next" },
        { id: "PageUp", label: "PageUp", action: "prev" },
        { id: "Period", label: ".", action: "blank" },
      ],
    };
    const saved = await request(adminCookie, "PUT", "/api/clicker", mapping);
    const reloaded = await request(adminCookie, "GET", "/api/clicker");
    const otherUser = await request(secondCookie, "GET", "/api/clicker");
    const duplicate = await request(adminCookie, "PUT", "/api/clicker", {
      ...mapping,
      buttons: [
        { id: "PageDown", label: "PageDown", action: "next" },
        { id: "PageDown", label: "PageDown again", action: "prev" },
      ],
    });
    const invalidAction = await request(adminCookie, "PUT", "/api/clicker", {
      ...mapping,
      buttons: [{ id: "PageDown", label: "PageDown", action: "self-destruct" }],
    });
    console.log(JSON.stringify({
      initial,
      saved,
      reloaded,
      otherUser,
      duplicate,
      invalidAction,
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
      SM_MODULE_BASE: moduleBase,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);

  assert.equal(data.initial.status, 200);
  assert.equal(data.initial.body.config, null);
  assert.equal(data.saved.status, 200);
  assert.equal(data.saved.body.config.name, "Logitech R400");
  assert.equal(data.saved.body.config.buttons.length, 3);
  assert.equal(typeof data.saved.body.config.updatedAt, "string");
  assert.deepEqual(data.reloaded.body.config.buttons, data.saved.body.config.buttons);
  assert.equal(data.otherUser.body.config, null);
  assert.equal(data.duplicate.status, 400);
  assert.equal(data.invalidAction.status, 400);
});
