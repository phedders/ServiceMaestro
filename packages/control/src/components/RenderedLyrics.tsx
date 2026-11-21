import { useMemo, type ReactNode } from "react";
import { isSongChordToken, suggestSongPageId } from "@sm/shared";
import { transposeChord } from "../chords";

const NAMED_SECTION =
  /^(?:verse|chorus|pre[- ]?chorus|bridge|intro|outro|ending|tag|turnaround|interlude|instrumental|refrain)(?:\s*\d+[a-z]?)?$/i;

function isSectionLabel(value: string): boolean {
  const token = value.trim();
  if (!token) return false;
  if (NAMED_SECTION.test(token)) return true;
  // Compact page IDs are lowercase; [C2] is a chord, [c2] is chorus 2.
  if (!/^[a-z]/.test(token)) return false;
  return suggestSongPageId(token) !== null;
}

function uppercaseChordRoot(value: string): string {
  return value.replace(/(^|\/)([a-g])/g, (_match, prefix: string, letter: string) =>
    `${prefix}${letter.toUpperCase()}`,
  );
}

function chordDisplay(value: string): string {
  if (value === "." || value === "N.C." || value === "NC") return value;
  return uppercaseChordRoot(value);
}

type Token =
  | { type: "text"; value: string }
  | { type: "chord"; value: string }
  | { type: "section"; value: string }
  | { type: "literal"; value: string };

type Block =
  | { type: "empty" }
  | { type: "text"; value: string }
  | { type: "section"; labels: string[] }
  | { type: "chords"; tokens: Token[] }
  | { type: "line"; tokens: Token[] };

function tokenize(line: string, semitones: number): Token[] {
  const tokens: Token[] = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) {
    if (match.index > last) {
      tokens.push({ type: "text", value: line.slice(last, match.index) });
    }
    const raw = match[1].trim();
    if (isSongChordToken(raw)) {
      tokens.push({ type: "chord", value: transposeChord(chordDisplay(raw), semitones) });
    } else if (isSectionLabel(raw)) {
      tokens.push({ type: "section", value: raw });
    } else {
      tokens.push({ type: "literal", value: raw });
    }
    last = match.index + match[0].length;
  }
  if (last < line.length) {
    tokens.push({ type: "text", value: line.slice(last) });
  }
  return tokens;
}

function parseLyrics(text: string, semitones: number): Block[] {
  return text.replace(/\r\n?/g, "\n").split("\n").map((line) => {
    if (!line.trim()) return { type: "empty" };

    // ChordPro directives are metadata, not lyric content.
    if (/^\s*\{[^}]*\}\s*$/.test(line)) return { type: "empty" };

    const tokens = tokenize(line, semitones);
    if (!tokens.length) return { type: "text", value: line };

    const bracketOnly = line.replace(/\[[^\]]+\]/g, "").trim() === "";
    if (bracketOnly) {
      const sectionTokens = tokens.filter((token) => token.type === "section");
      if (sectionTokens.length === tokens.length) {
        return { type: "section", labels: sectionTokens.map((token) => token.value) };
      }
      return { type: "chords", tokens };
    }
    return { type: "line", tokens };
  });
}

function renderInlineTokens(tokens: Token[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === "text") {
      nodes.push(token.value);
      continue;
    }
    if (token.type === "section") {
      nodes.push(
        <span className="rendered-inline-section" key={`section-${index}`}>
          {token.value}
        </span>,
      );
      continue;
    }
    if (token.type === "literal") {
      nodes.push(`[${token.value}]`);
      continue;
    }
    const next = tokens[index + 1];
    if (next?.type === "text" && next.value) {
      nodes.push(
        <span className="lyric-chord" key={`chord-${index}`}>
          <span className="rendered-chord">{token.value}</span>
          {next.value}
        </span>,
      );
      index++;
    } else {
      nodes.push(
        <span className="lyric-chord lyric-chord-standalone" key={`chord-${index}`}>
          <span className="rendered-chord">{token.value}</span>
        </span>,
      );
    }
  }
  return nodes;
}

function renderChordTokens(tokens: Token[]): ReactNode[] {
  return tokens.map((token, index) => {
    if (token.type === "chord") {
      return (
        <span className="rendered-chord" key={index}>
          {token.value}
        </span>
      );
    }
    if (token.type === "section") {
      return (
        <span className="rendered-inline-section" key={index}>
          {token.value}
        </span>
      );
    }
    if (token.type === "literal") {
      return <span key={index}>{`[${token.value}]`}</span>;
    }
    return <span key={index}>{token.value}</span>;
  });
}

export function RenderedLyrics({
  text,
  className = "lyrics-view",
  semitones = 0,
}: {
  text: string;
  className?: string;
  semitones?: number;
}) {
  const blocks = useMemo(() => parseLyrics(text, semitones), [text, semitones]);
  return (
    <div className={`${className} rendered-lyrics`}>
      {blocks.map((block, index) => {
        if (block.type === "empty") {
          return <div className="rendered-line rendered-empty" key={index} />;
        }
        if (block.type === "section") {
          return (
            <div className="rendered-section" key={index}>
              {block.labels.join(" · ")}
            </div>
          );
        }
        if (block.type === "chords") {
          return (
            <div className="rendered-chord-line" key={index}>
              {renderChordTokens(block.tokens)}
            </div>
          );
        }
        if (block.type === "text") {
          return (
            <div className="rendered-line" key={index}>
              {block.value}
            </div>
          );
        }
        return (
          <div className="rendered-line" key={index}>
            {renderInlineTokens(block.tokens)}
          </div>
        );
      })}
    </div>
  );
}
