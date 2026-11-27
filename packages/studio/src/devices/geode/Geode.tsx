// Geode: a sampler with a little room in it, for people who have never made music. The front is Mica's
// room (see room.ts) with a dock of big icons at the bottom centre that never goes away; each opens one
// simple control. Mica's face opens her memory: record any instrument in the session into it (up to
// 30 s), trim it, remove it, play it, choose how it plays. The back of the device (every knob behind
// the macros, the Temperature scales, the compressor, modulation) is hidden: ?geodeback shows its handle.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { Engine, ModSourceId } from '@fwm/engine';
import { useEngine } from '../../engine/EngineProvider';
import { useDeviceState, useDeviceSync } from '../../engine/useDeviceSync';
import { demoTape, finishRecording, fromPcm, makeTape, MAX_SECONDS, type Tape } from '../../model/sampleStore';
import { useDeviceTokens, usePrimitives } from '../../theme/Theme';
import { ParamKnob, type DeviceProps, type ParamCtx } from '../basalt/Basalt';
import { defaultsOf } from '../garnet/Garnet';
import { ModRow, useAssign } from '../ModRow';
import { PanelKeys } from '../PanelKeys';
import { Sends } from '../Sends';
import { GEODE_FORMAT, GEODE_PRESETS, fmtOf } from './presets';
import { readPalette, RoomPainter, tapePeaks, type Palette, type RoomInput } from './room';
import type { GeodeHost } from './types';

const SRC_LABEL: Record<ModSourceId, string> = { lfo: 'Motion', amp: 'Breath env', filt: '—' };
const DIVS = [1 / 16, 1 / 8, 3 / 16, 1 / 4, 1 / 2];
const BANDS = ['FREEZING', 'CHILL', 'WARM', 'HOT'];
const MT = [['Window', 1], ['Pitch', 2], ['Pan', 4], ['Grain position', 8], ['Echo', 16], ['Room', 32], ['Crunch', 64]] as const;
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
/** Pointer capture, when the pointer is a real one (tests send synthetic pointers). */
const capture = (ev: { currentTarget: Element; pointerId: number }) => {
  try {
    ev.currentTarget.setPointerCapture(ev.pointerId);
  } catch {
    /* not an active pointer */
  }
};
const sstep01 = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** The door, fully open: the Reverb and Delay sends it sets (the Delay joins from a quarter open). */
const DOOR_REV = 0.8, DOOR_DLY = 0.5;
const placeX = (v: number) => (clamp(v) * 2 - 1) * 0.85;
const placeZ = (v: number) => 0.25 + clamp(v) * 1.95;

// Line-art icons (stroke = the text colour).
const ICONS: Record<string, ReactNode> = {
  mica: (<svg viewBox="0 0 32 32"><path d="M16 4 25 10v11l-9 7-9-7V10z" /><circle cx="12.5" cy="15" r="1.3" fill="currentColor" /><circle cx="19.5" cy="15" r="1.3" fill="currentColor" /><path d="M13 20q3 2 6 0" /></svg>),
  temp: (<svg viewBox="0 0 32 32"><path d="M13 19V6a3 3 0 0 1 6 0v13a6 6 0 1 1-6 0z" /><path d="M16 22V11" /><circle cx="16" cy="24" r="2.5" fill="currentColor" /></svg>),
  fan: (<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="2" /><path className="fwm-geode__blades" d="M16 14q-1-8 5-9 2 5-5 9zM18 16q8-1 9 5-5 2-9-5zM16 18q1 8-5 9-2-5 5-9zM14 16q-8 1-9-5 5-2 9 5z" /></svg>),
  room: (<svg viewBox="0 0 32 32"><path d="M4 6h24v20H4zM11 12h10v8H11zM4 6l7 6M28 6l-7 6M4 26l7-6M28 26l-7-6" /></svg>),
  echo: (<svg viewBox="0 0 32 32"><path d="M27 5v22" /><path d="M5 16q3-6 6 0t6 0t6 0" /><path d="M23 10l-3 2M23 22l-3-2" /></svg>),
  breath: (<svg viewBox="0 0 32 32"><ellipse cx="11" cy="16" rx="4" ry="6" /><path d="M18 13q4-2 8 0M18 19q4 2 8 0M19 16h8" /></svg>),
  lamp: (<svg viewBox="0 0 32 32"><path d="M16 3v6M9 16l3-7h8l3 7z" /><path d="M13 19q3 3 6 0" /><path d="M8 25l3-3M24 25l-3-3M16 28v-4" /></svg>),
  grains: (<svg viewBox="0 0 32 32"><path d="M16 5l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" /><circle cx="25" cy="25" r="1.4" fill="currentColor" /><circle cx="7" cy="25" r="1" fill="currentColor" /><circle cx="25" cy="6" r="1" fill="currentColor" /></svg>),
  crunch: (<svg viewBox="0 0 32 32"><path d="M6 22h5v-5h5v-5h5v-5h5M6 26h20" /></svg>),
  motion: (<svg viewBox="0 0 32 32"><path d="M4 16q4-9 8 0t8 0t8 0" /><path d="M24 7l4 3-4 3M8 25l-4-3 4-3" /></svg>),
  trim: (<svg viewBox="0 0 32 32"><circle cx="9" cy="23" r="4" /><circle cx="23" cy="23" r="4" /><path d="M12 20 24 5M20 20 8 5" /></svg>),
  trash: (<svg viewBox="0 0 32 32"><path d="M7 9h18M12 9V6h8v3M9 9l1.5 18h11L23 9M14 13v10M18 13v10" /></svg>),
  play: (<svg viewBox="0 0 32 32"><path d="M11 8l13 8-13 8z" /></svg>),
  stop: (<svg viewBox="0 0 32 32"><path d="M10 10h12v12H10z" /></svg>),
  rec: (<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="8" fill="currentColor" /></svg>),
  file: (<svg viewBox="0 0 32 32"><path d="M9 4h10l6 6v18H9z" /><path d="M19 4v6h6" /><path d="M14 23V15l6-2v8" /><circle cx="12.5" cy="23" r="1.6" /><circle cx="18.5" cy="21" r="1.6" /></svg>),
  demo: (<svg viewBox="0 0 32 32"><rect x="5" y="9" width="22" height="14" rx="2" /><circle cx="11" cy="16" r="3" /><circle cx="21" cy="16" r="3" /><path d="M11 13h10" /></svg>),
};
/** What dragging a dock icon up / down sets. */
const DRAG: Record<string, string> = { temp: 'temp', fan: 'air', room: 'wet', echo: 'ewet', breath: 'breath', lamp: 'light', grains: 'grains', crunch: 'crunch', motion: 'mdepth' };
const DOCK: [string, string][] = [['mica', 'Mica'], ['motion', 'Motion'], ['temp', 'Temp'], ['fan', 'Air'], ['room', 'Room'], ['echo', 'Echo'], ['breath', 'Breath'], ['lamp', 'Light'], ['grains', 'Grains'], ['crunch', 'Crunch']];

/** Standalone (no studio): a tape kept in the panel, the demo tape only. */
function useLocalTape(engine: Engine | null, slot: number, enabled: boolean): GeodeHost {
  const [tape, setTape] = useState<Tape | null>(null);
  const [ver, setVer] = useState(0);
  const fns = useRef(new Set<() => void>());
  useEffect(() => {
    if (!enabled || !engine) return;
    const sr = engine.context.sampleRate;
    if (!tape) void engine.setSample(slot, new Float32Array(0));
    else {
      const { l, r } = fromPcm(tape);
      void engine.setSample(slot, l, tape.ch === 2 ? r : undefined);
    }
    void sr;
  }, [engine, slot, tape, enabled]);
  useEffect(() => {
    for (const f of fns.current) f();
  }, [ver]);
  return useMemo<GeodeHost>(
    () => ({
      status: tape ? { state: 'ready', meta: tape } : { state: 'empty' },
      rec: null,
      busy: false,
      inputs: [],
      record: () => {},
      stop: () => {},
      demo: () => {
        setTape(demoTape(engine?.context.sampleRate ?? 48000));
        setVer((v) => v + 1);
      },
      file: async (f) => {
        const ctx = engine?.context ?? new OfflineAudioContext(2, 1, 48000);
        const buf = await ctx.decodeAudioData(await f.arrayBuffer()).catch(() => null);
        if (!buf) return;
        const n = Math.min(buf.length, MAX_SECONDS * buf.sampleRate);
        const kept = finishRecording(buf.getChannelData(0).slice(0, n), (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice(0, n), buf.sampleRate);
        if (!kept) return;
        setTape(makeTape(kept.l, kept.r, buf.sampleRate, f.name));
        setVer((v) => v + 1);
      },
      clear: () => {
        setTape(null);
        setVer((v) => v + 1);
      },
      tape: () => tape,
      subscribe: (fn) => {
        fns.current.add(fn);
        return () => void fns.current.delete(fn);
      },
      version: () => ver,
    }),
    [tape, ver, engine],
  );
}

export function Geode({ store, host, slot, user = { name: 'You', color: 'var(--fwm-me)' } }: DeviceProps) {
  const { engine, status, start } = useEngine();
  const P = usePrimitives();
  const tokens = useDeviceTokens('geode');
  const state = useDeviceState(store);
  useDeviceSync(host ? null : engine, store, slot, 'geode');
  const live = status === 'on' ? engine : null;
  const local = useLocalTape(live, slot, !host); // standalone only (in the studio the host has the tape; in the manual it is a picture)
  const g = host?.geode ?? local;
  useSyncExternalStore(g.subscribe, g.version, g.version);
  const m = store.manifest;
  const IX = useMemo(() => Object.fromEntries(m.params.map((p, i) => [p.id, i])) as Record<string, number>, [m]);
  const spec = (id: string) => m.params[IX[id]];
  const pv = (id: string) => state.params[id] ?? spec(id).default;
  const set = useCallback(
    (id: string, v: number) => {
      store.setParam(id, v);
      host?.paramChanged?.(id, v);
    },
    [store, host],
  );
  const touch = (id: string | null) => host?.touch(id);
  const people = host?.people ?? [{ userId: 'me', name: user.name, color: user.color }];
  const [assign, setAssign] = useAssign();
  const ctx: ParamCtx = { store, slot, assign, setAssign, host };

  const presetIx = state.preset % GEODE_PRESETS.length;
  const edited = Object.entries({ ...defaultsOf(store), ...GEODE_PRESETS[presetIx].params }).some(([id, v]) => Math.abs((state.params[id] ?? 0) - v) > 1e-6);
  const loadPreset = (i: number) => {
    const n = (i + GEODE_PRESETS.length) % GEODE_PRESETS.length;
    // a starting point never moves Mica or her tape trim
    const cur = store.getState().params; // now, not as of the last render (a peer may have just moved her)
    const keep = { px: cur.px, pz: cur.pz, start: cur.start, end: cur.end };
    store.load({ ...GEODE_PRESETS[n], params: { ...GEODE_PRESETS[n].params, ...keep } }, n);
  };

  // ---- what's open ----
  const [pop, setPop] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const [trimOpen, setTrimOpen] = useState(false);
  const debug = typeof location !== 'undefined' && /[?&](geodeback|debug)(=|&|$)/.test(location.search);
  const [back, setBack] = useState(false);
  const rec = g.rec;
  useEffect(() => {
    if (rec) setZoom(true);
  }, [rec?.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const [input, setInput] = useState<string>('');
  const inputs = g.inputs;
  const inputId = inputs.some((i) => i.id === input) ? input : (inputs[0]?.id ?? '');
  const tape = g.tape();
  const fileIn = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  // Escape closes what is open (pop-up, Mica's memory)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPop(null);
      setZoom(false);
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  const peaks = useMemo(() => (tape ? tapePeaks(tape.pcm, tape.frames, 400) : null), [tape?.hash]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the room ----
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const painter = useRef<RoomPainter | null>(null);
  const pal = useRef<Palette | null>(null);
  // the door is the SEND knobs (the song's shared Reverb and Delay); without a host it is only a picture
  const [doorLocal, setDoorLocal] = useState(0);
  const door = host?.sends ? clamp(host.sends.rev / DOOR_REV) : doorLocal;
  const setDoor = (v: number) => {
    const d = clamp(v);
    if (host?.sends) {
      host.sends.set('rev', d * DOOR_REV);
      host.sends.set('dly', sstep01(0.25, 1, d) * DOOR_DLY);
    } else setDoorLocal(d);
  };
  const live$ = useRef({ params: state.params, zoom, rec, peaks, tape, door, drag: null as null | { x: number; z: number }, engine: live, slot, lastTick: null as unknown });
  live$.current = { ...live$.current, params: state.params, zoom, rec, peaks, tape, door, engine: live, slot };
  const hud = useRef<{ t: HTMLElement | null; r: HTMLElement | null; th: SVGRectElement | null; bulb: SVGCircleElement | null }>({ t: null, r: null, th: null, bulb: null });
  useEffect(() => {
    const canvas = cv.current;
    const el = wrap.current;
    if (!canvas || !el) return;
    pal.current = readPalette(el);
    const pt = new RoomPainter(canvas, pal.current);
    painter.current = pt;
    (canvas as HTMLCanvasElement & { fwmRoom?: RoomPainter }).fwmRoom = pt; // tests find the objects through it
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => pt.size()) : null;
    ro?.observe(canvas);
    pt.size();
    let raf = 0;
    let last = performance.now();
    let n = 0;
    const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const still = !!host?.preview; // a picture in the manual: a couple of frames a second is plenty
    let lastDraw = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (still && now - lastDraw < 500) return;
      lastDraw = now;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (++n % 120 === 0) pt.pal = pal.current = readPalette(el); // a look or skin may have changed
      const L = live$.current;
      const tick = L.engine?.last;
      const d = tick?.devices[L.slot];
      const e = d?.eff;
      const has = !!e && e.length === m.params.length;
      const val = (id: string) => (has ? e![IX[id]] : (L.params[id] ?? m.params[IX[id]].default));
      const viz = d?.viz;
      const voices: [number, number][] = [];
      if (viz) for (let k = 0; k < 8; k++) voices.push([viz[3 + k * 2], viz[4 + k * 2]]);
      const events: [number, number][] = [];
      if (viz && tick !== L.lastTick) {
        const b = 19;
        for (let k = 0; k < Math.min(32, viz[b]); k++) events.push([viz[b + 1 + k * 2], viz[b + 2 + k * 2]]);
      }
      L.lastTick = tick;
      const bpm = tick?.transport.bpm ?? 120;
      const mdepth = val('mdepth');
      const input: RoomInput = {
        eased: has,
        temp: val('temp'), air: val('air'), room: val('room'), light: val('light'), grains: val('grains'), gsize: val('gsize'), spread: val('spread'),
        crunch: val('crunch'), drive: val('drive'), sway: val('sway'), decay: val('decay'), wet: val('wet'), echoWet: val('ewet'), fb: val('fb'),
        echoSec: (DIVS[Math.round(L.params.div ?? 2)] ?? 0.1875) * 4 * 60 / bpm,
        start: val('start'), end: Math.max(val('start') + 0.01, val('end')), pos: val('pos'),
        motion: viz ? viz[1] : 0, moving: mdepth > 0.01,
        x: L.drag?.x ?? placeX(val('px')), z: L.drag?.z ?? placeZ(val('pz')),
        voices, aud: viz ? viz[0] : -1, events,
        tape: L.peaks && L.tape ? { peaks: L.peaks, name: L.tape.name, secs: L.tape.frames / L.tape.sr } : null,
        rec: L.rec ? { phase: L.rec.phase, secs: L.rec.secs } : null,
        zoom: L.zoom, reduceMotion: !!reduce?.matches,
        rug: val('rug'), width: val('width'), door: L.door, rev: Math.round(L.params.mode ?? 0) === 1,
      };
      pt.frame(input, now / 1000, dt);
      // HUD and the thermometer follow the eased values
      const t = input.temp;
      const h = hud.current;
      if (h.t) h.t.textContent = BANDS[Math.min(3, Math.floor(t * 3.999))];
      if (h.r) h.r.textContent = GEODE_FORMAT.room(input.room);
      if (h.th) {
        const hh = 160 * t;
        h.th.setAttribute('y', String(180 - hh));
        h.th.setAttribute('height', String(hh + 6));
      }
      el.style.setProperty('--geode-t', String(t));
      el.style.setProperty('--geode-air', String(input.air));
      // what you hear right now, on every slider and dock icon (macros and Motion move it, not only your hand)
      for (const n of el.querySelectorAll<HTMLElement>('[data-eff]')) {
        const id = n.dataset.eff!;
        if (IX[id] == null) continue;
        const v = val(id);
        n.style.setProperty('--eff', v.toFixed(4));
        const o = n.querySelector<HTMLElement>('.fwm-geode__val');
        if (o) o.textContent = fmtOf(id, m.params[IX[id]])(v);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [m, IX]);

  // ---- pointer in the room: drag Mica (pan, distance), pick a place on the film strip ----
  const onDown = (ev: RPointerEvent<HTMLCanvasElement>) => {
    const pt = painter.current;
    if (!pt) return;
    if (status !== 'on' && status !== 'loading') void start();
    const r = ev.currentTarget.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    if (pt.hitMica(px, py)) {
      capture(ev);
      ev.currentTarget.style.cursor = 'grabbing';
      touch('px');
      const x0 = ev.clientX, y0 = ev.clientY;
      let moved = false;
      let sentAt = 0;
      const send = (f: { x: number; z: number }) => {
        sentAt = performance.now();
        set('px', clamp((f.x / 0.85 + 1) / 2));
        set('pz', clamp((f.z - 0.25) / 1.95));
      };
      const place = (e: PointerEvent) => {
        if (!moved && Math.hypot(e.clientX - x0, e.clientY - y0) < 5) return; // a click opens her memory; a drag moves her
        moved = true;
        const f = pt.floorAt(e.clientX - r.left, e.clientY - r.top);
        if (!f) return;
        live$.current.drag = f; // she follows the pointer at once; the song (and everyone) gets ~25 updates a second
        if (performance.now() - sentAt > 40) send(f);
      };
      const c = ev.currentTarget;
      const up = () => {
        c.removeEventListener('pointermove', place);
        c.style.cursor = '';
        if (moved && live$.current.drag) send(live$.current.drag);
        live$.current.drag = null;
        touch(null);
        if (!moved) {
          setPop(null);
          setZoom(true);
        }
      };
      c.addEventListener('pointermove', place);
      c.addEventListener('pointerup', up, { once: true });
      c.addEventListener('pointercancel', up, { once: true });
      return;
    }
    const u = pt.wallU(px, py);
    if (u != null) {
      capture(ev);
      touch('pos');
      const seek = (uu: number) => {
        const s = pv('start'), e = Math.max(s + 0.02, pv('end'));
        set('pos', clamp((uu - s) / (e - s)));
        live?.command(slot, 2);
      };
      seek(u);
      const c = ev.currentTarget;
      const mv = (e: PointerEvent) => {
        const uu = pt.wallU(e.clientX - r.left, e.clientY - r.top);
        if (uu != null) seek(uu);
      };
      c.addEventListener('pointermove', mv);
      c.addEventListener('pointerup', () => { c.removeEventListener('pointermove', mv); touch(null); }, { once: true });
      return;
    }
    // the mirror: drag left / right to turn it (width); a click flips the tape (backwards / forwards)
    if (pt.hitMirror(px, py)) {
      capture(ev);
      touch('width');
      const x0 = ev.clientX, v0 = pv('width');
      let moved = false;
      const c = ev.currentTarget;
      const mv = (e: PointerEvent) => {
        if (Math.abs(e.clientX - x0) > 4) moved = true;
        if (moved) set('width', clamp(v0 + (e.clientX - x0) / 200));
      };
      c.addEventListener('pointermove', mv);
      c.addEventListener('pointerup', () => {
        c.removeEventListener('pointermove', mv);
        touch(null);
        if (!moved) set('mode', Math.round(pv('mode')) === 1 ? 0 : 1);
      }, { once: true });
      if (pop) setPop(null);
      return;
    }
    // the door: pull it left and it swings open into the room (its edge follows the finger)
    if (pt.hitDoor(px, py)) {
      capture(ev);
      const x0 = ev.clientX, v0 = door, w = pt.doorPx();
      const c = ev.currentTarget;
      const mv = (e: PointerEvent) => setDoor(v0 + (x0 - e.clientX) / w);
      c.addEventListener('pointermove', mv);
      c.addEventListener('pointerup', () => c.removeEventListener('pointermove', mv), { once: true });
      if (pop) setPop(null);
      return;
    }
    // the rug: its corner follows the finger across the floor
    if (pt.hitRug(px, py)) {
      capture(ev);
      touch('rug');
      const c = ev.currentTarget;
      const mv = (e: PointerEvent) => {
        const v = pt.rugAt(e.clientX - r.left, e.clientY - r.top);
        if (v != null) set('rug', v);
      };
      c.addEventListener('pointermove', mv);
      c.addEventListener('pointerup', () => { c.removeEventListener('pointermove', mv); touch(null); }, { once: true });
      if (pop) setPop(null);
      return;
    }
    // the lamp (Light) and the window (Air): drag up = brighter / more open, drag down = dimmer / closed
    const knob = pt.hitLamp(px, py) ? { id: 'light', span: 220 } : pt.hitWindow(px, py) ? { id: 'air', span: pt.windowPx() /* the sash follows the finger: the window's own size */ } : null;
    if (knob) {
      capture(ev);
      touch(knob.id);
      const y0 = ev.clientY, v0 = pv(knob.id);
      const c = ev.currentTarget;
      const mv = (e: PointerEvent) => set(knob.id, clamp(v0 + (y0 - e.clientY) / knob.span));
      c.addEventListener('pointermove', mv);
      c.addEventListener('pointerup', () => { c.removeEventListener('pointermove', mv); touch(null); }, { once: true });
      if (pop) setPop(null);
      return;
    }
    if (pt.hitBackWall(px, py)) {
      // push the back wall away (drag up) for a bigger room, pull it closer (drag down) for a smaller one
      capture(ev);
      touch('room');
      const y0 = ev.clientY, r0 = pv('room');
      const c = ev.currentTarget;
      const mv = (e: PointerEvent) => set('room', clamp(r0 + (y0 - e.clientY) / 300));
      c.addEventListener('pointermove', mv);
      c.addEventListener('pointerup', () => { c.removeEventListener('pointermove', mv); touch(null); }, { once: true });
      if (pop) setPop(null);
      return;
    }
    if (pop) setPop(null);
  };
  const onHover = (ev: RPointerEvent<HTMLCanvasElement>) => {
    const pt = painter.current;
    if (!pt || ev.buttons) return;
    const r = ev.currentTarget.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    ev.currentTarget.style.cursor = pt.hitMica(px, py) ? 'grab' : pt.wallU(px, py) != null || pt.hitMirror(px, py) || pt.hitDoor(px, py) ? 'ew-resize' : pt.hitRug(px, py) ? 'nwse-resize' : pt.hitLamp(px, py) || pt.hitWindow(px, py) || pt.hitBackWall(px, py) ? 'ns-resize' : '';
  };

  // ---- dock icons: drag up / down sets the icon's main amount (0–100% over ~250 px, so small moves stay small) ----
  const dockDragged = useRef(false);
  const [dockShow, setDockShow] = useState<{ id: string; text: string } | null>(null);
  const dockDown = (e: RPointerEvent<HTMLButtonElement>, id: string) => {
    const k = DRAG[id];
    if (!k || e.button !== 0) return;
    const b = e.currentTarget;
    const y0 = e.clientY, v0 = pv(k);
    let moved = false;
    dockDragged.current = false;
    const mv = (ev: PointerEvent) => {
      const dy = y0 - ev.clientY;
      if (!moved && Math.abs(dy) < 5) return;
      if (!moved) {
        moved = true;
        b.setPointerCapture?.(ev.pointerId);
        touch(k);
        if (status !== 'on' && status !== 'loading') void start();
      }
      const v = clamp(v0 + dy / 250);
      set(k, v);
      setDockShow({ id, text: fmtOf(k, spec(k))(v) });
    };
    const up = () => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      if (moved) {
        dockDragged.current = true;
        touch(null);
        setDockShow(null);
      }
    };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  };

  // ---- controls ----
  // plain functions, not components: a range being dragged must stay the same element between renders
  const row = (id: string, label: string, base = false) => {
    // the handle is your setting; the bar behind it is what you hear now (updated every frame)
    const v = pv(id);
    const shown = live?.last?.devices[slot]?.eff?.[IX[id]] ?? v;
    const pres = host?.presenceFor(id) ?? [];
    void base;
    return (
      <label className="fwm-geode__row" key={id} data-eff={id} style={{ '--eff': String(shown) } as CSSProperties}>
        <span>{label}</span>
        <span className="fwm-geode__track">
          <i aria-hidden="true" />
          <input type="range" min={0} max={1} step={0.005} value={v} aria-label={label}
            onPointerDown={() => touch(id)} onPointerUp={() => touch(null)} onChange={(e) => set(id, Number(e.target.value))} />
        </span>
        <output><span className="fwm-geode__val">{fmtOf(id, spec(id))(shown)}</span>{pres.length > 0 && <i className="fwm-geode__pres" style={{ background: pres[0].color }} title={pres.map((p) => p.name).join(', ')} />}</output>
      </label>
    );
  };
  const seg = (id: string, label: string, options: readonly string[]) => (
    <div className="fwm-geode__row fwm-geode__row--seg" key={id}>
      <span>{label}</span>
      <div className="fwm-seg" role="group" aria-label={label}>
        {options.map((o, i) => (
          <P.Button key={o} variant="seg" label={`${label}: ${o}`} pressed={Math.round(pv(id)) === i} onPress={() => {
            set(id, i);
            if (id === 'walk' && i > 0 && pv('mdepth') < 0.05) set('mdepth', 0.5); // the walk is part of Motion: at 0 she would not move
          }}>{o}</P.Button>
        ))}
      </div>
    </div>
  );
  const mto = Math.round(pv('mto'));
  const thermo = (
    <div className="fwm-geode__thermo">
      <svg viewBox="0 0 110 230" role="slider" tabIndex={0} aria-label="Temperature" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pv('temp') * 100)}
        onKeyDown={(e) => {
          const d = e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowDown' ? -0.05 : 0;
          if (!d) return;
          e.preventDefault();
          set('temp', clamp(pv('temp') + d));
        }}
        onPointerDown={(e) => {
          const svg = e.currentTarget;
          svg.setPointerCapture(e.pointerId);
          touch('temp');
          const at = (ev: { clientY: number }) => {
            const r = svg.getBoundingClientRect();
            return clamp(1 - (((ev.clientY - r.top) / r.height) * 230 - 20) / 160);
          };
          set('temp', at(e));
          const mv = (ev: PointerEvent) => set('temp', at(ev));
          svg.addEventListener('pointermove', mv);
          svg.addEventListener('pointerup', () => { svg.removeEventListener('pointermove', mv); touch(null); }, { once: true });
        }}>
        <rect className="fwm-geode__glass" x="44" y="12" width="22" height="168" rx="11" />
        <circle className="fwm-geode__glass" cx="55" cy="198" r="20" />
        <rect className="fwm-geode__merc" ref={(r) => void (hud.current.th = r)} x="50" y="20" width="10" height="160" rx="5" />
        <circle className="fwm-geode__merc" ref={(r) => void (hud.current.bulb = r)} cx="55" cy="198" r="14" />
        {[0, 1, 2, 3].map((i) => <line key={i} className="fwm-geode__glass" x1="70" x2="82" y1={24 + i * 50} y2={24 + i * 50} />)}
      </svg>
      <div className="fwm-geode__lbls"><span data-band="3">HOT</span><span data-band="2">WARM</span><span data-band="1">CHILL</span><span data-band="0">FREEZING</span></div>
    </div>
  );
  const POPS: Record<string, () => ReactNode> = {
    temp: () => thermo,
    fan: () => (<><h3>Air · the window</h3>{row('air', 'Window')}<p>More open: a brighter filter, a whistle, and the blinds (and the sound) sway more.</p></>),
    room: () => (<><h3>Room</h3>{row('room', 'Size')}{row('wet', 'Wet')}{row('rug', 'Rug')}<p>Geode's own reverb. The room stretches into the distance as it grows. The rug soaks it up: a darker, shorter tail and duller echoes (drag its corner in the room).</p></>),
    echo: () => (<><h3>Echo</h3>{seg('div', 'Time', spec('div').options!)}{row('fb', 'Bounces')}{row('ewet', 'Wet')}<p>Mica's voice bounces off the back wall: one round trip per repeat, in time with the song.</p></>),
    breath: () => (<><h3>Breath</h3>{row('breath', 'Pluck … Swell')}{['atk', 'dec', 'sus', 'rel'].map((id) => row(id, spec(id).label, true))}<p>The big slider moves all four; the four set your own shape (the numbers show what you hear). Mica's mouth follows it.</p></>),
    motion: () => (
      <>
        <h3>Motion</h3>
        {seg('mshape', 'Shape', spec('mshape').options!)}
        {seg('mrate', 'Speed', spec('mrate').options!)}
        {row('mdepth', 'Depth')}
        <div className="fwm-geode__row fwm-geode__row--seg">
          <span>Moves</span>
          <div className="fwm-seg" role="group" aria-label="What Motion moves">
            {MT.map(([l, b]) => (
              <P.Button key={l} variant="seg" label={`Motion moves ${l}`} pressed={(mto & b) !== 0} onPress={() => {
                set('mto', mto ^ b);
                if (pv('mdepth') < 0.05) set('mdepth', 0.5);
              }}>{l}</P.Button>
            ))}
          </div>
        </div>
        {seg('walk', 'Mica walks', spec('walk').options!)}
        {seg('wbars', 'Walk speed', spec('wbars').options!)}
        <p>One movement in time with the song, on everything you switch on (Depth 0 = nothing moves, Mica's walk included). Drag Mica to place her: left / right = pan, farther back = farther away; her walks go around that spot.</p>
      </>
    ),
    lamp: () => (<><h3>Light</h3>{row('light', 'Dimmer')}<p>Dim the lamp to calm the whole sound (a master low-pass). The room stays as it is.</p></>),
    grains: () => (<><h3>Grains</h3>{row('grains', 'Dry / wet')}{row('gsize', 'Size')}{row('gdens', 'Density')}{row('spread', 'Spread', true)}<p>Tiny slices of the tape. Drag on the film strip (right wall) to choose where they come from.</p></>),
    crunch: () => (<><h3>Crunch</h3>{row('crunch', 'Dry / wet')}<p>Bitcrush. The waves turn into steps.</p></>),
  };

  // ---- Mica's memory ----
  const st = g.status;
  const aud = live?.last?.devices[slot]?.viz?.[0] ?? -1;
  const recNote = rec
    ? rec.phase === 'armed' ? `Waiting for sound… play ${inputs.find((i) => i.id === rec.input)?.name ?? 'the instrument'} (your keys play it now).`
      : rec.phase === 'rec' ? `Recording ${rec.secs.toFixed(1)} s… press REC again to stop (30 s max).` : 'Saving into Mica\'s memory…'
    : g.busy ? 'Another Geode is recording right now.'
      : st.state === 'loading' ? `Getting the tape from the session: ${Math.round(st.progress * 100)}%`
        : st.state === 'missing' ? 'Waiting for someone who has this tape to join…'
          : st.state === 'empty' ? (inputs.length ? 'Empty. REC waits for sound from the instrument you pick, then records up to 30 s.' : 'Empty. Add another instrument to record it, or try the demo tape.')
            : `${st.meta.name}: play it with the keys.`;
  const trimCv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = trimCv.current;
    const p = pal.current;
    if (!c || !peaks || !p || !trimOpen) return;
    const w = (c.width = (c.clientWidth || 500) * devicePixelRatio), h = (c.height = 56 * devicePixelRatio), x = c.getContext('2d')!;
    x.clearRect(0, 0, w, h);
    x.strokeStyle = `rgb(${p.neon[1].join(',')})`;
    x.beginPath();
    for (let i = 0; i < w; i++) {
      const pk = peaks[Math.min(peaks.length - 1, Math.floor((i / w) * peaks.length))];
      x.moveTo(i, h / 2 - pk * h * 0.45);
      x.lineTo(i, h / 2 + pk * h * 0.45);
    }
    x.stroke();
    x.fillStyle = `rgba(${p.bg.join(',')},0.7)`;
    x.fillRect(0, 0, pv('start') * w, h);
    x.fillRect(pv('end') * w, 0, w - pv('end') * w, h);
  });
  const tapeSecs = tape ? tape.frames / tape.sr : 0;

  return (
    <div className="fwm-dev fwm-geode" data-device="geode" style={tokens as CSSProperties} ref={wrap}>
      <div className="fwm-dev__hdr">
        <div className="fwm-plate">
          <b>GEOD<i>E</i></b>
          <span>{host?.subtitle ? `Sampler · ${host.subtitle}` : 'Sampler · Mica\'s room'}</span>
        </div>
        <div className="fwm-who" aria-label="People on this device">
          {people.map((p) => (
            <div key={p.userId} className="fwm-av" style={{ background: p.color }} title={p.name}>{p.name[0]}</div>
          ))}
        </div>
        <Sends host={host} />
        <div className="fwm-preset">
          <P.Button variant="hw" label="Previous sound" onPress={() => loadPreset(presetIx - 1)}>‹</P.Button>
          <P.Screen variant="preset">
            {String(presetIx + 1).padStart(2, '0')} {GEODE_PRESETS[presetIx].name}
            {edited && <small className="fwm-garnet__edited"> edited</small>}
          </P.Screen>
          <P.Button variant="hw" label="Next sound" onPress={() => loadPreset(presetIx + 1)}>›</P.Button>
        </div>
      </div>

      {!back ? (
        <div className={'fwm-geode__screen' + (dropping ? ' is-drop' : '')}
          onDragOver={(e) => {
            if (![...e.dataTransfer.items].some((i) => i.kind === 'file')) return;
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDropping(false);
            const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|m4a|aac|webm)$/i.test(x.name));
            if (f && !rec) void g.file(f);
          }}>
          <canvas ref={cv} aria-label="Mica's room" onPointerDown={onDown} onPointerMove={onHover} />
          <div className="fwm-geode__hud"><span>TEMPERATURE</span><b ref={(r) => void (hud.current.t = r)}>WARM</b></div>
          <div className="fwm-geode__hud fwm-geode__hud--r"><span>ROOM</span><b ref={(r) => void (hud.current.r = r)}>12 m</b>
          </div>
          {st.state !== 'ready' && !zoom && (
            <button type="button" className="fwm-geode__hint" onClick={() => setZoom(true)}>
              {st.state === 'empty' ? 'Empty: click Mica to record, or drop an audio file here' : recNote}
            </button>
          )}
          {zoom && (
            <div className="fwm-geode__menu" role="dialog" aria-label="Mica's memory">
              <div className="fwm-geode__big">
                <button type="button" aria-label="Scissors: trim the tape" aria-pressed={trimOpen} disabled={!tape} onClick={() => setTrimOpen((o) => !o)}>{ICONS.trim}TRIM</button>
                <button type="button" aria-label="Trash: remove the tape" disabled={st.state === 'empty'} onClick={() => g.clear()}>{ICONS.trash}REMOVE</button>
                <button type="button" aria-label={aud >= 0 ? 'Stop the tape' : 'Play the tape'} className={aud >= 0 ? 'is-on' : ''} disabled={!tape || !live}
                  onClick={() => live?.command(slot, 1, aud >= 0 ? 0 : 1)}>{aud >= 0 ? ICONS.stop : ICONS.play}{aud >= 0 ? 'STOP' : 'PLAY'}</button>
                {inputs.length > 0 || rec ? (
                  <button type="button" aria-label={rec ? 'Stop recording' : 'Rec: wait for sound, then record'} className={rec ? 'is-rec' : ''} disabled={!rec && (g.busy || !inputId)}
                    onClick={() => (rec ? g.stop() : g.record(inputId))}>{rec ? ICONS.stop : ICONS.rec}{rec ? (rec.phase === 'armed' ? 'CANCEL' : 'STOP') : 'REC'}</button>
                ) : null}
                {st.state === 'empty' && !rec && <button type="button" aria-label="Load the demo tape" onClick={() => g.demo()}>{ICONS.demo}DEMO</button>}
                {!rec && <button type="button" aria-label="Load an audio file" onClick={() => fileIn.current?.click()}>{ICONS.file}FILE</button>}
                <input ref={fileIn} type="file" accept="audio/*" hidden onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void g.file(f);
                }} />
              </div>
              <div className="fwm-geode__note" role="status">
                {inputs.length > 0 && (
                  <label>Record from{' '}
                    <select value={inputId} disabled={!!rec} onChange={(e) => setInput(e.target.value)} aria-label="Instrument to record">
                      {inputs.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>{' · '}
                  </label>
                )}
                <span>{recNote}</span>
                {!rec && inputs.find((i) => i.id === inputId)?.muted && <b className="fwm-geode__warn"> {inputs.find((i) => i.id === inputId)!.name} is muted: unmute it to record.</b>}
                {rec && rec.phase !== 'saving' && <i className="fwm-geode__lvl" style={{ '--lvl': String(Math.min(1, rec.level * 1.4)) } as CSSProperties} />}
              </div>
              <div className="fwm-geode__box">
                {seg('mode', 'Plays', spec('mode').options!)}
                {Math.round(pv('mode')) !== 2 && seg('loop', 'Tape', spec('loop').options!)}
                {Math.round(pv('mode')) !== 2 && Math.round(pv('loop')) === 1 && row('lfade', 'Fade in')}
                {row('speed', 'Speed')}
                {row('pos', 'Position')}
              </div>
              {trimOpen && tape && (
                <div className="fwm-geode__box">
                  <canvas ref={trimCv} className="fwm-geode__trimcv" aria-hidden="true" />
                  <label className="fwm-geode__row"><span>Start</span>
                    <input type="range" min={0} max={1} step={0.001} value={pv('start')} aria-label="Trim start" onPointerDown={() => touch('start')} onPointerUp={() => touch(null)}
                      onChange={(e) => set('start', Math.min(Number(e.target.value), pv('end') - 0.02))} />
                    <output>{(pv('start') * tapeSecs).toFixed(2)} s</output></label>
                  <label className="fwm-geode__row"><span>End</span>
                    <input type="range" min={0} max={1} step={0.001} value={pv('end')} aria-label="Trim end" onPointerDown={() => touch('end')} onPointerUp={() => touch(null)}
                      onChange={(e) => set('end', Math.max(Number(e.target.value), pv('start') + 0.02))} />
                    <output>{(pv('end') * tapeSecs).toFixed(2)} s</output></label>
                </div>
              )}
            </div>
          )}
          {zoom && <button type="button" className="fwm-geode__backbtn" onClick={() => setZoom(false)}>← Back to the room</button>}
          {pop && !zoom && <div className={'fwm-geode__pop' + (pop === 'temp' ? ' is-bare' : '')} role="dialog" aria-label={pop}>{POPS[pop]?.()}</div>}
          <div className="fwm-geode__dock" role="toolbar" aria-label="Geode controls">
            {DOCK.map(([id, l]) => (
              <Fragment key={id}>
              <button type="button" data-id={id} aria-label={l} aria-expanded={id === 'mica' ? zoom : pop === id}
                className={(id === 'mica' && rec ? 'is-rec' : '') + (DRAG[id] ? ' is-level' : '')}
                data-eff={DRAG[id]}
                title={DRAG[id] ? `${l}: click to open, drag up or down to set` : undefined}
                onPointerDown={(e) => dockDown(e, id)}
                onKeyDown={(e) => {
                  const k = DRAG[id];
                  const d = e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowDown' ? -0.05 : 0;
                  if (!k || !d) return;
                  e.preventDefault();
                  set(k, clamp(pv(k) + d));
                }}
                onClick={() => {
                  if (dockDragged.current) {
                    dockDragged.current = false;
                    return;
                  }
                  if (status !== 'on' && status !== 'loading') void start();
                  if (id === 'mica') {
                    setZoom((z) => !z);
                    setPop(null);
                  } else {
                    setZoom(false);
                    setPop((p) => (p === id ? null : id));
                  }
                }}>
                {ICONS[id]}
                <span>{dockShow?.id === id ? dockShow.text : l.toUpperCase()}</span>
              </button>
              {id === 'room' && (
                <span className="fwm-geode__roombtns" role="group" aria-label="Room size">
                  <button type="button" aria-label="Bigger room" disabled={pv('room') >= 1} onClick={() => set('room', clamp(pv('room') + 0.1))}>+</button>
                  <button type="button" aria-label="Smaller room" disabled={pv('room') <= 0} onClick={() => set('room', clamp(pv('room') - 0.1))}>−</button>
                </span>
              )}
              </Fragment>
            ))}
          </div>
          {debug && <button type="button" className="fwm-geode__flip" onClick={() => setBack(true)} title="Debug: the knobs behind the room">BACK</button>}
        </div>
      ) : (
        <div className="fwm-geode__rear" aria-label="The back of Geode (debug)">
          <div className="fwm-brk">The knobs behind the macros (the arcs show what the macros make of them)</div>
          <div className="fwm-geode__knobs">{m.params.filter((p) => p.section === 'back').map((p) => <ParamKnob key={p.id} ctx={ctx} id={p.id} format={GEODE_FORMAT[p.id]} />)}</div>
          <div className="fwm-brk">How far the thermometer may pull each knob</div>
          <div className="fwm-geode__knobs">{m.params.filter((p) => p.section === 'scales').map((p) => <ParamKnob key={p.id} ctx={ctx} id={p.id} />)}</div>
          <div className="fwm-brk">Dynamics · squash now {(live?.last?.devices[slot]?.viz?.[2] ?? 0).toFixed(1)} dB</div>
          <div className="fwm-geode__knobs">{['cth', 'cratio', 'cmake', 'lvl'].map((id) => <ParamKnob key={id} ctx={ctx} id={id} />)}</div>
          <ModRow ctx={ctx} labels={SRC_LABEL} hint="Press Assign, then click a knob: Motion or the Breath envelope of the note played last moves it." />
          <P.Button variant="hw" label="Back to the room" onPress={() => setBack(false)}>← Room</P.Button>
        </div>
      )}

      <PanelKeys host={host} slot={slot} />
      <p className="fwm-geode__foot">The tape stays in your browser and goes straight to the people in this session, never to a server. Mica is our own character.</p>
    </div>
  );
}

