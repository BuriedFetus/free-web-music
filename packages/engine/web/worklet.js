// free-web-music engine: AudioWorklet side. Runs the Rust/WASM rack and the main sequencer
// on the audio thread, so pattern playback is sample-accurate and never stutters with the UI.
//
// Messages in (port):
//   {t:'add',slot,kind} {t:'remove',slot} {t:'on',slot,note,vel} {t:'off',slot,note} {t:'allOff',slot}
//   {t:'param',slot,i,v} {t:'route',slot,r,src,target,depth} {t:'unroute',slot,r}
//   {t:'transport', playing, bpm, swing}            play/stop restarts from bar 1
//   {t:'track', slot, len, dir, rate, own, mute}     per-track sequencer settings
//   {t:'pattern', slot, notes:[{s,l,m,v}], auto:{[paramIndex]:(number|null)[]}}   one pattern (no song)
// Song mode (when a song is set):
//   {t:'pat', slot, id, len, notes, auto}  {t:'patdel', slot, id}     an instrument's patterns
//   {t:'song', rows:[{id, len, cells:{[slot]: patternId}}], loop:'track'|'song'}
//   {t:'cue', row, wait}                   jump to a row now, keeping the place in the bar; with `wait`, switch
//                                          when the playing row ends (it shows as `next` in the tick)
//   transport may carry `row`: the row to start from when play starts
// Messages out: {t:'ready'} and ~60×/s {t:'tick', scope, devices, transport}.
// MessagePort is used everywhere for now; a SharedArrayBuffer ring comes later behind the same API.
const UI_EVERY = 6; // blocks between UI snapshots (~16 ms at 48 kHz)
const PAD_NOTE = 36; // drum machines: pad i = note 36 + i
const ACCENT = 12; // accented drum hits are sent 12 notes up

/** Deterministic hash for the Random direction (same on every client). */
function hash(n, k) {
  let h = (Math.imul(n, 2654435761) ^ Math.imul(k, 40503)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  return h >>> 0;
}

/** Which pattern step plays on tick n, for a track's length and direction. */
export function stepOf(n, len, dir, seed = 0) {
  const L = Math.max(1, len | 0);
  if (dir === 'rev') return L - 1 - (n % L);
  if (dir === 'pp') {
    if (L < 2) return 0;
    const P = 2 * L - 2;
    const k = n % P;
    return k < L ? k : P - k;
  }
  if (dir === 'rnd') return hash(n, seed) % L;
  return n % L;
}

/**
 * Main sequencer. Time is counted in 16th notes ("steps") of the global clock. Each track runs its
 * own tick counter (rate × clock); direction maps ticks to pattern steps; swing delays odd ticks.
 * Notes keep their fractional start (micro-timing) inside the step that holds them.
 */
export class Sequencer {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.playing = false;
    this.bpm = 120;
    this.swing = 0;
    // Position is derived from a whole frame count (no drift): pos = anchorPos + (frame - anchorFrame) * steps/frame.
    this.frame = 0;
    this.anchorFrame = 0;
    this.anchorPos = 0;
    this.tracks = new Map(); // slot → {len,dir,rate,own,mute,notes,auto,step}
    this.offs = []; // pending note-offs: {at (steps, global), slot, note}
    // Song: each row plays, per slot, one of that slot's patterns; a row lasts `len` steps (its longest
    // pattern), then the next row starts (loop 'song') or the same row again (loop 'track').
    this.pats = new Map(); // slot → Map(patternId → {len, notes, auto})
    this.song = null; // {rows:[{id,len,cells}], loop}
    this.row = 0; // index of the playing row
    this.rowStart = 0; // global position (steps) where it started
    this.pending = null; // id of the row to switch to when the playing one ends (cue with wait)
  }
  setPat(slot, id, p) {
    if (!this.pats.has(slot)) this.pats.set(slot, new Map());
    this.pats.get(slot).set(id, { len: Math.max(1, p.len | 0), notes: p.notes || [], auto: p.auto || {}, lens: p.lens || null });
  }
  delPat(slot, id) {
    this.pats.get(slot)?.delete(id);
  }
  setSong(song) {
    const cur = this.song?.rows[this.row]?.id;
    this.song = song && song.rows.length ? song : null;
    if (!this.song) return;
    const i = this.song.rows.findIndex((r) => r.id === cur);
    this.row = i >= 0 ? i : Math.min(this.row, this.song.rows.length - 1);
  }
  /** Jump to a row now. While playing, the new row picks up at the same place in the bar, so the beat goes on. */
  cue(row, wait = false) {
    if (!this.song) return;
    const i = Math.max(0, Math.min(this.song.rows.length - 1, row | 0));
    if (wait && this.playing) {
      this.pending = i === this.row ? null : this.song.rows[i].id; // the playing row again = cancel
      return;
    }
    this.pending = null;
    this.row = i;
    if (!this.playing) return;
    const p = this.pos;
    let into = (p - this.rowStart) % 16;
    const len = this.song.rows[this.row].len;
    if (into >= len) into %= len;
    this.rowStart = p - into;
  }
  /** What a slot plays right now: {len, notes, auto} or null (silent). */
  active(slot, t) {
    if (!this.song) return t;
    const id = this.song.rows[this.row]?.cells[slot];
    return (id != null && this.pats.get(slot)?.get(id)) || null;
  }
  get rowLen() {
    return this.song ? Math.max(1, this.song.rows[this.row]?.len || 16) : Infinity;
  }
  track(slot) {
    let t = this.tracks.get(slot);
    if (!t) {
      t = { len: 16, dir: 'fwd', rate: 1, own: false, mute: false, pmute: 0, psolo: 0, notes: [], auto: {}, step: -1 };
      this.tracks.set(slot, t);
    }
    return t;
  }
  setTrack(slot, s) {
    Object.assign(this.track(slot), s);
  }
  setPattern(slot, notes, auto) {
    const t = this.track(slot);
    t.notes = notes || [];
    t.auto = auto || {};
  }
  removeTrack(slot) {
    this.tracks.delete(slot);
    this.pats.delete(slot);
    this.offs = this.offs.filter((o) => o.slot !== slot);
  }
  /** Global position in steps at the start of the next block. */
  get pos() {
    return this.posAt(this.frame);
  }
  posAt(frame) {
    return this.anchorPos + (frame - this.anchorFrame) * this.stepsPerFrame();
  }
  setTransport({ playing, bpm, swing, row }) {
    if (bpm && bpm !== this.bpm) {
      // Tempo change keeps the current position.
      this.anchorPos = this.pos;
      this.anchorFrame = this.frame;
      this.bpm = bpm;
    }
    if (swing != null) this.swing = swing;
    if (playing != null && playing !== this.playing) {
      this.playing = playing;
      this.frame = 0;
      this.anchorFrame = 0;
      this.anchorPos = 0;
      this.rowStart = 0;
      this.pending = null;
      if (playing && row != null && this.song) this.row = Math.max(0, Math.min(this.song.rows.length - 1, row | 0));
      for (const t of this.tracks.values()) t.step = -1;
      return true; // caller flushes note-offs
    }
    return false;
  }
  stepsPerFrame() {
    return (this.bpm / 60) * 4 / this.sr;
  }
  /** Tick n of a track starts this many track-ticks after n (swing delays odd ticks). */
  swingShift(n) {
    return n % 2 === 1 ? this.swing * 0.5 : 0;
  }
  /**
   * Advance by `frames`, calling emit(frameOffset, kind, slot, a, b) for every event in this block,
   * in time order. kind: 'on' (a=note, b=vel), 'off' (a=note), 'param' (a=index, b=value).
   */
  advance(frames, emit) {
    if (!this.playing) return;
    const spf = this.stepsPerFrame();
    const p0 = this.posAt(this.frame);
    const p1 = this.posAt(this.frame + frames);
    const events = [];
    const at = (pos) => Math.min(frames - 1, Math.max(0, Math.floor((pos - p0) / spf + 1e-6)));
    // A block can cross the end of a row: play each part with the row it belongs to.
    let a = p0;
    for (let guard = 0; guard < 64 && a < p1; guard++) {
      const end = this.rowStart + this.rowLen;
      const b = Math.min(p1, end);
      if (b > a) this.collect(a, b, events);
      if (end > p1) break;
      // The row is over: a queued row, else the next one (loop song) or the same one again (loop track).
      const queued = this.pending != null && this.song ? this.song.rows.findIndex((r) => r.id === this.pending) : -1;
      this.pending = null;
      if (queued >= 0) this.row = queued;
      else if (this.song && this.song.loop === 'song') this.row = (this.row + 1) % this.song.rows.length;
      this.rowStart = end;
      a = end;
    }
    this.schedule(events, p0, p1, emit, at);
    this.frame += frames;
  }
  /** Events of the playing row between global positions a and b. Ticks count from the row's start. */
  collect(p0, p1, events) {
    const base = this.rowStart;
    for (const [slot, t] of this.tracks) {
      const pat = this.active(slot, t);
      if (!pat) {
        t.step = -1;
        continue;
      }
      const r = t.rate || 1;
      const t0 = (p0 - base) * r;
      const t1 = (p1 - base) * r;
      // Ticks whose (shifted, offset) events could fall in [t0, t1): notes sit up to 1 tick after
      // their tick start, swing adds up to half a tick.
      for (let n = Math.max(0, Math.floor(t0) - 2); n <= Math.floor(t1); n++) {
        const tickStart = n + this.swingShift(n);
        const idx = stepOf(n, pat.len, t.dir, slot + 1);
        if (tickStart >= t0 - 1e-9 && tickStart < t1 - 1e-9) {
          t.step = idx;
          for (const k in pat.auto) {
            const v = pat.auto[k]?.[idx];
            if (v != null) events.push({ pos: base + tickStart / r, kind: 'param', slot, a: Number(k), b: v });
          }
        }
        if (t.own || t.mute) continue;
        for (const note of pat.notes) {
          // Drum patterns: each pad row loops on its own length; muted / not-soloed pads are skipped.
          let ix = idx;
          if (pat.lens) {
            const pad = note.m - PAD_NOTE;
            if (pad >= 0 && pad < 32) {
              if ((t.pmute >> pad) & 1 || (t.psolo && !((t.psolo >> pad) & 1))) continue;
              ix = stepOf(n, pat.lens[pad] || pat.len, t.dir, slot + 1);
            }
          }
          if (Math.floor(note.s) !== ix) continue;
          const m = note.a ? note.m + ACCENT : note.m;
          const hits = note.r > 1 ? Math.min(4, note.r) : 1;
          const span = hits > 1 ? Math.min(note.l, 1) / hits : note.l; // a roll fits in one step
          for (let k = 0; k < hits; k++) {
            const on = tickStart + (note.s - ix) + k * span;
            if (on < t0 - 1e-9 || on >= t1 - 1e-9) continue;
            const gOn = base + on / r;
            const v = note.v * (1 - 0.1 * k);
            const hold = hits > 1 ? span * 0.9 : note.l * 0.98;
            events.push({ pos: gOn, kind: 'on', slot, a: m, b: v, off: gOn + Math.max(0.05, hold) / r });
          }
        }
      }
    }
  }
  schedule(events, p0, p1, emit, at) {
    events.sort((x, y) => x.pos - y.pos);
    const out = [];
    for (const e of events) {
      if (e.kind === 'on') {
        // A new note of the same pitch on the same track ends the one still sounding, first.
        this.offs = this.offs.filter((o) => {
          if (o.slot === e.slot && o.note === e.a && o.at > e.pos) {
            out.push({ pos: e.pos, kind: 'off', slot: o.slot, a: o.note });
            return false;
          }
          return true;
        });
        this.offs.push({ at: e.off, slot: e.slot, note: e.a });
      }
      out.push(e);
    }
    const keep = [];
    for (const o of this.offs) {
      if (o.at < p1) out.push({ pos: Math.max(p0, o.at), kind: 'off', slot: o.slot, a: o.note });
      else keep.push(o);
    }
    this.offs = keep;
    // Stable order: by time, and at equal times offs before ons (so retriggers work).
    out.sort((x, y) => x.pos - y.pos || (x.kind === 'off' ? 0 : 1) - (y.kind === 'off' ? 0 : 1));
    for (const e of out) emit(at(e.pos), e.kind, e.slot, e.a, e.b);
  }
  /** All pending note-offs now (used on stop). */
  flush(emit) {
    for (const o of this.offs) emit(0, 'off', o.slot, o.note);
    this.offs = [];
  }
}

const Processor = globalThis.AudioWorkletProcessor ?? class {};

class FwmEngine extends Processor {
  constructor(options) {
    super();
    const { wasm, slots = [] } = options.processorOptions;
    this.x = new WebAssembly.Instance(new WebAssembly.Module(wasm), {}).exports;
    this.x.fwm_init(sampleRate);
    this.slots = new Set();
    this.seq = new Sequencer(sampleRate);
    this.base = new Map(); // slot → Map(paramIndex → value) last set by the UI (restored on stop)
    for (const s of slots) this.add(s.slot, s.kind);
    this.n = 0;
    this.port.onmessage = (e) => this.msg(e.data);
    this.port.postMessage({ t: 'ready', sampleRate });
  }
  add(slot, kind) {
    if (this.x.fwm_add_device(slot, kind)) this.slots.add(slot);
  }
  emit = (frame, kind, slot, a, b) => {
    const x = this.x;
    if (kind === 'on') x.fwm_note_on(slot, frame, a, b);
    else if (kind === 'off') x.fwm_note_off(slot, frame, a);
    else if (kind === 'param') x.fwm_param(slot, frame, a, b);
  };
  msg(m) {
    const x = this.x;
    switch (m.t) {
      case 'add': this.add(m.slot, m.kind); break;
      case 'remove': x.fwm_remove_device(m.slot); this.slots.delete(m.slot); this.seq.removeTrack(m.slot); this.base.delete(m.slot); break;
      case 'on': x.fwm_note_on(m.slot, 0, m.note, m.vel ?? 0.8); break;
      case 'off': x.fwm_note_off(m.slot, 0, m.note); break;
      case 'allOff': x.fwm_all_off(m.slot); break;
      case 'param': {
        x.fwm_param(m.slot, 0, m.i, m.v);
        if (!this.base.has(m.slot)) this.base.set(m.slot, new Map());
        this.base.get(m.slot).set(m.i, m.v);
        break;
      }
      case 'route': {
        const r = x.fwm_set_route(m.slot, m.r, m.src, m.target, m.depth);
        if (r !== 0) this.port.postMessage({ t: 'routeRejected', slot: m.slot, r: m.r, code: r });
        break;
      }
      case 'unroute': x.fwm_clear_route(m.slot, m.r); break;
      case 'transport': {
        const wasPlaying = this.seq.playing;
        if (this.seq.setTransport(m)) {
          this.seq.flush(this.emit);
          if (wasPlaying) this.restoreAutomated();
        }
        break;
      }
      case 'track': this.seq.setTrack(m.slot, m); break;
      case 'pattern': this.seq.setPattern(m.slot, m.notes, m.auto); break;
      case 'pat': this.seq.setPat(m.slot, m.id, m); break;
      case 'patdel': this.seq.delPat(m.slot, m.id); break;
      case 'song': this.seq.setSong(m.song); break;
      case 'cue': this.seq.cue(m.row, m.wait); break;
    }
  }
  /** After playback, knobs go back to where the users left them (automation only applies while playing). */
  restoreAutomated() {
    for (const [slot, t] of this.seq.tracks) {
      const base = this.base.get(slot);
      if (!base) continue;
      const autos = [t.auto, ...[...(this.seq.pats.get(slot)?.values() ?? [])].map((p) => p.auto)];
      for (const auto of autos) for (const k in auto) if (base.has(Number(k))) this.x.fwm_param(slot, 0, Number(k), base.get(Number(k)));
    }
  }
  view(ptr, len) {
    return new Float32Array(this.x.memory.buffer, ptr, len);
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    const frames = out[0].length;
    const x = this.x;
    this.seq.advance(frames, this.emit);
    x.fwm_render(frames);
    out[0].set(this.view(x.fwm_out_l(), frames));
    if (out[1]) out[1].set(this.view(x.fwm_out_r(), frames));
    if (++this.n % UI_EVERY === 0) this.snapshot();
    return true;
  }
  snapshot() {
    const x = this.x;
    const len = x.fwm_scope_len();
    const ring = this.view(x.fwm_scope(), len);
    const pos = x.fwm_scope_pos();
    const scope = new Float32Array(len); // oldest → newest
    scope.set(ring.subarray(pos), 0);
    scope.set(ring.subarray(0, pos), len - pos);
    const devices = {};
    for (const s of this.slots) {
      const n = x.fwm_param_count(s);
      devices[s] = {
        eff: this.view(x.fwm_effective(s), n).slice(),
        mods: [x.fwm_mod_source(s, 0), x.fwm_mod_source(s, 1), x.fwm_mod_source(s, 2)],
        step: this.seq.tracks.get(s)?.step ?? -1,
      };
    }
    const sq = this.seq;
    const transport = {
      playing: sq.playing, pos: sq.pos, bpm: sq.bpm, time: currentTime,
      row: sq.song ? sq.song.rows[sq.row]?.id ?? null : null, rowPos: sq.playing && sq.song ? sq.pos - sq.rowStart : 0,
      next: sq.pending,
    };
    this.port.postMessage({ t: 'tick', scope, devices, transport }, [scope.buffer]);
  }
}

if (typeof registerProcessor === 'function') registerProcessor('fwm-engine', FwmEngine);
