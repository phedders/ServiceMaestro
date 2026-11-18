export const LEGAL_LINE =
  /^(ccli\s*(song|licen[cs]e)|for use solely with the songselect|note:\s*reproduction|©|copyright|\(c\)|all rights reserved)/i;

export interface LegalFooterBlock {
  start: number;
  end: number;
  lines: string[];
  text: string | null;
}

const EMPTY_FOOTER: LegalFooterBlock = {
  start: Number.MAX_SAFE_INTEGER,
  end: Number.MAX_SAFE_INTEGER,
  lines: [],
  text: null,
};

/**
 * Find the trailing CCLI/SongSelect legal block. It must contain a recognised
 * legal line; everything from that line to the end of the file is kept as
 * SongSelect info so continuation lines beginning with "|" cannot leak into
 * the lyrics. Optionally include the single author line immediately above the
 * block when it starts a new paragraph.
 */
export function extractLegalFooter(
  lines: string[],
  options: { includeAuthorLine?: boolean } = {},
): LegalFooterBlock {
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last -= 1;
  if (last < 0) return EMPTY_FOOTER;

  let legal = -1;
  for (let index = last; index >= 0; index -= 1) {
    if (LEGAL_LINE.test(lines[index].trim())) {
      legal = index;
      break;
    }
  }
  if (legal < 0) return EMPTY_FOOTER;

  let start = last;
  while (start > 0) {
    const previous = lines[start - 1];
    if (!previous.trim()) {
      start -= 1;
      continue;
    }
    if (LEGAL_LINE.test(previous.trim()) || /^\s*\|/.test(previous)) {
      start -= 1;
      continue;
    }
    const beforePrevious = start - 2 >= 0 ? lines[start - 2] : "";
    if (
      options.includeAuthorLine &&
      !beforePrevious.trim() &&
      !/[\[\]{}|]/.test(previous) &&
      previous.trim().length <= 200
    ) {
      start -= 1;
    }
    break;
  }

  const footerLines = lines
    .slice(start, last + 1)
    .map((line) => line.replace(/\s+$/, ""));
  while (footerLines.length && !footerLines[0].trim()) footerLines.shift();
  while (footerLines.length && !footerLines[footerLines.length - 1].trim()) footerLines.pop();

  return {
    start,
    end: last + 1,
    lines: footerLines,
    text: footerLines.join("\n").trim() || null,
  };
}
