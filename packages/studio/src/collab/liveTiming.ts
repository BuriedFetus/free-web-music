// When to play another person's live key or knob turn.
//
// Each event carries the moment it was heard by its player, on the sender's clock (`at`), and
// `now` is "heard time" here too (page time + output delay), so a key is never planned sooner than
// this computer can sound it.
// - Even: play every event at (`at` + a lag). The lag is a bit more than the slowest recent
//   arrivals and glides slowly, so the rhythm stays steady, only slightly late. An event that
//   still arrives after its slot plays at once (counted as late).
// - Tight: play on arrival: sooner, but the network's wobble is heard.
// The lag is measured directly as (arrival on my clock − `at` on theirs): it includes the clock
// difference, so the timing never depends on the clock estimate moving. That estimate is only used
// to show the real delay in ms.
// A key's release keeps the lag of its press, so a note never ends before it starts.
import type { TransportSync } from './transport';

export type LiveMode = 'even' | 'tight';

const WINDOW = 128;
const MAX_DELAY = 300; // never hold an event back more than this (real ms)
// The lag glides toward its target, so its own changes don't add wobble: up fast, down slowly.
const RISE = 2;
const FALL = 0.5;

export class LiveTiming {
  private raw = new Map<string, number[]>(); // session → recent (arrival − at), ms, in mixed clocks
  private lag = new Map<string, number>(); // session → lag in use
  private held = new Map<string, number>(); // session:key → lag used for its press
  private stats = new Map<string, { n: number; late: number }>();

  constructor(private sync: TransportSync, private now: () => number = () => performance.now()) {}

  private target(session: string): number | null {
    const d = this.raw.get(session);
    const off = this.sync.offset(session);
    let t: number | null;
    if (!d || d.length < 8) {
      // Not enough keys yet: start from the delay the pings measured.
      const c = this.sync.clocks().find((x) => x.session === session);
      t = off == null || !c ? null : c.delayHigh + 15 - off;
    } else {
      const s = [...d].sort((a, b) => a - b);
      t = s[Math.min(s.length - 1, Math.floor(0.95 * s.length))] + 3;
    }
    return t != null && off != null ? Math.min(t, MAX_DELAY - off) : t;
  }

  /** The Even lag (ms from when they hear a key to when I do; null until measured) and the share of late keys. */
  info(session: string) {
    const off = this.sync.offset(session);
    const lag = this.lag.get(session);
    const st = this.stats.get(session);
    return {
      lag: off != null && lag != null ? lag + off : null,
      late: st && st.n ? st.late / st.n : 0,
    };
  }

  /**
   * Page time (performance.now() ms) to play an event that `session` played at `at` (their clock).
   * `key` pairs a press with its release; knob turns pass no key.
   */
  when(session: string, at: number | undefined, mode: LiveMode, key?: { id: string; on: boolean }): number {
    const now = this.now();
    if (at == null) return now; // an older sender: as it comes
    const press = !key || key.on;
    if (press) {
      const d = this.raw.get(session) ?? [];
      d.push(now - at);
      if (d.length > WINDOW) d.shift();
      this.raw.set(session, d);
      const t = this.target(session);
      const cur = this.lag.get(session);
      if (t != null) this.lag.set(session, cur == null ? t : t > cur ? cur + Math.min(RISE, t - cur) : cur - Math.min(FALL, cur - t));
    }
    if (mode === 'tight') return now;
    let lag = this.lag.get(session);
    if (key) {
      const k = `${session}:${key.id}`;
      if (key.on) {
        if (lag != null) this.held.set(k, lag);
      } else {
        lag = this.held.get(k) ?? lag;
        this.held.delete(k);
      }
    }
    if (lag == null) return now;
    const due = at + lag;
    if (press) {
      const st = this.stats.get(session) ?? { n: 0, late: 0 };
      st.n++;
      if (due < now) st.late++;
      if (st.n > 200) {
        st.n /= 2;
        st.late /= 2;
      }
      this.stats.set(session, st);
    }
    return Math.max(now, due);
  }
}
