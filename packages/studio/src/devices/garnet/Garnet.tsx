// Garnet: string synth, front panel. Layout follows the approved mock-up (design/kit/garnet.html):
// STRINGS (Pick and Body rows) with the AMP block on the right, the PLAY row, and the neck you strum.
// Only theme primitives and --dev-* tokens. The neck's mode and chord type are this person's own view.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { useEngine } from '../../engine/EngineProvider';
import { useDeviceState, useDeviceSync } from '../../engine/useDeviceSync';
import type { DeviceStore } from '../../model/deviceStore';
import { formatParam } from '../../model/params';
import { DEFAULT_KEY, SCALES, NOTE_NAMES, type SongKey } from '../../model/scales';
import { useDeviceTokens, usePrimitives } from '../../theme/Theme';
import type { DeviceHost, DeviceProps } from '../basalt/Basalt';
import { Scope } from '../Scope';
import { CHORD_TYPES, FRETS, TUNING, chordsOfKey, inScale, neckKey, noteName, type ChordType } from './music';
import { GARNET_FORMAT, GARNET_PRESETS } from './presets';

type Mode = 'chords' | 'notes';
interface NeckView {
  mode: Mode;
  type: ChordType;
  lock: boolean;
}
const VIEW_KEY = 'fwm.garnet.neck';
function loadView(): NeckView {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    if (v && (v.mode === 'chords' || v.mode === 'notes') && CHORD_TYPES.some(([id]) => id === v.type)) return { mode: v.mode, type: v.type, lock: !!v.lock };
  } catch {
    /* no storage */
  }
  return { mode: 'chords', type: 'triad', lock: false };
}
/** A plucked string rings until it is plucked again, a chord without it is strummed, or this long. */
const RING_MS = 4000;
/** Only the most recently mounted Garnet panel takes the 1–7 strum keys. */
let keyOwner = 0;

export function Garnet({ store, host, slot, user = { name: 'You', color: 'var(--fwm-me)' } }: DeviceProps) {
  const { engine, status, start } = useEngine();
  const P = usePrimitives();
  const tokens = useDeviceTokens('garnet');
  const state = useDeviceState(store);
  useDeviceSync(host ? null : engine, store, slot, 'garnet');
  const [view, setViewState] = useState<NeckView>(loadView);
  const setView = (v: Partial<NeckView>) =>
    setViewState((old) => {
      const next = { ...old, ...v };
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(next));
      } catch {
        /* no storage */
      }
      return next;
    });

  // ---- notes: each string holds at most one note ----
  const noteOn = useCallback(
    (n: number, v: number) => {
      if (host) host.noteOn(n, v);
      else if (engine && status === 'on') engine.noteOn(slot, n, v);
      else if (status !== 'loading') void start();
    },
    [engine, status, slot, start, host],
  );
  const noteOff = useCallback((n: number) => (host ? host.noteOff(n) : engine?.noteOff(slot, n)), [engine, slot, host]);
  const ringing = useRef<(number | null)[]>([null, null, null, null, null, null]);
  const timers = useRef<number[]>([]);
  const release = useRef<number[]>([0, 0, 0, 0, 0, 0]);
  const strings = useRef<(HTMLDivElement | null)[]>([]);
  const ops = useRef({ noteOn, noteOff });
  ops.current = { noteOn, noteOff };

  const damp = (s: number) => {
    const old = ringing.current[s];
    if (old == null) return;
    ringing.current[s] = null;
    clearTimeout(release.current[s]);
    ops.current.noteOff(old);
  };
  const shake = (s: number) => {
    const el = strings.current[s];
    if (!el) return;
    el.classList.remove('is-ringing');
    void el.offsetWidth;
    el.classList.add('is-ringing');
  };
  const hold = (s: number, m: number) => {
    ringing.current[s] = m;
    clearTimeout(release.current[s]);
    release.current[s] = window.setTimeout(() => damp(s), RING_MS);
  };
  /** Pluck string `s` at note `m` (after `delay` ms, for strums). */
  const pluck = (s: number, m: number, v: number, delay = 0) => {
    const go = () => {
      damp(s);
      ops.current.noteOn(m, v);
      hold(s, m);
      shake(s);
    };
    if (delay > 0) timers.current.push(window.setTimeout(go, delay));
    else go();
  };
  /** Move a ringing string to a new fret without letting go (legato: Garnet's Slide glides it). */
  const slideTo = (s: number, m: number) => {
    const old = ringing.current[s];
    if (old === m) return;
    ops.current.noteOn(m, 0.7);
    hold(s, m);
    if (old != null) ops.current.noteOff(old);
    shake(s);
  };
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      for (let s = 0; s < 6; s++) damp(s);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---- the key, the chords ----
  const songKey = host?.songKey ?? DEFAULT_KEY;
  const key = neckKey(songKey);
  const chords = useMemo(() => chordsOfKey(songKey, view.type), [songKey.root, songKey.scale, view.type]); // eslint-disable-line react-hooks/exhaustive-deps
  const gap = 6 + state.params.strum ** 2 * 60;
  const strum = (c: number, up = false) => {
    const ch = chords[c];
    if (!ch) return;
    // strings this chord doesn't use are muted by the strumming hand
    ch.frets.forEach((f, s) => f < 0 && damp(s));
    const order = [0, 1, 2, 3, 4, 5].filter((s) => ch.frets[s] >= 0);
    if (up) order.reverse();
    order.forEach((s, i) => pluck(s, TUNING[s] + ch.frets[s], 0.85 - i * 0.03, i * gap));
  };
  const strumRef = useRef(strum);
  strumRef.current = strum;
  useEffect(() => {
    if (view.mode !== 'chords') return;
    const me = ++keyOwner;
    const kd = (e: KeyboardEvent) => {
      if (me !== keyOwner || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable=true]')) return;
      const d = /^Digit([1-7])$/.exec(e.code);
      if (!d) return;
      e.preventDefault();
      strumRef.current(+d[1] - 1, e.shiftKey);
    };
    addEventListener('keydown', kd);
    return () => removeEventListener('keydown', kd);
  }, [view.mode]);

  const presetIx = state.preset % GARNET_PRESETS.length;
  const edited = Object.entries({ ...defaultsOf(store), ...GARNET_PRESETS[presetIx].params }).some(([id, v]) => Math.abs((state.params[id] ?? 0) - v) > 1e-6);
  const loadPreset = (i: number) => {
    const n = (i + GARNET_PRESETS.length) % GARNET_PRESETS.length;
    store.load(GARNET_PRESETS[n], n);
  };
  const set = (id: string, v: number) => {
    store.setParam(id, v);
    host?.paramChanged?.(id, v);
  };
  const people = host?.people ?? [{ userId: 'me', name: user.name, color: user.color }];
  const knob = (id: string, size?: 'lg') => <GKnob key={id} store={store} host={host} id={id} set={set} size={size} />;
  const peerNotes = new Map((host?.peerHeld ?? []).map((h) => [h.note, h.color]));

  return (
    <div className="fwm-dev fwm-garnet" data-device="garnet" style={tokens as CSSProperties}>
      <div className="fwm-dev__hdr">
        <div className="fwm-plate">
          <b>
            GARNE<i>T</i>
          </b>
          <span>{host?.subtitle ? `String synth · ${host.subtitle}` : 'String synth · strum & pick'}</span>
        </div>
        <div className="fwm-who" aria-label="People on this device">
          {people.map((p) => (
            <div key={p.userId} className="fwm-av" style={{ background: p.color }} title={p.name}>
              {p.name[0]}
            </div>
          ))}
        </div>
        <div className="fwm-preset">
          <P.Button variant="hw" label="Previous sound" onPress={() => loadPreset(presetIx - 1)}>‹</P.Button>
          <P.Screen variant="preset">
            {String(presetIx + 1).padStart(2, '0')} {GARNET_PRESETS[presetIx].name}
            {edited && <small className="fwm-garnet__edited"> edited</small>}
          </P.Screen>
          <P.Button variant="hw" label="Next sound" onPress={() => loadPreset(presetIx + 1)}>›</P.Button>
          <Scope engine={status === 'on' ? engine : null} note={null} label="String" />
        </div>
      </div>

      <div className="fwm-garnet__face">
        <div>
          <div className="fwm-brk">Strings</div>
          <div className="fwm-garnet__row">
            <span className="fwm-garnet__rn">PICK</span>
            {['pick', 'hard', 'sustain', 'bright'].map((id) => knob(id))}
          </div>
          <div className="fwm-garnet__row">
            <span className="fwm-garnet__rn">BODY</span>
            <StepDial store={store} host={host} id="body" set={set} />
            {['reso', 'tone'].map((id) => knob(id))}
          </div>
        </div>
        <div>
          <div className="fwm-brk">Amp</div>
          <div className="fwm-garnet__amp">
            {knob('dist', 'lg')}
            {knob('drive', 'lg')}
            <StepDial store={store} host={host} id="cab" set={set} />
            {knob('pres')}
            {knob('lvl')}
          </div>
        </div>
      </div>

      <div className="fwm-brk">Play</div>
      <div className="fwm-garnet__play">
        {['strum', 'vib', 'slide', 'ring'].map((id) => knob(id))}
        <div className="fwm-seg fwm-garnet__mode" role="group" aria-label="What the neck plays">
          <P.Button variant="seg" label="Chords" pressed={view.mode === 'chords'} onPress={() => setView({ mode: 'chords' })}>Chords</P.Button>
          <P.Button variant="seg" label="Notes" pressed={view.mode === 'notes'} onPress={() => setView({ mode: 'notes' })}>Notes</P.Button>
        </div>
        {view.mode === 'chords' ? (
          <div className="fwm-seg fwm-seg--wrap fwm-garnet__types" role="group" aria-label="Chord type">
            {CHORD_TYPES.map(([id, l]) => (
              <P.Button key={id} variant="seg" label={l} pressed={view.type === id} onPress={() => setView({ type: id })} />
            ))}
          </div>
        ) : (
          <P.Button variant="hw" label="Only scale notes" pressed={view.lock} onPress={() => setView({ lock: !view.lock })}>Only scale notes</P.Button>
        )}
        <P.Button variant="hw" label="Palm mute" pressed={state.params.mute >= 0.5} presence={host?.presenceFor('mute')}
          onPress={() => set('mute', state.params.mute >= 0.5 ? 0 : 1)}>Palm mute</P.Button>
      </div>

      <Neck mode={view.mode} lock={view.lock} songKey={key} chords={chords} peerNotes={peerNotes} strings={strings}
        onPluck={pluck} onSlide={slideTo} onDamp={damp} onStrum={strum} />
      <p className="fwm-silk fwm-garnet__hint">
        {view.mode === 'chords'
          ? `Chords of ${NOTE_NAMES[key.root]} ${SCALES[key.scale]?.label.toLowerCase()}${songKey.scale === 'chromatic' ? ' (the song has no key: set one in the top bar)' : ''}. Drag across the strings inside a strip to strum, click one string to pick it. Keys 1–7 strum (Shift: up).`
          : `${NOTE_NAMES[key.root]} ${SCALES[key.scale]?.label.toLowerCase()}: lit notes are in the scale, the brightest is ${noteName(key.root, key)}. Drag along a string to move up the neck (with Slide on, it glides).`}
      </p>
    </div>
  );
}

function defaultsOf(store: DeviceStore): Record<string, number> {
  return Object.fromEntries(store.manifest.params.map((p) => [p.id, p.default]));
}

function GKnob({ store, host, id, set, size }: { store: DeviceStore; host?: DeviceHost; id: string; set(id: string, v: number): void; size?: 'lg' }) {
  const { Knob } = usePrimitives();
  const state = useDeviceState(store);
  const spec = store.manifest.params.find((p) => p.id === id)!;
  return (
    <Knob value={state.params[id]} onChange={(v) => set(id, v)} label={spec.label} size={size}
      format={(v) => (GARNET_FORMAT[id] ?? ((x: number) => formatParam(spec, x)))(v)}
      defaultValue={spec.default} presence={host?.presenceFor(id) ?? []}
      onGestureStart={() => host?.touch(id)} onGestureEnd={() => host?.touch(null)} />
  );
}

/** A stepped dial: the knob snaps to its choices, which are printed around it (click one to pick it). */
function StepDial({ store, host, id, set }: { store: DeviceStore; host?: DeviceHost; id: string; set(id: string, v: number): void }) {
  const { Knob } = usePrimitives();
  const state = useDeviceState(store);
  const spec = store.manifest.params.find((p) => p.id === id)!;
  const opts = spec.options ?? [];
  const n = Math.max(2, opts.length);
  const cur = Math.round(state.params[id] ?? 0);
  return (
    <div className="fwm-gstep">
      {opts.map((o, i) => {
        const a = ((-135 + (i * 270) / (n - 1)) * Math.PI) / 180;
        return (
          <button key={o} type="button" className={'fwm-gstep__lbl' + (i === cur ? ' is-on' : '')}
            style={{ left: `calc(50% + ${Math.sin(a) * 52}px)`, top: `${51 - Math.cos(a) * 46}px` }}
            aria-label={`${spec.label}: ${o}`} aria-pressed={i === cur} onClick={() => set(id, i)}>
            {o}
          </button>
        );
      })}
      <Knob value={cur / (n - 1)} label={spec.label} format={() => opts[cur] ?? ''} defaultValue={spec.default / (n - 1)}
        onChange={(v) => {
          const i = Math.round(v * (n - 1));
          if (i !== cur) set(id, i);
        }}
        presence={host?.presenceFor(id) ?? []} onGestureStart={() => host?.touch(id)} onGestureEnd={() => host?.touch(null)} />
    </div>
  );
}

interface NeckProps {
  mode: Mode;
  lock: boolean;
  songKey: SongKey;
  chords: ReturnType<typeof chordsOfKey>;
  peerNotes: Map<number, string>;
  strings: React.MutableRefObject<(HTMLDivElement | null)[]>;
  onPluck(s: number, m: number, v: number): void;
  onSlide(s: number, m: number): void;
  onDamp(s: number): void;
  onStrum(c: number, up?: boolean): void;
}

/** Six strings, low E at the bottom. Chords: one strip per chord of the key. Notes: frets 0–12. */
function Neck({ mode, lock, songKey, chords, peerNotes, strings, onPluck, onSlide, onDamp, onStrum }: NeckProps) {
  const neck = useRef<HTMLDivElement>(null);
  const drag = useRef<{ s: number; c: number; y: number; t: number } | null>(null);
  const cols = mode === 'chords' ? chords.length : FRETS + 1;
  const [hit, setHit] = useState<number | null>(null);

  const at = (e: PointerEvent) => {
    const r = neck.current!.getBoundingClientRect();
    const s = 5 - Math.max(0, Math.min(5, Math.floor(((e.clientY - r.top) / r.height) * 6)));
    const c = Math.max(0, Math.min(cols - 1, Math.floor(((e.clientX - r.left) / r.width) * cols)));
    return { s, c };
  };
  /** What string `s` plays in column `c`: a note, null (not in this chord: the hand mutes it) or undefined (off the scale, locked). */
  const noteAt = (s: number, c: number): number | null | undefined => {
    if (mode === 'chords') {
      const f = chords[c]?.frets[s] ?? -1;
      return f < 0 ? null : TUNING[s] + f;
    }
    const m = TUNING[s] + c;
    return lock && !inScale(m, songKey) ? undefined : m;
  };
  const play = (s: number, c: number, v: number) => {
    const m = noteAt(s, c);
    if (m === null) onDamp(s);
    else if (m !== undefined) onPluck(s, m, v);
    if (mode === 'chords') {
      setHit(c);
      window.setTimeout(() => setHit((h) => (h === c ? null : h)), 180);
    }
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    const h = at(e);
    drag.current = { ...h, y: e.clientY, t: performance.now() };
    play(h.s, h.c, 0.8);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const h = at(e);
    if (h.s !== d.s) {
      // crossed one or more strings: pluck each in order, harder for a faster drag
      const now = performance.now();
      const v = Math.max(0.4, Math.min(1, 0.5 + (Math.abs(e.clientY - d.y) / Math.max(1, now - d.t)) * 0.35));
      const dir = Math.sign(h.s - d.s);
      for (let s = d.s + dir; s !== h.s + dir; s += dir) play(s, h.c, v);
      drag.current = { ...h, y: e.clientY, t: now };
    } else if (h.c !== d.c) {
      if (mode === 'notes') {
        const m = noteAt(h.s, h.c);
        if (m != null) onSlide(h.s, m);
      }
      d.c = h.c;
    }
  };
  const up = () => {
    drag.current = null;
  };

  return (
    <div className="fwm-garnet__neckwrap">
      <div className={'fwm-garnet__heads is-' + mode} style={{ '--cols': cols } as CSSProperties}>
        {mode === 'chords'
          ? chords.map((c, i) => (
              <button key={i} type="button" className={'fwm-garnet__ch' + (hit === i ? ' is-hit' : '')} title={`Strum ${c.name} (key ${i + 1})`}
                onClick={(e) => onStrum(i, e.shiftKey)}>
                <b>{c.name}</b>
                <small>{c.roman}</small>
              </button>
            ))
          : Array.from({ length: cols }, (_, f) => (
              <div key={f} className="fwm-garnet__fret">
                {f === 0 ? 'open' : f}
                {[3, 5, 7, 9].includes(f) && <i />}
                {f === 12 && (<><i className="l" /><i /></>)}
              </div>
            ))}
      </div>
      <div ref={neck} className={'fwm-garnet__neck is-' + mode + (lock ? ' is-lock' : '')} style={{ '--cols': cols } as CSSProperties}
        role="group" aria-label="Guitar neck: click or drag across the strings"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {Array.from({ length: cols }, (_, c) => (
          <div key={c} className={'fwm-garnet__col' + (mode === 'notes' && c === 0 ? ' is-open' : '') + (hit === c ? ' is-hit' : '')}>
            {[5, 4, 3, 2, 1, 0].map((s) => {
              if (mode === 'chords') {
                const f = chords[c].frets[s];
                if (f < 0) return <div key={s} className="fwm-garnet__cell"><span className="fwm-garnet__cn is-x">×</span></div>;
                const m = TUNING[s] + f;
                return (
                  <div key={s} className="fwm-garnet__cell">
                    <span className={'fwm-garnet__cn' + (m % 12 === chords[c].root ? ' is-root' : '')}>{noteName(m, songKey)}</span>
                  </div>
                );
              }
              const m = TUNING[s] + c;
              const ins = inScale(m, songKey);
              const peer = peerNotes.get(m);
              return (
                <div key={s} className="fwm-garnet__cell">
                  <span className={'fwm-garnet__dot' + (ins ? (m % 12 === songKey.root ? ' is-root' : '') : ' is-off')}
                    style={peer ? ({ boxShadow: `0 0 0 3px ${peer}` } as CSSProperties) : undefined}>
                    {ins ? noteName(m, songKey) : ''}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        <div className="fwm-garnet__strings" aria-hidden="true">
          {TUNING.map((_, s) => (
            <div key={s} ref={(el) => void (strings.current[s] = el)} className={'fwm-garnet__str' + (s <= 2 ? ' is-wound' : '')}
              style={{ top: `${((5 - s + 0.5) / 6) * 100}%`, '--th': `${(3.8 - s * 0.5).toFixed(1)}px` } as CSSProperties} />
          ))}
        </div>
      </div>
    </div>
  );
}
