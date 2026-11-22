import { useState } from "react";
import type { LivePage, LiveState } from "@sm/shared";
import { PageEditDialog } from "./PageEditDialog";

export function PageList({
  live,
  onCommand,
  fullscreen = true,
}: {
  live: LiveState;
  onCommand: (payload: Record<string, unknown>) => void;
  fullscreen?: boolean;
}) {
  const [editing, setEditing] = useState<LivePage | null>(null);
  const queued = live.queuedItemIndex != null;
  const pages = queued ? live.queuedPages ?? [] : live.pages;
  const currentPage = queued ? 0 : live.pageIndex;
  if (!pages.length) {
    return <p className="muted">{queued ? "Queued item has no pages." : "No pages in the current item."}</p>;
  }

  const isStale = (page: LivePage): boolean => {
    if (queued) {
      return Boolean(live.queuedOutOfDatePages?.includes(page.index));
    }
    if (live.pagesOutOfDate && page.index === currentPage) return true;
    return Boolean(live.outOfDatePages?.includes(page.index));
  };

  const isEditable = (page: LivePage): boolean =>
    page.itemIndex != null &&
    page.itemIndex >= 0 &&
    page.source != null &&
    (page.itemKind === "song" || page.itemKind === "text");

  return (
    <>
      <div className={`page-list ${fullscreen ? "fullscreen-version" : ""}`}>
        {pages.map((page) => {
          const stale = isStale(page);
          const editable = isEditable(page);
          const itemKind =
            page.itemKind ?? live.items[page.itemIndex ?? -1]?.kind ?? null;
          const editPage = { ...page, itemKind: itemKind ?? page.itemKind };
          return (
            <div className="page-row-wrap" key={page.index}>
              <button
                className={`page-row ${page.index === currentPage ? "current" : ""} ${
                  stale ? "stale" : ""
                } ${editable ? "has-edit" : ""}`}
                onClick={() => onCommand({ type: "goto", pageIndex: page.index })}
                title={
                  stale
                    ? `This page has an edit waiting. Click to reload page ${page.index + 1}.`
                    : live.pagesOutOfDate && page.index === currentPage
                      ? `Pages are out of date after a lines/page change. Click to reload page ${page.index + 1}.`
                      : `Show page ${page.index + 1}`
                }
              >
                <span className="page-meta">
                  <span className="page-number">{page.index + 1}</span>
                  {page.section && (
                    <strong className="page-section">{page.section}</strong>
                  )}
                </span>
                <span className="page-text" dangerouslySetInnerHTML={{ __html: page.html }} />
                {stale && (
                  <span className="page-stale-icon" aria-hidden="true">
                    ↻
                  </span>
                )}
              </button>
              <button
                type="button"
                className="page-edit"
                disabled={!editable}
                onClick={() => {
                  if (editable) setEditing(editPage);
                }}
                title={
                  editable
                    ? `Edit page ${page.index + 1}`
                    : "This page type cannot be edited here"
                }
                aria-label={`Edit page ${page.index + 1}`}
              >
                ✎
              </button>
            </div>
          );
        })}
      </div>
      {editing && (
        <PageEditDialog
          page={editing}
          canSaveToSetlist={Boolean(live.setlistId)}
          onClose={() => setEditing(null)}
          onSave={(target, source) => {
            onCommand({
              type: "editPage",
              itemIndex: editing.itemIndex,
              pageIndex: editing.sourcePageIndex ?? editing.index,
              source,
              target,
            });
          }}
        />
      )}
    </>
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
