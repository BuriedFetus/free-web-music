import { describe, expect, it } from 'vitest';
import { scaleStep, snapToKey, inKey } from '../src/model/scales';

describe('playing in the song key', () => {
  it('A = the root, the home row walks up the scale', () => {
    const k = { root: 9, scale: 'minor' }; // A minor
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((d) => scaleStep(48, d, k))).toEqual([57, 59, 60, 62, 64, 65, 67, 69]);
    const e = { root: 4, scale: 'major' }; // E major from C3
    expect(scaleStep(48, 0, e)).toBe(52);
    expect(scaleStep(48, 2, e)).toBe(56);
  });
  it('every key is in the scale, at any base and key', () => {
    for (const scale of ['major', 'minor', 'dorian', 'majpent', 'blues', 'harmonic'])
      for (let root = 0; root < 12; root++)
        for (let d = 0; d < 20; d++) expect(inKey(scaleStep(36 + root, d, { root, scale }), { root, scale })).toBe(true);
  });
  it('an off-key note snaps to its nearest key note; no key = unchanged', () => {
    const c = { root: 0, scale: 'major' };
    expect(snapToKey(61, c)).toBe(62); // C# → D (a tie goes up)
    expect(snapToKey(66, c)).toBe(67);
    expect(snapToKey(64, c)).toBe(64);
    expect(snapToKey(61, { root: 0, scale: 'chromatic' })).toBe(61);
  });
});
