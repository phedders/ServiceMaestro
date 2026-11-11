import { useEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AppSettings, FontOption, GitSettings, GitStatus } from "@sm/shared";
import { api, ApiError } from "../api";
import { compactDateTime } from "../service-date";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_LABELS,
  loadKeyboardShortcuts,
  saveKeyboardShortcuts,
  shortcutFromEvent,
  type KeyboardShortcuts,
} from "../keyboard";

export default function SettingsPage({
  notify,
}: {
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [fonts, setFonts] = useState<FontOption[]>([]);
  const [family, setFamily] = useState("");
  const [cssUrl, setCssUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [loadingFonts, setLoadingFonts] = useState(true);
  const [churchsuite, setChurchsuite] = useState<{
    configured: boolean;
    tokenUrl: string;
    apiUrl: string;
    scopes: string;
    hasCachedToken: boolean;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState<KeyboardShortcuts>(loadKeyboardShortcuts);
  const [settings, setSettings] = useState<AppSettings>({ pageNavigation: "stop" });
  const [savingSettings, setSavingSettings] = useState(false);
  const [git, setGit] = useState<GitStatus | null>(null);
  const [gitForm, setGitForm] = useState<GitSettings | null>(null);
  const [gitSaving, setGitSaving] = useState(false);
  const [gitSyncing, setGitSyncing] = useState(false);
  const [gitExporting, setGitExporting] = useState(false);

  async function loadFonts() {
    setLoadingFonts(true);
    try {
      const result = await api.fonts();
      setFonts(result.fonts);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not load fonts", "error");
    } finally {
      setLoadingFonts(false);
    }
  }

  useEffect(() => {
    loadFonts();
    api
      .churchsuiteStatus()
      .then((result) => setChurchsuite(result.status))
      .catch(() => undefined);
    api
      .settings()
      .then((result) => setSettings(result.settings))
      .catch(() => undefined);
    api
      .gitStatus()
      .then((result) => {
        setGit(result);
        setGitForm({
          autoSave: result.autoSave,
          autoPush: result.autoPush,
          pullIntervalSeconds: result.pullIntervalSeconds,
          mergeMode: result.mergeMode,
        });
      })
      .catch(() => undefined);
  }, []);

  async function importFont() {
    if (!family.trim() && !cssUrl.trim()) return;
    setImporting(true);
    setTestResult(null);
    try {
      const result = await api.importFont(
        cssUrl.trim() ? { url: cssUrl.trim() } : { family: family.trim() },
      );
      setFamily("");
      setCssUrl("");
      await loadFonts();
      notify(`Imported ${result.font.label}`);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not import font", "error");
    } finally {
      setImporting(false);
    }
  }

  async function removeFont(font: FontOption) {
    if (!confirm(`Remove the cached font “${font.label}”?`)) return;
    try {
      await api.deleteFont(font.id);
      await loadFonts();
      notify("Font removed");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not remove font", "error");
    }
  }

  async function testChurchsuite() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testChurchsuite();
      setTestResult(`Connected. Sample plan response: ${JSON.stringify(result.plans).slice(0, 500)}`);
      notify("ChurchSuite connection succeeded");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "ChurchSuite test failed";
      setTestResult(message);
      notify(message, "error");
    } finally {
      setTesting(false);
    }
  }

  function captureShortcut(action: keyof KeyboardShortcuts, event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Escape") {
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      setShortcuts((current) => ({ ...current, [action]: "" }));
      return;
    }
    const value = shortcutFromEvent(event.nativeEvent);
    if (value) setShortcuts((current) => ({ ...current, [action]: value }));
  }

  function saveShortcuts() {
    const values = Object.values(shortcuts).filter(Boolean);
    if (new Set(values).size !== values.length) {
      notify("Each keyboard shortcut must be unique", "error");
      return;
    }
    saveKeyboardShortcuts(shortcuts);
    notify("Keyboard shortcuts saved");
  }

  function resetShortcuts() {
    const defaults = { ...DEFAULT_SHORTCUTS };
    setShortcuts(defaults);
    saveKeyboardShortcuts(defaults);
    notify("Keyboard shortcuts reset to defaults");
  }

  async function updatePageNavigation(value: AppSettings["pageNavigation"]) {
    const next = { ...settings, pageNavigation: value };
    setSettings(next);
    setSavingSettings(true);
    try {
      const result = await api.saveSettings(next);
      setSettings(result.settings);
      notify("Live navigation setting saved");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save live navigation", "error");
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveGit() {
    if (!gitForm) return;
    setGitSaving(true);
    try {
      const result = await api.saveGitSettings(gitForm);
      setGit((current) =>
        current
          ? { ...current, ...result.settings, repositories: result.repositories }
          : current,
      );
      setGitForm(result.settings);
      notify("Git settings saved");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save Git settings", "error");
    } finally {
      setGitSaving(false);
    }
  }

  async function syncGitNow() {
    setGitSyncing(true);
    try {
      const result = await api.syncGit();
      setGit((current) => (current ? { ...current, repositories: result.repositories } : current));
      notify("Git pull/sync complete");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Git sync failed", "error");
    } finally {
      setGitSyncing(false);
    }
  }

  async function exportGitNow() {
    setGitExporting(true);
    try {
      const result = await api.exportGit();
      setGit((current) => (current ? { ...current, repositories: result.repositories } : current));
      notify("Git export and push complete");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Git export failed", "error");
    } finally {
      setGitExporting(false);
    }
  }

  return (
    <div className="config-page">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Keyboard shortcuts</h2>
            <p className="muted">
              Control live output without leaving the control window. Shortcuts are ignored while
              typing in an input, textarea or select.
            </p>
          </div>
          <div className="button-row">
            <button className="button ghost" onClick={resetShortcuts}>
              Reset defaults
            </button>
            <button className="button primary" onClick={saveShortcuts}>
              Save shortcuts
            </button>
          </div>
        </div>
        <div className="shortcut-grid">
          {SHORTCUT_LABELS.map(({ action, label, hint }) => (
            <div key={action} className="shortcut-row">
              <div>
                <strong>{label}</strong>
                <span className="muted">{hint}</span>
              </div>
              <input
                className="shortcut-input"
                readOnly
                value={shortcuts[action]}
                placeholder="Press a shortcut…"
                onKeyDown={(event) => captureShortcut(action, event)}
                onFocus={(event) => event.currentTarget.select()}
                title="Focus and press the key combination; Backspace/Delete clears it"
              />
            </div>
          ))}
        </div>
        <p className="hint">
          Defaults: <code>B</code> hide/show, <code>←</code>/<code>→</code> pages,{" "}
          <code>↑</code>/<code>↓</code> set-list items. Press a field and then the desired key
          combination; Backspace or Delete clears it.
        </p>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Live navigation</h2>
            <p className="muted">
              Choose what happens when the previous/next page shortcut reaches the first or final
              page of the current set-list item.
            </p>
          </div>
          {savingSettings && <span className="muted">Saving…</span>}
        </div>
        <label>
          At the first/final page
          <select
            value={settings.pageNavigation}
            onChange={(event) =>
              updatePageNavigation(event.target.value as AppSettings["pageNavigation"])
            }
            disabled={savingSettings}
          >
            <option value="stop">Stop at the page boundary (default)</option>
            <option value="next-item">Continue to the previous/next set-list item</option>
          </select>
        </label>
        <p className="hint">
          “Continue” applies to the previous/next page keyboard shortcuts. Next at the final page
          opens the next item’s first page; previous at the first page opens the previous item’s
          last page. The setting is global for all operators.
        </p>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Fonts</h2>
            <p className="muted">
              Import Google Fonts by family name or CSS URL. Font files are cached in{" "}
              <code>/data/fonts</code> and become available in the Live display config.
            </p>
          </div>
          <span className="muted">{fonts.filter((font) => font.source === "google").length} imported</span>
        </div>

        <div className="font-import">
          <label>
            Google Fonts family
            <input
              value={family}
              onChange={(event) => setFamily(event.target.value)}
              placeholder="e.g. Inter, Lora, Source Sans 3"
            />
          </label>
          <label>
            …or CSS URL
            <input
              value={cssUrl}
              onChange={(event) => setCssUrl(event.target.value)}
              placeholder="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap"
            />
          </label>
          <button
            className="button primary"
            onClick={importFont}
            disabled={importing || (!family.trim() && !cssUrl.trim())}
          >
            {importing ? "Importing…" : "Import font"}
          </button>
        </div>
        <p className="hint">
          Only <code>fonts.googleapis.com</code> CSS URLs are accepted. The import downloads the
          actual font files, so displays keep working without internet access.
        </p>

        <div className="font-list">
          {fonts.map((font) => (
            <div key={font.id} className="font-row">
              <div>
                <strong>{font.label}</strong>
                <span className="muted">
                  {font.source === "google" ? "Google Fonts · cached" : "Built in"}
                  {font.importedAt ? ` · ${compactDateTime(font.importedAt)}` : ""}
                </span>
              </div>
              <code>{font.family}</code>
              {font.source === "google" && (
                <button className="button ghost small danger-text" onClick={() => removeFont(font)}>
                  Remove
                </button>
              )}
            </div>
          ))}
          {!loadingFonts && !fonts.length && <p className="muted">No fonts available.</p>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>ChurchSuite</h2>
            <p className="muted">
              Planning credentials are read from the container environment. Secrets are never stored
              in the database or exposed to the browser.
            </p>
          </div>
          <button className="button" onClick={testChurchsuite} disabled={testing}>
            {testing ? "Testing…" : "Test connection"}
          </button>
        </div>
        {churchsuite ? (
          <div className="config-kv">
            <div>
              <span>Configured</span>
              <strong>{churchsuite.configured ? "Yes" : "No"}</strong>
            </div>
            <div>
              <span>Token endpoint</span>
              <code>{churchsuite.tokenUrl}</code>
            </div>
            <div>
              <span>API base</span>
              <code>{churchsuite.apiUrl}</code>
            </div>
            <div>
              <span>Scopes</span>
              <code>{churchsuite.scopes}</code>
            </div>
          </div>
        ) : (
          <p className="muted">Could not read ChurchSuite status.</p>
        )}
        {testResult && <pre className="config-result">{testResult}</pre>}
        <p className="hint">
          Set <code>SM_CHURCHSUITE_CLIENT_ID</code> and{" "}
          <code>SM_CHURCHSUITE_CLIENT_SECRET</code> in the project&apos;s <code>.env</code> file
          next to <code>compose.yaml</code>, then restart the container.
        </p>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Git repositories</h2>
            <p className="muted">
              Status of the local songs, set-list, Bible and template repositories.
            </p>
          </div>
          <div className="button-row">
            <button className="button ghost" onClick={syncGitNow} disabled={gitSyncing || !git?.enabled}>
              {gitSyncing ? "Syncing…" : "Pull / sync now"}
            </button>
            <button className="button" onClick={exportGitNow} disabled={gitExporting || !git?.enabled}>
              {gitExporting ? "Exporting…" : "Export & push"}
            </button>
          </div>
        </div>

        {!git ? (
          <p className="muted">Could not read Git status.</p>
        ) : !git.enabled ? (
          <p className="muted">Git persistence is disabled for this deployment.</p>
        ) : (
          <>
            {gitForm && (
              <>
                <div className="git-settings-grid">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={gitForm.autoSave}
                      onChange={(event) =>
                        setGitForm({ ...gitForm, autoSave: event.target.checked })
                      }
                    />
                    Auto-commit changes
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={gitForm.autoPush}
                      onChange={(event) =>
                        setGitForm({ ...gitForm, autoPush: event.target.checked })
                      }
                    />
                    Auto-push after commit
                  </label>
                  <label>
                    Pull interval (seconds)
                    <input
                      type="number"
                      min={0}
                      max={86400}
                      value={gitForm.pullIntervalSeconds}
                      onChange={(event) =>
                        setGitForm({
                          ...gitForm,
                          pullIntervalSeconds: Math.max(0, Number(event.target.value) || 0),
                        })
                      }
                    />
                  </label>
                  <label>
                    Remote divergence
                    <select
                      value={gitForm.mergeMode}
                      onChange={(event) =>
                        setGitForm({
                          ...gitForm,
                          mergeMode: event.target.value as GitSettings["mergeMode"],
                        })
                      }
                    >
                      <option value="ff-only">Fast-forward only (stop on divergence)</option>
                      <option value="merge">Pull and merge</option>
                    </select>
                  </label>
                  <button className="button primary" onClick={saveGit} disabled={gitSaving}>
                    {gitSaving ? "Saving…" : "Save Git settings"}
                  </button>
                </div>
                <p className="hint">
                  Pull interval <code>0</code> disables automatic pulls. “Pull and merge” attempts a
                  normal Git merge when the local and remote branches have diverged. Auto-commit
                  controls whether songs/set lists are written when edited.
                </p>
              </>
            )}

            <details className="git-config-vars">
              <summary>Repository configuration variables</summary>
              <p className="hint">
                Repository paths, remotes and branches are configured through the container
                environment or <code>SM_CONFIG_FILE</code>. Remote secrets can be mounted and read
                from <code>_FILE</code> variables; never commit tokens or SSH keys. The runtime
                auto-commit/auto-push/pull/merge options above are stored in SQLite and override the
                environment defaults.
              </p>
              <div className="git-config-grid">
                <div>
                  <strong>Songs</strong>
                  <code>SM_GIT_SONGS_PATH</code>
                  <code>SM_GIT_SONGS_REMOTE</code>
                  <code>SM_GIT_SONGS_REMOTE_FILE</code>
                  <code>SM_GIT_SONGS_BRANCH</code>
                </div>
                <div>
                  <strong>Set lists</strong>
                  <code>SM_GIT_SETLISTS_PATH</code>
                  <code>SM_GIT_SETLISTS_REMOTE</code>
                  <code>SM_GIT_SETLISTS_REMOTE_FILE</code>
                  <code>SM_GIT_SETLISTS_BRANCH</code>
                </div>
                <div>
                  <strong>Bibles</strong>
                  <code>SM_GIT_BIBLES_PATH</code>
                  <code>SM_GIT_BIBLES_REMOTE</code>
                  <code>SM_GIT_BIBLES_REMOTE_FILE</code>
                  <code>SM_GIT_BIBLES_BRANCH</code>
                  <code>SM_GIT_BIBLES_OPTIONAL</code>
                  <code>SM_GIT_BIBLES_LFS</code>
                </div>
                <div>
                  <strong>Templates</strong>
                  <code>SM_GIT_TEMPLATES_PATH</code>
                  <code>SM_GIT_TEMPLATES_REMOTE</code>
                  <code>SM_GIT_TEMPLATES_REMOTE_FILE</code>
                  <code>SM_GIT_TEMPLATES_BRANCH</code>
                </div>
              </div>
              <p className="hint">
                Global: <code>SM_GIT_ENABLED</code>, <code>SM_GIT_AUTO_SAVE</code>,{" "}
                <code>SM_GIT_AUTO_PUSH</code>, <code>SM_GIT_PULL_INTERVAL</code>,{" "}
                <code>SM_GIT_SSH_KEY_FILE</code>, <code>SM_GIT_KNOWN_HOSTS_FILE</code>. YAML
                equivalent: <code>git.repositories.&lt;name&gt;.path/remote/branch</code> and{" "}
                <code>git.repositories.&lt;name&gt;.optional/lfs</code>.
              </p>
            </details>

            <div className="git-repo-list">
              {git.repositories.map((repo) => (
                <div key={repo.name} className="git-repo-row">
                  <div>
                    <strong>{repo.name}</strong>
                    <span className="muted">
                      {repo.remote ? repo.remote : "Local only"} · branch {repo.branch}
                      {repo.optional ? " · optional" : ""}
                    </span>
                  </div>
                  <div className="git-repo-meta">
                    <span>Last pull: {repo.lastPullAt ? compactDateTime(repo.lastPullAt) : "never"}</span>
                    <span>Last push: {repo.lastPushAt ? compactDateTime(repo.lastPushAt) : "never"}</span>
                    {repo.localCommit && <span>Commit: {repo.localCommit.slice(0, 10)}</span>}
                  </div>
                  {repo.error ? (
                    <span className="git-repo-error">{repo.error}</span>
                  ) : (
                    <span className="git-repo-ok">OK</span>
                  )}
                </div>
              ))}
              {!git.repositories.length && <p className="muted">No Git repositories initialised.</p>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
