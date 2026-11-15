import { useEffect, useState, type RefObject } from "react";

export function FullscreenButton({
  targetRef,
  label = "Fullscreen",
  compact = false,
  title = "Show this panel fullscreen",
}: {
  targetRef: RefObject<HTMLElement | null>;
  label?: string;
  compact?: boolean;
  title?: string;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const update = () => setActive(document.fullscreenElement === targetRef.current);
    document.addEventListener("fullscreenchange", update);
    update();
    return () => document.removeEventListener("fullscreenchange", update);
  }, [targetRef]);

  async function toggle() {
    try {
      if (document.fullscreenElement === targetRef.current) {
        await document.exitFullscreen();
      } else {
        await targetRef.current?.requestFullscreen();
      }
    } catch {
      // Fullscreen can be blocked by the browser or unavailable on this device.
    }
  }

  return (
    <button
      type="button"
      className={`button ghost small fullscreen-button ${compact ? "fullscreen-button-compact" : ""}`}
      onClick={() => void toggle()}
      aria-pressed={active}
      aria-label={active ? "Exit fullscreen" : title}
      title={active ? "Leave fullscreen" : title}
    >
      {compact ? (active ? "⤡" : "⛶") : active ? "Exit fullscreen" : label}
    </button>
  );
}
