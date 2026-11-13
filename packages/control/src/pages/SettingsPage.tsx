import { useEffect, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  DEFAULT_CHURCHSUITE_EMPTY_TYPES,
  SONG_SHEET_FONTS,
  suggestSongPageId,
  type AppSettings,
  type BibleTranslationInfo,
  type ControlTlsStatus,
  type FontOption,
  type GitSettings,
  type GitStatus,
  type PublicUser,
  type SharedFontOption,
  type SongPageIdFixScan,
  type SongSelectWatchStatus,
} from "@sm/shared";
import { useAdapters } from "../adapters";
import { api, ApiError } from "../api";
import { ReadOnlyFieldset } from "../page-access";
import { AccountPanel } from "../components/AccountPanel";
import { BrandingPanel } from "../components/BrandingPanel";
import {
  PREVIEW_SCREENS,
  loadPreviewScreenId,
  savePreviewScreenId,
  type PreviewScreenId,
} from "../preview-screen";
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
  user,
  notify,
}: {
  user: PublicUser;
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const {
    songSelectEnabled,
    churchSuiteEnabled,
    mqttEnabled,
    refresh: refreshAdapters,
  } = useAdapters();
  const [fonts, setFonts] = useState<FontOption[]>([]);
  const [sharedFonts, setSharedFonts] = useState<SharedFontOption[]>([]);
  const [missingFonts, setMissingFonts] = useState<SharedFontOption[]>([]);
  const [family, setFamily] = useState("");
  const [cssUrl, setCssUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [downloadingFontId, setDownloadingFontId] = useState("");
  const [downloadingMissing, setDownloadingMissing] = useState(false);
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
  const [previewScreenId, setPreviewScreenId] = useState<PreviewScreenId>(loadPreviewScreenId);
  const [settings, setSettings] = useState<AppSettings>({
    pageNavigation: "stop",
    churchsuiteEmptyTypes: [...DEFAULT_CHURCHSUITE_EMPTY_TYPES],
    defaultBibleTranslation: null,
    pageIdShortcuts: {},
    songSheetFontFamily: "Helvetica",
    songSheetFontSize: 15,
    songSheetColumns: 1,
  });
  const [bibleTranslations, setBibleTranslations] = useState<BibleTranslationInfo[]>([]);
  const [songselectWatch, setSongselectWatch] = useState<SongSelectWatchStatus | null>(null);
  const [scanningSongselect, setScanningSongselect] = useState(false);
  const [sslEnabled, setSslEnabled] = useState<boolean | null>(null);
  const [sslStatus, setSslStatus] = useState<ControlTlsStatus | null>(null);
  const [pageNames, setPageNames] = useState<string[]>([]);
  const [pageIdDraft, setPageIdDraft] = useState<Record<string, string>>({});
  const [scanningPageIds, setScanningPageIds] = useState(false);
  const [pageIdFixes, setPageIdFixes] = useState<SongPageIdFixScan | null>(null);
  const [fixingPageIds, setFixingPageIds] = useState(false);
  const [applyingPageIdFixes, setApplyingPageIdFixes] = useState(false);
  const [emptyType, setEmptyType] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingAdapters, setSavingAdapters] = useState(false);
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
      setSharedFonts(result.sharedFonts);
      setMissingFonts(result.missingFonts);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not load fonts", "error");
    } finally {
      setLoadingFonts(false);
    }
  }

  useEffect(() => {
    loadFonts();
    api
      .settings()
      .then((result) => setSettings(result.settings))
      .catch(() => undefined);
    api
      .sslStatus()
      .then((result) => {
        setSslEnabled(result.enabled);
        setSslStatus(result.status);
      })
      .catch(() => undefined);
    api
      .bibleTranslations()
      .then((result) => setBibleTranslations(result.translations))
      .catch(() => undefined);
    api
      .songPageNames()
      .then((result) => setPageNames(result.names))
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

  useEffect(() => {
    if (!churchSuiteEnabled) {
      setChurchsuite(null);
      setTestResult(null);
      return;
    }
    api
      .churchsuiteStatus()
      .then((result) => setChurchsuite(result.status))
      .catch(() => undefined);
  }, [churchSuiteEnabled]);

  useEffect(() => {
    if (!songSelectEnabled) {
      setSongselectWatch(null);
      return;
    }
    api
      .songselectWatch()
      .then((result) => setSongselectWatch(result.status))
      .catch(() => undefined);
  }, [songSelectEnabled]);

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

  async function downloadSharedFont(font: SharedFontOption) {
    setDownloadingFontId(font.id);
    try {
      await api.importFont(font.cssUrl ? { url: font.cssUrl } : { family: font.label });
      await loadFonts();
      notify(`Downloaded ${font.label}`);
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : `Could not download ${font.label}`,
        "error",
      );
    } finally {
      setDownloadingFontId("");
    }
  }

  async function downloadMissingFonts() {
    if (!missingFonts.length || downloadingMissing) return;
    setDownloadingMissing(true);
    try {
      const result = await api.importMissingFonts();
      await loadFonts();
      const count = result.downloaded.length;
      if (!result.failed.length) {
        notify(`Downloaded ${count} missing font${count === 1 ? "" : "s"}`);
      } else {
        notify(
          `Downloaded ${count} font${count === 1 ? "" : "s"}; ${result.failed.length} failed`,
          "error",
        );
      }
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Could not download missing fonts",
        "error",
      );
    } finally {
      setDownloadingMissing(false);
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

  async function scanSongselectWatch(force = false) {
    setScanningSongselect(true);
    try {
      const result = await api.scanSongselectWatch(force);
      setSongselectWatch(result.status);
      notify(
        result.report
          ? `SongSelect folder: ${result.report.imported} imported, ${result.report.updated} updated, ${result.report.skipped} skipped`
          : "SongSelect folder scan started",
      );
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Could not scan the SongSelect folder",
        "error",
      );
    } finally {
      setScanningSongselect(false);
    }
  }

  function shortcutForPage(name: string): string {
    const key = Object.keys(settings.pageIdShortcuts).find(
      (candidate) => candidate.toLowerCase() === name.toLowerCase(),
    );
    return key ? settings.pageIdShortcuts[key] : "";
  }

  function pageIdValue(name: string): string {
    if (Object.prototype.hasOwnProperty.call(pageIdDraft, name)) return pageIdDraft[name];
    return shortcutForPage(name) || suggestSongPageId(name) || "";
  }

  async function scanPageNames(showNotice = true): Promise<string[] | null> {
    setScanningPageIds(true);
    setPageIdFixes(null);
    try {
      const result = await api.songPageNames();
      setPageNames(result.names);
      if (showNotice) notify(`Found ${result.names.length} distinct song page names`);
      return result.names;
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Could not scan song page names",
        "error",
      );
      return null;
    } finally {
      setScanningPageIds(false);
    }
  }

  function pageIdShortcutMap(names = pageNames): Record<string, string> {
    const shortcuts = { ...settings.pageIdShortcuts };
    for (const name of names) {
      const cleaned = pageIdValue(name)
        .trim()
        .replace(/\s+/g, "")
        .replace(/[^a-zA-Z0-9_-]/g, "");
      if (cleaned) shortcuts[name] = cleaned;
      else delete shortcuts[name];
    }
    return shortcuts;
  }

  async function savePageIdShortcuts(showNotice = true, names = pageNames): Promise<boolean> {
    setSavingSettings(true);
    try {
      const result = await api.saveSettings({
        ...settings,
        pageIdShortcuts: pageIdShortcutMap(names),
      });
      setSettings(result.settings);
      setPageIdDraft({});
      if (showNotice) notify("Song page ID shortcuts saved");
      return true;
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Could not save page ID shortcuts",
        "error",
      );
      return false;
    } finally {
      setSavingSettings(false);
    }
  }

  async function scanPageIdFixes() {
    setFixingPageIds(true);
    setPageIdFixes(null);
    try {
      const names = await scanPageNames(false);
      if (!names) return;
      if (!(await savePageIdShortcuts(false, names))) return;
      const result = await api.songPageIdFixes();
      setPageIdFixes(result);
      notify(
        result.totalSongs
          ? `${result.totalSongs} song${result.totalSongs === 1 ? "" : "s"} can be fixed`
          : "No songs need page ID fixes",
      );
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Could not scan songs for page ID fixes",
        "error",
      );
    } finally {
      setFixingPageIds(false);
    }
  }

  async function applyPageIdFixes() {
    if (!pageIdFixes?.songs.length) return;
    setApplyingPageIdFixes(true);
    try {
      const result = await api.applySongPageIdFixes(
        pageIdFixes.songs.map((song) => song.songId),
      );
      setPageIdFixes(null);
      notify(`Updated page IDs in ${result.updated} songs`);
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Could not apply page ID fixes",
        "error",
      );
    } finally {
      setApplyingPageIdFixes(false);
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

  async function updateDefaultBibleTranslation(code: string) {
    const next = { ...settings, defaultBibleTranslation: code || null };
    setSettings(next);
    setSavingSettings(true);
    try {
      const result = await api.saveSettings(next);
      setSettings(result.settings);
      notify("Default Bible version saved");
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Could not save the default Bible version",
        "error",
      );
    } finally {
      setSavingSettings(false);
    }
  }

  async function saveSongSheetSettings() {
    setSavingSettings(true);
    try {
      const result = await api.saveSettings(settings);
      setSettings(result.settings);
      notify("Big Print PDF defaults saved");
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Could not save Big Print PDF settings",
        "error",
      );
    } finally {
      setSavingSettings(false);
    }
  }

  async function updateEmptyTypes(nextTypes: string[]) {
    const next = { ...settings, churchsuiteEmptyTypes: nextTypes };
    setSettings(next);
    setSavingSettings(true);
    try {
      const result = await api.saveSettings(next);
      setSettings(result.settings);
      notify("ChurchSuite empty item types saved");
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Could not save ChurchSuite item types",
        "error",
      );
    } finally {
      setSavingSettings(false);
    }
  }

  function addEmptyType() {
    const value = emptyType.trim();
    if (!value) return;
    const exists = settings.churchsuiteEmptyTypes.some(
      (entry) => entry.toLowerCase() === value.toLowerCase(),
    );
    if (exists) {
      notify("That ChurchSuite item type is already in the list", "error");
      return;
    }
    setEmptyType("");
    void updateEmptyTypes([...settings.churchsuiteEmptyTypes, value]);
  }

  function removeEmptyType(value: string) {
    void updateEmptyTypes(
      settings.churchsuiteEmptyTypes.filter((entry) => entry !== value),
    );
  }

  async function updateAdapter(
    key: "songSelectEnabled" | "churchSuiteEnabled" | "mqttEnabled",
    enabled: boolean,
  ) {
    setSavingAdapters(true);
    try {
      const result = await api.saveIntegrationSettings({
        songSelectEnabled:
          key === "songSelectEnabled" ? enabled : songSelectEnabled,
        churchSuiteEnabled:
          key === "churchSuiteEnabled" ? enabled : churchSuiteEnabled,
        mqttEnabled: key === "mqttEnabled" ? enabled : mqttEnabled,
      });
      await refreshAdapters();
      const label =
        key === "songSelectEnabled"
          ? "SongSelect"
          : key === "churchSuiteEnabled"
            ? "ChurchSuite"
            : "MQTT";
      notify(`${label} adapter ${result.settings[key] ? "enabled" : "disabled"}`);
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Could not save adapter settings",
        "error",
      );
    } finally {
      setSavingAdapters(false);
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
      <p className="hint">
        Team-wide settings — live navigation, default Bible, page IDs, display styling and
        background colours — sync through <code>settings/shared.json</code> in the set lists
        repository. Keyboard shortcuts, credentials, adapter availability and Git settings stay
        local to this server.
      </p>

      <AccountPanel user={user} notify={notify} />

      <ReadOnlyFieldset>
        {user.role === "admin" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>External adapters</h2>
                <p className="muted">
                  Enable only the integrations this installation uses. Availability is local to
                  this server and only administrators can change it. Disabled adapters are removed
                  from navigation, action buttons, help and settings immediately.
                </p>
              </div>
              {savingAdapters && <span className="muted">Saving…</span>}
            </div>
            <div className="adapter-toggle-grid">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={songSelectEnabled}
                  onChange={(event) =>
                    void updateAdapter("songSelectEnabled", event.target.checked)
                  }
                  disabled={savingAdapters}
                />
                SongSelect adapter
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={churchSuiteEnabled}
                  onChange={(event) =>
                    void updateAdapter("churchSuiteEnabled", event.target.checked)
                  }
                  disabled={savingAdapters}
                />
                ChurchSuite adapter
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={mqttEnabled}
                  onChange={(event) =>
                    void updateAdapter("mqttEnabled", event.target.checked)
                  }
                  disabled={savingAdapters}
                />
                MQTT adapter
              </label>
            </div>
            <p className="hint">
              Disabling an adapter does not delete its credentials, permissions or imported data.
              Re-enable it here to restore the related pages and buttons. When MQTT is enabled, its
              broker and command workspace is available under <strong>Menu → MQTT</strong>.
            </p>
          </section>
        )}

        {user.role === "admin" && <BrandingPanel notify={notify} />}

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Big Print PDF</h2>
            <p className="muted">
              Defaults for the printable song sheet. The set-list page can override text size and
              columns for a single download.
            </p>
          </div>
          <button
            className="button primary"
            onClick={saveSongSheetSettings}
            disabled={savingSettings}
            title="Save the default font, text size and columns for song-sheet PDFs"
          >
            {savingSettings ? "Saving…" : "Save PDF defaults"}
          </button>
        </div>
        <div className="song-sheet-settings-grid">
          <label>
            Font
            <select
              value={settings.songSheetFontFamily}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  songSheetFontFamily: event.target.value as AppSettings["songSheetFontFamily"],
                })
              }
            >
              {SONG_SHEET_FONTS.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Text size
            <input
              type="number"
              min={8}
              max={28}
              value={settings.songSheetFontSize}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  songSheetFontSize: Math.max(
                    8,
                    Math.min(28, Number(event.target.value) || 15),
                  ),
                })
              }
            />
          </label>
          <label>
            Columns
            <select
              value={settings.songSheetColumns}
              onChange={(event) =>
                setSettings({ ...settings, songSheetColumns: Number(event.target.value) })
              }
            >
              <option value={1}>1 column</option>
              <option value={2}>2 columns</option>
              <option value={3}>3 columns</option>
            </select>
          </label>
        </div>
      </section>

      {sslEnabled !== null && (
        <section
          className={`panel ssl-status-panel ${
            !sslEnabled ? "disabled" : sslStatus?.warnings.length ? "warning" : ""
          }`}
        >
          <div className="panel-heading">
            <div>
              <h2>Control HTTPS</h2>
              <p className="muted">
                {sslEnabled
                  ? "The control interface is HTTPS-only. Display outputs remain plain HTTP on the display port."
                  : "Control HTTPS is disabled. The control interface is served over plain HTTP and must be protected by a TLS-terminating forward proxy."}
              </p>
            </div>
            <span
              className={`ssl-badge ${
                !sslEnabled ? "http-mode" : sslStatus?.selfSigned ? "self-signed" : "trusted"
              }`}
            >
              {!sslEnabled
                ? "HTTP · proxy TLS"
                : sslStatus?.source === "generated"
                  ? "Self-signed · generated"
                  : sslStatus?.selfSigned
                    ? "Self-signed · provided"
                    : "Provided certificate"}
            </span>
          </div>
          {!sslEnabled ? (
            <>
              <p className="ssl-warning">
                Never expose the control port directly while HTTPS is disabled. Put it behind a
                trusted reverse proxy that terminates HTTPS and forwards to this server.
              </p>
              <p className="hint">
                Set <code>SM_SSL_ENABLED=false</code> or <code>ssl.enabled: false</code> in the
                config file. Keep <code>SM_SECURE_COOKIES=true</code> when the browser reaches the
                proxy over HTTPS.
              </p>
            </>
          ) : sslStatus ? (
            <>
              {sslStatus.warnings.map((warning) => (
                <p key={warning} className="ssl-warning">
                  {warning}
                </p>
              ))}
              <div className="config-kv ssl-cert-details">
                <div>
                  <span className="muted">Certificate</span>
                  <code>{sslStatus.certFile}</code>
                </div>
                <div>
                  <span className="muted">Private key</span>
                  <code>{sslStatus.keyFile}</code>
                </div>
                <div>
                  <span className="muted">Valid until</span>
                  <span>{compactDateTime(sslStatus.validTo)}</span>
                </div>
                <div>
                  <span className="muted">Days remaining</span>
                  <span>{sslStatus.daysRemaining}</span>
                </div>
              </div>
              <p className="hint">
                Provide a trusted certificate as <code>cert.pem</code> and <code>key.pem</code> in{" "}
                <code>{sslStatus.sslDir}</code>, or set <code>SM_SSL_CERT_FILE</code> and{" "}
                <code>SM_SSL_KEY_FILE</code>. Restart the server after replacing certificates.
              </p>
              {sslStatus.hasLocalCa && (
                <p className="hint">
                  Devices must trust the local CA before passkeys can be registered.{" "}
                  <a className="button ghost small" href="/api/ssl/ca.crt" download>
                    Download local CA
                  </a>{" "}
                  and install it on each device. On the local network it can also be downloaded from{" "}
                  <code>/display/ca.crt</code> on the display port.
                </p>
              )}
            </>
          ) : (
            <p className="muted">Loading certificate status…</p>
          )}
        </section>
      )}

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
            <button
              className="button ghost"
              onClick={resetShortcuts}
              title="Restore the default keyboard shortcuts"
            >
              Reset defaults
            </button>
            <button
              className="button primary"
              onClick={saveShortcuts}
              title="Save these keyboard shortcuts in this browser"
            >
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
            <h2>Live preview screen</h2>
            <p className="muted">
              Choose the screen size and aspect ratio emulated by the live preview on this control
              device.
            </p>
          </div>
        </div>
        <label>
          Emulated screen
          <select
            value={previewScreenId}
            onChange={(event) => {
              const next = event.target.value as PreviewScreenId;
              setPreviewScreenId(next);
              savePreviewScreenId(next);
            }}
          >
            {PREVIEW_SCREENS.map((screen) => (
              <option key={screen.id} value={screen.id}>
                {screen.label}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          The preview renders at this virtual resolution and is scaled down to fit the control
          panel. This makes font sizes and 16:9/16:10 layout match the real output screen. It only
          affects this browser and does not change the displays or shared settings.
        </p>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Bible</h2>
            <p className="muted">
              Choose the translation opened by default in the Bible module and when adding a Bible
              passage from a set list.
            </p>
          </div>
          {savingSettings && <span className="muted">Saving…</span>}
        </div>
        <label>
          Default Bible version
          <select
            value={settings.defaultBibleTranslation ?? ""}
            onChange={(event) => updateDefaultBibleTranslation(event.target.value)}
            disabled={savingSettings}
          >
            <option value="">First available translation</option>
            {bibleTranslations.map((translation) => (
              <option key={translation.code} value={translation.code}>
                {translation.name} ({translation.code})
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          If the selected version is unavailable, the first translation found in the Bible folder is
          used instead.
        </p>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Song page IDs</h2>
            <p className="muted">
              Scan the song library for section names such as “Verse 1” or “Opening Prayer”, then
              choose the compact ID used by the <strong>Simplify page IDs</strong> option. IDs never
              contain spaces; duplicate IDs get a numeric suffix within each song.
            </p>
          </div>
          <div className="button-row">
            <button
              className="button"
              onClick={() => void scanPageNames()}
              disabled={scanningPageIds}
              title="Scan all songs for distinct section/page names"
            >
              {scanningPageIds ? "Scanning…" : "Scan song database"}
            </button>
            <button
              className="button primary"
              onClick={scanPageIdFixes}
              disabled={fixingPageIds || scanningPageIds || savingSettings}
              title="Scan the song database, save the conversion table, and offer fixes for long or spaced page names"
            >
              {fixingPageIds ? "Scanning songs…" : "Fix songs"}
            </button>
            <button
              className="button ghost"
              onClick={() => void savePageIdShortcuts()}
              disabled={savingSettings || !pageNames.length}
              title="Save the short ID for each page name without changing any songs"
            >
              Save page IDs
            </button>
          </div>
        </div>
        {pageNames.length ? (
          <div className="page-id-table-wrap">
            <table className="page-id-table">
              <thead>
                <tr>
                  <th>Page name in songs</th>
                  <th>Short page ID</th>
                </tr>
              </thead>
              <tbody>
                {pageNames.map((name) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>
                      <input
                        value={pageIdValue(name)}
                        onChange={(event) => {
                          setPageIdFixes(null);
                          setPageIdDraft((current) => ({
                            ...current,
                            [name]: event.target.value,
                          }));
                        }}
                        placeholder={suggestSongPageId(name) ?? "short-id"}
                        title={`Short ID for “${name}”`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Scan the song database to list page names.</p>
        )}

        {pageIdFixes && (
          <div className="page-id-fix-preview">
            <div className="panel-heading">
              <div>
                <h3>Songs needing page ID fixes</h3>
                <p className="muted">
                  {pageIdFixes.totalSongs} songs · {pageIdFixes.totalLabels} page names to change
                </p>
              </div>
              <div className="button-row">
                <button
                  className="button primary"
                  onClick={applyPageIdFixes}
                  disabled={!pageIdFixes.totalSongs || applyingPageIdFixes}
                  title="Apply these page ID changes to the selected songs"
                >
                  {applyingPageIdFixes
                    ? "Fixing…"
                    : `Apply fixes to ${pageIdFixes.totalSongs} song${
                        pageIdFixes.totalSongs === 1 ? "" : "s"
                      }`}
                </button>
                <button
                  className="button ghost"
                  onClick={() => setPageIdFixes(null)}
                  disabled={applyingPageIdFixes}
                >
                  Cancel
                </button>
              </div>
            </div>
            {pageIdFixes.songs.length ? (
              <div className="page-id-fix-list">
                {pageIdFixes.songs.map((song) => (
                  <div key={song.songId} className="page-id-fix-row">
                    <strong>{song.title}</strong>
                    <span>
                      {song.changes
                        .map((change) => `${change.from} → ${change.to}`)
                        .join(" · ")}
                      {song.verseOrderChanged ? " · verse order" : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No song labels need changing with this conversion table.</p>
            )}
          </div>
        )}
      </section>

      {songSelectEnabled && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>SongSelect drop folder</h2>
            <p className="muted">
              Point the CCLI downloader’s output folder here. New text files are imported into the
              song library automatically and recorded in the list below.
            </p>
          </div>
          <div className="button-row">
            <button
              className="button primary"
              onClick={() => scanSongselectWatch(false)}
              disabled={scanningSongselect}
              title="Scan the SongSelect drop folder for new files"
            >
              {scanningSongselect ? "Scanning…" : "Scan now"}
            </button>
            <button
              className="button ghost"
              onClick={() => scanSongselectWatch(true)}
              disabled={scanningSongselect}
              title="Re-process every file, including previously skipped or errored files"
            >
              Force rescan
            </button>
          </div>
        </div>
        {songselectWatch ? (
          <>
            <div className="config-kv">
              <div className="span-2">
                <span>Drop directory</span>
                <code>{songselectWatch.directory}</code>
              </div>
              <div>
                <span>Watcher</span>
                <strong>
                  {songselectWatch.enabled
                    ? `On · every ${songselectWatch.intervalSeconds}s`
                    : "Disabled"}
                </strong>
              </div>
              <div>
                <span>Last scan</span>
                <strong>
                  {songselectWatch.lastScanAt
                    ? compactDateTime(songselectWatch.lastScanAt)
                    : "Not yet"}
                </strong>
              </div>
              <div>
                <span>Unseen files</span>
                <strong>{songselectWatch.pendingFiles}</strong>
              </div>
              <div>
                <span>Recently processed</span>
                <strong>{songselectWatch.recent.length}</strong>
              </div>
            </div>
            {songselectWatch.lastError && (
              <p className="banner error">{songselectWatch.lastError}</p>
            )}
            {songselectWatch.recent.length > 0 && (
              <div className="songselect-watch-list">
                {songselectWatch.recent.map((file) => (
                  <div key={`${file.path}-${file.processedAt}`} className="songselect-watch-row">
                    <span className={`badge ${file.status}`}>{file.status}</span>
                    <div>
                      <strong>{file.songTitle || file.path.split("/").pop()}</strong>
                      <span className="muted">
                        {file.path}
                        {file.message ? ` · ${file.message}` : ""}
                      </span>
                    </div>
                    <time>{compactDateTime(file.processedAt)}</time>
                  </div>
                ))}
              </div>
            )}
            {songselectWatch.recent.length === 0 && (
              <p className="muted">No files have been processed yet.</p>
            )}
          </>
        ) : (
          <p className="muted">Could not read the SongSelect watcher status.</p>
        )}
        <p className="hint">
          The folder is scanned automatically every few seconds. Files stay in place; re-downloading
          the same filename updates its song. A file that matches an existing song title or CCLI
          number is skipped until you use <strong>Force rescan</strong>.
        </p>
        </section>
      )}

      {churchSuiteEnabled && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>ChurchSuite empty items</h2>
            <p className="muted">
              Plan object types in this list become empty set-list items during import. They have no
              pages, so their text never reaches a display; any ChurchSuite text is kept in the
              item&apos;s notes.
            </p>
          </div>
          {savingSettings && <span className="muted">Saving…</span>}
        </div>
        <div className="churchsuite-empty-add">
          <input
            value={emptyType}
            onChange={(event) => setEmptyType(event.target.value)}
            placeholder="ChurchSuite object type, e.g. Welcome"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addEmptyType();
              }
            }}
          />
          <button
            className="button primary"
            onClick={addEmptyType}
            disabled={!emptyType.trim() || savingSettings}
            title="Add this ChurchSuite plan object type to the empty-item list"
          >
            Add type
          </button>
        </div>
        <div className="churchsuite-empty-list">
          {settings.churchsuiteEmptyTypes.map((type) => (
            <span key={type} className="churchsuite-empty-chip">
              {type}
              <button
                type="button"
                onClick={() => removeEmptyType(type)}
                title={`Remove “${type}” from the empty-item list`}
                aria-label={`Remove ${type} from the empty-item list`}
              >
                ×
              </button>
            </span>
          ))}
          {!settings.churchsuiteEmptyTypes.length && (
            <span className="muted">No empty-item types configured.</span>
          )}
        </div>
          <p className="hint">
            Defaults: {DEFAULT_CHURCHSUITE_EMPTY_TYPES.join(", ")}.
          </p>
        </section>
      )}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Fonts</h2>
            <p className="muted">
              Import Google Fonts by family name or CSS URL. Font files are cached in{" "}
              <code>/data/fonts</code> and become available in the Live display config.
            </p>
          </div>
          <div className="font-heading-actions">
            <span className="muted">
              {fonts.filter((font) => font.source === "google").length} downloaded ·{" "}
              {fonts.filter((font) => font.source === "local").length} local ·{" "}
              {sharedFonts.length} shared
              {missingFonts.length ? ` · ${missingFonts.length} missing` : ""}
            </span>
            <button
              className="button primary small"
              onClick={downloadMissingFonts}
              disabled={!missingFonts.length || downloadingMissing}
              title="Download every font listed in the shared settings file that is missing on this server"
            >
              {downloadingMissing
                ? "Downloading…"
                : `Download missing${missingFonts.length ? ` (${missingFonts.length})` : ""}`}
            </button>
          </div>
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
            title="Download and cache the specified Google font for offline displays"
          >
            {importing ? "Importing…" : "Import font"}
          </button>
        </div>
        <p className="hint">
          Only <code>fonts.googleapis.com</code> CSS URLs are accepted. The import downloads the
          actual font files, so displays keep working without internet access. Font files placed
          directly in <code>/data/fonts</code> are detected automatically and listed as local. Team
          settings and downloaded Google font names are shared through{" "}
          <code>settings/shared.json</code> in the set lists repository.
        </p>

        <div className="font-list">
          {missingFonts.map((font) => (
            <div key={`shared-${font.id}`} className="font-row missing">
              <div>
                <strong>{font.label}</strong>
                <span className="muted">Shared · not downloaded on this server</span>
              </div>
              <code>{font.family}</code>
              <button
                className="button primary small"
                onClick={() => downloadSharedFont(font)}
                disabled={downloadingMissing || Boolean(downloadingFontId)}
                title={`Download “${font.label}” on this server`}
              >
                {downloadingFontId === font.id ? "Downloading…" : "Download"}
              </button>
            </div>
          ))}
          {fonts.map((font) => (
            <div key={font.id} className="font-row">
              <div>
                <strong>{font.label}</strong>
                <span className="muted">
                  {font.source === "google"
                    ? "Google Fonts · cached"
                    : font.source === "local"
                      ? "Local file · detected"
                      : "Built in"}
                  {font.importedAt ? ` · ${compactDateTime(font.importedAt)}` : ""}
                </span>
              </div>
              <code>{font.family}</code>
              {font.source === "google" && (
                <button
                  className="button ghost small danger-text"
                  onClick={() => removeFont(font)}
                  title={`Remove the cached font “${font.label}”`}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {!loadingFonts && !fonts.length && !missingFonts.length && (
            <p className="muted">No fonts available.</p>
          )}
        </div>
      </section>

      {churchSuiteEnabled && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>ChurchSuite</h2>
            <p className="muted">
              Planning credentials are read from the container environment. Secrets are never stored
              in the database or exposed to the browser.
            </p>
          </div>
          <button
            className="button"
            onClick={testChurchsuite}
            disabled={testing}
            title="Test the configured ChurchSuite credentials and API access"
          >
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
      )}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Git repositories</h2>
            <p className="muted">
              Status of the local songs, set-list, Bible and template repositories.
            </p>
          </div>
          <div className="button-row">
            <button
              className="button ghost"
              onClick={syncGitNow}
              disabled={gitSyncing || !git?.enabled}
              title="Pull the configured Git repositories and reload their data"
            >
              {gitSyncing ? "Syncing…" : "Pull / sync now"}
            </button>
            <button
              className="button"
              onClick={exportGitNow}
              disabled={gitExporting || !git?.enabled}
              title="Write songs and set lists to Git and push to the remote"
            >
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
                  <button
                    className="button primary"
                    onClick={saveGit}
                    disabled={gitSaving}
                    title="Save runtime Git automation settings"
                  >
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
      </ReadOnlyFieldset>
    </div>
  );
}
