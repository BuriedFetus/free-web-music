// Garnet's neck: the chords of the song's key, chord types, and the guitar shapes that play them.
// Same rules as the approved mock-up (design/kit/garnet.html).
import { SCALES, type SongKey } from '../../model/scales';

/** Standard tuning, low E to high E (MIDI). The engine gives notes to strings the same way. */
export const TUNING = [40, 45, 50, 55, 59, 64] as const;
export const FRETS = 12;

export const CHORD_TYPES = [
  ['triad', 'Triad'],
  ['7', '7th'],
  ['sus2', 'sus2'],
  ['sus4', 'sus4'],
  ['add9', 'add9'],
  ['5', 'Power'],
] as const;
export type ChordType = (typeof CHORD_TYPES)[number][0];

const NS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const NF = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
/** Scales with fewer than seven notes build their chords from the seven-note scale they come from. */
const PARENT: Record<string, string> = { majpent: 'major', minpent: 'minor', blues: 'minor', chromatic: 'major' };
/** Semitones up to the major key with the same notes (decides ♯ or ♭ names). */
const TO_MAJOR: Record<string, number> = { major: 0, minor: 3, harmonic: 3, melodic: 3, dorian: 10, phrygian: 8, lydian: 7, mixolydian: 5 };

/** The key the neck uses: the song's key, or C major when the song has none. */
export function neckKey(k: SongKey): SongKey {
  return k.scale === 'chromatic' ? { root: 0, scale: 'major' } : k;
}
const chordScale = (k: SongKey) => PARENT[k.scale] ?? k.scale;
const flats = (k: SongKey) => [5, 10, 3, 8, 1].includes((k.root + (TO_MAJOR[chordScale(k)] ?? 0)) % 12);
export const noteName = (pc: number, k: SongKey) => (flats(k) ? NF : NS)[((pc % 12) + 12) % 12];
export const inScale = (m: number, k: SongKey) => (SCALES[k.scale] ?? SCALES.major).steps.includes((((m - k.root) % 12) + 12) % 12);

export interface Chord {
  root: number;
  name: string;
  /** Roman numeral (lower case = minor). */
  roman: string;
  pcs: number[];
  /** Fret per string, low E first; -1 = not played. */
  frets: number[];
  /** MIDI notes, low to high (the played strings). */
  notes: number[];
}

/** The chords of a key, one per scale degree, of the given type, all in the scale. */
export function chordsOfKey(key: SongKey, type: ChordType): Chord[] {
  const k = neckKey(key);
  const S = (SCALES[chordScale(k)] ?? SCALES.major).steps;
  const t = (d: number, i: number) => S[(d + i) % 7] + 12 * Math.floor((d + i) / 7) - S[d];
  return S.map((r, d) => {
    const third = t(d, 2), fifth = t(d, 4), sev = t(d, 6), sec = t(d, 1), four = t(d, 3);
    const root = (k.root + r) % 12;
    const R = noteName(root, k);
    const q = third === 4 && fifth === 7 ? '' : third === 3 && fifth === 7 ? 'm' : third === 3 && fifth === 6 ? '°' : third === 4 && fifth === 8 ? '+' : '';
    let iv: number[];
    let name: string;
    let opt: number | null = null;
    if (type === 'triad') {
      iv = [0, third, fifth];
      name = R + q;
    } else if (type === '7') {
      iv = [0, third, fifth, sev];
      opt = fifth;
      const n7: Record<string, string> = { '4,7,11': 'maj7', '4,7,10': '7', '3,7,10': 'm7', '3,6,10': 'm7♭5', '3,7,11': 'm(maj7)', '4,8,11': '+maj7', '3,6,9': '°7' };
      name = R + (n7[[third, fifth, sev].join()] ?? '7');
    } else if (type === 'sus2') {
      iv = [0, sec, fifth];
      name = R + (sec === 1 ? 'sus♭2' : 'sus2') + (fifth === 6 ? '♭5' : '');
    } else if (type === 'sus4') {
      iv = [0, four, fifth];
      name = R + (four === 6 ? 'sus♯4' : 'sus4') + (fifth === 6 ? '♭5' : '');
    } else if (type === 'add9') {
      iv = [0, third, fifth, sec];
      opt = fifth;
      const a9 = sec === 1 ? 'add♭9' : 'add9';
      name = R + (q === 'm' ? `m(${a9})` : q === '' ? a9 : `${q}(${a9})`);
    } else {
      iv = [0, 7];
      name = R + '5';
    }
    const rom = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][d];
    const roman = (third === 3 ? rom.toLowerCase() : rom) + (q === '°' ? '°' : q === '+' ? '+' : '');
    const pcs = [...new Set(iv.map((i) => (root + i + 120) % 12))];
    const frets = voicing({ root, pcs, third: (root + third) % 12, opt: opt == null ? null : (root + opt) % 12, power: type === '5' });
    const notes = frets.flatMap((f, s) => (f < 0 ? [] : [TUNING[s] + f]));
    return { root, name, roman, pcs, frets, notes };
  });
}

// ---- chord guide (Notes mode): a pressed note shows its chord on the neck ----
/** The guide: the main chord's root and, optionally, a second chord built on one of its notes (pitch classes). */
export interface Guide {
  main: number | null;
  second: number | null;
}
export const NO_GUIDE: Guide = { main: null, second: null };
export type GuideRole = 'root' | 'second' | 'third' | 'alt';

/** The triad on `pc`: the key's own chord when the note is in the key, else a major triad. Root first. */
export function triadOf(pc: number, key: SongKey): number[] {
  const k = neckKey(key);
  const c = inScale(pc, k) ? chordsOfKey(k, 'triad').find((ch) => ch.root === ((pc % 12) + 12) % 12) : undefined;
  if (c && c.pcs.length === 3) return c.pcs;
  return [pc, pc + 4, pc + 7].map((x) => ((x % 12) + 12) % 12);
}

const CHROM_RN = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
/** The chord on `pc` named for a progression: Roman numeral (its degree in the key; lower case = minor)
 *  and chord name. Off the key: the major chord, numbered by its distance from the key's root (♭VI…). */
export function chordLabel(pc: number, key: SongKey): { roman: string; name: string } {
  const k = neckKey(key);
  pc = ((pc % 12) + 12) % 12;
  const c = inScale(pc, k) ? chordsOfKey(k, 'triad').find((ch) => ch.root === pc) : undefined;
  if (c) return { roman: c.roman, name: c.name };
  return { roman: CHROM_RN[(pc - k.root + 12) % 12], name: noteName(pc, k) };
}

/** A note was pressed: the first note (or one outside both chords) starts a guide; a note of the main
 *  chord shows its own chord as the second; a note of the second chord's other notes makes the second
 *  chord the main one (and the pressed note shows its chord as the second). */
export function guideStep(g: Guide, pc: number, key: SongKey): Guide {
  pc = ((pc % 12) + 12) % 12;
  if (g.main == null) return { main: pc, second: null };
  const main = triadOf(g.main, key);
  // one of the second chord's other notes (the purple ones): that chord becomes the main one
  if (g.second != null && pc !== g.main && triadOf(g.second, key).slice(1).includes(pc)) return { main: g.second, second: pc };
  if (pc === g.main) return { main: pc, second: null };
  if (main.includes(pc)) return { main: g.main, second: pc };
  return { main: pc, second: null };
}

/** Colour role of each pitch class on the neck: the main root, its 2nd and 3rd notes, and the second
 *  chord's other two notes (purple; never over the main root). */
export function guideRoles(g: Guide, key: SongKey): Map<number, GuideRole> {
  const out = new Map<number, GuideRole>();
  if (g.main == null) return out;
  const [r, a, b] = triadOf(g.main, key);
  out.set(r, 'root').set(a, 'second').set(b, 'third');
  if (g.second != null) for (const pc of triadOf(g.second, key).slice(1)) if (pc !== r) out.set(pc, 'alt');
  return out;
}

interface Want {
  root: number;
  pcs: number[];
  third: number;
  opt: number | null;
  power: boolean;
}

/** A playable shape: root in the bass, every chord note present, within four frets (or open strings),
 *  no muted string between played ones, low on the neck, open strings where they ring naturally. */
export function voicing(ch: Want): number[] {
  const win = (p: number) => [...new Set([...(p <= 1 ? [0] : []), ...[0, 1, 2, 3].map((k) => Math.max(1, p) + k)])];
  let best: number[] = [-1, -1, -1, -1, -1, -1];
  let bestScore = Infinity;
  for (let p = 0; p <= 9; p++) {
    const W = win(p);
    for (const bs of [0, 1, 2]) {
      for (const bf of W.filter((f) => (TUNING[bs] + f) % 12 === ch.root)) {
        const top = ch.power ? bs + 2 : 5;
        if (top > 5) continue;
        const opts: number[][] = [];
        for (let s = bs + 1; s <= top; s++) {
          const o = W.filter((f) => ch.pcs.includes((TUNING[s] + f) % 12));
          // nothing in reach on this string: allow a stretch of one more fret
          const far = Math.max(1, p) + 4;
          if (!o.length && ch.pcs.includes((TUNING[s] + far) % 12)) o.push(far);
          if (!ch.power && s >= 4) o.push(-1);
          if (!o.length) o.push(-1);
          opts.push(o);
        }
        const fr = [-1, -1, -1, -1, -1, -1];
        fr[bs] = bf;
        const rec = (i: number) => {
          if (i === opts.length) {
            const sc = score(fr, bs, top, ch);
            if (sc < bestScore) {
              bestScore = sc;
              best = fr.slice();
            }
            return;
          }
          for (const f of opts[i]) {
            fr[bs + 1 + i] = f;
            rec(i + 1);
          }
        };
        rec(0);
      }
    }
  }
  return best;
}

function score(fr: number[], bs: number, top: number, ch: Want): number {
  let sc = 0;
  const pcs = new Set<number>();
  const played: number[] = [];
  for (let s = 0; s < 6; s++)
    if (fr[s] >= 0) {
      pcs.add((TUNING[s] + fr[s]) % 12);
      played.push(s);
    }
  for (const pc of ch.pcs) if (!pcs.has(pc)) sc += pc === ch.opt ? 2 : 100;
  const last = played[played.length - 1];
  for (let s = bs + 1; s < last; s++) if (fr[s] < 0) sc += 20;
  for (let s = last + 1; s <= top; s++) sc += 2.5;
  const fretted = played.map((s) => fr[s]).filter((f) => f > 0);
  if (fretted.length) {
    const lo = Math.min(...fretted), hi = Math.max(...fretted);
    const atLo = fretted.filter((f) => f === lo).length;
    if (fretted.length - (atLo > 1 ? atLo - 1 : 0) > 4) sc += 50;
    // a barre (one finger across the lowest fret) can't leave an open string under it
    const bar = played.filter((s) => fr[s] === lo);
    if (bar.length > 1) for (const s of played) if (fr[s] === 0 && s > bar[0] && s < bar[bar.length - 1]) sc += 6;
    sc += (hi - lo) * 0.6 + lo * 0.45;
  }
  sc -= played.length * 0.7;
  sc += bs * 0.2;
  if (played.filter((s) => (TUNING[s] + fr[s]) % 12 === ch.third).length > 2) sc += 1;
  const opens = played.filter((s) => fr[s] === 0).length;
  const far = fretted.some((f) => f >= 4);
  sc += opens * (far ? 1.5 : -0.4);
  if (ch.power && played.length !== 3) sc += 30;
  return sc;
}
