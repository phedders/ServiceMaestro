import fs from "node:fs";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { z } from "zod";
import { db } from "./db.js";
import {
  GIT_AUTHOR_EMAIL,
  GIT_AUTHOR_NAME,
  GIT_ENABLED,
  GIT_REPOS,
  type GitRepoConfig,
} from "./config.js";
import { getGitSettings } from "./settings.js";
import { buildSetlistExport, parseSetlistFile, type SetlistManifest } from "./setlist-transfer.js";
import { reloadBibleCatalog, setBibleDir } from "./bible.js";
import { addDefaultVerseTags } from "./lyrics.js";
import {
  exportTarpBundle,
  importTarpBundle,
  tarpPresentationFile,
  tarpThemeFile,
} from "./tarp-export.js";

interface RepoRuntime {
  config: GitRepoConfig;
  git: SimpleGit;
  lastError: string | null;
  lastPullAt: string | null;
  lastPushAt: string | null;
  localCommit: string | null;
}

const runtimes = new Map<string, RepoRuntime>();
let queue: Promise<unknown> = Promise.resolve();
let timer: NodeJS.Timeout | null = null;

const songFileSchema = z.object({
  schemaVersion: z.number().optional(),
  id: z.string(),
  title: z.string(),
  alternateTitles: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  copyright: z.string().nullable().optional(),
  ccli: z.string().nullable().optional(),
  key: z.string().nullable().optional(),
  lyrics: z.string(),
  verseOrder: z.string().nullable().optional(),
  lyricsMarkdown: z.boolean().optional(),
  verseOrders: z.array(z.object({ name: z.string(), order: z.string() })).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

export function redactRemote(remote: string | null): string | null {
  if (!remote) return null;
  try {
    const url = new URL(remote);
    if (url.username || url.password) {
      url.username = url.username ? "***" : "";
      url.password = url.password ? "***" : "";
    }
    return url.toString();
  } catch {
    // scp-like SSH URIs do not contain credentials.
    return remote;
  }
}

function safeError(error: unknown, remote: string | null): string {
  let message = (error as Error).message ?? String(error);
  if (remote) message = message.split(remote).join(redactRemote(remote) ?? "");
  return message.replace(/https?:\/\/[^@\s/]+@/g, "https://***@");
}

async function ensureRepo(config: GitRepoConfig): Promise<RepoRuntime> {
  fs.mkdirSync(config.path, { recursive: true });
  let git = simpleGit({ baseDir: config.path, maxConcurrentProcesses: 1 });
  const hasRepo = fs.existsSync(path.join(config.path, ".git"));

  if (!hasRepo) {
    if (config.remote) {
      try {
        await simpleGit().clone(config.remote, config.path, ["--branch", config.branch]);
        git = simpleGit({ baseDir: config.path, maxConcurrentProcesses: 1 });
      } catch {
        // Fall back to an empty local repo; a later sync can pull.
        await git.init(["--initial-branch", config.branch]);
        await git.addRemote("origin", config.remote);
      }
    } else {
      await git.init(["--initial-branch", config.branch]);
    }
  }

  await git.addConfig("user.name", GIT_AUTHOR_NAME, false, "local");
  await git.addConfig("user.email", GIT_AUTHOR_EMAIL, false, "local");

  if (config.remote) {
    const remotes = await git.getRemotes();
    if (remotes.some((remote) => remote.name === "origin")) {
      await git.remote(["set-url", "origin", config.remote]);
    } else {
      await git.addRemote("origin", config.remote);
    }
    try {
      await git.raw(["fetch", "origin", config.branch]);
      await git.raw(["pull", "--ff-only", "origin", config.branch]);
    } catch {
      // Offline or a new empty remote; keep the local state.
    }
  }

  if (config.name === "bibles" && config.lfs !== "off") {
    try {
      await git.raw(["lfs", "version"]);
      if (config.lfs === "required") {
        await git.raw(["lfs", "install", "--local"]);
      }
      if (config.remote) await git.raw(["lfs", "pull"]);
    } catch (error) {
      throw new Error(`Git LFS operation failed: ${(error as Error).message}`);
    }
  }

  const runtime: RepoRuntime = {
    config,
    git,
    lastError: null,
    lastPullAt: null,
    lastPushAt: null,
    localCommit: null,
  };
  runtimes.set(config.name, runtime);
  return runtime;
}

async function commit(runtime: RepoRuntime, message: string): Promise<void> {
  await runtime.git.add(["-A"]);
  const status = await runtime.git.status();
  if (!status.files.length) return;
  await runtime.git.commit(message);
  runtime.localCommit = (await runtime.git.revparse(["HEAD"])).trim();
  if (getGitSettings().autoPush && runtime.config.remote) {
    try {
      await runtime.git.raw(["push", "origin", runtime.config.branch]);
      runtime.lastPushAt = new Date().toISOString();
      runtime.lastError = null;
    } catch (error) {
      runtime.lastError = `Push failed: ${safeError(error, runtime.config.remote)}`;
    }
  }
}

function writeAtomically(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}

function songJson(id: string): string | null {
  const row = db.prepare("SELECT * FROM songs WHERE id = ?").get(id) as
    | {
        id: string;
        title: string;
        alternate_titles: string | null;
        author: string | null;
        copyright: string | null;
        ccli: string | null;
        key: string | null;
        lyrics: string;
        verse_order: string | null;
        lyrics_markdown: number;
        created_at: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  const verseOrders = (
    db
      .prepare("SELECT name, order_text FROM song_verse_orders WHERE song_id = ? ORDER BY name COLLATE NOCASE")
      .all(id) as Array<{ name: string; order_text: string }>
  ).map((entry) => ({ name: entry.name, order: entry.order_text }));
  return JSON.stringify(
    {
      schemaVersion: 2,
      id: row.id,
      title: row.title,
      alternateTitles: row.alternate_titles,
      author: row.author,
      copyright: row.copyright,
      ccli: row.ccli,
      key: row.key,
      lyrics: row.lyrics,
      verseOrder: row.verse_order,
      lyricsMarkdown: Boolean(row.lyrics_markdown),
      verseOrders,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    null,
    2,
  );
}

async function writeSong(runtime: RepoRuntime, id: string): Promise<void> {
  const json = songJson(id);
  if (!json) return;
  writeAtomically(path.join(runtime.config.path, "songs", `${id}.json`), json);
  await commit(runtime, `song: update ${id}`);
}

async function deleteSong(runtime: RepoRuntime, id: string): Promise<void> {
  const file = path.join(runtime.config.path, "songs", `${id}.json`);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    await commit(runtime, `song: delete ${id}`);
  }
}

function findSong(item: SetlistManifest["items"][number]): { id: string } | null {
  if (item.songId) {
    const byId = db.prepare("SELECT id FROM songs WHERE id = ?").get(item.songId) as
      | { id: string }
      | undefined;
    if (byId) return byId;
  }
  if (item.song?.ccli) {
    const byCcli = db.prepare("SELECT id FROM songs WHERE ccli = ? LIMIT 1").get(item.song.ccli) as
      | { id: string }
      | undefined;
    if (byCcli) return byCcli;
  }
  const title = item.song?.title || item.title;
  const rows = db
    .prepare("SELECT id, author FROM songs WHERE lower(title) = lower(?)")
    .all(title) as Array<{ id: string; author: string | null }>;
  if (rows.length === 1) return rows[0];
  if (item.song?.author) {
    const found = rows.find(
      (row) =>
        (row.author ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") ===
        item.song!.author!.toLowerCase().replace(/[^a-z0-9]/g, ""),
    );
    if (found) return found;
  }
  return null;
}

function importSetlist(manifest: SetlistManifest): void {
  if (manifest.tarp) importTarpBundle(manifest.tarp);
  const id = manifest.setlist.id ?? `git-${Date.now()}`;
  const existing = db.prepare("SELECT id FROM setlists WHERE id = ?").get(id);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(
      `UPDATE setlists SET name = ?, service_date = ?, service_time = ?, notes = ?,
       background_id = ?, stinger_id = ?, updated_at = ? WHERE id = ?`,
    ).run(
      manifest.setlist.name,
      manifest.setlist.serviceDate,
      manifest.setlist.serviceTime ?? null,
      manifest.setlist.notes ?? null,
      manifest.setlist.backgroundId ?? null,
      manifest.setlist.stingerId ?? null,
      now,
      id,
    );
    db.prepare("DELETE FROM setlist_items WHERE setlist_id = ?").run(id);
  } else {
    db.prepare(
      `INSERT INTO setlists
       (id, name, service_date, service_time, notes, background_id, stinger_id,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      manifest.setlist.name,
      manifest.setlist.serviceDate,
      manifest.setlist.serviceTime ?? null,
      manifest.setlist.notes ?? null,
      manifest.setlist.backgroundId ?? null,
      manifest.setlist.stingerId ?? null,
      now,
      now,
    );
  }

  const insert = db.prepare(
    `INSERT INTO setlist_items
     (id, setlist_id, position, kind, song_id, title, content, content_source,
      text_format, text_align, image_fit, background_id, stinger_id,
      stinger_overrides_json, key_override, transpose, max_lines, verse_order, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const item of manifest.items) {
    let songId: string | null = null;
    let content = item.content ?? null;
    if (item.kind === "song") {
      const found = findSong(item);
      if (found) {
        songId = found.id;
      } else if (item.song?.lyrics) {
        songId = `git-${manifest.setlist.id}-${item.position}`;
        const exists = db.prepare("SELECT id FROM songs WHERE id = ?").get(songId);
        if (!exists) {
          db.prepare(
            `INSERT INTO songs
             (id, title, author, copyright, ccli, key, lyrics, verse_order, source_format, source_path, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'git', NULL, ?, ?)`,
          ).run(
            songId,
            item.song.title,
            item.song.author ?? null,
            item.song.copyright ?? null,
            item.song.ccli ?? null,
            item.song.key ?? null,
            addDefaultVerseTags(item.song.lyrics),
            item.song.verseOrder ?? null,
            now,
            now,
          );
        }
      } else {
        content = item.title;
      }
    }

    insert.run(
      `git-item-${manifest.setlist.id}-${item.position}`,
      id,
      item.position,
      item.kind === "image" || item.kind === "image_list" || item.kind === "tarp"
        ? item.kind
        : songId
          ? "song"
          : "text",
      songId,
      item.title,
      content,
      item.contentSource ?? "text",
      item.kind === "text" ? item.format ?? null : null,
      item.kind === "text" ? item.textAlign ?? "left" : null,
      item.kind === "image" || item.kind === "image_list" ? item.imageFit ?? "scale" : "scale",
      item.backgroundId ?? null,
      item.stingerId ?? null,
      item.stingerPageOverrides ? JSON.stringify(item.stingerPageOverrides) : null,
      item.keyOverride ?? null,
      item.transpose ?? 0,
      item.maxLines ?? 4,
      item.verseOrder ?? null,
      item.notes ?? null,
    );
  }
}

function importSongsFromRepo(runtime: RepoRuntime): number {
  const dir = path.join(runtime.config.path, "songs");
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = songFileSchema.safeParse(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
      if (!parsed.success) continue;
      const song = parsed.data;
      const existing = db.prepare("SELECT id FROM songs WHERE id = ?").get(song.id);
      if (existing) {
        db.prepare(
          `UPDATE songs SET title = ?, alternate_titles = ?, author = ?, copyright = ?, ccli = ?, key = ?, lyrics = ?,
             verse_order = ?, lyrics_markdown = ?, updated_at = ? WHERE id = ?`,
        ).run(
          song.title,
          song.alternateTitles ?? null,
          song.author ?? null,
          song.copyright ?? null,
          song.ccli ?? null,
          song.key ?? null,
          addDefaultVerseTags(song.lyrics),
          song.verseOrder ?? null,
          song.lyricsMarkdown ? 1 : 0,
          song.updatedAt ?? new Date().toISOString(),
          song.id,
        );
      } else {
        db.prepare(
          `INSERT INTO songs
           (id, title, alternate_titles, author, copyright, ccli, key, lyrics, verse_order, lyrics_markdown, source_format, source_path, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'git', NULL, ?, ?)`,
        ).run(
          song.id,
          song.title,
          song.alternateTitles ?? null,
          song.author ?? null,
          song.copyright ?? null,
          song.ccli ?? null,
          song.key ?? null,
          addDefaultVerseTags(song.lyrics),
          song.verseOrder ?? null,
          song.lyricsMarkdown ? 1 : 0,
          song.createdAt ?? new Date().toISOString(),
          song.updatedAt ?? new Date().toISOString(),
        );
      }
      for (const verseOrder of song.verseOrders ?? []) {
        db.prepare(
          `INSERT INTO song_verse_orders (id, song_id, name, order_text, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(song_id, name) DO UPDATE SET order_text = excluded.order_text, updated_at = excluded.updated_at`,
        ).run(
          `git-vo-${song.id}-${verseOrder.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          song.id,
          verseOrder.name,
          verseOrder.order,
          song.createdAt ?? new Date().toISOString(),
          song.updatedAt ?? new Date().toISOString(),
        );
      }
      count += 1;
    } catch {
      // Ignore invalid files; they remain in the repo for inspection.
    }
  }
  return count;
}

function importSetlistsFromRepo(runtime: RepoRuntime): number {
  const dir = path.join(runtime.config.path, "setlists");
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = parseSetlistFile(fs.readFileSync(path.join(dir, name)), name);
      importSetlist(parsed.manifest);
      count += 1;
    } catch {
      // Ignore invalid files.
    }
  }
  return count;
}

function importTarpFromRepo(runtime: RepoRuntime): number {
  const themeDir = path.join(runtime.config.path, "tarp", "themes");
  const presentationDir = path.join(runtime.config.path, "tarp", "presentations");
  const themes: unknown[] = [];
  const presentations: unknown[] = [];
  for (const [dir, target] of [
    [themeDir, themes],
    [presentationDir, presentations],
  ] as const) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      try {
        target.push(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
      } catch {
        // Ignore malformed files; they remain in the repository.
      }
    }
  }
  if (!themes.length && !presentations.length) return 0;
  importTarpBundle({ themes, presentations });
  return themes.length + presentations.length;
}

async function exportAllTarp(runtime: RepoRuntime): Promise<void> {
  const bundle = exportTarpBundle();
  const themeDir = path.join(runtime.config.path, "tarp", "themes");
  const presentationDir = path.join(runtime.config.path, "tarp", "presentations");
  fs.mkdirSync(themeDir, { recursive: true });
  fs.mkdirSync(presentationDir, { recursive: true });

  const themeFiles = new Set((bundle.themes ?? []).map((theme) => `${theme.id}.json`));
  const presentationFiles = new Set(
    (bundle.presentations ?? []).map((presentation) => `${presentation.id}.json`),
  );
  for (const name of fs.readdirSync(themeDir)) {
    if (name.endsWith(".json") && !themeFiles.has(name)) fs.unlinkSync(path.join(themeDir, name));
  }
  for (const name of fs.readdirSync(presentationDir)) {
    if (name.endsWith(".json") && !presentationFiles.has(name)) {
      fs.unlinkSync(path.join(presentationDir, name));
    }
  }

  for (const theme of bundle.themes ?? []) {
    writeAtomically(path.join(themeDir, `${theme.id}.json`), tarpThemeFile(theme));
  }
  for (const presentation of bundle.presentations ?? []) {
    writeAtomically(
      path.join(presentationDir, `${presentation.id}.json`),
      tarpPresentationFile(presentation),
    );
  }
  await commit(
    runtime,
    `tarp: export ${bundle.presentations?.length ?? 0} presentations`,
  );
}

async function pullRuntime(runtime: RepoRuntime): Promise<void> {
  if (!runtime.config.remote) return;
  try {
    await runtime.git.raw(["fetch", "origin", runtime.config.branch]);
    const mergeMode = getGitSettings().mergeMode;
    await runtime.git.raw([
      "pull",
      mergeMode === "merge" ? "--no-rebase" : "--ff-only",
      "origin",
      runtime.config.branch,
    ]);
    runtime.lastPullAt = new Date().toISOString();
    runtime.lastError = null;
  } catch (error) {
    const message = (error as Error).message;
    if (message.includes("couldn't find remote ref")) {
      runtime.lastError = null;
      return;
    }
    runtime.lastError = `Pull failed: ${safeError(error, runtime.config.remote)}`;
  }
}

export async function syncGitFromRemotes(): Promise<void> {
  if (!GIT_ENABLED) return;
  for (const runtime of runtimes.values()) {
    await pullRuntime(runtime);
  }
  const songs = runtimes.get("songs");
  const setlists = runtimes.get("setlists");
  if (songs) importSongsFromRepo(songs);
  if (setlists) {
    importTarpFromRepo(setlists);
    importSetlistsFromRepo(setlists);
  }
  const bibles = runtimes.get("bibles");
  if (bibles) {
    const hasFiles =
      fs.existsSync(bibles.config.path) &&
      fs.readdirSync(bibles.config.path).some((name) => /\.(sqlite3?|db|json)$/i.test(name));
    if (hasFiles) {
      setBibleDir(bibles.config.path);
      reloadBibleCatalog();
    }
  }
}

export function configureGitAutoSync(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (!GIT_ENABLED) return;
  const interval = getGitSettings().pullIntervalSeconds;
  if (interval > 0) {
    timer = setInterval(() => {
      void syncGitFromRemotes().catch(() => undefined);
    }, interval * 1000);
    timer.unref();
  }
}

export async function initializeGitStorage(): Promise<void> {
  if (!GIT_ENABLED) return;
  try {
    await serial(async () => {
      for (const config of Object.values(GIT_REPOS)) {
        try {
          const runtime = await ensureRepo(config);
          await pullRuntime(runtime);

          if (config.name === "songs") {
            const dir = path.join(config.path, "songs");
            const hasFiles = fs.existsSync(dir) && fs.readdirSync(dir).some((name) => name.endsWith(".json"));
            if (hasFiles) importSongsFromRepo(runtime);
            else await exportAllSongs(runtime);
          }
          if (config.name === "setlists") {
            importTarpFromRepo(runtime);
            const dir = path.join(config.path, "setlists");
            const hasFiles = fs.existsSync(dir) && fs.readdirSync(dir).some((name) => name.endsWith(".json"));
            if (hasFiles) importSetlistsFromRepo(runtime);
            else await exportAllSetlists(runtime);
            await exportAllTarp(runtime);
          }
          if (config.name === "bibles") {
            const hasFiles =
              fs.existsSync(config.path) &&
              fs.readdirSync(config.path).some((name) => /\.(sqlite3?|db|json)$/i.test(name));
            if (hasFiles) {
              setBibleDir(config.path);
              reloadBibleCatalog();
            }
          }
        } catch (error) {
          const existing = runtimes.get(config.name);
          if (existing) existing.lastError = safeError(error, config.remote);
          // eslint-disable-next-line no-console
          console.warn(`[sm] Git repository ${config.name} unavailable: ${safeError(error, config.remote)}`);
        }
      }
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`[sm] Git storage disabled: ${(error as Error).message}`);
  }

  configureGitAutoSync();
}

async function exportAllSongs(runtime: RepoRuntime): Promise<void> {
  const rows = db.prepare("SELECT id FROM songs ORDER BY title COLLATE NOCASE").all() as Array<{ id: string }>;
  for (const row of rows) {
    const json = songJson(row.id);
    if (json) writeAtomically(path.join(runtime.config.path, "songs", `${row.id}.json`), json);
  }
  await commit(runtime, `songs: export ${rows.length} songs`);
}

async function exportAllSetlists(runtime: RepoRuntime): Promise<void> {
  const rows = db.prepare("SELECT id FROM setlists").all() as Array<{ id: string }>;
  for (const row of rows) {
    const manifest = buildSetlistExport(row.id, false).manifest;
    writeAtomically(
      path.join(runtime.config.path, "setlists", `${row.id}.json`),
      JSON.stringify(manifest, null, 2),
    );
  }
  await commit(runtime, `setlists: export ${rows.length} set lists`);
}

export async function saveSongToGit(id: string): Promise<void> {
  if (!GIT_ENABLED || !getGitSettings().autoSave) return;
  const runtime = runtimes.get("songs");
  if (!runtime) return;
  await serial(() => writeSong(runtime, id));
}

export async function deleteSongFromGit(id: string): Promise<void> {
  if (!GIT_ENABLED || !getGitSettings().autoSave) return;
  const runtime = runtimes.get("songs");
  if (!runtime) return;
  await serial(() => deleteSong(runtime, id));
}

export async function saveSetlistToGit(id: string): Promise<void> {
  if (!GIT_ENABLED || !getGitSettings().autoSave) return;
  const runtime = runtimes.get("setlists");
  if (!runtime) return;
  const manifest = buildSetlistExport(id, false).manifest;
  await serial(async () => {
    writeAtomically(
      path.join(runtime.config.path, "setlists", `${id}.json`),
      JSON.stringify(manifest, null, 2),
    );
    await commit(runtime, `setlist: update ${id}`);
  });
}

export async function deleteSetlistFromGit(id: string): Promise<void> {
  if (!GIT_ENABLED || !getGitSettings().autoSave) return;
  const runtime = runtimes.get("setlists");
  if (!runtime) return;
  await serial(async () => {
    const file = path.join(runtime.config.path, "setlists", `${id}.json`);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      await commit(runtime, `setlist: delete ${id}`);
    }
  });
}

export async function saveTarpLibraryToGit(): Promise<void> {
  if (!GIT_ENABLED || !getGitSettings().autoSave) return;
  const runtime = runtimes.get("setlists");
  if (!runtime) return;
  await serial(() => exportAllTarp(runtime));
}

export async function exportAllToGit(): Promise<void> {
  const songs = runtimes.get("songs");
  const setlists = runtimes.get("setlists");
  if (songs) await serial(() => exportAllSongs(songs));
  if (setlists) await serial(() => exportAllSetlists(setlists));
  if (setlists) await serial(() => exportAllTarp(setlists));
}

export async function pushGit(): Promise<void> {
  for (const runtime of runtimes.values()) {
    if (!runtime.config.remote) continue;
    try {
      await runtime.git.raw(["push", "origin", runtime.config.branch]);
      runtime.lastPushAt = new Date().toISOString();
      runtime.lastError = null;
    } catch (error) {
      runtime.lastError = `Push failed: ${safeError(error, runtime.config.remote)}`;
    }
  }
}

export function gitStatus(): Array<Record<string, unknown>> {
  const settings = getGitSettings();
  return [...runtimes.values()].map((runtime) => ({
    name: runtime.config.name,
    path: runtime.config.path,
    remote: redactRemote(runtime.config.remote),
    branch: runtime.config.branch,
    optional: runtime.config.optional,
    lfs: runtime.config.lfs,
    autoSave: settings.autoSave,
    autoPush: settings.autoPush,
    lastPullAt: runtime.lastPullAt,
    lastPushAt: runtime.lastPushAt,
    localCommit: runtime.localCommit,
    error: runtime.lastError,
  }));
}

export function shutdownGit(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
