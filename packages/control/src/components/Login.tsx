import { FormEvent, useState } from "react";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import type { BrandingSettings, PublicUser } from "@sm/shared";
import { api, ApiError } from "../api";

export default function Login({
  branding,
  onLogin,
}: {
  branding: BrandingSettings;
  onLogin: (user: PublicUser) => void;
}) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const passkeysSupported = browserSupportsWebAuthn();

  async function passkeyLogin() {
    if (!username.trim()) {
      setError("Enter your username first");
      return;
    }
    setPasskeyBusy(true);
    setError("");
    try {
      const { options } = await api.passkeyLoginOptions(username.trim());
      const response = await startAuthentication({ optionsJSON: options });
      const result = await api.passkeyLoginVerify(username.trim(), response);
      onLogin(result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Passkey sign-in was cancelled");
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.login(username.trim(), password);
      onLogin(result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-art">
        <div className="login-art-inner">
          <img
            className="brand-mark large"
            src={branding.logoUrl ?? "/icon.svg"}
            alt="Service Maestro"
          />
          <h1>Service Maestro</h1>
          <p>Lyrics, Bible passages and service visuals — driven live, with every screen in sync.</p>
          <ul>
            <li>Set lists with live isolation</li>
            <li>ChordPro, scores and tabs</li>
            <li>OBS-ready display outputs</li>
          </ul>
        </div>
      </div>
      <div className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <h2>Sign in</h2>
          <p className="muted">Use your Service Maestro account.</p>
          <label>
            Username
            <input
              value={username}
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              autoFocus
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button
            className="button primary full"
            disabled={busy || passkeyBusy}
            title={busy ? "Signing in…" : "Sign in to Service Maestro"}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
          {passkeysSupported && (
            <button
              type="button"
              className="button full"
              onClick={passkeyLogin}
              disabled={busy || passkeyBusy}
              title="Sign in using a passkey registered to this username"
            >
              {passkeyBusy ? "Waiting for passkey…" : "Sign in with a passkey"}
            </button>
          )}
          <p className="hint">
            The first run creates an <code>admin</code> account. Set <code>SM_ADMIN_PASSWORD</code>{" "}
            before starting the server.
          </p>
        </form>
      </div>
    </div>
  );
}
