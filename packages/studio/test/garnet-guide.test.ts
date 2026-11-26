import { describe, expect, it } from 'vitest';
import { NO_GUIDE, guideRoles, guideStep, triadOf } from '../src/devices/garnet/music';

const C = { root: 0, scale: 'major' };
const roles = (g: ReturnType<typeof guideStep>) => Object.fromEntries([...guideRoles(g, C)].sort((a, b) => a[0] - b[0]));

describe('Garnet chord guide', () => {
  it('chords: the key\'s own triad, a major triad off the key', () => {
    expect(triadOf(0, C)).toEqual([0, 4, 7]); // C
    expect(triadOf(4, C)).toEqual([4, 7, 11]); // Em
    expect(triadOf(8, C)).toEqual([8, 0, 3]); // G# (off the key): G# major
  });
  it('C, then E, then G: the user\'s walk-through', () => {
    let g = guideStep(NO_GUIDE, 60, C);
    expect(roles(g)).toEqual({ 0: 'root', 4: 'second', 7: 'third' }); // C blue, E red, G green
    g = guideStep(g, 64, C); // E: a note of the C chord
    expect(g).toEqual({ main: 0, second: 4 });
    expect(roles(g)).toEqual({ 0: 'root', 4: 'second', 7: 'alt', 11: 'alt' }); // C stays the root; Em's G and B purple
    g = guideStep(g, 67, C); // G: one of the purple notes → E becomes the root
    expect(g).toEqual({ main: 4, second: 7 });
    expect(guideRoles(g, C).get(4)).toBe('root');
  });
  it('a note outside both chords starts again', () => {
    const g = guideStep({ main: 0, second: 4 }, 62, C); // D
    expect(g).toEqual({ main: 2, second: null });
  });
});
