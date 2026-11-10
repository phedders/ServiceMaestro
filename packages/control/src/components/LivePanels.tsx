import type { LiveState } from "@wlm/shared";

export function PageList({ live, onCommand }: { live: LiveState; onCommand: (payload: Record<string, unknown>) => void }) {
  if (!live.pages.length) {
    return <p className="muted">No pages in the current item.</p>;
  }
  return (
    <div className="page-list">
      {live.pages.map((page) => (
        <button
          key={page.index}
          className={`page-row ${page.index === live.pageIndex ? "current" : ""}`}
          onClick={() => onCommand({ type: "goto", pageIndex: page.index })}
        >
          <span className="page-number">{page.index + 1}</span>
          <span className="page-text" dangerouslySetInnerHTML={{ __html: page.html }} />
        </button>
      ))}
    </div>
  );
}

export function ItemList({ live, onCommand }: { live: LiveState; onCommand: (payload: Record<string, unknown>) => void }) {
  if (!live.items.length) {
    return <p className="muted">No items in the current session.</p>;
  }
  return (
    <div className="item-list">
      {live.items.map((item) => (
        <button
          key={item.index}
          className={`item-row ${item.index === live.itemIndex ? "current" : ""}`}
          onClick={() => onCommand({ type: "goto", itemIndex: item.index })}
        >
          <span className="item-icon">{item.kind === "song" ? "♫" : "T"}</span>
          <span className="item-title">{item.title}</span>
          {item.notes && <span className="item-notes">{item.notes}</span>}
        </button>
      ))}
    </div>
  );
}
