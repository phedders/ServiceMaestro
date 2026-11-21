const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const NOTE_INDEX: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

const CHORD_RE = /^([A-G](?:#|b)?)(.*)$/;

/** Transpose a chord (including slash chords) by semitones. */
export function transposeChord(chord: string, semitones: number): string {
  if (!semitones) return chord;
  return chord
    .split("/")
    .map((part) => {
      const match = part.match(CHORD_RE);
      if (!match) return part;
      const index = NOTE_INDEX[match[1]];
      if (index === undefined) return part;
      return NOTES[(index + semitones + 120) % 12] + match[2];
    })
    .join("/");
}

/** Transpose a simple key label, leaving unrecognised values unchanged. */
export function transposeKey(key: string | null | undefined, semitones: number): string | null {
  if (!key) return null;
  return transposeChord(key, semitones);
}
