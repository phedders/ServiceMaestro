import { useEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AppSettings, FontOption } from "@wlm/shared";
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

export default function ConfigPage({
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
          Set <code>WLM_CHURCHSUITE_CLIENT_ID</code> and{" "}
          <code>WLM_CHURCHSUITE_CLIENT_SECRET</code> in the project&apos;s <code>.env</code> file
          next to <code>compose.yaml</code>, then restart the container.
        </p>
      </section>
    </div>
  );
}
