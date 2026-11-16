import {
  CLICKER_ACTIONS,
  type ClickerAction,
  type ClickerButtonMapping,
  type ClickerConfigInput,
  type LiveState,
} from "@sm/shared";

export const DEFAULT_CLICKER_BUTTONS: ClickerButtonMapping[] = [
  { id: "PageDown", label: "PageDown", action: "next" },
  { id: "PageUp", label: "PageUp", action: "prev" },
  { id: "Period", label: ".", action: "blank" },
];

export function defaultClickerConfig(): ClickerConfigInput {
  return {
    name: "Logitech R400",
    vendorId: 0x046d,
    productId: 0xc538,
    buttons: DEFAULT_CLICKER_BUTTONS.map((button) => ({ ...button })),
  };
}

export function clickerButtonFromEvent(event: KeyboardEvent): ClickerButtonMapping | null {
  if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return null;
  const id = event.code || event.key;
  if (!id || id === "Unidentified") return null;
  const label =
    event.key === " "
      ? "Space"
      : event.key && event.key !== "Unidentified"
        ? event.key
        : id;
  return { id, label, action: "next" };
}

export function clickerActionLabel(action: ClickerAction): string {
  return CLICKER_ACTIONS.find((entry) => entry.id === action)?.label ?? action;
}

export function runClickerAction(
  action: ClickerAction,
  live: LiveState,
  command: (payload: Record<string, unknown>) => void,
): void {
  switch (action) {
    case "next":
      command({ type: "next" });
      break;
    case "prev":
      command({ type: "prev" });
      break;
    case "nextPage":
      command({ type: "page", delta: 1 });
      break;
    case "prevPage":
      command({ type: "page", delta: -1 });
      break;
    case "nextItem":
      if (live.items.length) {
        command({
          type: "goto",
          itemIndex: Math.min(live.items.length - 1, live.itemIndex + 1),
        });
      }
      break;
    case "previousItem":
      if (live.items.length) {
        command({
          type: "goto",
          itemIndex: Math.max(0, live.itemIndex - 1),
        });
      }
      break;
    case "blank":
      command({ type: "blank", value: !live.blank });
      break;
    case "transposeUp":
      command({ type: "transpose", delta: 1 });
      break;
    case "transposeDown":
      command({ type: "transpose", delta: -1 });
      break;
    case "maxLinesUp":
      command({ type: "maxLines", value: Math.min(30, live.maxLines + 1) });
      break;
    case "maxLinesDown":
      command({ type: "maxLines", value: Math.max(1, live.maxLines - 1) });
      break;
    case "none":
      break;
  }
}
