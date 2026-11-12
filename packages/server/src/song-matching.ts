import type {
  SongAlternative,
  SongDuplicateCandidate,
  SongDuplicateGroup,
  SongMatchSummary,
} from "@sm/shared";

export interface MatchingSongRow {
  id: string;
  title: string;
  alternate_titles: string | null;
  author: string | null;
  copyright: string | null;
  ccli: string | null;
  key: string | null;
  lyrics: string;
  verse_order: string | null;
  lyrics_markdown: number;
  priority: number;
  different_from_ids?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SongMatch {
  song: MatchingSongRow;
  score: number;
  reasons: string[];
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "my",
  "of",
  "on",
  "the",
  "to",
  "with",
  "your",
]);

function titleWords(value: string): string[] {
  return (value.normalize("NFKD").toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (word) => word.length > 1 && !STOP_WORDS.has(word),
  );
}

function titleVariants(song: MatchingSongRow): Array<{ value: string; alternate: boolean }> {
  return [
    { value: song.title, alternate: false },
    ...(song.alternate_titles ?? "")
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => ({ value, alternate: true })),
  ];
}

function scoreTitle(
  target: string,
  targetWords: string[],
  value: string,
  alternate: boolean,
): { score: number; reason: string } | null {
  const normalized = normalize(value);
  if (!normalized) return null;
  const kind = alternate ? "Alternative title" : "Title";
  if (normalized === target) {
    return { score: 1000 + normalized.length, reason: `${kind} matches exactly` };
  }
  if (target.length >= 6 && normalized.length >= 6) {
    if (target.includes(normalized)) {
      return {
        score: 400 + normalized.length,
        reason: `${kind} is contained in the reference title`,
      };
    }
    if (normalized.includes(target)) {
      return {
        score: 300 + target.length,
        reason: `Reference title is contained in this ${kind.toLowerCase()}`,
      };
    }
  }
  const words = titleWords(value);
  if (!targetWords.length || !words.length) return null;
  const common = targetWords.filter((word) => words.includes(word));
  if (common.length < 2) return null;
  const ratio = common.length / Math.min(targetWords.length, words.length);
  if (ratio < 0.6) return null;
  return {
    score: Math.round(100 * ratio) + common.length,
    reason: `${common.length} shared title words`,
  };
}

export function findSongMatches(
  query: string,
  songs: MatchingSongRow[],
  limit = 10,
): SongMatch[] {
  const target = normalize(query);
  if (!target) return [];
  const targetWords = titleWords(query);
  const matches: SongMatch[] = [];
  for (const song of songs) {
    let bestScore = 0;
    const reasons = new Set<string>();
    for (const variant of titleVariants(song)) {
      const scored = scoreTitle(target, targetWords, variant.value, variant.alternate);
      if (!scored) continue;
      bestScore = Math.max(bestScore, scored.score);
      reasons.add(scored.reason);
    }
    if (bestScore > 0) matches.push({ song, score: bestScore, reasons: [...reasons] });
  }
  return matches
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.song.priority ?? 0) - (a.song.priority ?? 0) ||
        a.song.title.localeCompare(b.song.title),
    )
    .slice(0, limit);
}

function firstLines(lyrics: string): string {
  return lyrics
    .replace(/\r/g, "")
    .split("\n")
    .map((line) =>
      line
        .replace(/\[[^\]]*\]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line && !/^(verse|chorus|bridge|intro|outro|tag|ending|pre-chorus)\b/i.test(line))
    .slice(0, 4)
    .join("\n");
}

export function matchSummary(match: SongMatch): SongMatchSummary {
  const { song } = match;
  return {
    id: song.id,
    title: song.title,
    alternateTitles: song.alternate_titles,
    author: song.author,
    copyright: song.copyright,
    ccli: song.ccli,
    key: song.key,
    firstLines: firstLines(song.lyrics),
    score: match.score,
    priority: song.priority ?? 0,
    reasons: match.reasons,
  };
}

export function matchAlternative(match: SongMatch): SongAlternative {
  return {
    ...matchSummary(match),
    lyrics: match.song.lyrics,
    lyricsMarkdown: Boolean(match.song.lyrics_markdown),
  };
}

export function findSongAlternatives(
  current: MatchingSongRow,
  songs: MatchingSongRow[],
  itemTitle?: string | null,
  limit = 12,
): SongAlternative[] {
  const queries = [
    itemTitle?.trim(),
    current.title,
    ...(current.alternate_titles ?? "")
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean),
  ].filter((value): value is string => Boolean(value));
  const byId = new Map<string, SongMatch>();
  for (const query of queries) {
    for (const match of findSongMatches(query, songs, limit)) {
      if (match.song.id === current.id) continue;
      const existing = byId.get(match.song.id);
      if (!existing) {
        byId.set(match.song.id, match);
      } else {
        existing.score = Math.max(existing.score, match.score);
        existing.reasons = [...new Set([...existing.reasons, ...match.reasons])];
      }
    }
  }
  return [...byId.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.song.priority ?? 0) - (a.song.priority ?? 0) ||
        a.song.title.localeCompare(b.song.title),
    )
    .slice(0, limit)
    .map(matchAlternative);
}

function lyricsKey(lyrics: string): string {
  return lyrics
    .replace(/\[[^\]]*\]/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function differentSongIds(song: MatchingSongRow | undefined): Set<string> {
  if (!song?.different_from_ids) return new Set();
  try {
    const parsed = JSON.parse(song.different_from_ids) as unknown;
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string" && Boolean(id))
        : [],
    );
  } catch {
    return new Set();
  }
}

export function findDuplicateGroups(songs: MatchingSongRow[]): SongDuplicateGroup[] {
  const parent = new Map(songs.map((song) => [song.id, song.id]));
  const different = new Map(
    songs.map((song) => [song.id, differentSongIds(song)]),
  );
  const edges: Array<{ a: string; b: string; reason: string }> = [];

  function markedDifferent(a: string, b: string): boolean {
    return Boolean(different.get(a)?.has(b) || different.get(b)?.has(a));
  }

  function root(id: string): string {
    let current = id;
    while (parent.get(current) !== current) current = parent.get(current)!;
    while (parent.get(id) !== id) {
      const next = parent.get(id)!;
      parent.set(id, current);
      id = next;
    }
    return current;
  }

  function union(a: string, b: string, reason: string): void {
    const rootA = root(a);
    const rootB = root(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
    edges.push({
      a,
      b,
      reason: reason.includes("contained in") ? "One title contains the other" : reason,
    });
  }

  const byCcli = new Map<string, string[]>();
  const byLyrics = new Map<string, string[]>();
  for (const song of songs) {
    const ccli = song.ccli?.trim();
    if (ccli && !/^0+$/.test(ccli)) {
      byCcli.set(ccli.toLowerCase(), [...(byCcli.get(ccli.toLowerCase()) ?? []), song.id]);
    }
    const key = lyricsKey(song.lyrics);
    if (key.length >= 80) {
      byLyrics.set(key, [...(byLyrics.get(key) ?? []), song.id]);
    }
  }
  for (const ids of byCcli.values()) {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        if (!markedDifferent(ids[i], ids[j])) {
          union(ids[i], ids[j], "Same CCLI number");
        }
      }
    }
  }
  for (const ids of byLyrics.values()) {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        if (!markedDifferent(ids[i], ids[j])) {
          union(ids[i], ids[j], "Identical lyrics");
        }
      }
    }
  }

  for (const song of songs) {
    for (const alternative of findSongAlternatives(song, songs, null, songs.length)) {
      if (alternative.score < 300) continue;
      if (markedDifferent(song.id, alternative.id)) continue;
      union(song.id, alternative.id, alternative.reasons[0] ?? "Similar title");
    }
  }

  const groups = new Map<string, MatchingSongRow[]>();
  for (const song of songs) {
    const key = root(song.id);
    groups.set(key, [...(groups.get(key) ?? []), song]);
  }
  const reasonMap = new Map<string, Set<string>>();
  for (const edge of edges) {
    const key = root(edge.a);
    reasonMap.set(key, (reasonMap.get(key) ?? new Set()).add(edge.reason));
  }

  return [...groups.entries()]
    .filter(([, members]) => members.length > 1)
    .map(([key, members]) => {
      const sorted = [...members].sort(
        (a, b) =>
          (b.priority ?? 0) - (a.priority ?? 0) ||
          a.title.localeCompare(b.title),
      );
      const candidates: SongDuplicateCandidate[] = sorted.map((song) => ({
        id: song.id,
        title: song.title,
        alternateTitles: song.alternate_titles,
        author: song.author,
        copyright: song.copyright,
        ccli: song.ccli,
        key: song.key,
        lyrics: song.lyrics,
        lyricsMarkdown: Boolean(song.lyrics_markdown),
        priority: song.priority ?? 0,
        createdAt: song.created_at,
        updatedAt: song.updated_at,
      }));
      return {
        id: `duplicate-${candidates[0].id}`,
        reasons: [...(reasonMap.get(key) ?? new Set(["Possible duplicate"]))],
        songs: candidates,
      };
    })
    .sort((a, b) => a.songs[0].title.localeCompare(b.songs[0].title))
    .slice(0, 200);
}
