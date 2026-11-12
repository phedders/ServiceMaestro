const NUMBER = "\\d+[a-z]?";

const NAMED_SECTION = new RegExp(
  `^(?:verse|chorus|pre[- ]?chorus|bridge|intro|outro|ending|tag|turnaround|interlude|instrumental|refrain)(?:\\s*${NUMBER})?$`,
  "i",
);

const SHORT_SECTION =
  /^(?:[vcb]\s*\d+[a-z]?|(?:pc|tr|il|ins|inst|instr|int)(?:\s*\d+[a-z]?)?)$/i;

/**
 * Recognises a bare section heading written on its own line, for example
 * "Verse 2", "VERSE 2:", "V2" or "Pre-Chorus". It deliberately ignores
 * single-letter headings such as "C" or "B" because they are common lyric
 * words.
 */
export function bareSectionLabel(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/\s*[:.\-]\s*$/, "")
    .replace(/\s+/g, " ");
  if (!cleaned) return null;
  return NAMED_SECTION.test(cleaned) || SHORT_SECTION.test(cleaned) ? cleaned : null;
}
