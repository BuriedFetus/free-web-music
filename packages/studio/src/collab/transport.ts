// Shared transport: one Play / Stop / TRACK choice for everyone in the session, on the same beat.
//
// How it works (all through the host's live channel; the studio still opens no connection):
// - Clocks: every studio pings the others. From each ping / pong it learns the difference between the
//   two clocks; the lowest-delay quarter of recent samples gives sub-millisecond agreement.
// - Play says "TRACK x is at step 0 at time T", with T a little in the future (a bit more than the
//   network delay) so everyone gets the message in time and starts on the same sample.
// - The person who last pressed Play or clicked a TRACK (the "driver") says where the song is once a
//   second. Anyone more than a few ms off moves to the right place. That also covers tempo changes,
//   song edits and sound cards whose clocks drift apart.
// - Someone who joins while it plays asks ("hello") and the driver tells them where the song is.
// - "Play alone": your Play / Stop / TRACK clicks stay yours, and you ignore the group's.
import type { LiveChannel, LiveMessage, TransportMessage } from './types';

export type Loop = 'track' | 'song';
type Tp = Extract<TransportMessage, { t: 'tp' }>;

/** What the transport drives: the audio engine (song rows by id, times in page ms). */
export interface TransportTarget {
  play(row: string, pos: number, at: number): void;
  seek(row: string, pos: number, at: number): void;
  stop(): void;
  cue(row: string, wait: boolean): void;
  where(at: number): { row: string; pos: number; next: string | null; stepsPerMs: number } | null;
}

export interface TransportState {
  playing: boolean;
  alone: boolean;
  loop: Loop;
  /** User id of who last started, stopped or moved the song (null = me or nobody). */
  by: string | null;
}

export interface PeerClock {
  session: string;
  user: string;
  /** Their clock minus mine (ms), once measured. */
  offset: number | null;
  /** One-way delay to them (ms): typical and worst recent. */
  delay: number;
  delayHigh: number;
  alone: boolean;
}

/** Ms from a remote event to me: drift above this is corrected. */
const TOLERANCE_MS = 4;
const PING_EVERY = 1000;
const BEAT_EVERY = 1000;
const GONE_AFTER = 6000;

interface Sample {
  off: number;
  rtt: number;
}

export class TransportSync {
  readonly session = 's' + Math.random().toString(36).slice(2, 10);
  private state: TransportState;
  private n = 0;
  private loopN = 0; // loop changes have their own version, so they never cancel a TRACK click (or the reverse)
  private loopBy = '';
  private by = ''; // session of the driver
  private anchor: { row: string; pos: number; at: number } | null = null; // last known place (for an engine that starts later)
  private target: TransportTarget | null = null;
  private peers = new Map<string, { user: string; samples: Sample[]; seen: number; alone: boolean; lat: number }>();
  private listeners = new Set<() => void>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private unsub: (() => void) | null = null;
  private lastBeat = 0;
  private beatSoon = 0;
  private intervals: ReturnType<typeof setInterval>[] = [];
  private latency: () => number;
  private now: () => number;
  private onRemote: ((kind: Tp['kind'], user: string, s: TransportState) => void) | null;

  constructor(
    private channel: LiveChannel | null,
    private user: string,
    opts: {
      loop?: Loop;
      now?: () => number;
      /** This computer's output delay (ms): a Play can't be heard sooner than now + this. */
      latency?: () => number;
      onRemote?(kind: Tp['kind'], user: string, s: TransportState): void;
    } = {},
  ) {
    this.now = opts.now ?? (() => performance.now());
    this.latency = opts.latency ?? (() => 0);
    this.onRemote = opts.onRemote ?? null;
    this.state = { playing: false, alone: false, loop: opts.loop ?? 'song', by: null };
    if (!channel) return;
    this.unsub = channel.subscribe((m) => this.receive(m));
    // A quick burst of pings to learn the clocks, then one every few seconds.
    for (let i = 0; i < 12; i++) this.timers.push(setTimeout(() => this.ping(), 30 * i));
    this.timers.push(setTimeout(() => this.send({ t: 'hello', from: this.session }), 450));
    this.intervals.push(setInterval(() => this.ping(), PING_EVERY), setInterval(() => this.tick(), 50));
  }

  destroy() {
    this.unsub?.();
    for (const t of this.timers) clearTimeout(t);
    for (const t of this.intervals) clearInterval(t);
    this.timers = [];
    this.intervals = [];
    this.listeners.clear();
  }

  // ---- React store ----
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;
  private set(patch: Partial<TransportState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** The engine, once sound is on (null when off). A song that is already playing starts in it at the right place. */
  setTarget(t: TransportTarget | null) {
    this.target = t;
    if (!t || !this.state.playing || !this.anchor) return;
    // Alone (or nobody else here): sound just came on, so start the song now rather than partway in.
    const solo = this.state.alone || !this.clocks().some((c) => !c.alone);
    if (solo && this.anchor.at < this.now() + this.lead()) this.anchor = { ...this.anchor, at: this.now() + this.lead() };
    t.play(this.anchor.row, this.anchor.pos, this.anchor.at);
    if (!this.isDriver()) this.send({ t: 'hello', from: this.session });
  }

  // ---- my actions ----
  /** Play from TRACK `row`, for everyone (or only me when alone / nobody else is here). */
  play(row: string) {
    const at = this.now() + this.lead();
    this.anchor = { row, pos: 0, at };
    this.target?.play(row, 0, at);
    this.mine('play', { playing: true, row, pos: 0, time: at });
  }
  stop() {
    this.anchor = null;
    this.target?.stop();
    this.mine('stop', { playing: false, row: null, pos: 0, time: this.now() });
  }
  /** Click on a TRACK while playing: now, or when the playing TRACK ends (`wait`). */
  cue(row: string, wait: boolean) {
    this.target?.cue(row, wait);
    this.mine('cue', { playing: true, row, pos: 0, time: this.now(), wait });
    if (!wait) this.beatSoon = this.now() + 120; // tell the others exactly where we landed
  }
  setLoop(loop: Loop) {
    if (loop === this.state.loop) return;
    this.set({ loop });
    if (this.state.alone || !this.channel) return;
    this.loopN++;
    this.loopBy = this.session;
    this.send({ t: 'tp', from: this.session, user: this.user, kind: 'loop', n: this.loopN, playing: this.state.playing, row: null, pos: 0, time: this.now(), sent: this.now(), loop });
  }
  /** Play alone: on = my transport is my own; off = stop and drop back into the group's song. */
  setAlone(alone: boolean) {
    if (alone === this.state.alone) return;
    if (!alone) {
      this.anchor = null;
      this.target?.stop();
      this.set({ alone, playing: false });
      this.send({ t: 'hello', from: this.session });
    } else this.set({ alone });
    this.ping();
  }

  private mine(kind: Tp['kind'], m: Pick<Tp, 'playing' | 'row' | 'pos' | 'time'> & { wait?: boolean }) {
    const playing = m.playing;
    if (this.state.alone || !this.channel) return this.set({ playing, by: null });
    this.n++;
    this.by = this.session;
    this.set({ playing, by: null });
    this.send({ t: 'tp', from: this.session, user: this.user, kind, n: this.n, ...m, playing, sent: this.now(), loop: this.state.loop });
  }

  // ---- clocks ----
  private ping() {
    this.send({ t: 'ping', from: this.session, user: this.user, a: this.now(), alone: this.state.alone, lat: this.latency() });
  }
  private peer(id: string, user = '') {
    let p = this.peers.get(id);
    if (!p) this.peers.set(id, (p = { user, samples: [], seen: this.now(), alone: false, lat: 0 }));
    p.seen = this.now();
    if (user) p.user = user;
    return p;
  }
  /** Their clock minus mine, from the quarter of samples with the lowest round trip (null = not measured yet). */
  offset(session: string): number | null {
    const s = this.peers.get(session)?.samples;
    if (!s?.length) return null;
    const best = [...s].sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.ceil(s.length / 4)));
    const offs = best.map((x) => x.off).sort((a, b) => a - b);
    return offs[offs.length >> 1];
  }
  private alive(session: string) {
    return session === this.session || this.now() - (this.peers.get(session)?.seen ?? -Infinity) < GONE_AFTER;
  }
  /** Everyone I can hear from, with clock difference and delay. */
  clocks(): PeerClock[] {
    return [...this.peers.entries()]
      .filter(([id]) => this.alive(id))
      .map(([session, p]) => {
        const rtts = p.samples.map((s) => s.rtt).sort((a, b) => a - b);
        const q = (f: number) => (rtts.length ? rtts[Math.min(rtts.length - 1, Math.floor(f * rtts.length))] / 2 : 0);
        return { session, user: p.user, offset: this.offset(session), delay: q(0.5), delayHigh: q(0.9), alone: p.alone };
      });
  }
  /**
   * How far ahead Play starts: so it can be heard here (output delay) and, with others, so the message
   * reaches everyone and their sound cards in time.
   */
  lead() {
    const mine = this.latency();
    const others = this.state.alone ? [] : this.clocks().filter((c) => !c.alone);
    if (!others.length) return mine;
    const theirs = Math.max(...others.map((c) => c.delayHigh + (this.peers.get(c.session)?.lat ?? 0)));
    return Math.min(500, Math.max(mine, 60, theirs + 30));
  }
  private toLocal(m: Tp) {
    const off = this.offset(m.from);
    return off != null ? m.time - off : this.now() + (m.time - m.sent);
  }

  // ---- the group ----
  /** The driver says where the song is; if they left, the lowest session still here takes over. */
  private isDriver() {
    if (this.state.alone || !this.channel) return false;
    if (this.by && this.alive(this.by) && !this.peers.get(this.by)?.alone) return this.by === this.session;
    const ids = [this.session, ...this.clocks().filter((c) => !c.alone).map((c) => c.session)].sort();
    return ids[0] === this.session;
  }
  private tick() {
    const t = this.now();
    if (!this.state.playing || !this.isDriver()) return;
    if (t - this.lastBeat < BEAT_EVERY && !(this.beatSoon && t >= this.beatSoon)) return;
    this.beatSoon = 0;
    this.beat('beat');
  }
  private beat(kind: 'beat' | 'state') {
    const t = this.now();
    const w = this.target?.where(t);
    const a = this.anchor;
    const place = w ? { row: w.row, pos: w.pos, next: w.next } : a ? { row: a.row, pos: a.pos, next: null } : null;
    if (!place) return;
    this.lastBeat = t;
    this.send({
      t: 'tp', from: this.session, user: this.user, kind, n: this.n, playing: true,
      row: place.row, pos: place.pos, time: w ? t : a!.at, sent: t, loop: this.state.loop, next: place.next,
    });
  }

  private receive(m: LiveMessage) {
    if (m.t === 'on' || m.t === 'off' || m.t === 'param' || m.from === this.session) return;
    if (m.t === 'ping') {
      const p = this.peer(m.from, m.user);
      const was = p.alone;
      p.alone = m.alone;
      p.lat = m.lat ?? 0;
      this.send({ t: 'pong', from: this.session, to: m.from, a: m.a, b: this.now() });
      if (was !== m.alone) this.set({}); // chips
      return;
    }
    if (m.t === 'pong') {
      if (m.to !== this.session) return;
      const c = this.now();
      const p = this.peer(m.from);
      p.samples.push({ off: m.b - (m.a + c) / 2, rtt: c - m.a });
      if (p.samples.length > 32) p.samples.shift();
      return;
    }
    this.peer(m.from);
    if (m.t === 'hello') {
      if (this.state.playing && this.isDriver()) this.beat('state');
      return;
    }
    if (m.t !== 'tp' || this.state.alone) return;
    if (m.kind === 'loop') {
      if (m.n < this.loopN || (m.n === this.loopN && m.from < this.loopBy)) return;
      this.loopN = m.n;
      this.loopBy = m.from;
      this.set({ loop: m.loop });
      this.onRemote?.('loop', m.user, this.state);
      return;
    }
    // Newer wins; two changes at once: the higher session id wins, the same on every computer.
    const steady = m.kind === 'beat' || m.kind === 'state';
    if (m.n < this.n || (m.n === this.n && !steady && m.from < this.by)) return;
    const fresh = m.n > this.n || m.from !== this.by;
    this.n = m.n;
    this.by = m.from;
    const at = this.toLocal(m);
    const t = this.target;
    // The loop setting comes with the state a newcomer gets; otherwise only from loop changes.
    const loop = m.kind === 'state' && this.loopN === 0 ? m.loop : this.state.loop;
    if (m.kind === 'stop' || !m.playing) {
      this.anchor = null;
      if (this.state.playing) t?.stop();
      this.set({ playing: false, loop, by: m.user });
      if (fresh) this.onRemote?.('stop', m.user, this.state);
      return;
    }
    if (m.kind === 'cue') {
      if (m.row) t?.cue(m.row, !!m.wait);
      this.set({ loop, by: m.user });
      this.onRemote?.('cue', m.user, this.state);
      return;
    }
    if (!m.row) return;
    this.anchor = { row: m.row, pos: m.pos, at };
    const wasPlaying = this.state.playing;
    if (m.kind === 'play' || !wasPlaying) t?.play(m.row, m.pos, at);
    else if (t) {
      const w = t.where(at);
      if (!w || w.row !== m.row || Math.abs(w.pos - m.pos) > TOLERANCE_MS * w.stepsPerMs) t.seek(m.row, m.pos, at);
      if (m.next && w?.next !== m.next) t.cue(m.next, true);
    }
    this.set({ playing: true, loop, by: m.user });
    if (m.kind === 'play' && fresh) this.onRemote?.('play', m.user, this.state);
    else if (!wasPlaying) this.onRemote?.('state', m.user, this.state);
  }

  private send(m: TransportMessage) {
    this.channel?.send(m);
  }
}
