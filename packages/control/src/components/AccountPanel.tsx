import { useEffect, useState } from "react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import {
  MODULE_PERMISSIONS,
  type PasskeySummary,
  type PublicUser,
  type SiteScraperProviderSummary,
} from "@sm/shared";
import { api, ApiError } from "../api";
import { compactDateTime } from "../service-date";

export function AccountPanel({
  user,
  notify,
}: {
  user: PublicUser;
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [passkeyName, setPasskeyName] = useState("");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [siteProviders, setSiteProviders] = useState<SiteScraperProviderSummary[]>([]);
  const [siteForms, setSiteForms] = useState<
    Record<string, { username: string; password: string; cookie: string }>
  >({});
  const [siteBusy, setSiteBusy] = useState<string | null>(null);
  const passkeysSupported = browserSupportsWebAuthn();

  async function loadPasskeys() {
    try {
      const result = await api.passkeys();
      setPasskeys(result.passkeys);
    } catch {
      setPasskeys([]);
    }
  }

  useEffect(() => {
    void loadPasskeys();
  }, []);

  async function loadSiteProviders() {
    try {
      const result = await api.siteScrapingProviders();
      setSiteProviders(result.providers);
      setSiteForms((current) =>
        Object.fromEntries(
          result.providers.map((provider) => [
            provider.id,
            current[provider.id] ?? {
              username: provider.userUsername ?? "",
              password: "",
              cookie: "",
            },
          ]),
        ),
      );
    } catch {
      setSiteProviders([]);
    }
  }

  useEffect(() => {
    void loadSiteProviders();
  }, []);

  function updateSiteForm(
    providerId: string,
    patch: Partial<{ username: string; password: string; cookie: string }>,
  ) {
    setSiteForms((current) => ({
      ...current,
      [providerId]: {
        username: current[providerId]?.username ?? "",
        password: current[providerId]?.password ?? "",
        cookie: current[providerId]?.cookie ?? "",
        ...patch,
      },
    }));
  }

  async function saveSiteCredentials(provider: SiteScraperProviderSummary) {
    const form = siteForms[provider.id] ?? { username: "", password: "", cookie: "" };
    setSiteBusy(provider.id);
    try {
      await api.saveSiteCredentials(provider.id, {
        username: form.username.trim() || undefined,
        password: form.password || undefined,
        cookie: form.cookie || undefined,
      });
      setSiteForms((current) => ({
        ...current,
        [provider.id]: { username: form.username, password: "", cookie: "" },
      }));
      await loadSiteProviders();
      notify(`${provider.label} credentials saved`);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not save site credentials", "error");
    } finally {
      setSiteBusy(null);
    }
  }

  async function removeSiteCredentials(provider: SiteScraperProviderSummary) {
    if (!confirm(`Remove your ${provider.label} credentials?`)) return;
    setSiteBusy(provider.id);
    try {
      await api.deleteSiteCredentials(provider.id);
      setSiteForms((current) => ({
        ...current,
        [provider.id]: { username: "", password: "", cookie: "" },
      }));
      await loadSiteProviders();
      notify(`${provider.label} credentials removed`);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not remove site credentials", "error");
    } finally {
      setSiteBusy(null);
    }
  }

  async function changePassword() {
    if (!currentPassword || newPassword.length < 8) {
      notify("Enter your current password and a new password of at least 8 characters", "error");
      return;
    }
    setChangingPassword(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      notify("Password changed");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not change password", "error");
    } finally {
      setChangingPassword(false);
    }
  }

  async function registerPasskey() {
    if (!passkeysSupported) return;
    setPasskeyBusy(true);
    try {
      const { options } = await api.passkeyRegistrationOptions();
      const response = await startRegistration({ optionsJSON: options });
      await api.verifyPasskeyRegistration(response, passkeyName.trim() || undefined);
      setPasskeyName("");
      await loadPasskeys();
      notify("Passkey registered");
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Passkey registration was cancelled",
        "error",
      );
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function removePasskey(passkey: PasskeySummary) {
    if (!confirm(`Remove passkey “${passkey.name}”?`)) return;
    setPasskeyBusy(true);
    try {
      await api.deletePasskey(passkey.id);
      await loadPasskeys();
      notify("Passkey removed");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not remove passkey", "error");
    } finally {
      setPasskeyBusy(false);
    }
  }

  return (
    <section className="panel account-panel">
      <div className="panel-heading">
        <div>
          <h2>My account</h2>
          <p className="muted">
            Signed in as <strong>{user.username}</strong> · {user.role}
          </p>
        </div>
      </div>

      <div className="account-section">
        <h3>Change password</h3>
        <div className="account-password-grid">
          <label>
            Current password
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="At least 8 characters"
            />
          </label>
          <button
            className="button primary"
            onClick={changePassword}
            disabled={changingPassword}
            title="Change your own password"
          >
            {changingPassword ? "Changing…" : "Change password"}
          </button>
        </div>
      </div>

      <div className="account-section">
        <div className="panel-heading">
          <div>
            <h3>Passkeys</h3>
            <p className="muted">
              Use a device passkey, fingerprint, face recognition or security key to sign in.
            </p>
          </div>
          {passkeysSupported && (
            <div className="button-row">
              <input
                value={passkeyName}
                onChange={(event) => setPasskeyName(event.target.value)}
                placeholder="Passkey name (optional)"
              />
              <button
                className="button primary small"
                onClick={registerPasskey}
                disabled={passkeyBusy}
                title="Register a passkey on this device"
              >
                {passkeyBusy ? "Waiting…" : "Register passkey"}
              </button>
            </div>
          )}
        </div>
        {!passkeysSupported && (
          <p className="hint">This browser does not support WebAuthn passkeys.</p>
        )}
        <div className="passkey-list">
          {passkeys.map((passkey) => (
            <div key={passkey.id} className="passkey-row">
              <div>
                <strong>{passkey.name}</strong>
                <span className="muted">
                  Added {compactDateTime(passkey.createdAt)}
                  {passkey.lastUsedAt ? ` · last used ${compactDateTime(passkey.lastUsedAt)}` : ""}
                </span>
              </div>
              <button
                className="button ghost small danger-text"
                onClick={() => removePasskey(passkey)}
                disabled={passkeyBusy}
                title={`Remove passkey “${passkey.name}”`}
              >
                Remove
              </button>
            </div>
          ))}
          {passkeysSupported && !passkeys.length && (
            <p className="muted">No passkeys registered yet.</p>
          )}
        </div>
      </div>

      <div className="account-section">
        <div className="panel-heading">
          <div>
            <h3>Song site credentials</h3>
            <p className="muted">
              Personal credentials for the site scraping framework that downloads SongPro, lead
              sheet, chord and lyric files.
            </p>
          </div>
        </div>
        <p className="hint">
          Credentials are encrypted at rest and are only used for downloads you start. Personal
          credentials override the server credential set from <code>config.yaml</code>; server
          credentials are the fallback when you have none.
        </p>
        {siteProviders.map((provider) => {
          const form = siteForms[provider.id] ?? {
            username: provider.userUsername ?? "",
            password: "",
            cookie: "",
          };
          const busy = siteBusy === provider.id;
          const sourceLabel =
            provider.activeSource === "user"
              ? `Using your credentials${provider.userUsername ? ` (${provider.userUsername})` : ""}`
              : provider.activeSource === "server"
                ? "Using server credentials"
                : "No credentials configured";
          return (
            <div className="site-credential-card" key={provider.id}>
              <div className="site-credential-heading">
                <div>
                  <strong>{provider.label}</strong>
                  <span className="muted">{provider.description}</span>
                  <span className="hint">
                    {provider.artifactKinds.join(" · ")} · {sourceLabel}
                  </span>
                </div>
                {provider.userConfigured && (
                  <button
                    className="button ghost small danger-text"
                    onClick={() => void removeSiteCredentials(provider)}
                    disabled={busy}
                    title={`Remove your ${provider.label} credentials`}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="site-credential-grid">
                <label>
                  Username
                  <input
                    value={form.username}
                    onChange={(event) =>
                      updateSiteForm(provider.id, { username: event.target.value })
                    }
                    autoComplete="username"
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={form.password}
                    onChange={(event) =>
                      updateSiteForm(provider.id, { password: event.target.value })
                    }
                    autoComplete="current-password"
                    placeholder={
                      provider.userConfigured ? "Leave blank to keep current" : "Website password"
                    }
                  />
                </label>
                <label>
                  Session cookie
                  <input
                    type="password"
                    value={form.cookie}
                    onChange={(event) =>
                      updateSiteForm(provider.id, { cookie: event.target.value })
                    }
                    placeholder="Optional alternative to username/password"
                  />
                </label>
                <button
                  className="button primary small"
                  onClick={() => void saveSiteCredentials(provider)}
                  disabled={busy}
                  title={`Save your ${provider.label} credentials`}
                >
                  {busy ? "Saving…" : "Save credentials"}
                </button>
              </div>
              {provider.serverConfigured && (
                <p className="hint">
                  A server-level credential set is configured for this provider.
                </p>
              )}
            </div>
          );
        })}
        {!siteProviders.length && <p className="muted">No site scraper providers are available.</p>}
      </div>

      <div className="account-section">
        <h3>Write access</h3>
        <div className="permission-summary">
          {MODULE_PERMISSIONS.map((module) => (
            <span
              key={module.id}
              className={`permission-chip ${user.permissions[module.id] ? "allowed" : ""}`}
            >
              {module.label}
            </span>
          ))}
        </div>
        <p className="hint">
          An administrator controls these module permissions. Read-only access is always available.
        </p>
      </div>
    </section>
  );
}
