import { FormEvent, useState } from "react";
import type { PublicUser } from "@wlm/shared";
import { api, ApiError } from "../api";

export default function Login({ onLogin }: { onLogin: (user: PublicUser) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
          <div className="brand-mark large">♪</div>
          <h1>Web Lyric Master</h1>
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
          <p className="muted">Use your Web Lyric Master account.</p>
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
          <button className="button primary full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="hint">
            The first run creates an <code>admin</code> account. Set <code>WLM_ADMIN_PASSWORD</code>{" "}
            before starting the server.
          </p>
        </form>
      </div>
    </div>
  );
}
