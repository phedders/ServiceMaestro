import { useEffect, useRef, useState } from "react";
import { compactDate } from "../service-date";

function parseDate(value: string): string | null {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length !== 8) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function formatDateInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

export function IsoDateInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(() => compactDate(value));
  const nativeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setText(compactDate(value));
  }, [value]);

  function openPicker() {
    const input = nativeRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        return;
      } catch {
        // Fall back to a normal click in browsers that block showPicker here.
      }
    }
    input.click();
  }

  return (
    <span className="iso-date-field">
      <input
        className="iso-date-input"
        value={text}
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder="YYYY-MM-DD"
        title="Date in YYYY-MM-DD format"
        onChange={(event) => {
          const formatted = formatDateInput(event.target.value);
          setText(formatted);
          const next = parseDate(formatted);
          if (next) onChange(next);
        }}
        onBlur={() => {
          if (!parseDate(text)) setText(compactDate(value));
        }}
        onFocus={(event) => event.currentTarget.select()}
      />
      <button
        type="button"
        className="date-picker-button"
        onClick={openPicker}
        title="Choose a date"
        aria-label="Choose a date"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
          <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
      <input
        ref={nativeRef}
        className="native-date-picker"
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  );
}
