import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("seeds, resolves and separates shared and local display outputs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-outputs-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const {
      listDisplayOutputs,
      sharedDisplayOutputs,
      createDisplayOutput,
      updateDisplayOutput,
      deleteDisplayOutput,
      resolveDisplayOutput,
      replaceSharedDisplayOutputs,
      displayOutputsMap,
    } = await import(process.env.SM_MODULE_BASE + "display-outputs.js");

    const defaults = listDisplayOutputs();
    const localBase = structuredClone(defaults.find((entry) => entry.id === "full"));
    delete localBase.scope;
    const local = createDisplayOutput(
      { ...localBase, id: "youth-full", label: "Youth full", aliases: ["youth"] },
      "local",
    );
    const updated = updateDisplayOutput("youth-full", { ...local, label: "Youth fullscreen" });
    const conflict = (() => {
      try {
        createDisplayOutput({ ...local, id: "main" }, "local");
        return "no error";
      } catch (error) {
        return error.message;
      }
    })();
    const resolved = resolveDisplayOutput("main");
    const deleted = deleteDisplayOutput("youth-full");

    const customShared = {
      ...structuredClone(defaults.find((entry) => entry.id === "full")),
      id: "main",
      label: "Main output",
      aliases: ["broadcast"],
    };
    delete customShared.scope;
    replaceSharedDisplayOutputs([customShared]);
    const afterReplace = listDisplayOutputs();
    const shared = sharedDisplayOutputs();
    const maps = displayOutputsMap();

    console.log(JSON.stringify({
      defaultCount: defaults.length,
      defaultScopes: [...new Set(defaults.map((entry) => entry.scope))],
      fullImageHeight: defaults.find((entry) => entry.id === "full")?.image.maxHeightPercent,
      local: { id: local.id, scope: local.scope },
      updatedLabel: updated.label,
      conflict,
      resolvedId: resolved?.id ?? null,
      deleted,
      afterReplace: afterReplace.map((entry) => ({ id: entry.id, scope: entry.scope })),
      sharedCount: shared.length,
      sharedHasScope: Object.prototype.hasOwnProperty.call(shared[0] ?? {}, "scope"),
      mapKeys: Object.keys(maps),
    }));
  `;

  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SM_ENV_FILE: emptyEnv,
      SM_CONFIG_FILE: emptyConfig,
      SM_DATA_DIR: dir,
      SM_GIT_ENABLED: "false",
      SM_MODULE_BASE: moduleBase,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);

  assert.equal(data.defaultCount, 5);
  assert.deepEqual(data.defaultScopes, ["shared"]);
  assert.equal(data.fullImageHeight, 100);
  assert.deepEqual(data.local, { id: "youth-full", scope: "local" });
  assert.equal(data.updatedLabel, "Youth fullscreen");
  assert.match(data.conflict, /already in use: main/);
  assert.equal(data.resolvedId, "lowerthird");
  assert.equal(data.deleted, true);
  assert.deepEqual(data.afterReplace, [{ id: "main", scope: "shared" }]);
  assert.equal(data.sharedCount, 1);
  assert.equal(data.sharedHasScope, false);
  assert.deepEqual(data.mapKeys, ["main"]);
});
