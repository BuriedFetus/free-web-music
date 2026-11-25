// free-web-music engine: main-thread host. Plain ES module (no build step), used by the design
// kit directly and by @fwm/studio through a bundler.
//
//   const engine = await createEngine();
//   engine.add(0, 'basalt');
//   engine.noteOn(0, 48, 0.9); engine.setParam(0, 'cut', 0.6);
//   const stop = engine.subscribe(({ scope, devices }) => { ... });  // ~60×/s for the UI
//
// Parameters are addressed by id; ids, order and ranges come from devices/<id>.json.
// The worklet and WASM files are found next to this module (`new URL(..., import.meta.url)`,
// which Vite, webpack 5 and Rollup all understand), or under `base` if given.

export const KINDS = { basalt: 1, flint: 2 };
export const MOD_SOURCES = { lfo: 0, amp: 1, filt: 2 };
/** Mixer strip settings. level: 0..1 (0.8 = 0 dB), pan: -1..1, mute: 0/1, sendA / sendB: 0..1. */
export const MIX = { level: 0, pan: 1, mute: 2, sendA: 3, sendB: 4 };
/** Peak meter index of the master in `tick.meters` (L; R is the next one). */
export const MASTER_METER = 32;

const DEFAULT_URLS = () => ({
  wasm: new URL('./fwm_engine.wasm', import.meta.url).href,
  worklet: new URL('./worklet.js', import.meta.url).href,
  basalt: new URL('./basalt.json', import.meta.url).href,
  flint: new URL('./flint.json', import.meta.url).href,
});

export async function createEngine({ base, context, manifests } = {}) {
  const ctx = context || new AudioContext({ latencyHint: 'interactive' });
  const urls = base
    ? Object.fromEntries(
        Object.entries({ wasm: 'fwm_engine.wasm', worklet: 'worklet.js', basalt: 'basalt.json', flint: 'flint.json' }).map(([k, f]) => [
          k,
          new URL(f, new URL(base, location.href)).href,
        ]),
      )
    : DEFAULT_URLS();
  const loadManifest = async (m) => (typeof m === 'object' ? m : (await fetch(m)).json());
  const [wasm, basalt, flint] = await Promise.all([
    fetch(urls.wasm).then((r) => {
      if (!r.ok) throw new Error('engine wasm: HTTP ' + r.status);
      return r.arrayBuffer();
    }),
    loadManifest(manifests?.basalt ?? urls.basalt),
    loadManifest(manifests?.flint ?? urls.flint),
  ]);
  const manifest = { basalt, flint };
  await ctx.audioWorklet.addModule(urls.worklet);
  const node = new AudioWorkletNode(ctx, 'fwm-engine', {
    numberOfInputs: 0,
    outputChannelCount: [2],
    processorOptions: { wasm },
  });
  node.connect(ctx.destination);

  const slots = new Map(); // slot → device id
  const listeners = new Set();
  // Page time (performance.now(), ms) ↔ audio time (context seconds), for the moment a sample is
  // HEARD: getOutputTimestamp includes the output latency, so two computers that start "at the same
  // page time" sound together. Median of recent readings, so one odd reading can't move it.
  const ks = [];
  let k = null;
  const sampleClock = () => {
    const ts = ctx.getOutputTimestamp?.();
    const v = ts && ts.performanceTime > 0 && ts.contextTime > 0
      ? ts.contextTime - ts.performanceTime / 1000
      : ctx.currentTime - performance.now() / 1000 - (ctx.baseLatency || 0) - (ctx.outputLatency || 0);
    ks.push(v);
    if (ks.length > 31) ks.shift();
    k = [...ks].sort((a, b) => a - b)[ks.length >> 1];
  };
  const ctxAt = (ms) => {
    if (k == null) sampleClock();
    return k + ms / 1000;
  };
  const ready = new Promise((res) => {
    node.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'ready') res();
      else if (m.t === 'tick') {
        sampleClock();
        engine.last = m;
        engine.onTick?.(m);
        for (const fn of listeners) fn(m);
      } else if (m.t === 'routeRejected') console.warn('engine: route rejected', m);
    };
  });
  const send = (m) => node.port.postMessage(m);
  const index = (slot, id) => {
    const params = manifest[slots.get(slot)]?.params || [];
    const i = params.findIndex((p) => p.id === id);
    if (i < 0) throw new Error(`unknown param ${id}`);
    return i;
  };

  const engine = {
    context: ctx,
    node,
    manifest,
    last: null,
    onTick: null,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    add(slot, deviceId) {
      slots.set(slot, deviceId);
      send({ t: 'add', slot, kind: KINDS[deviceId] });
    },
    remove(slot) {
      slots.delete(slot);
      send({ t: 'remove', slot });
    },
    noteOn(slot, note, vel = 0.8) {
      send({ t: 'on', slot, note, vel });
    },
    noteOff(slot, note) {
      send({ t: 'off', slot, note });
    },
    /** Other people's live keys and knob turns: at page time `at` (performance.now() ms), to the sample. */
    noteOnAt(slot, note, vel, at) {
      send({ t: 'at', at: ctxAt(at), m: { t: 'on', slot, note, vel } });
    },
    noteOffAt(slot, note, at) {
      send({ t: 'at', at: ctxAt(at), m: { t: 'off', slot, note } });
    },
    setParamAt(slot, id, value, at) {
      send({ t: 'at', at: ctxAt(at), m: { t: 'param', slot, i: index(slot, id), v: value } });
    },
    allOff(slot) {
      send({ t: 'allOff', slot });
    },
    /** value is normalised 0..1 (enums: the option index) */
    setParam(slot, id, value) {
      send({ t: 'param', slot, i: index(slot, id), v: value });
    },
    paramIndex: index,
    setRoute(slot, r, src, target, depth) {
      send({ t: 'route', slot, r, src: MOD_SOURCES[src], target: index(slot, target), depth });
    },
    clearRoute(slot, r) {
      send({ t: 'unroute', slot, r });
    },
    /** Main sequencer: play/stop (restarts from bar 1, from song row `row`), tempo, swing (0..0.6). */
    setTransport({ playing, bpm, swing, row }) {
      send({ t: 'transport', playing, bpm, swing, row });
    },
    /**
     * Shared transport: start so that song row `row` is `pos` steps in at page time `at`
     * (performance.now() ms; in the future = start exactly then, in the past = join mid-row).
     */
    playAt(row, pos, at) {
      send({ t: 'transport', playing: true, row, pos, at: ctxAt(at) });
    },
    /** While playing: move so that row `row` is `pos` steps in at page time `at` (drift correction). */
    seek(row, pos, at) {
      send({ t: 'seek', row, pos, at: ctxAt(at) });
    },
    /** Audio time (context seconds) heard at page time `ms`. */
    contextTime: ctxAt,
    /** Song row (id), position in it (steps) and the queued row, heard at page time `at`; null when stopped. */
    where(at) {
      const tr = engine.last?.transport;
      if (!tr || !tr.playing || tr.row == null) return null;
      const spm = (tr.bpm / 60) * 4 / 1000;
      return { row: tr.row, pos: tr.rowPos + (ctxAt(at) - tr.time) * 1000 * spm, next: tr.next ?? null, stepsPerMs: spm };
    },
    /** Mixer strip of a slot: e.g. setMix(0, { level: 0.8, pan: 0, mute: false }). Gains glide, no clicks. */
    setMix(slot, settings) {
      for (const k in settings) if (k in MIX) send({ t: 'mix', slot, p: MIX[k], v: Number(settings[k]) });
    },
    /** Master: setMaster({ level }). */
    setMaster(settings) {
      if (settings.level != null) send({ t: 'master', p: 0, v: settings.level });
    },
    /** Song mode: one of a slot's patterns, {len, notes, auto: {paramId: (value|null)[]}}. */
    setPat(slot, id, { len, notes, auto = {}, lens }) {
      const byIndex = {};
      for (const k in auto) byIndex[index(slot, k)] = auto[k];
      send({ t: 'pat', slot, id, len, notes, auto: byIndex, lens });
    },
    deletePat(slot, id) {
      send({ t: 'patdel', slot, id });
    },
    /** Song mode: rows [{id, len, cells: {slot: patternId}}] and loop 'track' | 'song' (null = no song). */
    setSong(song) {
      send({ t: 'song', song });
    },
    /** Jump to song row `row` now (keeps the place in the bar while playing), or with `wait` when the playing row ends. */
    cue(row, wait = false) {
      send({ t: 'cue', row, wait });
    },
    /** Per-track sequencer settings: len 1..16, dir fwd|rev|pp|rnd, rate 0.5|1|2, own, mute. */
    setTrack(slot, settings) {
      send({ t: 'track', slot, ...settings });
    },
    /** Notes [{s,l,m,v}] (s, l in steps, may be fractional) and automation {paramId: (value|null)[16]}. */
    setPattern(slot, notes, auto = {}) {
      const byIndex = {};
      for (const id in auto) byIndex[index(slot, id)] = auto[id];
      send({ t: 'pattern', slot, notes, auto: byIndex });
    },
    /** Estimated transport position in steps right now (between ticks), or null when stopped. */
    position() {
      const tr = engine.last?.transport;
      if (!tr || !tr.playing) return null;
      return tr.pos + (ctx.currentTime - tr.time) * (tr.bpm / 60) * 4;
    },
    /** Song row playing now and the estimated position inside it (steps), or null when stopped. */
    rowPosition() {
      const tr = engine.last?.transport;
      if (!tr || !tr.playing || tr.row == null) return null;
      return { row: tr.row, pos: tr.rowPos + (ctx.currentTime - tr.time) * (tr.bpm / 60) * 4 };
    },
    resume() {
      return ctx.resume();
    },
    suspend() {
      return ctx.suspend();
    },
    latency() {
      return { base: ctx.baseLatency || 0, output: ctx.outputLatency || 0 };
    },
  };
  // An OfflineAudioContext only starts the worklet when rendering starts, so don't wait there.
  if (typeof OfflineAudioContext === 'undefined' || !(ctx instanceof OfflineAudioContext)) await ready;
  return engine;
}
