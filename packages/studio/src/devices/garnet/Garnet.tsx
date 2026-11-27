// Garnet: string synth, front panel. Layout follows the approved mock-up (design/kit/garnet.html):
// STRINGS (Pick and Body rows) with the AMP block on the right, the PLAY row, and the neck you strum.
// Only theme primitives and --dev-* tokens. The neck's mode and chord type are this person's own view.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { PresetBar } from '../PresetBar';
import { useEngine } from '../../engine/EngineProvider';
import { useDeviceState, useDeviceSync, useEffectiveValue } from '../../engine/useDeviceSync';
import type { DeviceStore } from '../../model/deviceStore';
import { formatParam } from '../../model/params';
import { DEFAULT_KEY, SCALES, NOTE_NAMES, type SongKey } from '../../model/scales';
import { useDeviceTokens, usePrimitives } from '../../theme/Theme';
import type { DeviceHost, DeviceProps } from '../basalt/Basalt';
import { Scope } from '../Scope';
import { Sends } from '../Sends';
import { CHORD_TYPES, FRETS, NO_GUIDE, TUNING, chordLabel, chordsOfKey, guideRoles, guideStep, triadOf, inScale, neckKey, noteName, type ChordType, type Guide, type GuideRole } from './music';
import { GARNET_FORMAT, GARNET_PRESETS } from './presets';

type Mode = 'chords' | 'notes';
interface NeckView {
  mode: Mode;
  type: ChordType;
  lock: boolean;
  /** Chord guide on the neck (Notes mode). */
  guide: boolean;
}
const VIEW_KEY = 'fwm.garnet.neck';
function loadView(): NeckView {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    // the neck always shows notes now (Chords mode is gone, user 2026-11-27)
    if (v && CHORD_TYPES.some(([id]) => id === v.type)) return { mode: 'notes', type: v.type, lock: !!v.lock, guide: v.guide !== false };
  } catch {
    /* no storage */
  }
  return { mode: 'notes', type: 'triad', lock: false, guide: true };
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
  // the chord buttons (PLAY row) light up when they strum, from a click or keys 1–7
  const [chHit, setChHit] = useState(-1);
  const chT = useRef(0);
  const strumShow = (c: number, up = false) => {
    strum(c, up);
    // with the chord guide on: the same as pressing the chord's root (once the strum is out: redrawing the
    // neck mid-strum would delay its notes)
    const root = chords[c]?.root;
    if (root != null && guideOn) timers.current.push(window.setTimeout(() => press(root), 6 * gap + 15));
    setChHit(c);
    clearTimeout(chT.current);
    chT.current = window.setTimeout(() => setChHit(-1), 180);
  };
  const strumRef = useRef(strumShow);
  strumRef.current = strumShow;
  useEffect(() => {
    if (host?.preview) return; // a picture in the manual never takes the number keys
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
  const knob = (id: string, size?: 'lg') => <GKnob key={id} store={store} host={host} id={id} set={set} size={size} slot={slot} />;
  const peerNotes = new Map((host?.peerHeld ?? []).map((h) => [h.note, h.color]));
  // computer keys: show where each held note is on the neck (the string a guitarist would use, as the
  // engine does: the highest free string that reaches it) and make that string ring
  const myHeld = host?.myHeld ?? [];
  const mine = new Map<number, number>(); // string → fret
  for (const n of myHeld) {
    for (let st = 5; st >= 0; st--) {
      const f = n - TUNING[st];
      if (f >= 0 && f <= FRETS && !mine.has(st)) {
        mine.set(st, f);
        break;
      }
    }
  }
  const mineKey = [...mine].map(([st, f]) => `${st}:${f}`).join(',');
  // chord guide: each pressed note (neck or computer keys) moves it on (see guideStep in music.ts)
  const [guide, setGuide] = useState<Guide>(NO_GUIDE);
  const guideOn = view.mode === 'notes' && view.guide;
  const press = (m: number) => guideOn && setGuide((g) => guideStep(g, m, keyRef.current));
  const keyRef = useRef(key);
  keyRef.current = key;
  const roles = guideOn ? guideRoles(guide, key) : new Map<number, GuideRole>();
  // Roman numeral badges on every guided note: the chord built on it (its place in the key), in its
  // circle's colour; the next chord's root keeps a purple badge
  const badges = new Map<number, { rn: string; role: GuideRole }>();
  for (const [pc, role] of roles) badges.set(pc, { rn: chordLabel(pc, key).roman, role });
  if (guideOn && guide.second != null && guide.second !== guide.main) badges.set(guide.second, { rn: chordLabel(guide.second, key).roman, role: 'alt' });
  const prevMine = useRef(new Set<string>());
  useEffect(() => {
    const now = new Set(mineKey ? mineKey.split(',') : []);
    for (const k of now)
      if (!prevMine.current.has(k)) {
        const [st, f] = k.split(':').map(Number);
        shake(st);
        press(TUNING[st] + f);
      }
    prevMine.current = now;
  }, [mineKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <Sends host={host} />
        <div className="fwm-preset">
          <PresetBar device="garnet" store={store} host={host} factory={GARNET_PRESETS} factoryIx={presetIx} edited={edited} loadFactory={(i) => loadPreset(i)} noun="sound" editedClass="fwm-garnet__edited" />
          <Scope engine={status === 'on' && !host?.preview ? engine : null} note={null} label="String" />
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
        <div className="fwm-garnet__chords" role="group" aria-label="Chords of the key: click to strum (keys 1–7)">
          {chords.map((c, i) => (
            <button key={i} type="button" className={'fwm-garnet__ch' + (chHit === i ? ' is-hit' : '')} title={`Strum ${c.name} (key ${i + 1}, Shift: up)`}
              onClick={(e) => strumShow(i, e.shiftKey)}>
              <b>{c.name}</b>
              <small>{c.roman}</small>
            </button>
          ))}
        </div>
        <P.Button variant="hw" label="Only scale notes" pressed={view.lock} onPress={() => setView({ lock: !view.lock })}>Only scale notes</P.Button>
        <P.Button variant="hw" label="Chord guide" pressed={view.guide} onPress={() => { setGuide(NO_GUIDE); setView({ guide: !view.guide }); }}>Chord guide</P.Button>
        <P.Button variant="hw" label="Palm mute" pressed={state.params.mute >= 0.5} presence={host?.presenceFor('mute')}
          onPress={() => set('mute', state.params.mute >= 0.5 ? 0 : 1)}>Palm mute</P.Button>
        <Whammy value={state.params.wham ?? 0.5} set={(v) => set('wham', v)} host={host} />
      </div>

      {guideOn && <GuideLegend guide={guide} songKey={key} />}
      <Neck mode={view.mode} lock={view.lock} guide={guideOn} songKey={key} chords={chords} peerNotes={peerNotes} mine={mine} roles={roles} badges={badges} strings={strings}
        onPluck={(st: number, m: number, v: number) => {
          if (view.mode === 'notes') press(m);
          pluck(st, m, v);
        }} onSlide={slideTo} onDamp={damp} onStrum={strum} />
      <p className="fwm-silk fwm-garnet__hint">
        {`${NOTE_NAMES[key.root]} ${SCALES[key.scale]?.label.toLowerCase()}${songKey.scale === 'chromatic' ? ' (the song has no key: set one in the top bar)' : ''}: lit notes are in the scale, the brightest is ${noteName(key.root, key)}. Drag along a string to move up the neck (with Slide on, it glides). The chord buttons strum the chords of the key (keys 1–7, Shift: up).`}
      </p>
    </div>
  );
}

export function defaultsOf(store: DeviceStore): Record<string, number> {
  return Object.fromEntries(store.manifest.params.map((p) => [p.id, p.default]));
}

export function GKnob({ store, host, id, set, size, slot = -1, fmt = GARNET_FORMAT }: { store: DeviceStore; host?: DeviceHost; id: string; set(id: string, v: number): void; size?: 'lg'; slot?: number; fmt?: Record<string, (v: number) => string> }) {
  const { Knob } = usePrimitives();
  const state = useDeviceState(store);
  const { engine, status } = useEngine();
  const index = store.manifest.params.findIndex((p) => p.id === id);
  const spec = store.manifest.params[index];
  // automation moves the knob: it shows what the engine plays (unless you are turning it)
  const [held, setHeld] = useState(false);
  const live = useEffectiveValue(status === 'on' && !host?.preview && slot >= 0 ? engine : null, slot, index);
  const stored = state.params[id];
  const shown = !held && live != null && Math.abs(live - stored) > 0.004 ? live : stored;
  return (
    <Knob value={shown} onChange={(v) => set(id, v)} label={spec.label} size={size}
      format={(v) => (fmt[id] ?? ((x: number) => formatParam(spec, x)))(v)}
      defaultValue={spec.default} presence={host?.presenceFor(id) ?? []}
      onGestureStart={() => { setHeld(true); host?.touch(id); }} onGestureEnd={() => { setHeld(false); host?.touch(null); }} />
  );
}

/** A stepped dial: the knob snaps to its choices, which are printed around it (click one to pick it). */
export function StepDial({ store, host, id, set }: { store: DeviceStore; host?: DeviceHost; id: string; set(id: string, v: number): void }) {
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
  /** The chord guide is on: notes are labelled rectangles; off: round notes, more like a real neck. */
  guide: boolean;
  songKey: SongKey;
  chords: ReturnType<typeof chordsOfKey>;
  peerNotes: Map<number, string>;
  /** Notes this person holds on the computer keyboard: string → fret. */
  mine: Map<number, number>;
  /** Chord guide colours per pitch class. */
  roles: Map<number, GuideRole>;
  /** Roman numeral badges per pitch class (the main root; the next chord's root). */
  badges: Map<number, { rn: string; role: GuideRole }>;
  strings: React.MutableRefObject<(HTMLDivElement | null)[]>;
  onPluck(s: number, m: number, v: number): void;
  onSlide(s: number, m: number): void;
  onDamp(s: number): void;
  onStrum(c: number, up?: boolean): void;
}

/** Six strings, low E at the bottom. Chords: one strip per chord of the key. Notes: frets 0–12. */
function Neck({ mode, lock, guide, songKey, chords, peerNotes, mine, roles, badges, strings, onPluck, onSlide, onDamp, onStrum }: NeckProps) {
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
      <div ref={neck} className={'fwm-garnet__neck is-' + mode + (lock ? ' is-lock' : '') + (guide ? ' is-guide' : '')} style={{ '--cols': cols } as CSSProperties}
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
                    <span className={'fwm-garnet__cn' + (m % 12 === chords[c].root ? ' is-root' : '') + (mine.get(s) === f ? ' is-mine' : '')}>{noteName(m, songKey)}</span>
                  </div>
                );
              }
              const m = TUNING[s] + c;
              const ins = inScale(m, songKey);
              const peer = peerNotes.get(m);
              const role = roles.get(m % 12);
              const badge = mine.get(s) === c ? undefined : badges.get(m % 12);
              return (
                <div key={s} className="fwm-garnet__cell">
                  <span className={'fwm-garnet__dot' + (mine.get(s) === c ? ' is-mine' : role ? ` is-g-${role}` : ins ? (m % 12 === songKey.root ? ' is-root' : '') : ' is-off')}
                    style={peer ? ({ boxShadow: `0 0 0 3px ${peer}` } as CSSProperties) : undefined}>
                    {ins || role || mine.get(s) === c ? noteName(m, songKey) : ''}
                    {badge && <small className={`fwm-garnet__rn-badge is-${badge.role}`}>{badge.rn}</small>}
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

/** Whammy ribbon: press and drag (left dives up to 7 semitones, right raises up to 2); let go and it
 *  springs back to rest, like a mod wheel. Arrow keys nudge it; it returns on key up. */
function Whammy({ value, set, host }: { value: number; set(v: number): void; host?: DeviceHost }) {
  const ref = useRef<HTMLDivElement>(null);
  const [down, setDown] = useState(false);
  const at = (x: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - r.left) / r.width));
  };
  const release = () => {
    setDown(false);
    set(0.5);
    host?.touch(null);
  };
  const st = value < 0.5 ? -(0.5 - value) * 14 : (value - 0.5) * 4;
  return (
    <div className="fwm-whammy">
      <span className="fwm-silk">Whammy</span>
      <div ref={ref} className={'fwm-whammy__rib' + (down ? ' is-down' : '')} role="slider" tabIndex={0} aria-label="Whammy"
        aria-valuemin={-7} aria-valuemax={2} aria-valuenow={Math.round(st * 10) / 10} aria-valuetext={`${st >= 0 ? '+' : ''}${st.toFixed(1)} semitones`}
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* synthetic events */
          }
          setDown(true);
          host?.touch('wham');
          set(at(e.clientX));
        }}
        onPointerMove={(e) => down && set(at(e.clientX))}
        onPointerUp={release} onPointerCancel={release}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(Math.max(0, value - 0.1));
          else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(Math.min(1, value + 0.1));
          else return;
          e.preventDefault();
        }}
        onKeyUp={(e) => e.key.startsWith('Arrow') && set(0.5)}>
        <i className="fwm-whammy__zero" />
        <b className="fwm-whammy__thumb" style={{ left: `${value * 100}%` }} />
        <small>{Math.abs(st) < 0.05 ? '0' : `${st > 0 ? '+' : ''}${st.toFixed(1)}`}</small>
      </div>
    </div>
  );
}

/** What the guide's colours mean right now: the main chord (root, 2nd and 3rd notes) and the next one. */
function GuideLegend({ guide, songKey }: { guide: Guide; songKey: SongKey }) {
  if (guide.main == null)
    return <p className="fwm-garnet__legend fwm-silk">Chord guide: press a note to see its chord. Root, 2nd and 3rd notes get their own colour, with its Roman numeral (its place in the key).</p>;
  const [r, a, b] = triadOf(guide.main, songKey);
  const main = chordLabel(guide.main, songKey);
  const next = guide.second != null && guide.second !== guide.main ? chordLabel(guide.second, songKey) : null;
  const nextNotes = guide.second != null ? triadOf(guide.second, songKey).slice(1).filter((pc) => pc !== r) : [];
  const n = (pc: number) => noteName(pc, songKey);
  return (
    <p className="fwm-garnet__legend" aria-live="polite">
      <span><i className="is-g-root" />Root {n(r)} · chord <b>{main.name}</b> ({main.roman})</span>
      <span><i className="is-g-second" />2nd note {n(a)}</span>
      <span><i className="is-g-third" />3rd note {n(b)}</span>
      {next && <span><i className="is-g-alt" />Next: <b>{next.name}</b> ({next.roman}): {nextNotes.map(n).join(', ')}, press one to make it the root</span>}
    </p>
  );
}
