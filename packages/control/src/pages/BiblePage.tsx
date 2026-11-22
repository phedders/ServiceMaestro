import { useEffect, useMemo, useState } from "react";
import { formatBibleVerses } from "@sm/shared";
import type {
  BibleBook,
  BibleLayout,
  BiblePassage,
  BibleTranslationInfo,
  BibleVerse,
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
  const [chapterPassage, setChapterPassage] = useState<BiblePassage | null>(null);
  const [rangePassage, setRangePassage] = useState<BiblePassage | null>(null);
  const [endChapterPassage, setEndChapterPassage] = useState<BiblePassage | null>(null);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState<number | "more">(1);
  const [toChapter, setToChapter] = useState(2);
  const [toVerse, setToVerse] = useState(1);
  const multiChapter = to === "more";
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
    let cancelled = false;
    setChapterPassage(null);
    setRangePassage(null);
    setEndChapterPassage(null);
    api
      .bibleChapter(translation, bookNumber, chapter)
      .then((result) => {
        if (cancelled) return;
        setChapterPassage(result.passage);
        const first = result.passage.verses[0]?.number ?? 1;
        const last = result.passage.verses[result.passage.verses.length - 1]?.number ?? first;
        setFrom(first);
        setTo(last);
        setToChapter(chapter + 1);
        setToVerse(last);
      })
      .catch((error) => {
        if (cancelled) return;
        notify(error instanceof ApiError ? error.message : "Could not load passage", "error");
      });
    return () => {
      cancelled = true;
    };
  }, [translation, bookNumber, chapter]);

  useEffect(() => {
    if (!multiChapter || !translation || !bookNumber || !toChapter) {
      setEndChapterPassage(null);
      return;
    }
    let cancelled = false;
    api
      .bibleChapter(translation, bookNumber, toChapter)
      .then((result) => {
        if (cancelled) return;
        setEndChapterPassage(result.passage);
        const first = result.passage.verses[0]?.number ?? 1;
        const last = result.passage.verses[result.passage.verses.length - 1]?.number ?? first;
        setToVerse((current) =>
          current >= first && current <= last ? current : last,
        );
      })
      .catch((error) => {
        if (cancelled) return;
        notify(error instanceof ApiError ? error.message : "Could not load end chapter", "error");
      });
    return () => {
      cancelled = true;
    };
  }, [multiChapter, translation, bookNumber, toChapter]);

  useEffect(() => {
    if (
      !multiChapter ||
      !translation ||
      !bookNumber ||
      !chapter ||
      !toChapter ||
      !endChapterPassage ||
      endChapterPassage.chapter !== toChapter
    ) {
      setRangePassage(null);
      return;
    }
    let cancelled = false;
    api
      .biblePassage(translation, bookNumber, chapter, from, toVerse, toChapter)
      .then((result) => {
        if (!cancelled) setRangePassage(result.passage);
      })
      .catch((error) => {
        if (cancelled) return;
        notify(error instanceof ApiError ? error.message : "Could not load passage range", "error");
      });
    return () => {
      cancelled = true;
    };
  }, [
    multiChapter,
    translation,
    bookNumber,
    chapter,
    from,
    toChapter,
    toVerse,
    endChapterPassage,
  ]);

  const book = books.find((candidate) => candidate.number === bookNumber);
  const endVerse = typeof to === "number" ? to : toVerse;

  const verses = useMemo(() => {
    if (multiChapter) return rangePassage?.verses ?? [];
    if (!chapterPassage) return [];
    return chapterPassage.verses.filter(
      (verse) => verse.number >= from && verse.number <= endVerse,
    );
  }, [multiChapter, rangePassage, chapterPassage, from, endVerse]);

  const chapterGroups = useMemo(() => {
    const groups: Array<{ chapter: number; verses: BibleVerse[] }> = [];
    for (const verse of verses) {
      const number = verse.chapter ?? chapterPassage?.chapter ?? chapter;
      let group = groups.find((entry) => entry.chapter === number);
      if (!group) {
        group = { chapter: number, verses: [] };
        groups.push(group);
      }
      group.verses.push(verse);
    }
    return groups;
  }, [verses, chapterPassage, chapter]);

  function reference() {
    const active = multiChapter ? rangePassage ?? chapterPassage : chapterPassage;
    if (!active) return "";
    if (multiChapter) {
      return `${active.bookName} ${active.chapter}:${from}–${toChapter}:${toVerse} (${active.translationName})`;
    }
    return `${active.bookName} ${active.chapter}:${from}${
      endVerse !== from ? `–${endVerse}` : ""
    } (${active.translationName})`;
  }

  function selectedText(verseNumbers = false) {
    if (!chapterGroups.length) return "";
    return chapterGroups
      .map((group) => {
        const text = formatBibleVerses(group.verses, layout, { verseNumbers });
        return chapterGroups.length > 1
          ? `${chapterPassage?.bookName ?? "Chapter"} ${group.chapter}\n${text}`
          : text;
      })
      .join("\n\n");
  }

  function passageBody(verseNumbers = false) {
    const text = selectedText(verseNumbers);
    if (!text) return "";
    return includeReference ? `${reference()}\n${text}` : text;
  }

  function display() {
    if (!canWrite) return;
    const body = passageBody();
    if (body) onQuickText(body);
  }

  async function addToSetlist() {
    if (!canWrite) return;
    const body = passageBody(layout === "paragraph");
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
          <label className="bible-field-translation">
            Translation
            <select
              value={translation}
              onChange={(event) => setTranslation(event.target.value)}
              title={
                translations.find((item) => item.code === translation)?.shortName ?? undefined
              }
            >
              {translations.map((item) => (
                <option key={item.code} value={item.code} title={item.name}>
                  {item.shortName} — {item.books} books / {item.verses.toLocaleString()} verses
                </option>
              ))}
            </select>
          </label>
          <label className="bible-field-book">
            Book
            <select
              value={bookNumber}
              onChange={(event) => {
                setBookNumber(Number(event.target.value));
                setChapter(1);
              }}
              title={book?.name}
            >
              {books.map((item) => (
                <option key={item.number} value={item.number}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="bible-field-chapter">
            Chapter
            <select value={chapter} onChange={(event) => setChapter(Number(event.target.value))}>
              {Array.from({ length: book?.chapters ?? 0 }, (_, index) => index + 1).map((number) => (
                <option key={number} value={number}>
                  {number}
                </option>
              ))}
            </select>
          </label>
          <label className="bible-field-from">
            From
            <select value={from} onChange={(event) => setFrom(Number(event.target.value))}>
              {(chapterPassage?.verses ?? []).map((verse) => (
                <option key={verse.number} value={verse.number}>
                  {verse.number}
                </option>
              ))}
            </select>
          </label>
          <label className="bible-field-to">
            To
            <select
              value={to}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "more") {
                  setTo("more");
                  setToChapter(
                    Math.min(
                      chapter + 1,
                      Math.max(1, book?.chapters ?? chapter + 1),
                    ),
                  );
                  setToVerse(1);
                  return;
                }
                setTo(Number(value));
              }}
            >
              {(chapterPassage?.verses ?? []).map((verse) => (
                <option key={verse.number} value={verse.number}>
                  {verse.number}
                </option>
              ))}
              {book && chapter < book.chapters && (
                <option value="more">&lt;More&gt;</option>
              )}
            </select>
          </label>
          {multiChapter && (
            <div className="bible-more-fields">
              <label>
                To chapter
                <select
                  value={toChapter}
                  onChange={(event) => setToChapter(Number(event.target.value))}
                >
                  {Array.from(
                    { length: Math.max(0, (book?.chapters ?? chapter) - chapter) },
                    (_, index) => chapter + 1 + index,
                  ).map((number) => (
                    <option key={number} value={number}>
                      {number}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                To verse
                <select
                  value={toVerse}
                  onChange={(event) => setToVerse(Number(event.target.value))}
                >
                  {(endChapterPassage?.verses ?? []).map((verse) => (
                    <option key={verse.number} value={verse.number}>
                      {verse.number}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
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
                  navigator.clipboard?.writeText(selectedText());
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
                    ? "Appends the passage to the live page queue and shows it; it is not saved to the set list"
                    : "Read-only access to Bible"
                }
              >
                Add to live page queue
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>{chapterPassage ? reference() : "Passage"}</h2>
          <span className="muted">{verses.length} verses</span>
        </div>
        {chapterPassage ? (
          <div className={`bible-passage ${layout === "paragraph" ? "paragraph" : "verses"}`}>
            {chapterGroups.map((group) => (
              <div key={group.chapter} className="bible-chapter">
                {chapterGroups.length > 1 && (
                  <h3 className="bible-chapter-heading">
                    {chapterPassage.bookName} {group.chapter}
                  </h3>
                )}
                {layout === "paragraph" ? (
                  <p>
                    {group.verses.map((verse) => (
                      <span key={`${group.chapter}:${verse.number}`}>
                        <sup>{verse.number}</sup>
                        {verse.text}{" "}
                      </span>
                    ))}
                  </p>
                ) : (
                  group.verses.map((verse) => (
                    <p key={`${group.chapter}:${verse.number}`}>
                      <sup>{verse.number}</sup>
                      {verse.text}
                    </p>
                  ))
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Choose a chapter to load a passage.</p>
        )}
      </section>
    </div>
  );
}
