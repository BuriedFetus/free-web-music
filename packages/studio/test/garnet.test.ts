// Garnet's neck: chords of the key, chord types, guitar shapes, note names.
import { describe, expect, it } from 'vitest';
import { chordsOfKey, voicing, TUNING } from '../src/devices/garnet/music';

const shape = (f: number[]) => f.map((x) => (x < 0 ? 'x' : x)).join('');
const names = (root: number, scale: string, type: Parameters<typeof chordsOfKey>[1] = 'triad') =>
  chordsOfKey({ root, scale }, type).map((c) => c.name).join(' ');

describe('Garnet chords', () => {
  it('builds the chords of the key, and of C major when the song has no key', () => {
    expect(names(0, 'major')).toBe('C Dm Em F G Am B°');
    expect(names(0, 'chromatic')).toBe('C Dm Em F G Am B°');
    expect(names(4, 'minor')).toBe('Em F♯° G Am Bm C D');
    expect(names(5, 'major')).toBe('F Gm Am B♭ C Dm E°'); // flat key: B♭, not A♯
    expect(names(9, 'minpent')).toBe('Am B° C Dm Em F G'); // pentatonic: chords of its minor scale
  });
  it('keeps every chord type in the scale', () => {
    expect(names(0, 'major', '7')).toBe('Cmaj7 Dm7 Em7 Fmaj7 G7 Am7 Bm7♭5');
    expect(names(0, 'major', 'sus4')).toBe('Csus4 Dsus4 Esus4 Fsus♯4 Gsus4 Asus4 Bsus4♭5');
    expect(names(0, 'major', '5')).toBe('C5 D5 E5 F5 G5 A5 B5');
    expect(names(0, 'major', 'add9').split(' ')[2]).toBe('Em(add♭9)');
  });
  it('plays the shapes a guitarist uses', () => {
    const c = chordsOfKey({ root: 0, scale: 'major' }, 'triad');
    expect(c.map((x) => x.name + ':' + shape(x.frets)).join(' ')).toBe('C:x32010 Dm:xx0231 Em:022000 F:133211 G:320003 Am:x02210 B°:x20431');
    expect(shape(chordsOfKey({ root: 0, scale: 'major' }, '5')[0].frets)).toBe('x355xx');
    expect(c[0].notes).toEqual([48, 52, 55, 60, 64]);
  });
  it('every shape has the root in the bass and every chord note, with no muted string inside', () => {
    const bad: string[] = [];
    for (const root of [0, 2, 4, 5, 7, 9, 11])
      for (const scale of ['major', 'minor', 'dorian'])
        for (const type of ['triad', '7', 'sus2', 'sus4', '5'] as const)
          for (const ch of chordsOfKey({ root, scale }, type)) {
            const played = ch.frets.map((f, s) => (f < 0 ? -1 : s)).filter((s) => s >= 0);
            const why: string[] = [];
            if ((TUNING[played[0]] + ch.frets[played[0]]) % 12 !== ch.root) why.push('bass');
            for (let s = played[0]; s <= played[played.length - 1]; s++) if (ch.frets[s] < 0) why.push('inner mute');
            const pcs = new Set(ch.notes.map((n) => n % 12));
            const need = type === '7' ? ch.pcs.filter((_, i) => i !== 2) : ch.pcs; // a 7th may leave out its fifth
            for (const pc of need) if (!pcs.has(pc)) why.push('missing ' + pc);
            if (why.length) bad.push(`${ch.name} ${shape(ch.frets)} (${why.join(', ')})`);
          }
    expect(bad).toEqual([]);
  });
  it('voicing finds a power chord on three strings', () => {
    expect(voicing({ root: 4, pcs: [4, 11], third: 8, opt: null, power: true }).filter((f) => f >= 0).length).toBe(3);
  });
});
