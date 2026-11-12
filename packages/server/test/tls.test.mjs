import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;
const openssl = spawnSync("openssl", ["version"], { encoding: "utf8" });
const hasOpenssl = openssl.status === 0;

test(
  "generates a local HTTPS certificate and then reuses it",
  { skip: !hasOpenssl && "openssl is not available" },
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-tls-"));
    const emptyEnv = path.join(dir, "empty.env");
    const emptyConfig = path.join(dir, "config.yaml");
    fs.writeFileSync(emptyEnv, "");
    fs.writeFileSync(emptyConfig, "{}\n");

    const script = `
      const { prepareControlTls } = await import(process.env.SM_MODULE_BASE + "tls.js");
      const tls = await prepareControlTls();
      console.log(JSON.stringify({
        source: tls.status.source,
        selfSigned: tls.status.selfSigned,
        warnings: tls.status.warnings,
        certFile: tls.status.certFile,
        keyFile: tls.status.keyFile,
        certHeader: tls.cert.subarray(0, 27).toString("utf8"),
        keyHeader: tls.key.subarray(0, 27).toString("utf8"),
      }));
    `;

    const run = (extra = {}) =>
      spawnSync(process.execPath, ["--input-type=module", "-e", script], {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          SM_ENV_FILE: emptyEnv,
          SM_CONFIG_FILE: emptyConfig,
          SM_DATA_DIR: dir,
          SM_SSL_DIR: path.join(dir, "ssl"),
          SM_GIT_ENABLED: "false",
          SM_MODULE_BASE: moduleBase,
          ...extra,
        },
      });

    const first = run();
    assert.equal(first.status, 0, first.stderr);
    const generated = JSON.parse(first.stdout);
    assert.equal(generated.source, "generated");
    assert.equal(generated.selfSigned, true);
    assert.ok(generated.warnings.some((warning) => warning.includes("self-signed")));
    assert.equal(generated.certHeader, "-----BEGIN CERTIFICATE-----");
    assert.match(generated.keyHeader, /^-----BEGIN (?:RSA )?PRIVATE KEY/);
    assert.ok(fs.existsSync(generated.certFile));
    assert.ok(fs.existsSync(generated.keyFile));

    const second = run();
    assert.equal(second.status, 0, second.stderr);
    const reused = JSON.parse(second.stdout);
    assert.equal(reused.source, "provided");
    assert.equal(reused.selfSigned, true);
    assert.ok(reused.warnings.some((warning) => warning.includes("self-signed")));

    const configured = run({
      SM_SSL_DIR: path.join(dir, "other-ssl"),
      SM_SSL_CERT_FILE: generated.certFile,
      SM_SSL_KEY_FILE: generated.keyFile,
    });
    assert.equal(configured.status, 0, configured.stderr);
    const explicit = JSON.parse(configured.stdout);
    assert.equal(explicit.source, "provided");
    assert.equal(explicit.certFile, generated.certFile);
    assert.equal(explicit.keyFile, generated.keyFile);
  },
);
