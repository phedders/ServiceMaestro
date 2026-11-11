export interface LyricDiffLine {
  type: "same" | "removed" | "added";
  text: string;
}

export function diffLyrics(before: string, after: string): LyricDiffLine[] {
  const a = before.replace(/\r\n?/g, "\n").split("\n");
  const b = after.replace(/\r\n?/g, "\n").split("\n");
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const lines: LyricDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ type: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      lines.push({ type: "removed", text: a[i] });
      i += 1;
    } else {
      lines.push({ type: "added", text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    lines.push({ type: "removed", text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    lines.push({ type: "added", text: b[j] });
    j += 1;
  }
  return lines;
}
