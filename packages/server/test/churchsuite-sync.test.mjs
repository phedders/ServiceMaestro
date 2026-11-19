import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleBase = new URL("../dist/", import.meta.url).href;

test("compares a ChurchSuite plan with its existing set list", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-churchsuite-sync-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const base = process.env.SM_MODULE_BASE;
    const { db } = await import(base + "db.js");
    const { buildDesiredSetlistItems, analyseChurchsuiteSync, applyChurchsuiteSync } =
      await import(base + "churchsuite-import.js");

    const preview = {
      plan: {
        id: 42,
        identifier: "SUNDAY-AM",
        name: "Sunday morning",
        date: "2026-11-22",
        time: "10:30",
        status: "published",
      },
      items: [
        {
          id: 101,
          order: 1,
          typeId: 1,
          typeName: "Worship",
          name: "Amazing Grace",
          isSong: true,
          key: "G",
          author: null,
          notes: null,
          duration: null,
          reading: null,
          action: "song",
          matchedSong: { id: "song-a", title: "Amazing Grace", key: "G" },
          matchCandidates: [],
        },
        {
          id: 102,
          order: 2,
          typeId: 2,
          typeName: "Prayer",
          name: "Prayer",
          isSong: false,
          key: null,
          author: null,
          notes: null,
          duration: null,
          reading: null,
          action: "placeholder",
          matchedSong: null,
          matchCandidates: [],
        },
        {
          id: 103,
          order: 3,
          typeId: 3,
          typeName: "Welcome",
          name: "Welcome",
          isSong: false,
          key: null,
          author: null,
          notes: null,
          duration: null,
          reading: null,
          action: "placeholder",
          matchedSong: null,
          matchCandidates: [],
        },
      ],
      existingSetlist: null,
      songCount: 1,
      matchedCount: 1,
      placeholderCount: 2,
      emptyCount: 0,
    };

    const desired = buildDesiredSetlistItems(preview, {});
    const existing = {
      id: "setlist-1",
      name: "Sunday morning",
      serviceDate: "2026-11-22",
      serviceTime: "10:30",
      updatedAt: "2026-11-01T00:00:00.000Z",
      itemCount: 4,
    };
    const rows = [
      {
        id: "row-1",
        position: 0,
        kind: "song",
        song_id: "song-a",
        title: "Amazing Grace",
        content: null,
        content_source: "text",
        text_format: null,
        text_align: null,
        key_override: "G",
        transpose: 0,
        max_lines: 4,
        verse_order: null,
        notes: null,
        churchsuite_item_id: 101,
      },
      {
        id: "row-2",
        position: 1,
        kind: "text",
        song_id: null,
        title: "Prayer",
        content: "Old prayer text",
        content_source: "text",
        text_format: "text",
        text_align: "left",
        key_override: null,
        transpose: 0,
        max_lines: 4,
        verse_order: null,
        notes: null,
        churchsuite_item_id: 102,
      },
      {
        id: "row-3",
        position: 2,
        kind: "text",
        song_id: null,
        title: "Removed item",
        content: "Old",
        content_source: "text",
        text_format: "text",
        text_align: "left",
        key_override: null,
        transpose: 0,
        max_lines: 4,
        verse_order: null,
        notes: null,
        churchsuite_item_id: 104,
      },
      {
        id: "row-4",
        position: 3,
        kind: "text",
        song_id: null,
        title: "Manual note",
        content: "Keep me",
        content_source: "text",
        text_format: "text",
        text_align: "left",
        key_override: null,
        transpose: 0,
        max_lines: 4,
        verse_order: null,
        notes: null,
        churchsuite_item_id: null,
      },
    ];
    const analysis = analyseChurchsuiteSync(desired.items, existing, rows, {
      name: existing.name,
      serviceDate: existing.serviceDate,
      serviceTime: existing.serviceTime,
    });

    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO songs (id, title, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("song-a", "Amazing Grace", "Amazing grace", now, now);
    db.prepare(
      "INSERT INTO setlists (id, name, service_date, service_time, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "setlist-1",
      existing.name,
      existing.serviceDate,
      existing.serviceTime,
      "Imported from ChurchSuite plan Sunday morning (SUNDAY-AM)",
      now,
      now,
    );
    const insertRow = db.prepare(
      "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title, content, content_source, text_format, text_align, key_override, transpose, max_lines, notes, churchsuite_item_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const row of rows) {
      insertRow.run(
        row.id,
        "setlist-1",
        row.position,
        row.kind,
        row.song_id,
        row.title,
        row.content,
        row.content_source,
        row.text_format,
        row.text_align,
        row.key_override,
        row.transpose,
        row.max_lines,
        row.notes,
        row.churchsuite_item_id,
      );
    }

    const synced = await applyChurchsuiteSync(
      { ...preview, existingSetlist: existing },
      {},
    );
    const finalSetlist = db.prepare("SELECT * FROM setlists WHERE id = ?").get("setlist-1");
    const finalRows = db
      .prepare("SELECT * FROM setlist_items WHERE setlist_id = ? ORDER BY position ASC")
      .all("setlist-1");
    console.log(
      JSON.stringify({
        summary: analysis.summary,
        changes: analysis.changes,
        report: synced.report,
        finalSetlist,
        finalRows,
      }),
    );
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

  assert.deepEqual(data.summary, {
    added: 1,
    updated: 1,
    removed: 1,
    unchanged: 1,
    manual: 1,
  });
  assert.ok(data.changes.some((change) => change.kind === "added" && change.title === "Welcome"));
  assert.ok(data.changes.some((change) => change.kind === "removed" && change.title === "Removed item"));
  const updated = data.changes.find((change) => change.kind === "updated");
  assert.equal(updated.title, "Prayer");
  assert.ok(updated.fields.some((field) => field.label === "Content"));

  assert.equal(data.report.mode, "updated");
  assert.equal(data.finalSetlist.churchsuite_plan_id, 42);
  assert.deepEqual(
    data.finalRows.map((row) => row.title),
    ["Amazing Grace", "Prayer", "Welcome", "Manual note"],
  );
  assert.deepEqual(
    data.finalRows.map((row) => row.position),
    [0, 1, 2, 3],
  );
  assert.equal(data.finalRows[1].content, "Prayer");
  assert.equal(data.finalRows[2].churchsuite_item_id, 103);
  assert.equal(data.finalRows[3].churchsuite_item_id, null);
});

test("a set-list sync preserves an existing song choice until the plan item changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-churchsuite-preserve-"));
  const emptyEnv = path.join(dir, "empty.env");
  const emptyConfig = path.join(dir, "config.yaml");
  fs.writeFileSync(emptyEnv, "");
  fs.writeFileSync(emptyConfig, "{}\n");

  const script = `
    const base = process.env.SM_MODULE_BASE;
    const { db } = await import(base + "db.js");
    const { applyChurchsuiteSync } = await import(base + "churchsuite-import.js");
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO songs (id, title, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("song-a", "Amazing Grace", "Amazing grace", now, now);
    db.prepare(
      "INSERT INTO songs (id, title, lyrics, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("song-b", "New Grace", "New grace", now, now);

    function previewFor(id, name) {
      return {
        plan: {
          id: 77,
          identifier: "PLAN-77",
          name: "Sunday",
          date: "2026-11-22",
          time: "10:30",
          status: "published",
        },
        items: [
          {
            id,
            order: 1,
            typeId: 4,
            typeName: "Worship",
            name,
            isSong: true,
            key: "G",
            author: null,
            notes: null,
            duration: null,
            reading: null,
            action: "song",
            matchedSong: { id: "song-b", title: "New Grace", key: "G" },
            matchCandidates: [],
          },
        ],
        existingSetlist: null,
        songCount: 1,
        matchedCount: 1,
        placeholderCount: 0,
        emptyCount: 0,
      };
    }

    function setup(id, name, snapshotName) {
      const setlistId = "setlist-" + id;
      db.prepare(
        "INSERT INTO setlists (id, name, service_date, service_time, notes, churchsuite_plan_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(setlistId, "Sunday", "2026-11-22", "10:30", "Imported", 77, now, now);
      db.prepare(
        "INSERT INTO setlist_items (id, setlist_id, position, kind, song_id, title, content_source, text_format, text_align, key_override, transpose, max_lines, churchsuite_item_id, churchsuite_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        "row-" + id,
        setlistId,
        "0",
        "song",
        "song-a",
        "Amazing Grace",
        "text",
        null,
        null,
        "G",
        0,
        4,
        id,
        JSON.stringify({ name: snapshotName, reading: null, layout: null }),
      );
      return {
        id: setlistId,
        name: "Sunday",
        serviceDate: "2026-11-22",
        serviceTime: "10:30",
        updatedAt: now,
        itemCount: 1,
      };
    }

    const preserved = await applyChurchsuiteSync(
      { ...previewFor(201, "Amazing Grace"), existingSetlist: setup(201, "Amazing Grace", "Amazing Grace") },
      {},
    );
    const preservedRow = db
      .prepare("SELECT song_id FROM setlist_items WHERE setlist_id = ?")
      .get("setlist-201");

    const changed = await applyChurchsuiteSync(
      { ...previewFor(202, "New Grace"), existingSetlist: setup(202, "New Grace", "Old Grace") },
      {},
    );
    const changedRow = db
      .prepare("SELECT song_id FROM setlist_items WHERE setlist_id = ?")
      .get("setlist-202");

    console.log(JSON.stringify({
      preserved: { report: preserved.report, songId: preservedRow.song_id },
      changed: { report: changed.report, songId: changedRow.song_id },
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

  assert.equal(data.preserved.songId, "song-a");
  assert.equal(data.preserved.report.updated, 0);
  assert.equal(data.changed.songId, "song-b");
  assert.equal(data.changed.report.updated, 1);
});
