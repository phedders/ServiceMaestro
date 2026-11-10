import { useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { LiveState, PublicUser } from "@wlm/shared";
import { api, ApiError } from "./api";
import { EMPTY_LIVE } from "./empty";
import Login from "./components/Login";
import LivePage from "./pages/LivePage";
import SetlistsPage from "./pages/SetlistsPage";
import SongsPage from "./pages/SongsPage";
import DashboardPage from "./pages/DashboardPage";

type Page = "live" | "setlists" | "songs" | "dashboard";

interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

export default function App() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>("live");
  const [live, setLive] = useState<LiveState>(EMPTY_LIVE);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = (text: string, kind: "info" | "error" = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, text, kind }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  };

  useEffect(() => {
    api
      .me()
      .then((result) => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    api
      .live()
      .then((result) => setLive(result.state))
      .catch(() => undefined);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const socket: Socket = io({ withCredentials: true });
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("live:snapshot", (state: LiveState) => setLive(state));
    return () => {
      socket.disconnect();
    };
  }, [user]);

  const command = async (payload: Record<string, unknown>) => {
    try {
      const result = await api.command(payload);
      setLive(result.state);
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Command failed", "error");
    }
  };

  const quickText = async (text: string) => {
    try {
      const result = await api.quickText(text, "direct");
      setLive(result.state);
      notify("Quick text displayed");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not display text", "error");
    }
  };

  const stopLive = async () => {
    try {
      const result = await api.stopLive();
      setLive(result.state);
      notify("Live session ended");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not stop session", "error");
    }
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
    setLive(EMPTY_LIVE);
  };

  const pageTitle = useMemo(() => {
    switch (page) {
      case "live":
        return "Live control";
      case "setlists":
        return "Set lists";
      case "songs":
        return "Songs";
      case "dashboard":
        return "Dashboard";
    }
  }, [page]);

  if (loading) {
    return <div className="boot">Loading Web Lyric Master…</div>;
  }

  if (!user) {
    return (
      <Login
        onLogin={(nextUser) => {
          setUser(nextUser);
          setPage("live");
        }}
      />
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">♪</div>
          <div>
            <strong>Web Lyric Master</strong>
            <span>Service control</span>
          </div>
        </div>

        <nav className="nav">
          <button className={page === "live" ? "active" : ""} onClick={() => setPage("live")}>
            <span className="nav-icon">▶</span> Live control
          </button>
          <button className={page === "setlists" ? "active" : ""} onClick={() => setPage("setlists")}>
            <span className="nav-icon">☰</span> Set lists
          </button>
          <button className={page === "songs" ? "active" : ""} onClick={() => setPage("songs")}>
            <span className="nav-icon">♫</span> Songs
          </button>
          <button className={page === "dashboard" ? "active" : ""} onClick={() => setPage("dashboard")}>
            <span className="nav-icon">▦</span> Dashboard
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="status-line">
            <span className={`dot ${connected ? "online" : "offline"}`} />
            {connected ? "Connected" : "Reconnecting…"}
          </div>
          <div className="user-line">
            <div>
              <strong>{user.username}</strong>
              <span>{user.role}</span>
            </div>
            <button className="button ghost small" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{pageTitle}</h1>
            <p className="muted">
              {live.status === "idle" ? "No live session" : `${live.setlistName} · ${live.status}`}
            </p>
          </div>
          <div className="topbar-actions">
            {live.status !== "idle" && (
              <button className="button danger" onClick={stopLive}>
                End session
              </button>
            )}
          </div>
        </header>

        {page === "live" && (
          <LivePage
            live={live}
            onCommand={command}
            onQuickText={quickText}
            onStarted={(state) => {
              setLive(state);
              notify("Live session started");
            }}
            notify={notify}
          />
        )}
        {page === "setlists" && (
          <SetlistsPage
            onStarted={(state) => {
              setLive(state);
              setPage("live");
              notify("Live session started");
            }}
            notify={notify}
          />
        )}
        {page === "songs" && <SongsPage notify={notify} />}
        {page === "dashboard" && (
          <DashboardPage
            live={live}
            onCommand={command}
            onQuickText={quickText}
            notify={notify}
          />
        )}
      </main>

      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
}
