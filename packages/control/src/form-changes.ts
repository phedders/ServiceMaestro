export interface FormChange {
  label: string;
  before?: unknown;
  after?: unknown;
  detail?: string;
  hideValues?: boolean;
}

export interface ChangeEntry {
  label: string;
  before?: unknown;
  after?: unknown;
  detail?: string;
  hideValues?: boolean;
  changed?: boolean;
}

function valueKey(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function valuesEqual(before: unknown, after: unknown): boolean {
  return valueKey(before) === valueKey(after);
}

export function changeList(entries: ChangeEntry[]): FormChange[] {
  return entries
    .filter((entry) => entry.changed ?? !valuesEqual(entry.before, entry.after))
    .map(({ label, before, after, detail, hideValues }) => ({
      label,
      before,
      after,
      detail,
      hideValues,
    }));
}

export function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const clean = value.replace(/\s+/g, " ").trim();
    if (!clean) return "(empty)";
    return clean.length > 90 ? `${clean.slice(0, 87)}…` : clean;
  }
  if (Array.isArray(value)) {
    if (!value.length) return "(empty)";
    const text = value.map((entry) => formatChangeValue(entry)).join(", ");
    return text.length > 90 ? `${text.slice(0, 87)}…` : text;
  }
  if (typeof value === "object") {
    const text = valueKey(value);
    return text.length > 90 ? `${text.slice(0, 87)}…` : text;
  }
  return String(value);
}
