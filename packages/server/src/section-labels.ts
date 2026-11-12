const NUMBER = "\\d+[a-z]?";

const NAMED_SECTION = new RegExp(
  `^(?:verse|chorus|pre[- ]?chorus|bridge|intro|outro|ending|tag|turnaround|interlude|instrumental|refrain)(?:\\s*${NUMBER})?$`,
  "i",
);

const SHORT_SECTION =
  /^(?:[vcb]\s*\d+[a-z]?|(?:pc|tr|turn|il|ins|inst|instr|int)(?:\s*\d+[a-z]?)?)$/i;

function cleanLabel(value: string): string {
  return value
    .trim()
    .replace(/\s*[:.\-]\s*$/, "")
    .replace(/\s+/g, " ");
}

/**
 * Recognises a bare section heading written on its own line, for example
 * "Verse 2", "VERSE 2:", "V2" or "Pre-Chorus". It deliberately ignores
 * single-letter headings such as "C" or "B" because they are common lyric
 * words.
 */
export function bareSectionLabel(value: string): string | null {
  const cleaned = cleanLabel(value);
  if (!cleaned) return null;
  return NAMED_SECTION.test(cleaned) || SHORT_SECTION.test(cleaned) ? cleaned : null;
}

/**
 * Recognises a section heading inside square brackets, for example "[Verse 1]"
 * or the compact page IDs produced by Settings such as "[c]", "[i]" and "[t]".
 * Compact single-letter IDs are deliberately lowercase-only so "[C]" and
 * "[B]" remain chord markers.
 */
export function bracketedSectionLabel(value: string): string | null {
  const cleaned = cleanLabel(value);
  if (!cleaned) return null;
  if (/^[vcbioetrp]$/.test(cleaned)) return cleaned;
  return bareSectionLabel(cleaned);
}
