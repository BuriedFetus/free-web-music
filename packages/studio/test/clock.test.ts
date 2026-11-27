import { describe, expect, it } from 'vitest';
import { Sequencer } from '@fwm/engine/worklet';

describe('the clock devices move by', () => {
  it('keeps counting when a row loops (Mica walks on, Motion goes on)', () => {
    const sr = 48000;
    const s = new Sequencer(sr);
    s.setSong({ rows: [{ id: 'r', len: 16, cells: {} }], loop: 'track' });
    s.setTransport({ playing: true, bpm: 120, row: 0 });
    const emit = () => {};
    for (let i = 0; i < Math.round((sr * 4.5) / 128); i++) s.advance(128, emit); // 4.5 s = 36 steps: the row looped twice
    expect(s.pos - s.rowStart).toBeLessThan(16);
    expect(s.clock).toBeGreaterThan(35);
  });

  it('someone who joins mid-row starts their clock where the row is', () => {
    const s = new Sequencer(48000);
    s.setSong({ rows: [{ id: 'r', len: 64, cells: {} }], loop: 'track' });
    s.start(0, 24);
    expect(s.clock).toBeCloseTo(24);
  });
});
