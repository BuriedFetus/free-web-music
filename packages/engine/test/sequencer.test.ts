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
