import { useEffect, useRef, useState } from "react";

const PAGE_BREAK_RE =
  /\s*(?:<!--\s*-?\s*page\s*-?\s*-->|<hr\b[^>]*class=["'][^"']*page-break[^"']*["'][^>]*>)\s*/i;
const PAGE_SEPARATOR = "\n\n<!-- page -->\n\n";

function splitPages(value: string): string[] {
  const parts = value.replace(/\r\n?/g, "\n").split(PAGE_BREAK_RE);
  return parts.length ? parts.map((part) => part.replace(/^\n+|\n+$/g, "")) : [""];
}

function joinPages(pages: string[]): string {
  return pages.join(PAGE_SEPARATOR);
}

export function PageContentEditor({
  value,
  onChange,
  rows = 6,
  placeholder,
  textareaClassName = "",
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  textareaClassName?: string;
}) {
  const [pages, setPages] = useState<string[]>(() => splitPages(value));
  const [activePage, setActivePage] = useState(0);
  const refs = useRef<Array<HTMLTextAreaElement | null>>([]);
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    const next = splitPages(value);
    setPages(next);
    setActivePage((current) => Math.min(current, next.length - 1));
  }, [value]);

  function emit(next: string[]) {
    setPages(next);
    const serialized = joinPages(next);
    lastEmitted.current = serialized;
    onChange(serialized);
  }

  function updatePage(index: number, nextValue: string) {
    emit(pages.map((page, pageIndex) => (pageIndex === index ? nextValue : page)));
  }

  function addPage() {
    const next = [...pages, ""];
    emit(next);
    const index = next.length - 1;
    setActivePage(index);
    requestAnimationFrame(() => refs.current[index]?.focus());
  }

  function removePage(index: number) {
    if (pages.length <= 1) return;
    const next = pages.filter((_page, pageIndex) => pageIndex !== index);
    emit(next);
    setActivePage((current) => Math.min(current, next.length - 1));
  }

  function insertPageMarker() {
    const index = Math.min(activePage, Math.max(0, pages.length - 1));
    const element = refs.current[index];
    const page = pages[index] ?? "";
    const start = element?.selectionStart ?? page.length;
    const end = element?.selectionEnd ?? start;
    const marker = `${start === 0 ? "" : "\n\n"}<!-- page -->\n\n`;
    const nextPage = page.slice(0, start) + marker + page.slice(end);
    updatePage(index, nextPage);
    requestAnimationFrame(() => {
      const textarea = refs.current[index];
      if (!textarea) return;
      const cursor = start + marker.length;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div className="page-content-editor">
      <div className="page-content-toolbar">
        <button type="button" className="button ghost small" onClick={insertPageMarker}>
          Insert page marker
        </button>
        <button type="button" className="button small" onClick={addPage}>
          + Add page box
        </button>
        <span className="hint">Both markers and page boxes create new pages.</span>
      </div>
      {pages.map((page, index) => (
        <div className="page-content-box" key={index}>
          <div className="page-content-box-head">
            <span>Page {index + 1}</span>
            {pages.length > 1 && (
              <button
                type="button"
                className="button ghost small danger-text"
                onClick={() => removePage(index)}
              >
                Remove page
              </button>
            )}
          </div>
          <textarea
            ref={(element) => {
              refs.current[index] = element;
            }}
            className={textareaClassName}
            value={page}
            rows={rows}
            placeholder={placeholder}
            spellCheck={false}
            onFocus={() => setActivePage(index)}
            onChange={(event) => updatePage(index, event.target.value)}
          />
        </div>
      ))}
    </div>
  );
}
