import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { formatBibleVerses } from "@sm/shared";
import { cleanVerseText, getBooks, getPassage, loadBibleCatalog } from "../dist/bible.js";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sm-bible-"));
}

test("formats Bible verses as a paragraph or one line per verse", () => {
  const verses = [
    { number: 1, text: "In the beginning" },
    { number: 2, text: "The earth was formless" },
  ];
  assert.equal(formatBibleVerses(verses, "paragraph"), "In the beginning The earth was formless");
  assert.equal(formatBibleVerses(verses, "verses"), "In the beginning\nThe earth was formless");
});

test("cleans Bible markup and entities", () => {
  assert.equal(
    cleanVerseText("<pb/>In the <f>[†1]</f>beginning God &amp; <i>all</i>"),
    "In the beginning God & all",
  );
});

test("loads MyBible, BibleDb and JSON schemas", () => {
  const dir = tempDir();

  const a = new Database(path.join(dir, "TESTA.sqlite"));
  a.exec(`
    CREATE TABLE book (id INTEGER PRIMARY KEY, book_reference_id INTEGER, testament_reference_id INTEGER, name TEXT);
    CREATE TABLE verse (id INTEGER PRIMARY KEY, book_id INTEGER, chapter INTEGER, verse INTEGER, text TEXT);
    CREATE TABLE metadata ("key" TEXT, value TEXT);
    INSERT INTO book VALUES (1, 1, 1, 'Genesis'), (2, 2, 1, 'Exodus');
    INSERT INTO verse VALUES (1, 1, 1, 1, 'In the beginning &amp; <i>God</i>');
    INSERT INTO verse VALUES (2, 1, 1, 2, 'The earth was formless');
    INSERT INTO metadata VALUES ('name', 'TESTA'), ('copyright', '(C) Test A');
  `);
  a.close();

  const b = new Database(path.join(dir, "TESTB.sqlite3"));
  b.exec(`
    CREATE TABLE books (book_number INTEGER, short_name TEXT, long_name TEXT, book_color TEXT);
    CREATE TABLE books_all (book_number INTEGER, short_name TEXT, long_name TEXT, book_color TEXT, is_present INTEGER);
    CREATE TABLE verses (book_number INTEGER, chapter INTEGER, verse INTEGER, text TEXT);
    CREATE TABLE info (name TEXT, value TEXT);
    INSERT INTO books VALUES (10, 'Gen', 'Genesis', '#fff');
    INSERT INTO books_all VALUES (10, 'Gen', 'Genesis', '#fff', 1), (20, 'Exo', 'Exodus', '#fff', 1);
    INSERT INTO verses VALUES (10, 1, 1, '<pb/>In the <f>ⓐ</f>beginning');
    INSERT INTO info VALUES ('description', 'Test Study Bible'), ('detailed_info', '(C) Test B');
  `);
  b.close();

  fs.writeFileSync(
    path.join(dir, "TESTC.json"),
    JSON.stringify([
      { translation: "TESTC", book: 1, chapter: 1, verse: 1, text: "JSON verse one" },
      { translation: "TESTC", book: 1, chapter: 1, verse: 2, text: "JSON verse two" },
    ]),
  );

  const catalog = loadBibleCatalog(dir);
  assert.deepEqual(
    [...catalog.translations.keys()].sort(),
    ["TESTA", "TESTB", "TESTC"],
  );

  const books = getBooks("TESTA", catalog);
  assert.equal(books?.length, 2);
  assert.equal(books?.[0].name, "Genesis");

  const passage = getPassage("TESTA", 1, 1, 1, 2, catalog);
  assert.equal(passage?.verses.length, 2);
  assert.equal(passage?.verses[0].text, "In the beginning & God");

  const study = getPassage("TESTB", 1, 1, undefined, undefined, catalog);
  assert.equal(study?.verses[0].text, "In the beginning");
  assert.equal(study?.translationName, "Test Study Bible");

  const json = getPassage("TESTC", 1, 1, 2, 2, catalog);
  assert.equal(json?.verses.length, 1);
  assert.equal(json?.verses[0].text, "JSON verse two");
});
