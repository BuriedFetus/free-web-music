// free-web-music engine: main-thread host. Plain ES module (no build step), used by the design
// kit today and wrapped by the React package later.
//
//   const engine = await createEngine({ base: 'engine/' });
//   engine.add(0, 'basalt');
//   engine.noteOn(0, 48, 0.9); engine.setParam(0, 'cut', 0.6);
//   engine.onTick = ({ scope, devices }) => { ... };   // ~60×/s: waveform + modulated values
//
// Parameters are addressed by id; the ids, order and ranges come from devices/<id>.json.

export const KINDS = { basalt: 1 };
export const MOD_SOURCES = { lfo: 0, amp: 1, filt: 2 };

export async function createEngine({ base = './', context, manifests = { basalt: 'basalt.json' } } = {}) {
  const ctx = context || new AudioContext({ latencyHint: 'interactive' });
  const url = (f) => new URL(f, new URL(base, location.href)).href;
  const [wasm, ...mans] = await Promise.all([
    fetch(url('fwm_engine.wasm')).then((r) => { if (!r.ok) throw new Error('engine wasm: ' + r.status); return r.arrayBuffer(); }),
    ...Object.values(manifests).map((f) => fetch(url(f)).then((r) => r.json())),
  ]);
  const manifest = Object.fromEntries(mans.map((m) => [m.id, m]));
  await ctx.audioWorklet.addModule(url('worklet.js'));
  const node = new AudioWorkletNode(ctx, 'fwm-engine', {
    numberOfInputs: 0,
    outputChannelCount: [2],
    processorOptions: { wasm },
  });
  node.connect(ctx.destination);

  const slots = new Map(); // slot → device id
  const ready = new Promise((res) => {
    node.port.onmessage = (e) => {
      const m = e.data;
      if (m.t === 'ready') res();
      else if (m.t === 'tick') engine.onTick?.(m);
      else if (m.t === 'routeRejected') console.warn('engine: route rejected', m);
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
    manifest,
    onTick: null,
    add(slot, deviceId) {
      slots.set(slot, deviceId);
      send({ t: 'add', slot, kind: KINDS[deviceId] });
    },
    remove(slot) { slots.delete(slot); send({ t: 'remove', slot }); },
    noteOn(slot, note, vel = 0.8) { send({ t: 'on', slot, note, vel }); },
    noteOff(slot, note) { send({ t: 'off', slot, note }); },
    allOff(slot) { send({ t: 'allOff', slot }); },
    /** value is normalised 0..1 (enums: the option index) */
    setParam(slot, id, value) { send({ t: 'param', slot, i: index(slot, id), v: value }); },
    paramIndex: index,
    setRoute(slot, r, src, target, depth) {
      send({ t: 'route', slot, r, src: MOD_SOURCES[src], target: index(slot, target), depth });
    },
    clearRoute(slot, r) { send({ t: 'unroute', slot, r }); },
    resume() { return ctx.resume(); },
    latency() { return { base: ctx.baseLatency || 0, output: ctx.outputLatency || 0 }; },
  };
  // An OfflineAudioContext only starts the worklet when rendering starts, so don't wait for it there.
  if (typeof OfflineAudioContext === 'undefined' || !(ctx instanceof OfflineAudioContext)) await ready;
  return engine;
}
