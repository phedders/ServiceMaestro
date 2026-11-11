import test from "node:test";
import assert from "node:assert/strict";
import { transposeChord, keyDelta, buildPages, renderLine, parseTextContent, extractTextFormat } from "../dist/render.js";

test("transposes simple and slash chords", () => {
  assert.equal(transposeChord("C", 2), "D");
  assert.equal(transposeChord("G/B", 2), "A/C#");
  assert.equal(transposeChord("F#m7", 1), "Gm7");
  assert.equal(transposeChord("N.C.", 2), "N.C.");
});

test("computes the nearest key change", () => {
  assert.equal(keyDelta("G", "A"), 2);
  assert.equal(keyDelta("A", "G"), -2);
  assert.equal(keyDelta("C", "C"), 0);
});

test("renders chord spans and escapes lyrics", () => {
  const html = renderLine("A[C]mazing <grace>", 2);
  assert.match(html, /class="chord"/);
  assert.match(html, /D/);
  assert.match(html, /&lt;grace&gt;/);
});

test("splits sections into pages by max lines", () => {
  const pages = buildPages({
    kind: "song",
    title: "Test",
    lyrics: "[Verse 1]\nline one\nline two\nline three\nline four\nline five",
    key: "G",
    keyOverride: "A",
    transpose: 0,
    maxLines: 4,
  });
  assert.ok(pages.length >= 2);
  assert.match(pages[0].html, /Verse 1/);
  assert.match(pages[0].html, /line one/);
});

test("text blank lines create page breaks", () => {
  const pages = buildPages({
    kind: "text",
    title: "Welcome",
    content: "First page\n\nSecond page",
    transpose: 0,
    maxLines: 4,
  });
  assert.equal(pages.length, 2);
});

test("honours verse order and repeats sections", () => {
  const pages = buildPages({
    kind: "song",
    title: "Order",
    lyrics: "[Verse 1]\nverse one\n\n[Chorus]\nchorus line",
    verseOrder: "C V1 C",
    transpose: 0,
    maxLines: 4,
  });
  assert.equal(pages.length, 3);
  assert.match(pages[0].html, /Chorus/);
  assert.match(pages[1].html, /Verse 1/);
  assert.match(pages[2].html, /Chorus/);
});

test("renders markdown text items and strips scripts", () => {
  const pages = buildPages({
    kind: "text",
    title: "Welcome",
    content: "type: markdown\n# Hello\n\n**bold** text\n\n<script>alert(1)</script>",
    transpose: 0,
    maxLines: 4,
  });
  assert.equal(pages.length, 1);
  assert.match(pages[0].html, /<h1>Hello<\/h1>/);
  assert.match(pages[0].html, /<strong>bold<\/strong>/);
  assert.doesNotMatch(pages[0].html, /script|alert/);
});

test("supports front-matter HTML text and page breaks", () => {
  const pages = buildPages({
    kind: "text",
    title: "Notices",
    content: "---\ntype: html\n---\n<h2>One</h2>\n<!-- page -->\n<p>Two</p>",
    transpose: 0,
    maxLines: 4,
  });
  assert.equal(pages.length, 2);
  assert.match(pages[0].html, /<h2>One<\/h2>/);
  assert.match(pages[1].html, /<p>Two<\/p>/);
});

test("supports inline styles and the legacy style-attribute typo", () => {
  const styled = buildPages({
    kind: "text",
    title: "Styled",
    content: 'type:html\nThis is <span style="font-size:200%">big</span>',
    transpose: 0,
    maxLines: 4,
  });
  assert.match(styled[0].html, /style="font-size:200%"/);
  assert.match(styled[0].html, /<span/);

  const legacy = buildPages({
    kind: "text",
    title: "Legacy",
    content: 'type:html\nThis is <style="font-size=200%">big</style>',
    transpose: 0,
    maxLines: 4,
  });
  assert.match(legacy[0].html, /<span style="font-size:200%">big<\/span>/);
  assert.doesNotMatch(legacy[0].html, /<style/);
});

test("honours explicit page markers in songs", () => {
  const pages = buildPages({
    kind: "song",
    title: "Marker",
    lyrics: "[Verse 1]\nline one\nline two<!-- page -->line three",
    transpose: 0,
    maxLines: 10,
  });
  assert.equal(pages.length, 2);
  assert.match(pages[0].html, /line two/);
  assert.match(pages[1].html, /line three/);
});

test("rich text does not use the flex line container", () => {  const pages = buildPages({
    kind: "text",
    title: "Strong",
    content: "type:html\nThis is <strong>big</strong>",
    transpose: 0,
    maxLines: 4,
  });
  assert.match(pages[0].html, /^<div class="text-html">/);
  assert.doesNotMatch(pages[0].html, /slide-inner/);
});

test("parses text metadata first lines", () => {
  assert.equal(parseTextContent("type: markdown\n# Hi").format, "markdown");
  assert.equal(parseTextContent("---\nformat: rst\n---\nTitle\n=====").format, "rst");
  assert.equal(parseTextContent("type: text\nplain").format, "text");
});

test("extracts a text format header into metadata", () => {
  const extracted = extractTextFormat("format: markdown\n# Welcome\n\n**Bold**");
  assert.equal(extracted.format, "markdown");
  assert.equal(extracted.content, "# Welcome\n\n**Bold**");
  assert.equal(extractTextFormat("plain words").format, null);
});

test("splits pages on max words whichever comes first", () => {
  const words = Array.from({ length: 30 }, (_, index) => `word${index + 1}`).join(" ");
  const pages = buildPages(
    {
      kind: "text",
      title: "Long",
      content: words,
      transpose: 0,
      maxLines: 50,
    },
    0,
    { maxLines: 50, maxWords: 10, smartPageSplits: false },
  );
  assert.equal(pages.length, 3);
  assert.match(pages[0].html, /word1/);
  assert.match(pages[2].html, /word30/);
});

test("smart splitting wraps long lines and limits page lines by scale", () => {
  const words = Array.from({ length: 220 }, (_, index) => `word${index + 1}`).join(" ");
  const pages = buildPages(
    {
      kind: "text",
      title: "Smart",
      content: words,
      transpose: 0,
      maxLines: 8,
    },
    0,
    { maxLines: 8, maxWords: 500, smartPageSplits: true, textScale: 1 },
  );
  assert.ok(pages.length > 1);
  const firstLines = (pages[0].html.match(/class="line"/g) ?? []).length;
  assert.ok(firstLines <= 8);
  assert.match(pages[0].html, /word1/);
});

test("renders song Markdown and split-word tags", () => {
  const pages = buildPages({
    kind: "song",
    title: "Styled",
    lyrics: "[Verse 1]\n**bold** and *italic* ==highlight==\ncan - not be sat - is - fied",
    transpose: 0,
    maxLines: 4,
    lyricsMarkdown: true,
  });
  assert.match(pages[0].html, /<strong>bold<\/strong>/);
  assert.match(pages[0].html, /<em>italic<\/em>/);
  assert.match(pages[0].html, /<mark>highlight<\/mark>/);
  assert.equal((pages[0].html.match(/class="lyric-split"/g) ?? []).length, 3);
  const plain = renderLine("can - not", 0);
  assert.doesNotMatch(plain, /lyric-split/);
  const split = renderLine("can - not", 0, { splitWords: true });
  assert.match(split, /class="lyric-split"/);
});

test("smart wrapping keeps split words together", () => {
  const pages = buildPages(
    {
      kind: "song",
      title: "Split",
      lyrics: "many words before the line sat - is - fied and many words after it",
      transpose: 0,
      maxLines: 8,
    },
    0,
    { maxLines: 8, maxWords: 500, smartPageSplits: true, textScale: 2 },
  );
  const html = pages.map((page) => page.html).join("");
  assert.match(
    html,
    /sat<span class="lyric-split"> - <\/span>is<span class="lyric-split"> - <\/span>fied/,
  );
});
