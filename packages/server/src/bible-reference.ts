import type { BibleVerse } from "@sm/shared";

export interface ParsedBibleReference {
  bookName: string;
  chapter: number;
  from: number | null;
  to: number | null;
  fromPart: string | null;
  toPart: string | null;
}

export function parseBibleReference(value: string): ParsedBibleReference | null {
  const cleaned = value
    .replace(/^reading\s*:\s*/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
  const match = cleaned.match(
    /^((?:[1-3]\s*)?[A-Za-z][A-Za-z .'-]*?)\s+(\d{1,3})(?:\s*[:.]\s*(\d{1,3})\s*([a-z]?)(?:\s*[-–—]\s*(\d{1,3})\s*([a-z]?))?)?$/i,
  );
  if (!match) return null;
  const chapter = Number(match[2]);
  if (!Number.isInteger(chapter) || chapter <= 0) return null;
  const from = match[3] ? Number(match[3]) : null;
  const to = match[5] ? Number(match[5]) : from;
  return {
    bookName: match[1].trim(),
    chapter,
    from: from && from > 0 ? from : null,
    to: to && to > 0 ? to : null,
    fromPart: match[4]?.toLowerCase() || null,
    toPart: match[6]?.toLowerCase() || null,
  };
}

function sentenceChunks(text: string): string[] {
  const matches = text.match(/[^.!?]+(?:[.!?]+["'”’)]?|$)/g);
  const chunks = (matches ?? [text]).map((part) => part.trim()).filter(Boolean);
  return chunks.length ? chunks : [text];
}

function clauseChunks(text: string): string[] {
  const matches = text.match(
    /[^.!?;:—–,]+(?:[.!?;:—–,]+["'”’)]?|\s*$)/g,
  );
  const chunks = (matches ?? [text]).map((part) => part.trim()).filter(Boolean);
  return chunks.length ? chunks : [text];
}

function verseTextParts(text: string): string[] {
  const sentences = sentenceChunks(text);
  if (sentences.length > 1) return sentences;
  return clauseChunks(text);
}

/**
 * Bible references can start part-way through a verse, e.g. 14:33b. In that
 * notation "a" is the whole/first part, "b" starts at the second sentence or
 * clause, "c" at the third, and so on. If the verse cannot be split, keep the
 * full verse rather than dropping text.
 */
export function verseFromPart(text: string, part: string | null | undefined): string {
  const normalized = part?.trim().toLowerCase();
  if (!normalized || normalized === "a") return text;
  const index = normalized.charCodeAt(0) - 97;
  if (index <= 0) return text;
  const chunks = verseTextParts(text);
  if (chunks.length <= index) return text;
  return chunks.slice(index).join(" ").trim() || text;
}

export function verseToPart(text: string, part: string | null | undefined): string {
  const normalized = part?.trim().toLowerCase();
  if (!normalized) return text;
  const index = normalized.charCodeAt(0) - 97;
  if (index < 0) return text;
  const chunks = verseTextParts(text);
  if (index >= chunks.length) return text;
  return chunks.slice(0, index + 1).join(" ").trim() || text;
}

export function applyBiblePartRange(
  verses: BibleVerse[],
  fromPart: string | null | undefined,
  toPart: string | null | undefined,
): BibleVerse[] {
  return verses.map((verse, index) => {
    let text = verse.text;
    if (verses.length === 1 && fromPart && toPart) {
      text = verseFromPart(verseToPart(text, toPart), fromPart);
    } else {
      if (index === 0) text = verseFromPart(text, fromPart);
      if (index === verses.length - 1) text = verseToPart(text, toPart);
    }
    return { ...verse, text };
  });
}
