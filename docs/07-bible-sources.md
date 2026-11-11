# Bible source formats (from the sample files)

> Implementation status: adapters for all three schema families below are implemented (`packages/server/src/bible.ts`) with translation/book/chapter/verse-range APIs and a Bible page in the control UI. The preferred default translation is configured globally under **Settings → Bible** and falls back to the first available translation.

Findings from the Bible files dropped into `samples/bible/` on 2026-11-10. Files are treated as read-only source data; the application never writes to them.

## 1. Files received

| File | Format | Size | Content |
| --- | --- | --- | --- |
| `NASB.sqlite` | SQLite | ~10 MB | 66 books, 31,103 verses, no comments |
| `NET.sqlite` | SQLite | ~25 MB | 66 books, 31,065 verses, 25,310 comments |
| `ESVGSB.SQLite3` | SQLite | ~16 MB | ESV Global Study Bible, 66 books, 31,103 verses + study content |
| `NET.json` | JSON array | ~21 MB | 31,065 NET verses with comments |

All SQLite files are UTF-8. They use two different schema families, which confirms the need for schema detection and adapters.

## 2. Schema A — `book` / `verse` (NASB, NET)

```sql
book (
  id INTEGER PRIMARY KEY,
  book_reference_id INTEGER,
  testament_reference_id INTEGER,   -- 1 = OT, 2 = NT
  name VARCHAR(50)
)
verse (
  id INTEGER PRIMARY KEY,           -- global row id, not canonical
  book_id INTEGER REFERENCES book(id),
  chapter INTEGER,
  verse INTEGER,
  text TEXT
)
comment (
  id INTEGER PRIMARY KEY,
  book_id INTEGER, chapter INTEGER, verse INTEGER,
  comment TEXT                      -- HTML (NET); empty in NASB
)
metadata (key VARCHAR(255) PRIMARY KEY, value VARCHAR(255))
```

Observed:

- `book.id` and `book_reference_id` are **1–66**; `book` has exactly 66 rows.
- Verse counts: NASB 31,103; NET 31,065 (expected translation differences).
- `metadata`: `version=2`, `language_id=30`, `name=NASB|NET`, `copyright=(C)NASB`, `permissions`, `full_license`.
- Indexes exist on `verse.book_id`, `verse.chapter`, `verse.verse`, `verse.text`, `book.name`.
- NET `comment` rows contain HTML links to verses (e.g. `<a href='/NET/1/1/1'>1</a>`); comments are optional study notes, not projection text.
- `verse.text` is plain text (no markup) in both.

Mapping: canonical book number = `book.id` (1–66); chapter/verse from columns. Translation code from `metadata.name` or the filename.

## 3. Schema B — `books` / `verses` (ESV Global Study Bible)

```sql
books (book_number INTEGER, short_name, long_name, book_color)
books_all (book_number, short_name, long_name, book_color, is_present)
verses (book_number INTEGER, chapter INTEGER, verse INTEGER, text TEXT)
stories (book_number, chapter, verse, order_if_several, title)
introductions (book_number, introduction)
info (name, value)
```

Observed:

- `book_number` is a **10-based source id** (`10` Genesis, `20` Exodus, …), with gaps reserved for deuterocanonical books. Because the gaps are present, **do not derive the canonical index by dividing by 10**; map through the ordered `books` table instead. The max in this file is `730` (Revelation).
- `books` has 66 present books; `books_all` has 85 rows, 19 marked `is_present = 0` (deuterocanon: Tobit, Judith, Wisdom, Sirach, Maccabees, etc.). Only present books are exposed.
- 31,103 verses; `text` contains markup:
  - `<pb/>` — page break (7,173 occurrences),
  - `<f>…</f>` — footnote/cross-reference markers (25,977 occurrences), often symbols such as `ⓐ`, `†`, `[†1-26]`.
- `info` carries `language`, `description` ("The ESV Global Study Bible"), `detailed_info` (copyright), `chapter_string`, `chapter_string_ps`, `russian_numbering`, `contains_accents`, `html_style`.
- `stories` (2,405) and `introductions` (67) are study content; optional, not required for lyrics/passages.
- No index on `(book_number, chapter, verse)` is guaranteed; check and plan a cache.

Mapping: canonical order = rank of `book_number` in `books` (1–66), not `book_number / 10` blindly. Keep the original number for display/debug.

Text sanitization:

- `<pb/>` → ignored or treated as a paragraph/page hint; never shown as text.
- `<f>…</f>` → default **strip** for congregation output (footnote/cross-ref marker); optionally render as superscript in a study view.
- `html_style` from `info` is **not injected**; use the app's own theme CSS.
- Any other tags/entities are escaped or allow-listed.

## 4. Schema C — JSON export (`NET.json`)

- Top-level array of **31,065** objects:
  `pk`, `translation` (`NET`), `book` (1–66), `chapter`, `verse`, `text` (plain), `comment` (HTML).
- Same data as `NET.sqlite`; useful as a portable import but not efficient to query per request (21 MB).
- Adapter options:
  1. import once into the app's normalized cache at first use, or
  2. ignore when the matching SQLite file exists, or
  3. accept it as an import format that produces a normalized translation.
- Validate: translation id, book range, duplicate `(book, chapter, verse)`, verse count.

## 5. Detection and normalization

At startup (or when files change):

1. For each `.db`/`.sqlite`/`.sqlite3`, open **read-only** (`mode=ro`, `immutable=1` where appropriate).
2. Inspect `sqlite_master`:
   - `verse` + `book` + `metadata` → **Schema A** (`mybible`),
   - `verses` + `books` + `info` → **Schema B** (`bibledb`),
   - else fail with a diagnostic, never guess.
3. Read translation name/code from `metadata.name` or `info.description`/filename; allow an admin override.
4. Resolve the book list:
   - Schema A: `book.id` / `book_reference_id` 1–66.
   - Schema B: rank of present `books` rows; keep `book_number` as source id. Exclude `is_present = 0`.
5. Optionally build a **normalized cache** in the app DB or `/data/cache/bible/<code>.sqlite`:
   ```sql
   bible_verses (
     translation TEXT, book INTEGER, chapter INTEGER, verse INTEGER,
     text TEXT, comment TEXT,
     PRIMARY KEY (translation, book, chapter, verse)
   )
   ```
   with indexes; refresh when source `mtime`/hash changes. This gives a uniform query path and protects against missing source indexes.
6. Validate canonical counts (66 books; ~31,100 verses) and report missing/extra books, duplicate verses, empty text, and unusual book numbers.

## 6. Query and API mapping

```ts
passage(translation, { book, chapter, from, to }) ->
  { translation, bookName, chapter, from, to, verses: [{ number, text, comment? }] }
```

- Book/chapter navigation uses the normalized cache; the UI can offer the canonical 66 books plus only translations that are present.
- Verse ranges are inclusive; missing verse numbers are reported rather than silently collapsed.
- Optional comments/study notes are fetched only when the UI asks for "study notes"; they are not mixed into the lyric/passage text.
- Translation metadata (name, copyright, source file) is exposed for attribution.

## 7. Licensing and operations

- Keep source DBs read-only in `/library/bible`; never copy them into exports/bundles.
- Display the translation copyright/attribution from metadata where available.
- Do not modify or redistribute the source files; the normalized cache is internal.
- Record source hash + schema kind in `bible_translations` for change detection.
- If a file is replaced, rebuild the cache and keep the previous one until the new one validates.

## 8. Open questions

1. Which translations are licensed for the church's use, and may the app display/store them locally?
2. Should study notes/comments be available in the musician/operator UI, or only verses?
3. Is the JSON file a permanent option or just a one-off export? (SQLite is preferred.)
4. Are there more schema families planned (e.g. MyBible modules with Strong's numbers, red-letter markup)?
