import { useEffect, useMemo, useState } from "react";
import { formatBibleVerses } from "@sm/shared";
import type {
  BibleBook,
  BibleLayout,
  BiblePassage,
  BibleTranslationInfo,
  LiveState,
  SetlistSummary,
} from "@sm/shared";
import { api, ApiError } from "../api";
import { BibleLayoutButtons } from "../components/BibleLayoutButtons";
import { compactDate, pickCurrentSetlist } from "../service-date";
import { usePageAccess } from "../page-access";
import { useSessionState } from "../session-state";

export default function BiblePage({
  live,
  onQuickText,
  notify,
}: {
  live: LiveState;
  onQuickText: (text: string) => void;
  notify: (text: string, kind?: "info" | "error") => void;
}) {
  const { canWrite } = usePageAccess();
  const [translations, setTranslations] = useState<BibleTranslationInfo[]>([]);
  const [translation, setTranslation] = useSessionState("bible:translation", "");
  const [books, setBooks] = useState<BibleBook[]>([]);
  const [bookNumber, setBookNumber] = useSessionState("bible:book", 1);
  const [chapter, setChapter] = useSessionState("bible:chapter", 1);
  const [passage, setPassage] = useState<BiblePassage | null>(null);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [loading, setLoading] = useState(true);
  const [includeReference, setIncludeReference] = useSessionState(
    "bible:include-reference",
    true,
  );
  const [layout, setLayout] = useSessionState<BibleLayout>("bible:layout", "verses");
  const [setlists, setSetlists] = useState<SetlistSummary[]>([]);
  const [targetSetlist, setTargetSetlist] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    Promise.all([
      api.bibleTranslations(),
      api.settings().catch(() => null),
    ])
      .then(([result, settings]) => {
        setTranslations(result.translations);
        const preferred =
          settings?.settings.defaultBibleTranslation ?? null;
        const initial =
          result.translations.find((entry) => entry.code === translation) ??
          result.translations.find((entry) => entry.code === preferred) ??
          result.translations[0];
        if (initial) setTranslation(initial.code);
        if (!result.translations.length) notify("No Bible translations found in the Bible folder", "error");
      })
      .catch((error) => notify(error instanceof ApiError ? error.message : "Could not load translations", "error"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!translation) return;
    api
      .bibleBooks(translation)
      .then((result) => {
        setBooks(result.books);
        const current = result.books.find((book) => book.number === bookNumber);
        const first = result.books[0];
        if (!current && first) {
          setBookNumber(first.number);
          setChapter(1);
        }
      })
      .catch((error) => notify(error instanceof ApiError ? error.message : "Could not load books", "error"));
  }, [translation]);

  useEffect(() => {
    api
      .setlists()
      .then((result) => {
        setSetlists(result.setlists);
        const preferred =
          (live.setlistId && result.setlists.find((setlist) => setlist.id === live.setlistId)?.id) ||
          pickCurrentSetlist(result.setlists)?.id ||
          "";
        setTargetSetlist(preferred);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!translation || !bookNumber || !chapter) return;
    setPassage(null);
    api
      .bibleChapter(translation, bookNumber, chapter)
      .then((result) => {
        setPassage(result.passage);
        const first = result.passage.verses[0]?.number ?? 1;
        const last = result.passage.verses[result.passage.verses.length - 1]?.number ?? first;
        setFrom(first);
        setTo(last);
      })
      .catch((error) => {
        notify(error instanceof ApiError ? error.message : "Could not load passage", "error");
      });
  }, [translation, bookNumber, chapter]);

  const book = books.find((candidate) => candidate.number === bookNumber);

  const verses = useMemo(() => {
    if (!passage) return [];
    return passage.verses.filter((verse) => verse.number >= from && verse.number <= to);
  }, [passage, from, to]);

  function reference() {
    if (!passage) return "";
    return `${passage.bookName} ${passage.chapter}:${from}${
      to !== from ? `–${to}` : ""
    } (${passage.translationName})`;
  }

  function passageBody() {
    if (!verses.length) return "";
    const text = formatBibleVerses(verses, layout);
    return includeReference ? `${reference()}\n${text}` : text;
  }

  function display() {
    if (!canWrite) return;
    const body = passageBody();
    if (body) onQuickText(body);
  }

  async function addToSetlist() {
    if (!canWrite) return;
    const body = passageBody();
    if (!targetSetlist || !body) return;
    setAdding(true);
    try {
      await api.addItem(targetSetlist, {
        kind: "text",
        title: reference() || "Bible passage",
        content: body,
        contentSource: "bible",
        format: "text",
      });
      const target = setlists.find((setlist) => setlist.id === targetSetlist);
      notify(
        target
          ? `Added ${reference()} to “${target.name}”`
          : `Added ${reference()} to the current set list`,
      );
    } catch (error) {
      notify(error instanceof ApiError ? error.message : "Could not add passage to set list", "error");
    } finally {
      setAdding(false);
    }
  }

  if (loading) return <div className="panel">Loading translations…</div>;

  if (!translations.length) {
    return (
      <section className="panel empty-state">
        <div>
          <h2>No Bible translations found</h2>
          <p className="muted">
            Place SQLite translations in the configured Bible directory, then reload.
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className="bible-page">
      <section className="panel">
        <div className="panel-heading">
          <h2>Bible passage</h2>
          <span className="muted">{live.status === "idle" ? "Start a live session to display" : "Ready"}</span>
        </div>
        <div className="bible-controls">
          <label>
            Translation
            <select value={translation} onChange={(event) => setTranslation(event.target.value)}>
              {translations.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name} — {item.books} books / {item.verses.toLocaleString()} verses
                </option>
              ))}
            </select>
          </label>
          <label>
            Book
            <select
              value={bookNumber}
              onChange={(event) => {
                setBookNumber(Number(event.target.value));
                setChapter(1);
              }}
            >
              {books.map((item) => (
                <option key={item.number} value={item.number}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Chapter
            <select value={chapter} onChange={(event) => setChapter(Number(event.target.value))}>
              {Array.from({ length: book?.chapters ?? 0 }, (_, index) => index + 1).map((number) => (
                <option key={number} value={number}>
                  {number}
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <select value={from} onChange={(event) => setFrom(Number(event.target.value))}>
              {(passage?.verses ?? []).map((verse) => (
                <option key={verse.number} value={verse.number}>
                  {verse.number}
                </option>
              ))}
            </select>
          </label>
          <label>
            To
            <select value={to} onChange={(event) => setTo(Number(event.target.value))}>
              {(passage?.verses ?? []).map((verse) => (
                <option key={verse.number} value={verse.number}>
                  {verse.number}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="bible-actions">
          <div className="bible-action-options">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={includeReference}
                onChange={(event) => setIncludeReference(event.target.checked)}
              />
              Include reference
            </label>
            <BibleLayoutButtons value={layout} onChange={setLayout} />
          </div>
          <div className="bible-target">
            <label>
              Current set list
              <select
                value={targetSetlist}
                onChange={(event) => setTargetSetlist(event.target.value)}
                disabled={!canWrite}
              >
                {!setlists.length && <option value="">No set lists yet</option>}
                {setlists.map((setlist) => (
                  <option key={setlist.id} value={setlist.id}>
                    {setlist.name} — {compactDate(setlist.serviceDate)}
                    {setlist.serviceTime ? ` ${setlist.serviceTime}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="button-row">
              <button
                className="button ghost"
                onClick={() => {
                  navigator.clipboard?.writeText(formatBibleVerses(verses, layout));
                  notify("Passage copied");
                }}
                disabled={!verses.length}
                title="Copy the selected verses to the clipboard without the reference"
              >
                Copy text
              </button>
              <button
                className="button"
                onClick={addToSetlist}
                disabled={!canWrite || !targetSetlist || !verses.length || adding}
                title={
                  canWrite
                    ? "Adds a text item to the selected set list without changing the live output"
                    : "Read-only access to Bible"
                }
              >
                {adding ? "Adding…" : "Add to current setlist"}
              </button>
              <button
                className="button primary"
                onClick={display}
                disabled={!canWrite || !verses.length || live.status === "idle"}
                title={
                  canWrite
                    ? "Shows the passage immediately; it is not saved to the set list"
                    : "Read-only access to Bible"
                }
              >
                Add to live session
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>{passage ? reference() : "Passage"}</h2>
          <span className="muted">{verses.length} verses</span>
        </div>
        {passage ? (
          <div className={`bible-passage ${layout === "paragraph" ? "paragraph" : "verses"}`}>
            {layout === "paragraph" ? (
              <p>
                {verses.map((verse) => (
                  <span key={verse.number}>
                    <sup>{verse.number}</sup>
                    {verse.text}{" "}
                  </span>
                ))}
              </p>
            ) : (
              verses.map((verse) => (
                <p key={verse.number}>
                  <sup>{verse.number}</sup>
                  {verse.text}
                </p>
              ))
            )}
          </div>
        ) : (
          <p className="muted">Choose a chapter to load a passage.</p>
        )}
      </section>
    </div>
  );
}
