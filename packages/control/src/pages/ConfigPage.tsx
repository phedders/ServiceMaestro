import { useEffect, useState } from "react";
import type { FontOption } from "@wlm/shared";
import { api, ApiError } from "../api";

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

  return (
    <div className="config-page">
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
                  {font.importedAt ? ` · ${new Date(font.importedAt).toLocaleString()}` : ""}
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
