import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  MODULE_PERMISSIONS,
  type BrandingSettings,
  type DisplayViewLink,
  type IntegrationSettings,
  type LiveState,
  type PermissionModule,
  type PublicUser,
} from "@sm/shared";
import { AdapterProvider } from "./adapters";
import { api, ApiError } from "./api";
import { EMPTY_LIVE } from "./empty";
import { PageAccessProvider } from "./page-access";
import { MqttControls } from "./components/MqttControls";
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
import BackgroundsPage from "./pages/BackgroundsPage";
import StingersPage from "./pages/StingersPage";
import UsersPage from "./pages/UsersPage";
import DeDupePage from "./pages/DeDupePage";
import OutputsPage from "./pages/OutputsPage";
import MqttPage from "./pages/MqttPage";

const TarpPage = lazy(() => import("./pages/TarpPage"));
import {
  SHORTCUT_CHANGE_EVENT,
  handleListNavigation,
  isTypingTarget,
  loadKeyboardShortcuts,
  shortcutMatches,
  type KeyboardShortcuts,
} from "./keyboard";

type Page =
  | "live"
  | "setlists"
  | "songs"
  | "images"
  | "tarp"
  | "bible"
  | "churchsuite"
  | "settings"
  | "outputs"
  | "backgrounds"
  | "stingers"
  | "dedupe"
  | "users"
  | "mqtt"
  | "help";

interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

const PAGE_MODULE: Partial<Record<Page, PermissionModule>> = {
  live: "live",
  setlists: "setlists",
  songs: "songs",
  images: "images",
  tarp: "tarp",
  bible: "bible",
  churchsuite: "churchsuite",
  settings: "settings",
  outputs: "settings",
  backgrounds: "backgrounds",
  stingers: "stingers",
  dedupe: "songs",
  mqtt: "settings",
};

export default function App() {
  const standaloneMusicians =
    typeof window !== "undefined" && /^\/musicians\/?$/.test(window.location.pathname);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>("live");
  const [live, setLive] = useState<LiveState>(EMPTY_LIVE);
  const [branding, setBranding] = useState<BrandingSettings>({
    logoUrl: null,
    navBackground: null,
    logoUpdatedAt: null,
  });
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [displayViews, setDisplayViews] = useState<DisplayViewLink[]>([]);
  const [adapters, setAdapters] = useState<IntegrationSettings>({
    songSelect: "off",
    churchSuite: "off",
    mqtt: "off",
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
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
    const loadBranding = () => {
      api
        .branding()
        .then((result) => setBranding(result.branding))
        .catch(() => undefined);
    };
    loadBranding();
    window.addEventListener("sm-branding-changed", loadBranding);
    return () => window.removeEventListener("sm-branding-changed", loadBranding);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--nav-bg",
      branding.navBackground ?? "#0a1018",
    );
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = branding.logoUrl ?? "/icon.svg";
  }, [branding]);

  useEffect(() => {
    const refresh = () => setShortcuts(loadKeyboardShortcuts());
    window.addEventListener(SHORTCUT_CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SHORTCUT_CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const canWriteLive = !user || user.role === "admin" || user.permissions.live === true;

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

  function refreshDisplayViews() {
    if (!user || standaloneMusicians) return;
    api
      .displayViews()
      .then((result) => setDisplayViews(result.views))
      .catch(() => undefined);
  }

  async function refreshAdapters() {
    try {
      const result = await api.integrationSettings();
      setAdapters(result.settings);
    } catch {
      setAdapters({ songSelect: "off", churchSuite: "off", mqtt: "off" });
    }
  }

  useEffect(() => {
    refreshDisplayViews();
  }, [user, standaloneMusicians]);

  useEffect(() => {
    if (!user || standaloneMusicians) return;
    void refreshAdapters();
    const refresh = () => void refreshAdapters();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [user, standaloneMusicians]);

  useEffect(() => {
    if (standaloneMusicians) return;
    if (page === "churchsuite" && adapters.churchSuite === "off") setPage("live");
    if (page === "mqtt" && adapters.mqtt === "off") setPage("live");
  }, [page, adapters.churchSuite, adapters.mqtt, standaloneMusicians]);

  const adapterContext = useMemo(
    () => ({
      songSelectEnabled: adapters.songSelect !== "off",
      churchSuiteEnabled: adapters.churchSuite !== "off",
      mqttEnabled: adapters.mqtt !== "off",
      modes: adapters,
      refresh: refreshAdapters,
    }),
    [adapters],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const close = () => setMenuOpen(false);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menuOpen]);

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
    if (!canWriteLive) return;
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
      if (!canWriteLive) return;
      if (handleListNavigation(event)) return;
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
  }, [user, standaloneMusicians, shortcuts, live, command, canWriteLive]);

  const quickText = async (text: string) => {
    if (!canWriteLive) return;
    try {
      const result = await api.quickText(text, "direct");
      setLive(result.state);
      notify("Quick text displayed");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not display text", "error");
    }
  };

  const quickSong = async (songId: string) => {
    if (!canWriteLive) return;
    try {
      const result = await api.quickSong(songId);
      setLive(result.state);
      notify("Song displayed");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not display song", "error");
    }
  };

  const quickImage = async (path: string, title?: string) => {
    if (!canWriteLive) return;
    try {
      const result = await api.quickImage(path, title);
      setLive(result.state);
      notify("Image sent live");
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not display image", "error");
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
    setAdapters({ songSelect: "off", churchSuite: "off", mqtt: "off" });
  };

  function toggleMenu() {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const rect = menuRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 276;
    const estimatedHeight = 430;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top =
      rect.bottom + 8 + estimatedHeight > window.innerHeight
        ? Math.max(12, rect.top - 8 - estimatedHeight)
        : rect.bottom + 8;
    setMenuPosition({ top, left });
    setMenuOpen(true);
  }

  function openSettings() {
    setPage("settings");
    setMenuOpen(false);
  }

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
      case "tarp":
        return "Tarp";
      case "bible":
        return "Bible";
      case "churchsuite":
        return "ChurchSuite";
      case "settings":
        return "Settings";
      case "outputs":
        return "Outputs";
      case "backgrounds":
        return "Backgrounds";
      case "stingers":
        return "Stingers";
      case "dedupe":
        return "DeDupe";
      case "users":
        return "Users";
      case "mqtt":
        return "MQTT";
      case "help":
        return "Help";
    }
  }, [page]);

  const pageModule = PAGE_MODULE[page];
  const canWritePage =
    !pageModule ||
    !user ||
    user.role === "admin" ||
    user.permissions[pageModule] === true;
  const pageModuleLabel = pageModule
    ? MODULE_PERMISSIONS.find((module) => module.id === pageModule)?.label ?? pageModule
    : null;

  if (loading) {
    return <div className="boot">Loading Service Maestro…</div>;
  }

  if (!user) {
    return (
      <Login
        branding={branding}
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
            <img
              className="brand-mark"
              src={branding.logoUrl ?? "/icon.svg"}
              alt="Service Maestro"
            />
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
    <AdapterProvider value={adapterContext}>
      <div
        className={`app ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${topbarMode ? "topbar-mode" : ""}`}
      >
      <aside className="sidebar">
        <div className="brand">
          <img
            className="brand-mark"
            src={branding.logoUrl ?? "/icon.svg"}
            alt="Service Maestro"
          />
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
            <span className="nav-icon">▤</span> Set lists
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
            className={page === "tarp" ? "active" : ""}
            onClick={() => setPage("tarp")}
            title="Create Tarp themes and presentations"
          >
            <span className="nav-icon">▧</span> Tarp
          </button>
          <button
            className={page === "bible" ? "active" : ""}
            onClick={() => setPage("bible")}
            title="Look up a Bible passage to display or add to a set list"
          >
            <span className="nav-icon">✝</span> Bible
          </button>
          {adapterContext.churchSuiteEnabled && (
            <button
              className={page === "churchsuite" ? "active" : ""}
              onClick={() => setPage("churchsuite")}
              title="Pull ChurchSuite plans and create draft set lists"
            >
              <span className="nav-icon">⛪</span> ChurchSuite
            </button>
          )}
          <button
            className={page === "help" ? "active" : ""}
            onClick={() => setPage("help")}
            title="Open the service-day guide and troubleshooting reference"
          >
            <span className="nav-icon">?</span> Help
          </button>
          <div className="nav-more" ref={menuRef}>
            <button
              type="button"
              className={`nav-more-toggle ${menuOpen || page === "settings" ? "active" : ""}`}
              onClick={toggleMenu}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Open external display links and settings"
            >
              <span className="nav-icon">☰</span> Menu
            </button>
            {menuOpen && menuPosition && (
              <div
                className="nav-dropdown"
                role="menu"
                style={{ top: menuPosition.top, left: menuPosition.left }}
              >
                <div className="nav-dropdown-label">External links</div>
                {displayViews.map((view) => (
                  <a
                    key={view.id}
                    className="nav-dropdown-link"
                    href={view.url}
                    target="_blank"
                    rel="noreferrer"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    title={`Open ${view.label} in a new tab`}
                  >
                    <span>{view.label}</span>
                    <span className="nav-dropdown-external" aria-hidden="true">
                      ↗
                    </span>
                  </a>
                ))}
                {!displayViews.length && <span className="nav-dropdown-empty">No views available</span>}
                {adapterContext.mqttEnabled && (
                  <MqttControls
                    placement="menu"
                    notify={notify}
                    onPublished={() => setMenuOpen(false)}
                  />
                )}
                <div className="nav-dropdown-separator" />
                <button
                  type="button"
                  className="nav-dropdown-link"
                  role="menuitem"
                  onClick={() => {
                    setPage("backgrounds");
                    setMenuOpen(false);
                  }}
                  title="Open the global background library"
                >
                  <span>Backgrounds</span>
                  <span className="nav-dropdown-external" aria-hidden="true">
                    ◫
                  </span>
                </button>
                <button
                  type="button"
                  className="nav-dropdown-link"
                  role="menuitem"
                  onClick={() => {
                    setPage("stingers");
                    setMenuOpen(false);
                  }}
                  title="Open the transition stinger library"
                >
                  <span>Stingers</span>
                  <span className="nav-dropdown-external" aria-hidden="true">
                    ✦
                  </span>
                </button>
                <button
                  type="button"
                  className="nav-dropdown-link"
                  role="menuitem"
                  onClick={() => {
                    setPage("dedupe");
                    setMenuOpen(false);
                  }}
                  title="Find duplicate songs, preview differences and keep the best version"
                >
                  <span>DeDupe</span>
                  <span className="nav-dropdown-external" aria-hidden="true">
                    ⧉
                  </span>
                </button>
                {user.role === "admin" && (
                  <button
                    type="button"
                    className="nav-dropdown-link"
                    role="menuitem"
                    onClick={() => {
                      setPage("users");
                      setMenuOpen(false);
                    }}
                    title="Manage users, write permissions and activity"
                  >
                    <span>Users</span>
                    <span className="nav-dropdown-external" aria-hidden="true">
                      ◉
                    </span>
                  </button>
                )}
                {user.role === "admin" && adapterContext.mqttEnabled && (
                  <button
                    type="button"
                    className="nav-dropdown-link"
                    role="menuitem"
                    onClick={() => {
                      setPage("mqtt");
                      setMenuOpen(false);
                    }}
                    title="Configure MQTT broker, commands and outgoing controls"
                  >
                    <span>MQTT</span>
                    <span className="nav-dropdown-external" aria-hidden="true">
                      ⇄
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className="nav-dropdown-link"
                  role="menuitem"
                  onClick={() => {
                    setPage("outputs");
                    setMenuOpen(false);
                  }}
                  title="Configure display outputs, templates and transitions"
                >
                  <span>Outputs</span>
                  <span className="nav-dropdown-external" aria-hidden="true">
                    ▤
                  </span>
                </button>
                <button
                  type="button"
                  className="nav-dropdown-link"
                  role="menuitem"
                  onClick={openSettings}
                  title="Open adapter, display, keyboard and Git settings"
                >
                  <span>Settings</span>
                  <span className="nav-dropdown-external" aria-hidden="true">
                    ⚙
                  </span>
                </button>
              </div>
            )}
          </div>
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
                disabled={!canWriteLive}
                title={
                  canWriteLive
                    ? "End the live session and return all outputs to idle"
                    : "Read-only access to live control"
                }
              >
                End session
              </button>
            )}
          </div>
        </header>

        {pageModule && !canWritePage && (
          <div className="read-only-banner">
            You have read-only access to {pageModuleLabel}. An administrator can grant write access
            on the Users page.
          </div>
        )}

        <PageAccessProvider
          value={{ canWrite: canWritePage, moduleLabel: pageModuleLabel }}
        >
          {page === "live" && (
            <LivePage
              live={live}
              displayViews={displayViews}
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
          {page === "images" && (
            <ImagesPage live={live} notify={notify} onQuickImage={quickImage} />
          )}
          {page === "tarp" && (
            <Suspense fallback={<div className="panel">Loading Tarp…</div>}>
              <TarpPage notify={notify} />
            </Suspense>
          )}
          {page === "bible" && <BiblePage live={live} onQuickText={quickText} notify={notify} />}
          {page === "churchsuite" && adapterContext.churchSuiteEnabled && (
            <ChurchsuitePage notify={notify} onOpenSetlists={() => setPage("setlists")} />
          )}
          {page === "settings" && <SettingsPage user={user} notify={notify} />}
          {page === "outputs" && (
            <OutputsPage notify={notify} onChanged={refreshDisplayViews} />
          )}
          {page === "dedupe" && <DeDupePage notify={notify} />}
          {page === "users" && <UsersPage user={user} notify={notify} />}
          {page === "mqtt" && user.role === "admin" && adapterContext.mqttEnabled && (
            <MqttPage notify={notify} />
          )}
          {page === "backgrounds" && <BackgroundsPage notify={notify} />}
          {page === "stingers" && <StingersPage notify={notify} />}
          {page === "help" && <HelpPage onOpenSettings={() => setPage("settings")} />}
        </PageAccessProvider>
      </main>

      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            {toast.text}
          </div>
        ))}
      </div>
      </div>
    </AdapterProvider>
  );
}
