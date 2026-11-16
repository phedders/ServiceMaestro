import { useEffect, useRef, useState } from "react";
import type { ExternalPresentation, LiveState } from "@sm/shared";
import { api, ApiError } from "../api";
import { FullscreenButton } from "../components/FullscreenButton";
import {
  parsePresentationInput,
  presentationProviderLabel,
  presentationToInput,
  presentationWarning,
} from "../presentations";
import { compactDateTime } from "../service-date";

function hostFor(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function newPresentationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `presentation-${Date.now()}`;
}

export default function PresentationsPage({
  notify,
  liveStatus,
  canWriteLive,
  onShowLive,
}: {
  notify: (text: string, kind?: "info" | "error") => void;
  liveStatus: LiveState["status"];
  canWriteLive: boolean;
  onShowLive: (embedUrl: string, title?: string) => Promise<void>;
}) {
  const [presentations, setPresentations] = useState<ExternalPresentation[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [showing, setShowing] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const viewerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    api
      .presentations()
      .then((result) => {
        const list = result.config?.presentations ?? [];
        setPresentations(list);
        setUpdatedAt(result.config?.updatedAt ?? null);
        setSelectedId(list[0]?.id ?? "");
      })
      .catch((error) =>
        notify(
          error instanceof ApiError ? error.message : "Could not load presentations",
          "error",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const selected = presentations.find((presentation) => presentation.id === selectedId) ?? null;
  const selectedWarning = selected ? presentationWarning(selected) : null;

  async function persist(next: ExternalPresentation[], message: string): Promise<boolean> {
    setSaving(true);
    try {
      const result = await api.savePresentations({ presentations: next });
      setPresentations(result.config.presentations);
      setUpdatedAt(result.config.updatedAt);
      notify(message);
      return true;
    } catch (error) {
      notify(
        error instanceof ApiError ? error.message : "Could not save presentations",
        "error",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function addPresentation() {
    try {
      const parsed = parsePresentationInput(urlInput, nameInput);
      const id = newPresentationId();
      const next: ExternalPresentation[] = [
        ...presentations,
        { id, ...presentationToInput(parsed) },
      ];
      if (await persist(next, "Presentation added")) {
        setSelectedId(id);
        setNameInput("");
        setUrlInput("");
        setFormNotice(parsed.warning ?? "");
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not add presentation", "error");
    }
  }

  async function removePresentation(id: string) {
    if (!confirm("Remove this presentation from your saved list?")) return;
    const next = presentations.filter((presentation) => presentation.id !== id);
    if (await persist(next, "Presentation removed")) {
      if (selectedId === id) setSelectedId(next[0]?.id ?? "");
    }
  }

  function openInWindow() {
    if (!selected) return;
    window.open(selected.openUrl, "_blank", "noopener,noreferrer");
  }

  function focusPresentation() {
    iframeRef.current?.focus();
    try {
      iframeRef.current?.contentWindow?.focus();
    } catch {
      // Cross-origin focus can be refused; clicking the frame also works.
    }
  }

  async function showLive() {
    if (!selected) return;
    setShowing(true);
    try {
      await onShowLive(selected.embedUrl, selected.name);
    } finally {
      setShowing(false);
    }
  }

  if (loading) return <div className="panel">Loading presentations…</div>;

  return (
    <div className="presentations-page">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>External presentations</h2>
            <p className="muted">
              Embed public PowerPoint, Canva or Google Slides links. Private SharePoint links usually
              require sign-in and must be opened in a new window.
            </p>
          </div>
          {updatedAt && <span className="muted">Saved {compactDateTime(updatedAt)}</span>}
        </div>
        <div className="presentation-add-grid">
          <label>
            Name
            <input
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="Optional name"
              maxLength={120}
            />
          </label>
          <label className="presentation-url-field">
            Share link or iframe embed code
            <input
              value={urlInput}
              onChange={(event) => {
                setUrlInput(event.target.value);
                setFormNotice("");
              }}
              placeholder="https://www.canva.com/design/… or <iframe src=…>"
            />
          </label>
          <button
            className="button primary"
            onClick={() => void addPresentation()}
            disabled={saving || !urlInput.trim()}
            title="Add this presentation to your saved list"
          >
            {saving ? "Saving…" : "Add presentation"}
          </button>
        </div>
        {formNotice && <p className="hint">{formNotice}</p>}
        <p className="hint">
          For PowerPoint use <strong>File → Share → Embed this Presentation</strong> and paste the
          iframe code. For Canva use <strong>Share → Embed</strong> or paste the normal design link.
          Google Slides links are converted to their public embed view. Service Maestro does not send
          keystrokes into an embedded presentation; click inside it or use Focus presentation so the
          USB clicker’s own keyboard events go directly to the provider.
        </p>
      </section>

      <div className="presentations-grid">
        <aside className="panel presentations-list" data-key-list>
          <div className="panel-heading">
            <h3>Saved presentations</h3>
            <span className="muted">{presentations.length}</span>
          </div>
          {presentations.map((presentation) => (
            <button
              key={presentation.id}
              data-key-list-item
              className={`presentation-list-item ${
                presentation.id === selectedId ? "current" : ""
              }`}
              onClick={() => setSelectedId(presentation.id)}
              title={`Open ${presentation.name}`}
            >
              <strong>{presentation.name}</strong>
              <span>
                {presentationProviderLabel(presentation.provider)} ·{" "}
                {hostFor(presentation.openUrl)}
              </span>
            </button>
          ))}
          {!presentations.length && <p className="muted">No presentations saved yet.</p>}
        </aside>

        <section className="panel presentations-viewer" ref={viewerRef}>
          {selected ? (
            <>
              <div className="panel-heading">
                <div>
                  <h2>{selected.name}</h2>
                  <p className="muted">
                    {presentationProviderLabel(selected.provider)} · {hostFor(selected.embedUrl)}
                  </p>
                </div>
                <div className="button-row">
                  <button
                    className="button primary small"
                    onClick={() => void showLive()}
                    disabled={!canWriteLive || liveStatus === "idle" || showing}
                    title={
                      !canWriteLive
                        ? "Read-only live access"
                        : liveStatus === "idle"
                          ? "Start a live session first"
                          : "Send this presentation to the live outputs"
                    }
                  >
                    {showing ? "Sending…" : "Show live"}
                  </button>
                  <button
                    className="button ghost small"
                    onClick={focusPresentation}
                    title="Move keyboard focus into the embedded presentation"
                  >
                    Focus presentation
                  </button>
                  <button
                    className="button ghost small"
                    onClick={openInWindow}
                    title="Open the original presentation in a new browser window"
                  >
                    Open in new window
                  </button>
                  <FullscreenButton targetRef={viewerRef} />
                  <button
                    className="button ghost small danger-text"
                    onClick={() => void removePresentation(selected.id)}
                    disabled={saving}
                    title="Remove this presentation from the saved list"
                  >
                    Remove
                  </button>
                </div>
              </div>
              {selectedWarning && <p className="banner presentation-warning">{selectedWarning}</p>}
              <div className="presentation-frame-wrap">
                <iframe
                  key={selected.id}
                  ref={iframeRef}
                  className="presentation-frame"
                  src={selected.embedUrl}
                  title={selected.name}
                  allow="fullscreen; autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
              <p className="hint">
                <strong>Show live</strong> sends this embed to all live outputs, including the OBS
                browser sources. The provider must allow public embedding. If the frame stays blank
                or asks you to sign in, use <strong>Open in new window</strong> and sign in there;
                the USB clicker will operate the focused external window normally.
              </p>
            </>
          ) : (
            <p className="muted">Add or select a presentation to embed it here.</p>
          )}
        </section>
      </div>
    </div>
  );
}
