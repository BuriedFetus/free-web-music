import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import geodeManifest from '@fwm/engine/devices/geode.json';
import type { DeviceManifest } from '@fwm/engine';
import { Project } from '../src/model/project';
import {
  chunkTape, demoTape, finishRecording, fromPcm, hashPcm, makeTape, metaOf, resample, TapeAssembler, TapeStore, toPcm, type Tape,
} from '../src/model/sampleStore';

const sr = 48000;
const tone = (n: number, hz: number, g = 0.5) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * hz * i) / sr) * g);

describe('tapes', () => {
  it('round to 16 bits, and identical channels become mono', () => {
    const l = tone(1000, 440);
    expect(toPcm(l, l).ch).toBe(1);
    expect(toPcm(l, tone(1000, 220)).ch).toBe(2);
    const t = makeTape(l, tone(1000, 220), sr, 'x');
    const back = fromPcm(t);
    expect(Math.abs(back.l[100] - l[100])).toBeLessThan(1 / 32767 + 1e-6);
  });

  it('have the same fingerprint everywhere, and a different one for a different sound', () => {
    const a = makeTape(tone(5000, 440), null, sr, 'a');
    const b = makeTape(tone(5000, 440), null, sr, 'renamed');
    const c = makeTape(tone(5000, 441), null, sr, 'a');
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
    expect(makeTape(tone(5000, 440), null, 44100, 'a').hash).not.toBe(a.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('travel in pieces and come back whole, in any order', () => {
    const t = makeTape(tone(sr * 2, 300), tone(sr * 2, 450), sr, 'Opal · 2.0 s');
    const parts = chunkTape(t, 'me', 24 * 1024);
    expect(parts.length).toBe(Math.ceil((sr * 2 * 2 * 2) / (24 * 1024)));
    const asm = new TapeAssembler();
    let got: Tape | null = null;
    const order = parts.map((_, i) => i).reverse();
    for (const i of order) {
      got = asm.add(parts[i]) ?? got;
      if (!got && i > 0) expect(asm.progress(t.hash)).toBeGreaterThan(0);
    }
    expect(got).not.toBeNull();
    expect(got!.hash).toBe(t.hash);
    expect(got!.ch).toBe(2);
    expect(Array.from(got!.pcm.subarray(0, 50))).toEqual(Array.from(t.pcm.subarray(0, 50)));
  });

  it('a damaged piece is refused (the tape is asked for again)', () => {
    const t = makeTape(tone(20000, 300), null, sr, 'x');
    const parts = chunkTape(t, 'me', 8192);
    parts[1] = { ...parts[1], data: parts[2].data };
    const asm = new TapeAssembler();
    let got: Tape | null = null;
    for (const p of parts) got = asm.add(p) ?? got;
    expect(got).toBeNull();
  });

  it('recordings are trimmed of silence and normalised', () => {
    const n = sr;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 12000; i < 30000; i++) l[i] = r[i] = Math.sin(i * 0.05) * 0.2;
    const k = finishRecording(l, r, sr)!;
    expect(k.l.length).toBeLessThan(30000 - 12000 + sr * 0.06);
    expect(k.l.length).toBeGreaterThan(30000 - 12000);
    expect(Math.max(...k.l.map(Math.abs))).toBeCloseTo(0.9, 2);
    expect(finishRecording(new Float32Array(n), new Float32Array(n), sr)).toBeNull();
  });

  it('resample to another rate keeps the length in time', () => {
    const x = tone(44100, 440);
    expect(resample(x, 44100, 48000).length).toBe(48000);
    expect(resample(x, 48000, 48000)).toBe(x);
  });

  it('the store keeps tapes, and receives them from the channel', async () => {
    const s = new TapeStore(null);
    const t = demoTape(sr);
    expect(t.frames).toBe(sr * 3);
    let changes = 0;
    s.subscribe(() => changes++);
    for (const p of chunkTape(t, 'peer')) s.receive(p);
    expect(s.has(t.hash)).toBe(true);
    expect((await s.get(t.hash))?.name).toBe('Demo tape');
    expect(changes).toBeGreaterThan(1);
    expect(hashPcm(t.pcm, t.sr, t.ch)).toBe(t.hash);
  });
});

describe('the song only holds the tape fingerprint', () => {
  it('sets, clears (undoably), saves and loads it', () => {
    const p = new Project(new Y.Doc(), { user: 'u' });
    const m = geodeManifest as unknown as DeviceManifest;
    const id = p.addTrack(m);
    expect(p.tape(id)).toBeNull();
    const t = makeTape(tone(4800, 300), null, sr, 'x');
    p.setTape(id, metaOf(t));
    expect(p.tape(id)?.hash).toBe(t.hash);
    const file = p.toFile();
    expect(file.tracks[0].tape).toEqual(metaOf(t));
    expect(JSON.stringify(file).length).toBeLessThan(20000); // no sound in the song
    p.setTape(id, null);
    expect(p.tape(id)).toBeNull();
    p.undo();
    expect(p.tape(id)?.hash).toBe(t.hash);
    const q = new Project(new Y.Doc(), { user: 'v' });
    q.loadFile(file, { geode: m }, null);
    expect(q.tape(q.tracks()[0].id)?.hash).toBe(t.hash);
  });
});
