import type { LiveState } from "@wlm/shared";

export function PageList({ live, onCommand }: { live: LiveState; onCommand: (payload: Record<string, unknown>) => void }) {
  const pages = live.queuedItemIndex != null ? live.queuedPages ?? [] : live.pages;
  const currentPage = live.queuedItemIndex != null ? -1 : live.pageIndex;
  if (!pages.length) {
    return <p className="muted">{live.queuedItemIndex != null ? "Queued item has no pages." : "No pages in the current item."}</p>;
  }
  return (
    <div className="page-list">
      {pages.map((page) => (
        <button
          key={page.index}
          className={`page-row ${page.index === currentPage ? "current" : ""}`}
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
  const currentItem = live.queuedItemIndex ?? live.itemIndex;
  return (
    <div className="item-list">
      {live.items.map((item) => (
        <button
          key={item.index}
          className={`item-row ${item.index === currentItem ? "current" : ""}`}
          onClick={() => onCommand({ type: "queueItem", itemIndex: item.index })}
        >
          <span className="item-icon">{item.kind === "song" ? "♫" : "T"}</span>
          <span className="item-title">{item.title}</span>
          {item.notes && <span className="item-notes">{item.notes}</span>}
        </button>
      ))}
    </div>
  );
}
