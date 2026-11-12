import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

const PREFIX = "sm-session:";

function readSessionValue<T>(key: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(`${PREFIX}${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/**
 * Per-tab UI state that survives switching between Service Maestro pages.
 * sessionStorage is intentionally used instead of an HTTP cookie: this state
 * belongs to the control browser and should never be sent to the server.
 */
export function useSessionState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readSessionValue(key, initial));

  useEffect(() => {
    try {
      window.sessionStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value));
    } catch {
      // Session persistence is optional; the page still works without it.
    }
  }, [key, value]);

  return [value, setValue];
}
