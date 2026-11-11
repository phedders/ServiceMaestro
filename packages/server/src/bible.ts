import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  BibleBook,
  BiblePassage,
  BibleTranslationInfo,
  BibleVerse,
} from "@sm/shared";
import { BIBLE_DIR } from "./config.js";

interface Adapter {
  info: BibleTranslationInfo;
  books: BibleBook[];
  sourceBookIds: Map<number, number | string>;
  chapter(book: number, chapter: number): BibleVerse[];
  close(): void;
}

export interface BibleCatalog {
  dir: string;
  translations: Map<string, Adapter>;
  errors: string[];
}

const CANONICAL_BOOKS = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
  "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra",
  "Nehemiah", "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon",
  "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
  "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah",
  "Malachi", "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians",
  "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians",
  "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James",
  "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
];

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&");
}

export function cleanVerseText(value: string): string {
  return decodeEntities(
    value
      .replace(/<pb\s*\/?>/gi, " ")
      .replace(/<f\b[^>]*>[\s\S]*?<\/f>/gi, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function baseCode(file: string): string {
  return path.basename(file).replace(/\.(sqlite3?|db|json)$/i, "").replace(/[^a-zA-Z0-9_-]/g, "");
}

function tableNames(db: Database.Database): Set<string> {
  return new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
}

function readInfo(db: Database.Database, table: string, keyColumn = "key"): Map<string, string> {
  try {
    return new Map(
      (
        db
          .prepare(`SELECT ${keyColumn} AS info_key, value FROM ${table}`)
          .all() as Array<{ info_key: string; value: string }>
      ).map((row) => [row.info_key, row.value ?? ""]),
    );
  } catch {
    return new Map();
  }
}

function buildInfo(
  code: string,
  name: string,
  schema: BibleTranslationInfo["schema"],
  books: BibleBook[],
  verses: number,
  copyright: string | null,
): BibleTranslationInfo {
  return { code, name, schema, books: books.length, verses, copyright };
}

/* ------------------------------------------------------------------ */
/* Schema A: book / verse / comment / metadata                          */
/* ------------------------------------------------------------------ */

function loadSchemaA(file: string): Adapter | null {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  const tables = tableNames(db);
  if (!tables.has("verse") || !tables.has("book")) {
    db.close();
    return null;
  }

  const metadata = readInfo(db, "metadata");
  const code = (metadata.get("name") || baseCode(file)).toUpperCase();
  const copyright = metadata.get("copyright") || null;
  const bookRows = db.prepare("SELECT id, name FROM book ORDER BY id").all() as Array<{
    id: number;
    name: string;
  }>;
  const chapterRows = db.prepare("SELECT book_id, MAX(chapter) AS max FROM verse GROUP BY book_id").all() as Array<{
    book_id: number;
    max: number;
  }>;
  const chapterMap = new Map(chapterRows.map((row) => [row.book_id, row.max]));
  const sourceBookIds = new Map<number, number>();
  const books: BibleBook[] = bookRows.map((row, index) => {
    const number = index + 1;
    sourceBookIds.set(number, row.id);
    return { number, name: row.name, chapters: chapterMap.get(row.id) ?? 0 };
  });
  const count = (db.prepare("SELECT COUNT(*) AS n FROM verse").get() as { n: number }).n;
  const statement = db.prepare(
    "SELECT verse, text FROM verse WHERE book_id = ? AND chapter = ? ORDER BY verse ASC",
  );

  return {
    info: buildInfo(code, code, "mybible", books, count, copyright),
    books,
    sourceBookIds,
    chapter(book, chapter) {
      const source = sourceBookIds.get(book);
      if (source === undefined) return [];
      return (statement.all(source, chapter) as Array<{ verse: number; text: string }>).map((row) => ({
        number: row.verse,
        text: cleanVerseText(row.text),
      }));
    },
    close() {
      db.close();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Schema B: books / verses / info / stories                            */
/* ------------------------------------------------------------------ */

function loadSchemaB(file: string): Adapter | null {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  const tables = tableNames(db);
  if (!tables.has("verses") || !tables.has("books")) {
    db.close();
    return null;
  }

  const info = readInfo(db, "info", "name");
  const code = baseCode(file).toUpperCase();
  const name = info.get("description") || code;
  const copyright = decodeEntities(info.get("detailed_info") || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
  const bookSql = "SELECT book_number, long_name FROM books ORDER BY book_number";
  const bookRows = db.prepare(bookSql).all() as Array<{ book_number: number; long_name: string }>;
  const chapterRows = db
    .prepare("SELECT book_number, MAX(chapter) AS max FROM verses GROUP BY book_number")
    .all() as Array<{ book_number: number; max: number }>;
  const chapterMap = new Map(chapterRows.map((row) => [row.book_number, row.max]));
  const sourceBookIds = new Map<number, number>();
  const books: BibleBook[] = bookRows.map((row, index) => {
    const number = index + 1;
    sourceBookIds.set(number, row.book_number);
    return { number, name: row.long_name, chapters: chapterMap.get(row.book_number) ?? 0 };
  });
  const count = (db.prepare("SELECT COUNT(*) AS n FROM verses").get() as { n: number }).n;
  const statement = db.prepare(
    "SELECT verse, text FROM verses WHERE book_number = ? AND chapter = ? ORDER BY verse ASC",
  );

  return {
    info: buildInfo(code, name, "bibledb", books, count, copyright),
    books,
    sourceBookIds,
    chapter(book, chapter) {
      const source = sourceBookIds.get(book);
      if (source === undefined) return [];
      return (statement.all(source, chapter) as Array<{ verse: number; text: string }>).map((row) => ({
        number: row.verse,
        text: cleanVerseText(row.text),
      }));
    },
    close() {
      db.close();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Schema C: JSON array (NET export)                                    */
/* ------------------------------------------------------------------ */

function loadJson(file: string): Adapter | null {
  const raw = fs.readFileSync(file, "utf8");
  const rows = JSON.parse(raw) as Array<{
    translation?: string;
    book?: number | string;
    chapter?: number | string;
    verse?: number | string;
    text?: string;
  }>;
  if (!Array.isArray(rows) || !rows.length) return null;

  const code = (rows[0].translation || baseCode(file)).toUpperCase();
  const versesByBook = new Map<number, Map<number, BibleVerse[]>>();
  const chapters = new Map<number, number>();
  const names = new Map<number, string>();

  for (const row of rows) {
    const book = Number(row.book);
    const chapter = Number(row.chapter);
    const verse = Number(row.verse);
    if (!Number.isFinite(book) || !Number.isFinite(chapter) || !Number.isFinite(verse)) continue;
    if (!versesByBook.has(book)) {
      versesByBook.set(book, new Map());
      names.set(book, CANONICAL_BOOKS[book - 1] ?? `Book ${book}`);
    }
    const byChapter = versesByBook.get(book)!;
    if (!byChapter.has(chapter)) byChapter.set(chapter, []);
    byChapter.get(chapter)!.push({ number: verse, text: cleanVerseText(String(row.text ?? "")) });
    chapters.set(book, Math.max(chapters.get(book) ?? 0, chapter));
  }

  const bookNumbers = [...versesByBook.keys()].sort((a, b) => a - b);
  const sourceBookIds = new Map<number, number>();
  const books: BibleBook[] = bookNumbers.map((source, index) => {
    const number = index + 1;
    sourceBookIds.set(number, source);
    return { number, name: names.get(source) ?? `Book ${source}`, chapters: chapters.get(source) ?? 0 };
  });
  const verseCount = rows.length;

  return {
    info: buildInfo(code, code, "json", books, verseCount, null),
    books,
    sourceBookIds,
    chapter(book, chapter) {
      const source = sourceBookIds.get(book);
      if (source === undefined) return [];
      return versesByBook.get(source)?.get(chapter) ?? [];
    },
    close() {},
  };
}

/* ------------------------------------------------------------------ */
/* Catalog                                                              */
/* ------------------------------------------------------------------ */

function loadAdapter(file: string): Adapter | null {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".json") return loadJson(file);
  if (![".sqlite", ".sqlite3", ".db"].includes(ext)) return null;
  return loadSchemaA(file) ?? loadSchemaB(file);
}

export function loadBibleCatalog(dir = BIBLE_DIR): BibleCatalog {
  const catalog: BibleCatalog = { dir, translations: new Map(), errors: [] };
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    catalog.errors.push(`Bible directory not found: ${dir}`);
    return catalog;
  }

  const files = fs
    .readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .map((name) => path.join(dir, name))
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return [".sqlite", ".sqlite3", ".db", ".json"].includes(ext);
    })
    // SQLite wins over JSON when they expose the same translation.
    .sort((a, b) => {
      const aJson = a.toLowerCase().endsWith(".json") ? 1 : 0;
      const bJson = b.toLowerCase().endsWith(".json") ? 1 : 0;
      return aJson - bJson || a.localeCompare(b);
    });

  for (const file of files) {
    try {
      const adapter = loadAdapter(file);
      if (!adapter) {
        catalog.errors.push(`${path.basename(file)}: unrecognised schema`);
        continue;
      }
      const existing = catalog.translations.get(adapter.info.code);
      if (existing) {
        if (existing.info.schema === "json" && adapter.info.schema !== "json") {
          existing.close();
          catalog.translations.set(adapter.info.code, adapter);
        } else {
          adapter.close();
        }
        continue;
      }
      catalog.translations.set(adapter.info.code, adapter);
    } catch (error) {
      catalog.errors.push(`${path.basename(file)}: ${(error as Error).message}`);
    }
  }

  return catalog;
}

let cached: BibleCatalog | null = null;
let activeBibleDir = BIBLE_DIR;

export function setBibleDir(dir: string): void {
  activeBibleDir = dir;
}

export function getBibleCatalog(): BibleCatalog {
  if (!cached) cached = loadBibleCatalog(activeBibleDir);
  return cached;
}

export function reloadBibleCatalog(): BibleCatalog {
  if (cached) {
    for (const adapter of cached.translations.values()) adapter.close();
  }
  cached = loadBibleCatalog(activeBibleDir);
  return cached;
}

export function listTranslations(): BibleTranslationInfo[] {
  return [...getBibleCatalog().translations.values()]
    .map((adapter) => adapter.info)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getBooks(code: string, catalog = getBibleCatalog()): BibleBook[] | null {
  const adapter = catalog.translations.get(code.toUpperCase());
  return adapter ? adapter.books : null;
}

export function getPassage(
  code: string,
  bookNumber: number,
  chapter: number,
  from?: number,
  to?: number,
  catalog = getBibleCatalog(),
): BiblePassage | null {
  const adapter = catalog.translations.get(code.toUpperCase());
  if (!adapter) return null;
  const book = adapter.books.find((candidate) => candidate.number === bookNumber);
  if (!book) return null;
  const verses = adapter.chapter(bookNumber, chapter);
  if (!verses.length) return null;
  const start = Math.max(1, from ?? verses[0].number);
  const end = Math.max(start, Math.min(to ?? verses[verses.length - 1].number, 999));
  const selected = verses.filter((verse) => verse.number >= start && verse.number <= end);
  if (!selected.length) return null;
  return {
    translation: adapter.info.code,
    translationName: adapter.info.name,
    book: book.number,
    bookName: book.name,
    chapter,
    from: start,
    to: end,
    verses: selected,
  };
}

export function getChapter(
  code: string,
  book: number,
  chapter: number,
  catalog = getBibleCatalog(),
): BiblePassage | null {
  return getPassage(code, book, chapter, undefined, undefined, catalog);
}
