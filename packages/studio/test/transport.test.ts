// Shared transport over a simulated network: clocks that differ by seconds, delays that wobble.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransportSync, type TransportTarget } from '../src/collab/transport';
import type { LiveChannel, LiveMessage } from '../src/collab/types';

const SPM = (120 / 60) * 4 / 1000; // steps per ms at 120 BPM

/** A song player that keeps one anchor; `rate` != 1 makes it drift like a sound card would. */
class FakeEngine implements TransportTarget {
  a: { row: string; pos: number; at: number } | null = null;
  seeks = 0;
  queued: string | null = null;
  constructor(public rate = 1) {}
  play(row: string, pos: number, at: number) { this.a = { row, pos, at }; }
  seek(row: string, pos: number, at: number) { this.seeks++; this.a = { row, pos, at }; }
  stop() { this.a = null; }
  cue(row: string, wait: boolean) { if (wait) this.queued = row; else if (this.a) this.a = { ...this.a, row }; }
  where(at: number) {
    return this.a ? { row: this.a.row, pos: this.a.pos + (at - this.a.at) * SPM * this.rate, next: this.queued, stepsPerMs: SPM } : null;
  }
}

/** Seeded network between studios: base delay + wobble, in true time. */
function network(base = 30, wobble = 15, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const nodes: { fn: Set<(m: LiveMessage) => void> }[] = [];
  const join = (): LiveChannel => {
    const me = { fn: new Set<(m: LiveMessage) => void>() };
    nodes.push(me);
    return {
      send(m) {
        for (const n of nodes) if (n !== me) setTimeout(() => n.fn.forEach((f) => f(structuredClone(m))), base + wobble * -Math.log(1 - rnd() * 0.999));
      },
      subscribe(f) {
        me.fn.add(f);
        return () => me.fn.delete(f);
      },
    };
  };
  return { join };
}

/** A studio whose clock reads true time + `skew` ms. */
function studio(net: ReturnType<typeof network>, user: string, skew: number, onRemote?: (k: string, u: string) => void) {
  const engine = new FakeEngine();
  const now = () => Date.now() + skew;
  const sync = new TransportSync(net.join(), user, { now, onRemote: onRemote as never });
  sync.setTarget(engine);
  // Position at TRUE time T (ms), or null.
  const at = (T: number) => engine.where(T + skew);
  return { sync, engine, skew, at };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe('TransportSync', () => {
  it('learns the clock difference to within a millisecond', () => {
    const net = network(35, 12);
    const a = studio(net, 'ana', 0);
    const b = studio(net, 'ben', 1234.567);
    vi.advanceTimersByTime(8000);
    const off = a.sync.offset(b.sync.session)!;
    expect(Math.abs(off - 1234.567)).toBeLessThan(1.5);
    expect(a.sync.clocks()[0].delay).toBeGreaterThan(30);
    a.sync.destroy(); b.sync.destroy();
  });

  it('Play starts everyone on the same beat; Stop stops everyone', () => {
    const net = network();
    const heard: string[] = [];
    const a = studio(net, 'ana', 0);
    const b = studio(net, 'ben', -987.6, (k, u) => heard.push(`${k}:${u}`));
    vi.advanceTimersByTime(3000);
    a.sync.play('r1');
    const lead = a.engine.a!.at - Date.now();
    expect(lead).toBeGreaterThanOrEqual(60);
    vi.advanceTimersByTime(lead); // the start moment: B got the message in time
    expect(b.sync.getSnapshot().playing).toBe(true);
    const T = Date.now() + 500;
    expect(Math.abs(a.at(T)!.pos - b.at(T)!.pos) / SPM).toBeLessThan(4); // ms apart (inaudible)
    expect(heard).toContain('play:ana');
    b.sync.stop();
    vi.advanceTimersByTime(500);
    expect(a.sync.getSnapshot().playing).toBe(false);
    expect(a.engine.a).toBeNull();
    a.sync.destroy(); b.sync.destroy();
  });

  it('the driver keeps a drifting sound card in step', () => {
    const net = network();
    const a = studio(net, 'ana', 0);
    const b = studio(net, 'ben', 400);
    b.engine.rate = 1.002; // 2 ms per second fast
    vi.advanceTimersByTime(3000);
    a.sync.play('r1');
    vi.advanceTimersByTime(20_000);
    const T = Date.now();
    expect(Math.abs(a.at(T)!.pos - b.at(T)!.pos) / SPM).toBeLessThan(6);
    expect(b.engine.seeks).toBeGreaterThan(2);
    a.sync.destroy(); b.sync.destroy();
  });

  it('someone who joins while it plays drops in at the right place', () => {
    const net = network();
    const a = studio(net, 'ana', 0);
    vi.advanceTimersByTime(1000);
    a.sync.play('r1');
    vi.advanceTimersByTime(5000);
    const c = studio(net, 'cleo', 3210);
    vi.advanceTimersByTime(1500);
    expect(c.sync.getSnapshot().playing).toBe(true);
    const T = Date.now();
    expect(Math.abs(a.at(T)!.pos - c.at(T)!.pos) / SPM).toBeLessThan(4);
    a.sync.destroy(); c.sync.destroy();
  });

  it('Play alone keeps my transport to myself, and turning it off rejoins the group', () => {
    const net = network();
    const a = studio(net, 'ana', 0);
    const b = studio(net, 'ben', 50);
    vi.advanceTimersByTime(2000);
    b.sync.setAlone(true);
    b.sync.play('r2');
    vi.advanceTimersByTime(500);
    expect(a.sync.getSnapshot().playing).toBe(false);
    a.sync.play('r1');
    vi.advanceTimersByTime(500);
    expect(b.engine.a!.row).toBe('r2'); // still on my own
    b.sync.setAlone(false);
    vi.advanceTimersByTime(1500);
    expect(b.sync.getSnapshot().playing).toBe(true);
    const T = Date.now();
    expect(b.at(T)!.row).toBe('r1');
    expect(Math.abs(a.at(T)!.pos - b.at(T)!.pos) / SPM).toBeLessThan(4);
    a.sync.destroy(); b.sync.destroy();
  });

  it('two Plays at once end the same on both sides; TRACK clicks and loop reach everyone', () => {
    const net = network();
    const a = studio(net, 'ana', 0);
    const b = studio(net, 'ben', 77);
    vi.advanceTimersByTime(2000);
    a.sync.play('r1');
    b.sync.play('r3');
    vi.advanceTimersByTime(1500);
    expect(a.engine.a!.row).toBe(b.engine.a!.row);
    a.sync.cue('r2', true);
    a.sync.setLoop('track');
    vi.advanceTimersByTime(300);
    expect(b.engine.queued).toBe('r2');
    expect(b.sync.getSnapshot().loop).toBe('track');
    a.sync.destroy(); b.sync.destroy();
  });

  it('with no one else here, Play starts at once', () => {
    const net = network();
    const a = studio(net, 'ana', 0);
    vi.advanceTimersByTime(1000);
    a.sync.play('r1');
    expect(a.engine.a!.at).toBe(Date.now());
    a.sync.destroy();
  });
});
