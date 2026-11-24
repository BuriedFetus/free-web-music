// Song key: a root (0 = C … 11 = B) and a scale. Used by the piano roll to highlight or fold rows.
export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;

/** Semitone steps from the root. 'chromatic' means "no key": every row is in. */
export const SCALES: Record<string, { label: string; steps: number[] }> = {
  chromatic: { label: 'No key (chromatic)', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  major: { label: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  harmonic: { label: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  melodic: { label: 'Melodic minor', steps: [0, 2, 3, 5, 7, 9, 11] },
  dorian: { label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { label: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { label: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { label: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  majpent: { label: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  minpent: { label: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  blues: { label: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
};

export interface SongKey {
  root: number;
  scale: string;
}
export const DEFAULT_KEY: SongKey = { root: 0, scale: 'chromatic' };

export function inKey(m: number, k: SongKey): boolean {
  const steps = (SCALES[k.scale] ?? SCALES.chromatic).steps;
  return steps.includes((((m - k.root) % 12) + 12) % 12);
}
export const isRoot = (m: number, k: SongKey) => k.scale !== 'chromatic' && (((m - k.root) % 12) + 12) % 12 === 0;
export const keyLabel = (k: SongKey) => (k.scale === 'chromatic' ? 'No key' : `${NOTE_NAMES[k.root]} ${SCALES[k.scale]?.label ?? k.scale}`);
