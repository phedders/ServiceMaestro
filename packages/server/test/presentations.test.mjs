import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("saves external presentations per user and validates embed URLs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-presentations-"));
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
    const { presentationRoutes } = await import(base + "routes/presentations.js");

    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("presentations-second-user", "presentations-second-user", "unused", "operator", now);
    const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    const adminCookie = COOKIE_NAME + "=" + createSession(admin.id).token;
    const secondCookie =
      COOKIE_NAME + "=" + createSession("presentations-second-user").token;

    const app = Fastify();
    await app.register(presentationRoutes);
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

    const initial = await request(adminCookie, "GET", "/api/presentations");
    const savedConfig = {
      presentations: [
        {
          id: "canva-demo",
          name: "Canva demo",
          provider: "canva",
          openUrl: "https://www.canva.com/design/abc/view",
          embedUrl: "https://www.canva.com/design/abc/view?embed",
        },
      ],
    };
    const saved = await request(adminCookie, "PUT", "/api/presentations", savedConfig);
    const reloaded = await request(adminCookie, "GET", "/api/presentations");
    const otherUser = await request(secondCookie, "GET", "/api/presentations");
    const duplicate = await request(adminCookie, "PUT", "/api/presentations", {
      presentations: [
        ...savedConfig.presentations,
        { ...savedConfig.presentations[0], name: "Duplicate" },
      ],
    });
    const insecure = await request(adminCookie, "PUT", "/api/presentations", {
      presentations: [
        {
          ...savedConfig.presentations[0],
          embedUrl: "javascript:alert(1)",
        },
      ],
    });
    console.log(JSON.stringify({
      initial,
      saved,
      reloaded,
      otherUser,
      duplicate,
      insecure,
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
  assert.equal(data.saved.body.config.presentations.length, 1);
  assert.equal(typeof data.saved.body.config.updatedAt, "string");
  assert.deepEqual(
    data.reloaded.body.config.presentations,
    data.saved.body.config.presentations,
  );
  assert.equal(data.otherUser.body.config, null);
  assert.equal(data.duplicate.status, 400);
  assert.equal(data.insecure.status, 400);
});
