// Main sequencer timing, checked to the sample. At 120 BPM and 48 kHz one step (a 16th) = 6000 frames.
import { describe, expect, it } from 'vitest';
import { Sequencer, stepOf } from '../web/worklet.js';

const SR = 48000;
const STEP = 6000;
type Ev = { frame: number; kind: string; slot: number; a: number; b?: number };

function run(seq: Sequencer, frames: number): Ev[] {
  const out: Ev[] = [];
  for (let f = 0; f < frames; f += 128) {
    seq.advance(128, (off, kind, slot, a, b) => out.push({ frame: f + off, kind, slot, a, b }));
  }
  return out;
}
const play = (seq: Sequencer) => seq.setTransport({ playing: true, bpm: 120, swing: 0 });
const ons = (evs: Ev[]) => evs.filter((e) => e.kind === 'on');

describe('stepOf', () => {
  it('maps ticks to steps per direction', () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => stepOf(n, 4, 'fwd'))).toEqual([0, 1, 2, 3, 0, 1]);
    expect([0, 1, 2, 3, 4].map((n) => stepOf(n, 4, 'rev'))).toEqual([3, 2, 1, 0, 3]);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((n) => stepOf(n, 4, 'pp'))).toEqual([0, 1, 2, 3, 2, 1, 0, 1]);
    const rnd = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => stepOf(n, 4, 'rnd', 7));
    expect(rnd.every((x) => x >= 0 && x < 4)).toBe(true);
    expect(rnd).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((n) => stepOf(n, 4, 'rnd', 7))); // same on every client
  });
});

describe('Sequencer', () => {
  it('plays notes on the exact sample, including micro-timing', () => {
    const seq = new Sequencer(SR);
    seq.setPattern(0, [{ s: 0, l: 1, m: 36, v: 1 }, { s: 4, l: 1, m: 38, v: 1 }, { s: 6.5, l: 1, m: 40, v: 1 }]);
    play(seq);
    const e = ons(run(seq, 8 * STEP));
    expect(e.map((x) => [x.frame, x.a])).toEqual([[0, 36], [4 * STEP, 38], [6.5 * STEP, 40]]);
  });

  it('ends each note after its length', () => {
    const seq = new Sequencer(SR);
    seq.setPattern(0, [{ s: 2, l: 2, m: 36, v: 1 }]);
    play(seq);
    const off = run(seq, 8 * STEP).find((x) => x.kind === 'off')!;
    expect(off.frame).toBeCloseTo(2 * STEP + 2 * 0.98 * STEP, -1);
  });

  it('loops by track length', () => {
    const seq = new Sequencer(SR);
    seq.setTrack(0, { len: 3 });
    seq.setPattern(0, [{ s: 0, l: 0.5, m: 36, v: 1 }]);
    play(seq);
    expect(ons(run(seq, 9 * STEP)).map((x) => x.frame).filter((f) => f < 9 * STEP)).toEqual([0, 3 * STEP, 6 * STEP]);
  });

  it('applies swing to odd steps', () => {
    const seq = new Sequencer(SR);
    seq.setPattern(0, [{ s: 1, l: 0.5, m: 36, v: 1 }]);
    seq.setTransport({ playing: true, bpm: 120, swing: 0.5 });
    expect(ons(run(seq, 2 * STEP))[0].frame).toBe(1.25 * STEP);
  });

  it('runs at half and double rate', () => {
    for (const [rate, frame] of [[2, STEP / 2], [0.5, STEP * 2]]) {
      const seq = new Sequencer(SR);
      seq.setTrack(0, { rate });
      seq.setPattern(0, [{ s: 1, l: 0.5, m: 36, v: 1 }]);
      play(seq);
      expect(ons(run(seq, 3 * STEP))[0].frame).toBe(frame);
    }
  });

  it('cuts a sounding note before retriggering the same pitch', () => {
    const seq = new Sequencer(SR);
    seq.setPattern(0, [{ s: 0, l: 8, m: 36, v: 1 }, { s: 2, l: 1, m: 36, v: 1 }]);
    play(seq);
    const e = run(seq, 3 * STEP).filter((x) => x.frame === 2 * STEP);
    expect(e.map((x) => x.kind)).toEqual(['off', 'on']);
  });

  it('sends automation at its step, and nothing for muted or own-seq tracks', () => {
    const seq = new Sequencer(SR);
    const auto = Array(16).fill(null);
    auto[3] = 0.9;
    seq.setPattern(0, [{ s: 0, l: 1, m: 36, v: 1 }], { 4: auto });
    seq.setTrack(0, { mute: true });
    play(seq);
    const e = run(seq, 4 * STEP);
    expect(ons(e)).toEqual([]);
    expect(e.filter((x) => x.kind === 'param').map((x) => [x.frame, x.a, x.b])).toEqual([[3 * STEP, 4, 0.9]]);
  });

  it('stop releases everything and restarts from bar 1', () => {
    const seq = new Sequencer(SR);
    seq.setPattern(0, [{ s: 0, l: 16, m: 36, v: 1 }]);
    play(seq);
    run(seq, STEP);
    const offs: number[] = [];
    seq.setTransport({ playing: false });
    seq.flush((_f, _k, _s, a) => offs.push(a));
    expect(offs).toEqual([36]);
    play(seq);
    expect(ons(run(seq, 128))[0].frame).toBe(0);
  });
});

describe('Sequencer: song (rows of patterns)', () => {
  // Slot 0 has a 16-step pattern "a" (note 36 on every beat) and a 32-step "b" (note 48 at 0 and 16);
  // slot 1 has a 12-step pattern "c" (note 60 at step 0).
  function songSeq(loop: 'track' | 'song') {
    const seq = new Sequencer(SR);
    seq.setTrack(0, {});
    seq.setTrack(1, {});
    seq.setPat(0, 'a', { len: 16, notes: [0, 4, 8, 12].map((s) => ({ s, l: 1, m: 36, v: 1 })) });
    seq.setPat(0, 'b', { len: 32, notes: [0, 16].map((s) => ({ s, l: 1, m: 48, v: 1 })) });
    seq.setPat(1, 'c', { len: 12, notes: [{ s: 0, l: 1, m: 60, v: 1 }] });
    seq.setSong({ loop, rows: [{ id: 'r1', len: 16, cells: { 0: 'a', 1: 'c' } }, { id: 'r2', len: 32, cells: { 0: 'b' } }] });
    return seq;
  }
  const at = (e: Ev[], note: number) => ons(e).filter((x) => x.a === note).map((x) => x.frame / STEP);

  it('loop song: a row lasts as long as its longest pattern, shorter ones restart with each row', () => {
    const seq = songSeq('song');
    play(seq);
    const e = run(seq, 64 * STEP);
    expect(at(e, 36)).toEqual([0, 4, 8, 12, 48, 52, 56, 60]); // row 1 at 0, row 2 (32 steps) 16–48, row 1 again at 48
    expect(at(e, 48)).toEqual([16, 32]);
    expect(at(e, 60)).toEqual([0, 12, 48, 60]); // the 12-step pattern repeats inside row 1 and restarts with it
  });

  it('loop track: the playing row repeats; play can start from any row', () => {
    const seq = songSeq('track');
    seq.setTransport({ playing: true, bpm: 120, swing: 0, row: 1 });
    const e = run(seq, 64 * STEP);
    expect(at(e, 48)).toEqual([0, 16, 32, 48]);
    expect(at(e, 36)).toEqual([]);
  });

  it('cue jumps to another row at once, keeping the place in the bar', () => {
    const seq = songSeq('track');
    play(seq);
    run(seq, 6 * STEP); // about 6 steps into row 1 (blocks are 128 frames, so 6.016)
    const into = seq.pos - seq.rowStart;
    seq.cue(1);
    expect(seq.pos - seq.rowStart).toBeCloseTo(into, 6); // same place in the bar, now in row 2
    const e = run(seq, 20 * STEP);
    // Row 2's next note (its step 16) comes when row 2 reaches 16, about 10 steps later.
    expect(at(e, 48).map((f) => Math.round((f + into) * 1000) / 1000)).toEqual([16]);
    expect(at(e, 36)).toEqual([]);
  });

  it('a slot with no pattern in the row is silent; editing the song keeps the playing row', () => {
    const seq = songSeq('song');
    play(seq);
    run(seq, 20 * STEP); // in row 2
    seq.setSong({ loop: 'song', rows: [{ id: 'r0', len: 16, cells: {} }, { id: 'r1', len: 16, cells: { 0: 'a', 1: 'c' } }, { id: 'r2', len: 32, cells: { 0: 'b' } }] });
    expect(seq.song!.rows[seq.row].id).toBe('r2');
    const e = run(seq, 12 * STEP);
    expect(at(e, 60)).toEqual([]); // slot 1 has nothing in row 2
    expect(at(e, 36)).toEqual([]); // row r0 (empty) comes next, at 32
  });
});

describe('Sequencer: drum patterns (rows with their own length, accent, rolls, pad mute / solo)', () => {
  // Pad 0 (note 36): hit on step 0 of a 4-step row; pad 1 (37): step 0 of a 3-step row. Pattern = 4 steps.
  function drums(extra: object = {}) {
    const seq = new Sequencer(SR);
    seq.setTrack(0, { pmute: 0, psolo: 0, ...extra });
    seq.setPat(0, 'd', { len: 4, lens: [4, 3], notes: [{ s: 0, l: 1, m: 36, v: 1 }, { s: 0, l: 1, m: 37, v: 0.5, a: 1 }, { s: 2, l: 1, m: 36, v: 1, r: 3 }] });
    seq.setSong({ loop: 'track', rows: [{ id: 'r', len: 12, cells: { 0: 'd' } }] });
    return seq;
  }
  const at = (e: Ev[], note: number) => ons(e).filter((x) => x.a === note && x.frame < 12 * STEP).map((x) => Math.round((x.frame / STEP) * 1000) / 1000);

  it('each pad row loops on its own length; accents go 12 notes up; a roll is 3 quick hits in one step', () => {
    const seq = drums();
    play(seq);
    const e = run(seq, 12 * STEP);
    expect(at(e, 36)).toEqual([0, 2, 2.333, 2.667, 4, 6, 6.333, 6.667, 8, 10, 10.333, 10.667]); // 4-step row with a ×3 roll on step 2
    expect(at(e, 49)).toEqual([0, 3, 6, 9]); // the accented 3-step row: note 37 + 12
    expect(at(e, 37)).toEqual([]);
    const roll = ons(e).filter((x) => x.a === 36 && x.frame > 1.5 * STEP && x.frame < 3 * STEP).map((x) => x.b);
    expect(roll.map((v) => Math.round(v! * 100) / 100)).toEqual([1, 0.9, 0.8]); // each roll hit a little softer
  });

  it('muted pads are silent; soloed pads play alone', () => {
    let e = run((() => { const s = drums({ pmute: 1 }); play(s); return s; })(), 8 * STEP);
    expect(at(e, 36)).toEqual([]);
    expect(at(e, 49).length).toBeGreaterThan(0);
    e = run((() => { const s = drums({ psolo: 1 }); play(s); return s; })(), 8 * STEP);
    expect(at(e, 36).length).toBeGreaterThan(0);
    expect(at(e, 49)).toEqual([]);
  });
});

describe('Sequencer: cue with wait', () => {
  it('switches when the playing row ends, not before; cueing the playing row again cancels', () => {
    const seq = new Sequencer(SR);
    seq.setTrack(0, {});
    seq.setPat(0, 'a', { len: 16, notes: [{ s: 0, l: 1, m: 36, v: 1 }] });
    seq.setPat(0, 'b', { len: 16, notes: [{ s: 0, l: 1, m: 48, v: 1 }] });
    seq.setSong({ loop: 'track', rows: [{ id: 'r1', len: 16, cells: { 0: 'a' } }, { id: 'r2', len: 16, cells: { 0: 'b' } }] });
    play(seq);
    run(seq, 6 * STEP);
    seq.cue(1, true);
    expect(seq.pending).toBe('r2');
    const e = run(seq, 26 * STEP); // to step 32
    const firstB = ons(e).find((x) => x.a === 48)!;
    expect(Math.round((firstB.frame / STEP + 6) * 100) / 100).toBeCloseTo(16, 1); // row 2 starts at step 16, on the beat
    expect(ons(e).filter((x) => x.a === 36 && x.frame < 9 * STEP)).toHaveLength(0); // row 1 finished first (no early cut)
    expect(seq.pending).toBeNull();
    seq.cue(0, true);
    seq.cue(1, true); // the playing row again: cancel
    expect(seq.pending).toBeNull();
  });
});

describe('Sequencer: shared transport (start at a time, seek)', () => {
  const song = () => {
    const seq = new Sequencer(SR);
    seq.setTrack(0, {});
    seq.setPat(0, 'a', { len: 16, notes: [0, 4, 8, 12].map((s) => ({ s, l: 1, m: 36, v: 1 })) });
    seq.setPat(0, 'b', { len: 16, notes: [{ s: 0, l: 1, m: 48, v: 1 }] });
    seq.setSong({ loop: 'song', rows: [{ id: 'r1', len: 16, cells: { 0: 'a' } }, { id: 'r2', len: 16, cells: { 0: 'b' } }] });
    seq.setTransport({ bpm: 120 });
    return seq;
  };

  it('a start in the future waits, to the sample', () => {
    const seq = song();
    seq.start(0, -1000 / STEP); // 1000 frames from now
    const e = ons(run(seq, 5 * STEP));
    expect(e.map((x) => x.frame)).toEqual([1000, 1000 + 4 * STEP]);
  });

  it('a start in the past joins mid-row on the beat, then the song goes on', () => {
    const seq = song();
    seq.start(0, 6); // 6 steps in: the next hit is step 8, two steps from now
    const e = ons(run(seq, 12 * STEP));
    expect(e.map((x) => [x.frame, x.a])).toEqual([[2 * STEP, 36], [6 * STEP, 36], [10 * STEP, 48]]);
  });

  it('seek moves the row without restarting the clock or cutting notes', () => {
    const seq = song();
    seq.start(0, 0);
    run(seq, 2 * STEP);
    seq.seek(0, 3.5); // half a step ahead of where it was (2)
    const e = ons(run(seq, 2 * STEP));
    expect(e.map((x) => x.frame)).toEqual([0.5 * STEP]); // step 4 is now half a step away
    seq.seek(1, 15); // jump to the end of row 2: loop song goes back to row 1
    const f = ons(run(seq, 2 * STEP));
    expect(f.map((x) => [x.frame, x.a])).toEqual([[STEP, 36]]);
  });
});
