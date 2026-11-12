import type { FontOption } from "@sm/shared";

const SAMPLE = "Abc Bcd Oo 1230";

export function FontSelect({
  value,
  fonts,
  onChange,
  title = "Choose a font",
}: {
  value: string;
  fonts: FontOption[];
  onChange: (family: string) => void;
  title?: string;
}) {
  const known = fonts.some((font) => font.family === value);
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} title={title}>
      {fonts.map((font) => (
        <option
          key={font.id}
          value={font.family}
          style={{ fontFamily: font.family }}
          title={`${font.label} · ${SAMPLE}`}
        >
          {font.label}
          {font.source === "google" ? " (Google)" : ""} — {SAMPLE}
        </option>
      ))}
      {!known && (
        <option
          value={value}
          style={{ fontFamily: value }}
          title={`Custom / imported · ${SAMPLE}`}
        >
          Custom / imported — {SAMPLE}
        </option>
      )}
    </select>
  );
}
