import { useEffect, useState } from "react";
import { compactDate } from "../service-date";

function parseCompact(value: string): string | null {
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

export function IsoDateInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [text, setText] = useState(() => compactDate(value));

  useEffect(() => {
    setText(compactDate(value));
  }, [value]);

  return (
    <input
      className="iso-date-input"
      value={text}
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      placeholder="YYYYMMDD"
      title="Date in YYYYMMDD format"
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, "").slice(0, 8);
        setText(digits);
        const next = parseCompact(digits);
        if (next) onChange(next);
      }}
      onBlur={() => {
        if (!parseCompact(text)) setText(compactDate(value));
      }}
      onFocus={(event) => event.currentTarget.select()}
    />
  );
}
