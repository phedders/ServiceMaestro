import { DEFAULT_DISPLAY_OUTPUTS, displayOutputSchema } from "@sm/shared";
import type {
  DisplayOutput,
  DisplayOutputEntry,
  DisplayOutputScope,
} from "@sm/shared";
import { db } from "./db.js";

const SEEDED_KEY = "display_outputs_seeded";
const FULL_IMAGE_FILL_KEY = "display_outputs_full_image_fill_v1";

interface OutputRow {
  id: string;
  label: string;
  template: string;
  scope: DisplayOutputScope;
  sort_order: number;
  config_json: string;
  created_at: string;
  updated_at: string;
}

function rowToEntry(row: OutputRow): DisplayOutputEntry {
  const parsed = displayOutputSchema.parse(JSON.parse(row.config_json));
  return {
    ...parsed,
    id: row.id,
    label: row.label,
    template: row.template as DisplayOutput["template"],
    scope: row.scope,
  };
}

function normaliseOutput(output: DisplayOutput): DisplayOutput {
  return {
    ...output,
    id: output.id.trim().toLowerCase(),
    aliases: [...new Set(output.aliases.map((alias) => alias.trim().toLowerCase()).filter(Boolean))],
  };
}

function upgradeFullImageFill(output: DisplayOutput): DisplayOutput {
  if (
    output.id === "full" &&
    output.template === "full" &&
    output.image.maxHeightPercent === 78
  ) {
    return {
      ...output,
      image: { ...output.image, maxHeightPercent: 100 },
    };
  }
  return output;
}

function markerFor(key: string): string | undefined {
  return (
    db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined
  )?.value;
}

function setMarkerFor(key: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, '1', ?)
     ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at`,
  ).run(key, new Date().toISOString());
}

function allRows(): OutputRow[] {
  return db
    .prepare(
      `SELECT id, label, template, scope, sort_order, config_json, created_at, updated_at
       FROM display_outputs
       ORDER BY CASE scope WHEN 'shared' THEN 0 ELSE 1 END, sort_order ASC, label COLLATE NOCASE ASC`,
    )
    .all() as OutputRow[];
}

function marker(): string | undefined {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(SEEDED_KEY) as
    | { value: string }
    | undefined;
  return row?.value;
}

function setMarker(): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, '1', ?)
     ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at`,
  ).run(SEEDED_KEY, new Date().toISOString());
}

function writeOutput(output: DisplayOutput, scope: DisplayOutputScope, sortOrder: number): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO display_outputs
       (id, label, template, scope, sort_order, config_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    output.id,
    output.label,
    output.template,
    scope,
    sortOrder,
    JSON.stringify(output),
    now,
    now,
  );
}

function ensureSeeded(): void {
  if (marker()) return;
  const count = (db.prepare("SELECT COUNT(*) AS count FROM display_outputs").get() as {
    count: number;
  }).count;
  if (count > 0) {
    setMarker();
    return;
  }
  const insert = db.prepare(
    `INSERT INTO display_outputs
       (id, label, template, scope, sort_order, config_json, created_at, updated_at)
     VALUES (?, ?, ?, 'shared', ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  const seed = db.transaction(() => {
    DEFAULT_DISPLAY_OUTPUTS.forEach((output, index) => {
      insert.run(output.id, output.label, output.template, index, JSON.stringify(output), now, now);
    });
    setMarker();
  });
  seed();
}

ensureSeeded();

function migrateFullImageFill(): void {
  if (markerFor(FULL_IMAGE_FILL_KEY)) return;
  const row = db
    .prepare(
      `SELECT id, label, template, scope, sort_order, config_json, created_at, updated_at
       FROM display_outputs WHERE id = 'full'`,
    )
    .get() as OutputRow | undefined;
  if (row) {
    const existing = rowToEntry(row);
    const { scope: _scope, ...output } = existing;
    const upgraded = upgradeFullImageFill(output);
    if (upgraded.image.maxHeightPercent !== output.image.maxHeightPercent) {
      db.prepare(
        "UPDATE display_outputs SET config_json = ?, updated_at = ? WHERE id = 'full'",
      ).run(JSON.stringify(upgraded), new Date().toISOString());
    }
  }
  setMarkerFor(FULL_IMAGE_FILL_KEY);
}

migrateFullImageFill();

function conflict(
  output: DisplayOutput,
  rows: OutputRow[],
  ignoreId?: string,
): string | null {
  const used = new Set<string>();
  for (const row of rows) {
    if (row.id === ignoreId) continue;
    const existing = rowToEntry(row);
    used.add(existing.id);
    for (const alias of existing.aliases) used.add(alias);
  }
  for (const token of [output.id, ...output.aliases]) {
    if (used.has(token)) return token;
  }
  return null;
}

export function listDisplayOutputs(): DisplayOutputEntry[] {
  return allRows().map(rowToEntry);
}

export function sharedDisplayOutputs(): DisplayOutput[] {
  return allRows()
    .filter((row) => row.scope === "shared")
    .map((row) => {
      const { scope: _scope, ...output } = rowToEntry(row);
      return output;
    });
}

export function displayOutputsMap(): Record<string, DisplayOutput> {
  return Object.fromEntries(
    listDisplayOutputs()
      .filter((output) => output.enabled)
      .map((output) => [output.id, output]),
  );
}

export function resolveDisplayOutput(token: string): DisplayOutputEntry | null {
  const key = token.trim().toLowerCase();
  if (!key) return null;
  return (
    listDisplayOutputs().find(
      (output) => output.enabled && (output.id === key || output.aliases.includes(key)),
    ) ?? null
  );
}

export function createDisplayOutput(
  input: DisplayOutput,
  scope: DisplayOutputScope,
): DisplayOutputEntry {
  const output = normaliseOutput(displayOutputSchema.parse(input));
  const rows = allRows();
  const duplicate = conflict(output, rows);
  if (duplicate) throw new Error(`Output ID or alias already in use: ${duplicate}`);
  const sortOrder =
    (db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM display_outputs").get() as {
      next: number;
    }).next;
  writeOutput(output, scope, sortOrder);
  return rowToEntry(
    db.prepare(
      `SELECT id, label, template, scope, sort_order, config_json, created_at, updated_at
       FROM display_outputs WHERE id = ?`,
    ).get(output.id) as OutputRow,
  );
}

export function updateDisplayOutput(id: string, input: DisplayOutput): DisplayOutputEntry {
  const existing = allRows().find((row) => row.id === id);
  if (!existing) throw new Error("Output not found");
  const output = normaliseOutput(displayOutputSchema.parse({ ...input, id }));
  const duplicate = conflict(output, allRows(), id);
  if (duplicate) throw new Error(`Output ID or alias already in use: ${duplicate}`);
  db.prepare(
    `UPDATE display_outputs
     SET label = ?, template = ?, config_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(output.label, output.template, JSON.stringify(output), new Date().toISOString(), id);
  return rowToEntry(
    db.prepare(
      `SELECT id, label, template, scope, sort_order, config_json, created_at, updated_at
       FROM display_outputs WHERE id = ?`,
    ).get(id) as OutputRow,
  );
}

export function deleteDisplayOutput(id: string): boolean {
  return db.prepare("DELETE FROM display_outputs WHERE id = ?").run(id).changes > 0;
}

export function replaceSharedDisplayOutputs(outputs: DisplayOutput[]): void {
  const parsed = outputs.map((output) =>
    upgradeFullImageFill(normaliseOutput(displayOutputSchema.parse(output))),
  );
  const ids = new Set<string>();
  for (const output of parsed) {
    if (ids.has(output.id)) throw new Error(`Duplicate shared output ID: ${output.id}`);
    ids.add(output.id);
  }
  const aliases = new Set<string>();
  for (const output of parsed) {
    for (const alias of output.aliases) {
      if (ids.has(alias) || aliases.has(alias)) {
        throw new Error(`Duplicate shared output alias: ${alias}`);
      }
      aliases.add(alias);
    }
  }
  const localTokens = new Set<string>();
  for (const row of allRows()) {
    if (row.scope !== "local") continue;
    const output = rowToEntry(row);
    localTokens.add(output.id);
    for (const alias of output.aliases) localTokens.add(alias);
  }
  for (const output of parsed) {
    for (const token of [output.id, ...output.aliases]) {
      if (localTokens.has(token)) {
        throw new Error(`Shared output conflicts with a local output: ${token}`);
      }
    }
  }
  const remove = db.prepare("DELETE FROM display_outputs WHERE scope = 'shared'");
  const insert = db.prepare(
    `INSERT INTO display_outputs
       (id, label, template, scope, sort_order, config_json, created_at, updated_at)
     VALUES (?, ?, ?, 'shared', ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  const apply = db.transaction(() => {
    remove.run();
    parsed.forEach((output, index) => {
      insert.run(output.id, output.label, output.template, index, JSON.stringify(output), now, now);
    });
    setMarker();
  });
  apply();
}
