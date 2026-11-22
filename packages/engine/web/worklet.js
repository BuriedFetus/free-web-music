// free-web-music engine: AudioWorklet side. Runs the Rust/WASM rack on the audio thread.
// Messages in (port): {t:'add',slot,kind} {t:'on',slot,note,vel} {t:'off',slot,note} {t:'allOff',slot}
//                     {t:'param',slot,i,v} {t:'route',slot,r,src,target,depth} {t:'unroute',slot,r}
// Messages out: {t:'ready'} and, about 60 times a second, {t:'tick',scope,eff,mods} for the UI.
// Phase 1 uses this MessagePort path everywhere; the SharedArrayBuffer ring (when the page is
// cross-origin isolated) comes later behind the same message API.
const UI_EVERY = 6; // blocks between UI snapshots (~16 ms at 48 kHz)

class FwmEngine extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { wasm, slots = [] } = options.processorOptions;
    this.x = new WebAssembly.Instance(new WebAssembly.Module(wasm), {}).exports;
    this.x.fwm_init(sampleRate);
    this.slots = new Set();
    for (const s of slots) this.add(s.slot, s.kind);
    this.n = 0;
    this.port.onmessage = (e) => this.msg(e.data);
    this.port.postMessage({ t: 'ready', sampleRate });
  }
  add(slot, kind) {
    if (this.x.fwm_add_device(slot, kind)) this.slots.add(slot);
  }
  msg(m) {
    const x = this.x;
    switch (m.t) {
      case 'add': this.add(m.slot, m.kind); break;
      case 'remove': x.fwm_remove_device(m.slot); this.slots.delete(m.slot); break;
      case 'on': x.fwm_note_on(m.slot, 0, m.note, m.vel ?? 0.8); break;
      case 'off': x.fwm_note_off(m.slot, 0, m.note); break;
      case 'allOff': x.fwm_all_off(m.slot); break;
      case 'param': x.fwm_param(m.slot, 0, m.i, m.v); break;
      case 'route': {
        const r = x.fwm_set_route(m.slot, m.r, m.src, m.target, m.depth);
        if (r !== 0) this.port.postMessage({ t: 'routeRejected', slot: m.slot, r: m.r, code: r });
        break;
      }
      case 'unroute': x.fwm_clear_route(m.slot, m.r); break;
    }
  }
  view(ptr, len) {
    return new Float32Array(this.x.memory.buffer, ptr, len);
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    const frames = out[0].length;
    const x = this.x;
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
      };
    }
    this.port.postMessage({ t: 'tick', scope, devices }, [scope.buffer]);
  }
}

registerProcessor('fwm-engine', FwmEngine);
