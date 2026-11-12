import type { SetlistSummary } from "@sm/shared";

/**
 * ISO calendar date (`YYYY-MM-DD`) used for display and sortable set-list
 * names. Accepts `YYYY-MM-DD`, `YYYYMMDD` or an ISO timestamp/Date.
 */
export function compactDate(value: string | Date): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const match = value.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  return compactDate(new Date(value));
}

export function defaultSetlistName(date: string | Date = new Date()): string {
  return `${compactDate(date)}-`;
}

export function compactDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${compactDate(date)} ${hours}:${minutes}`;
}

/**
 * Combine a set list's service date and optional time into a local Date.
 * Date-only services are treated as 10:00 so a sensible "today" window exists.
 */
export function serviceDateTime(setlist: Pick<SetlistSummary, "serviceDate" | "serviceTime">): Date {
  const [year, month, day] = setlist.serviceDate.split("-").map(Number);
  const match = (setlist.serviceTime ?? "").match(/^(\d{1,2}):(\d{2})/);
  const hours = match ? Number(match[1]) : 10;
  const minutes = match ? Number(match[2]) : 0;
  return new Date(year, (month || 1) - 1, day || 1, hours, minutes, 0, 0);
}

/**
 * Pick the service that is running now, then the next one, then the most
 * recent past service. Used by the Bible page and the musician view.
 */
export function pickCurrentSetlist(
  setlists: SetlistSummary[],
  now: Date = new Date(),
): SetlistSummary | null {
  if (!setlists.length) return null;
  const sorted = [...setlists].sort(
    (a, b) => serviceDateTime(a).getTime() - serviceDateTime(b).getTime(),
  );

  const current = sorted.find((setlist) => {
    const start = serviceDateTime(setlist).getTime();
    return now.getTime() >= start - 3 * 60 * 60 * 1000 && now.getTime() <= start + 6 * 60 * 60 * 1000;
  });
  if (current) return current;

  const next = sorted.find((setlist) => serviceDateTime(setlist).getTime() > now.getTime());
  return next ?? sorted[sorted.length - 1];
}
