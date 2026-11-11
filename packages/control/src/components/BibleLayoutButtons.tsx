import type { BibleLayout } from "@sm/shared";

const OPTIONS: Array<{ value: BibleLayout; label: string }> = [
  { value: "paragraph", label: "Paragraph" },
  { value: "verses", label: "Line per verse" },
];

export function BibleLayoutButtons({
  value,
  onChange,
  label = "Layout",
}: {
  value: BibleLayout;
  onChange: (value: BibleLayout) => void;
  label?: string;
}) {
  return (
    <div className="bible-layout-options">
      <span className="field-label">{label}</span>
      <div className="segmented-buttons" role="group" aria-label="Bible passage layout">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`button ghost small ${value === option.value ? "active" : ""}`}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            title={`Use ${option.label.toLowerCase()} layout`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
