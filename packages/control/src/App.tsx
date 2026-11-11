import { useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { LiveState, PublicUser } from "@sm/shared";
import { api, ApiError } from "./api";
import { EMPTY_LIVE } from "./empty";
import Login from "./components/Login";
import LivePage from "./pages/LivePage";
import SetlistsPage from "./pages/SetlistsPage";
import SongsPage from "./pages/SongsPage";
import BiblePage from "./pages/BiblePage";
import MusiciansPage from "./pages/MusiciansPage";
import SettingsPage from "./pages/SettingsPage";
import HelpPage from "./pages/HelpPage";
import ChurchsuitePage from "./pages/ChurchsuitePage";
import ImagesPage from "./pages/ImagesPage";
import {
  SHORTCUT_CHANGE_EVENT,
  isTypingTarget,
  loadKeyboardShortcuts,
  shortcutMatches,
  type KeyboardShortcuts,
} from "./keyboard";

type Page = "live" | "setlists" | "songs" | "images" | "bible" | "churchsuite" | "settings" | "help";

interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

export default function App() {
  const standaloneMusicians =
    typeof window !== "undefined" && /^\/musicians\/?$/.test(window.location.pathname);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>("live");
  const [live, setLive] = useState<LiveState>(EMPTY_LIVE);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [shortcuts, setShortcuts] = useState<KeyboardShortcuts>(loadKeyboardShortcuts);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("sm-sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [topbarMode, setTopbarMode] = useState(() => {
    try {
      return window.localStorage.getItem("sm-topbar-mode") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem("sm-sidebar-collapsed", sidebarCollapsed ? "1" : "0");
      window.localStorage.setItem("sm-topbar-mode", topbarMode ? "1" : "0");
    } catch {
      // Storage can be unavailable in private browsing; layout still works for this session.
    }
  }, [sidebarCollapsed, topbarMode]);

  useEffect(() => {
    const refresh = () => setShortcuts(loadKeyboardShortcuts());
    window.addEventListener(SHORTCUT_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SHORTCUT_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

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
    if (!user || standaloneMusicians) return;
    api
      .live()
      .then((result) => setLive(result.state))
      .catch(() => undefined);
  }, [user, standaloneMusicians]);

  useEffect(() => {
    if (!user || standaloneMusicians) return;
    const socket: Socket = io({ withCredentials: true });
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("live:snapshot", (state: LiveState) => setLive(state));
    return () => {
      socket.disconnect();
    };
  }, [user, standaloneMusicians]);

  useEffect(() => {
    const applyTitles = () => {
      document
        .querySelectorAll<HTMLElement>("button, a.button, a.nav-link, a.image-thumb, label.button")
        .forEach((element) => {
          if (element.title) return;
          const label =
            element.getAttribute("aria-label") ||
            element.innerText.replace(/\s+/g, " ").trim() ||
            element.querySelector("img")?.alt;
          if (label) element.title = label;
        });
    };
    applyTitles();
    const observer = new MutationObserver(applyTitles);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const command = async (payload: Record<string, unknown>) => {
    try {
      const result = await api.command(payload);
      setLive(result.state);
      if (payload.type === "appendItem") notify("Pages appended to the live queue");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Command failed", "error");
    }
  };

  useEffect(() => {
    if (!user || standaloneMusicians) return;

    const handler = (event: KeyboardEvent) => {
      if (event.repeat || isTypingTarget(event.target)) return;
      if (live.status === "idle") return;

      if (shortcutMatches(event, shortcuts.toggleBlank)) {
        event.preventDefault();
        command({ type: "blank", value: !live.blank });
        return;
      }
      if (shortcutMatches(event, shortcuts.nextPage)) {
        event.preventDefault();
        command({ type: "page", delta: 1 });
        return;
      }
      if (shortcutMatches(event, shortcuts.previousPage)) {
        event.preventDefault();
        command({ type: "page", delta: -1 });
        return;
      }
      if (!live.items.length) return;
      const currentItem = Math.max(0, live.itemIndex);
      if (shortcutMatches(event, shortcuts.nextItem)) {
        const target = Math.min(live.items.length - 1, currentItem + 1);
        event.preventDefault();
        command({ type: "goto", itemIndex: target });
        return;
      }
      if (shortcutMatches(event, shortcuts.previousItem)) {
        const target = Math.max(0, currentItem - 1);
        event.preventDefault();
        command({ type: "goto", itemIndex: target });
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [user, standaloneMusicians, shortcuts, live, command]);

  const quickText = async (text: string) => {
    try {
      const result = await api.quickText(text, "direct");
      setLive(result.state);
      notify("Quick text displayed");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not display text", "error");
    }
  };

  const quickSong = async (songId: string) => {
    try {
      const result = await api.quickSong(songId);
      setLive(result.state);
      notify("Song displayed");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not display song", "error");
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
      case "images":
        return "Images";
      case "bible":
        return "Bible";
      case "churchsuite":
        return "ChurchSuite";
      case "settings":
        return "Settings";
      case "help":
        return "Help";
    }
  }, [page]);

  if (loading) {
    return <div className="boot">Loading Service Maestro…</div>;
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

  if (standaloneMusicians) {
    return (
      <div className="standalone-shell">
        <header className="standalone-header">
          <div className="brand">
            <img className="brand-mark" src="/icon.svg" alt="Service Maestro" />
            <div>
              <strong>Service Maestro</strong>
              <span>Musicians · read-only service view</span>
            </div>
          </div>
          <div className="standalone-header-actions">
            <span className="muted">
              {user.username} · {user.role}
            </span>
            <a className="button ghost" href="/" title="Open the main Service Maestro control window">
              Control
            </a>
            <button className="button ghost" onClick={logout} title="Sign out of Service Maestro">
              Sign out
            </button>
          </div>
        </header>
        <main className="standalone-main">
          <MusiciansPage notify={notify} />
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

  return (
    <div
      className={`app ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${topbarMode ? "topbar-mode" : ""}`}
    >
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src="/icon.svg" alt="Service Maestro" />
          <div>
            <strong>Service Maestro</strong>
            <span>Service control</span>
          </div>
        </div>

        <nav className="nav">
          <button
            className={page === "live" ? "active" : ""}
            onClick={() => setPage("live")}
            title="Open live control, transport and display settings"
          >
            <span className="nav-icon">▶</span> Live control
          </button>
          <button
            className={page === "setlists" ? "active" : ""}
            onClick={() => setPage("setlists")}
            title="Open set lists to plan and publish services"
          >
            <span className="nav-icon">☰</span> Set lists
          </button>
          <button
            className={page === "songs" ? "active" : ""}
            onClick={() => setPage("songs")}
            title="Open the song library and import tools"
          >
            <span className="nav-icon">♫</span> Songs
          </button>
          <button
            className={page === "images" ? "active" : ""}
            onClick={() => setPage("images")}
            title="Browse, upload and add images to set lists"
          >
            <span className="nav-icon">▣</span> Images
          </button>
          <button
            className={page === "bible" ? "active" : ""}
            onClick={() => setPage("bible")}
            title="Look up a Bible passage to display or add to a set list"
          >
            <span className="nav-icon">✝</span> Bible
          </button>
          <a
            className="nav-link"
            href="/musicians"
            target="_blank"
            rel="noreferrer"
            title="Open the read-only musicians view in a new tab"
          >
            <span className="nav-icon">♪</span> Musicians
          </a>
          <button
            className={page === "churchsuite" ? "active" : ""}
            onClick={() => setPage("churchsuite")}
            title="Pull ChurchSuite plans and create draft set lists"
          >
            <span className="nav-icon">⛪</span> ChurchSuite
          </button>
          <button
            className={page === "settings" ? "active" : ""}
            onClick={() => setPage("settings")}
            title="Open keyboard, font, ChurchSuite and Git settings"
          >
            <span className="nav-icon">⚙</span> Settings
          </button>
          <button
            className={page === "help" ? "active" : ""}
            onClick={() => setPage("help")}
            title="Open the service-day guide and troubleshooting reference"
          >
            <span className="nav-icon">?</span> Help
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
            <button
              className="button ghost small"
              onClick={logout}
              title="Sign out of Service Maestro"
            >
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
            {!topbarMode && (
              <button
                className="button ghost small layout-toggle"
                onClick={() => setSidebarCollapsed((current) => !current)}
                title={sidebarCollapsed ? "Show navigation" : "Collapse the left navigation"}
              >
                {sidebarCollapsed ? "☰ Show menu" : "⇤ Hide menu"}
              </button>
            )}
            <button
              className="button ghost small layout-toggle"
              onClick={() => setTopbarMode((current) => !current)}
              title={topbarMode ? "Use left sidebar" : "Move navigation to a top bar"}
            >
              {topbarMode ? "Side menu" : "Top menu"}
            </button>
            {live.status !== "idle" && (
              <button
                className="button danger"
                onClick={stopLive}
                title="End the live session and return all outputs to idle"
              >
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
            live={live}
            onStarted={(state) => {
              setLive(state);
              setPage("live");
              notify("Live session started");
            }}
            notify={notify}
          />
        )}
        {page === "songs" && <SongsPage live={live} onQuickSong={quickSong} notify={notify} />}
        {page === "images" && <ImagesPage live={live} notify={notify} />}
        {page === "bible" && <BiblePage live={live} onQuickText={quickText} notify={notify} />}
        {page === "churchsuite" && (
          <ChurchsuitePage notify={notify} onOpenSetlists={() => setPage("setlists")} />
        )}
        {page === "settings" && <SettingsPage notify={notify} />}
        {page === "help" && <HelpPage onOpenSettings={() => setPage("settings")} />}
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
