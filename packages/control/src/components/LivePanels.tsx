import type { LiveState } from "@sm/shared";

export function PageList({ live, onCommand }: { live: LiveState; onCommand: (payload: Record<string, unknown>) => void }) {
  const pages = live.queuedItemIndex != null ? live.queuedPages ?? [] : live.pages;
  const currentPage = live.queuedItemIndex != null ? 0 : live.pageIndex;
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
          title={`Show page ${page.index + 1}`}
        >
          <span className="page-meta">
            <span className="page-number">{page.index + 1}</span>
            {page.section && (
              <span className="page-section">({page.section})</span>
            )}
          </span>
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
      {live.items.map((item) => {
        const queueItem = () =>
          onCommand({ type: "queueItem", itemIndex: item.index });
        const appendItem = () =>
          onCommand({ type: "appendItem", itemIndex: item.index });
        return (
          <div
            key={item.index}
            className={`item-row ${item.index === currentItem ? "current" : ""}`}
            onClick={queueItem}
          >
            <button
              className="item-row-main"
              onClick={(event) => {
                event.stopPropagation();
                queueItem();
              }}
              title="Queue this item's page list"
            >
              <span className="item-icon">
                {item.kind === "song"
                  ? "♫"
                  : item.kind === "image"
                    ? "▣"
                    : item.kind === "image_list"
                      ? "▦"
                      : item.kind === "tarp"
                        ? "✦"
                        : "T"}
              </span>
              <span className="item-title">{item.title}</span>
              {item.notes && <span className="item-notes">{item.notes}</span>}
            </button>
            <button
              className="item-live"
              onClick={(event) => {
                event.stopPropagation();
                onCommand({ type: "goto", itemIndex: item.index });
              }}
              title={`Take ${item.title} live from its first page`}
              aria-label={`Take ${item.title} live`}
            >
              Live
            </button>
            <button
              className="item-append"
              onClick={(event) => {
                event.stopPropagation();
                appendItem();
              }}
              title="Append this item's pages to the current live queue"
              aria-label={`Append ${item.title} pages to the live queue`}
            >
              +
            </button>
          </div>
        );
      })}
    </div>
  );
}
