import { useEffect, useState } from "react";
import type { BrandingSettings } from "@sm/shared";
import { api, ApiError } from "../api";

const DEFAULT_NAV_COLOR = "#0a1018";

export function BrandingPanel({
  notify,
}: {
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [branding, setBranding] = useState<BrandingSettings | null>(null);
  const [navColor, setNavColor] = useState(DEFAULT_NAV_COLOR);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const result = await api.branding();
      setBranding(result.branding);
      setNavColor(result.branding.navBackground ?? DEFAULT_NAV_COLOR);
    } catch {
      setBranding(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function changed(next: BrandingSettings) {
    setBranding(next);
    window.dispatchEvent(new Event("sm-branding-changed"));
  }

  async function saveColor() {
    setBusy(true);
    try {
      const result = await api.saveBranding(navColor);
      changed(result.branding);
      notify("Navigation background saved");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save navigation colour", "error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadLogo() {
    if (!logoFile) return;
    setBusy(true);
    try {
      const result = await api.uploadBrandingLogo(logoFile);
      setLogoFile(null);
      changed(result.branding);
      notify("Site logo updated");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not upload logo", "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeLogo() {
    if (!confirm("Remove the custom site logo and return to the default Service Maestro icon?")) {
      return;
    }
    setBusy(true);
    try {
      const result = await api.deleteBrandingLogo();
      changed(result.branding);
      notify("Site logo removed");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not remove logo", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel branding-panel">
      <div className="panel-heading">
        <div>
          <h2>Instance branding</h2>
          <p className="muted">
            Personalise this installation. These settings are local to this server and are not
            shared through the set lists repository.
          </p>
        </div>
      </div>

      <div className="branding-logo-row">
        <div className="branding-logo-preview">
          <img src={branding?.logoUrl ?? "/icon.svg"} alt="Site logo preview" />
        </div>
        <div className="branding-logo-actions">
          <label>
            Site logo
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml"
              onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <div className="button-row">
            <button
              className="button primary small"
              onClick={uploadLogo}
              disabled={!logoFile || busy}
              title="Upload a new site logo"
            >
              {busy ? "Saving…" : "Upload logo"}
            </button>
            {branding?.logoUrl && (
              <button
                className="button ghost small danger-text"
                onClick={removeLogo}
                disabled={busy}
                title="Remove the custom logo"
              >
                Reset logo
              </button>
            )}
          </div>
          <p className="hint">PNG, JPEG, GIF, WebP, AVIF or SVG, up to 5 MB.</p>
        </div>
      </div>

      <div className="branding-colour-row">
        <label>
          Sidebar / top menu background
          <input
            type="color"
            value={navColor}
            onChange={(event) => setNavColor(event.target.value)}
          />
        </label>
        <button
          className="button primary"
          onClick={saveColor}
          disabled={busy}
          title="Save the navigation background colour"
        >
          Save background
        </button>
        <button
          className="button ghost"
          onClick={() => setNavColor(DEFAULT_NAV_COLOR)}
          disabled={busy}
          title="Reset the colour field to the default"
        >
          Default colour
        </button>
      </div>
      <p className="hint">
        The colour applies immediately after saving. Choose a dark colour so the white navigation
        text remains readable.
      </p>
    </section>
  );
}
