export type ShortcutAction =
  | "toggleBlank"
  | "nextPage"
  | "previousPage"
  | "nextItem"
  | "previousItem";

export interface KeyboardShortcuts {
  toggleBlank: string;
  nextPage: string;
  previousPage: string;
  nextItem: string;
  previousItem: string;
}

export const SHORTCUT_LABELS: Array<{ action: ShortcutAction; label: string; hint: string }> = [
  { action: "toggleBlank", label: "Hide / show", hint: "Blank or reveal the live output" },
  { action: "nextPage", label: "Next page", hint: "Advance one page" },
  { action: "previousPage", label: "Previous page", hint: "Go back one page" },
  { action: "nextItem", label: "Next set-list item", hint: "Show the first page of the next item" },
  {
    action: "previousItem",
    label: "Previous set-list item",
    hint: "Show the first page of the previous item",
  },
];

export const DEFAULT_SHORTCUTS: KeyboardShortcuts = {
  toggleBlank: "B",
  nextPage: "ArrowRight",
  previousPage: "ArrowLeft",
  nextItem: "ArrowDown",
  previousItem: "ArrowUp",
};

const STORAGE_KEY = "sm-keyboard-shortcuts";
export const SHORTCUT_CHANGE_EVENT = "sm-shortcuts-changed";

function normalizeKey(value: string): string {
  if (value === " ") return "Space";
  if (value.length === 1) return value.toUpperCase();
  return value;
}

function normalizeShortcut(value: string): string {
  return value
    .split("+")
    .map((part) => normalizeKey(part.trim()))
    .join("+");
}

export function shortcutFromEvent(event: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  parts.push(normalizeKey(event.key));
  return parts.join("+");
}

export function shortcutMatches(event: KeyboardEvent, shortcut: string): boolean {
  if (!shortcut) return false;
  return shortcutFromEvent(event) === normalizeShortcut(shortcut);
}

export function loadKeyboardShortcuts(): KeyboardShortcuts {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SHORTCUTS };
    const parsed = JSON.parse(raw) as Partial<KeyboardShortcuts>;
    return {
      toggleBlank: parsed.toggleBlank ?? DEFAULT_SHORTCUTS.toggleBlank,
      nextPage: parsed.nextPage ?? DEFAULT_SHORTCUTS.nextPage,
      previousPage: parsed.previousPage ?? DEFAULT_SHORTCUTS.previousPage,
      nextItem: parsed.nextItem ?? DEFAULT_SHORTCUTS.nextItem,
      previousItem: parsed.previousItem ?? DEFAULT_SHORTCUTS.previousItem,
    };
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

export function saveKeyboardShortcuts(shortcuts: KeyboardShortcuts): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts));
    window.dispatchEvent(new Event(SHORTCUT_CHANGE_EVENT));
  } catch {
    // Private browsing/storage problems should not break live control.
  }
}

const LIST_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown"]);

/**
 * Moves focus and selection through a marked list using arrow/page keys.
 * Returns true when the key was handled so global live shortcuts stay out of
 * the way while the operator is browsing a list.
 */
export function handleListNavigation(event: KeyboardEvent): boolean {
  const target = event.target as Element | null;
  const item = target?.closest<HTMLElement>("[data-key-list-item]");
  const list = item?.closest<HTMLElement>("[data-key-list]");
  if (!item || !list) return false;

  const items = Array.from(list.querySelectorAll<HTMLElement>("[data-key-list-item]"));
  const index = items.indexOf(item);
  if (index < 0) return false;

  if (!LIST_KEYS.has(event.key)) {
    // Keep other control shortcuts from firing while focus is in a list.
    return true;
  }

  const itemHeight = Math.max(1, item.getBoundingClientRect().height);
  const pageSize = Math.max(1, Math.floor((list.clientHeight || 400) / itemHeight));
  const delta =
    event.key === "ArrowUp"
      ? -1
      : event.key === "ArrowDown"
        ? 1
        : event.key === "PageUp"
          ? -pageSize
          : pageSize;
  const nextIndex = Math.max(0, Math.min(items.length - 1, index + delta));
  event.preventDefault();
  if (nextIndex === index) return true;

  const next = items[nextIndex];
  next.focus({ preventScroll: true });
  next.click();
  next.scrollIntoView({ block: "nearest" });
  return true;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable
  );
}
