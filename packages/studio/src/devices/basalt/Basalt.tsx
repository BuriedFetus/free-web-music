// Basalt: mono bass synth, front panel. Layout and behaviour follow the approved design kit
// (design/kit/index.html). It only uses primitives from the theme, so hosts can restyle it.
import { inKey, isRoot, snapToKey, type SongKey } from '../../model/scales';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import type { ModSourceId } from '@fwm/engine';
import { useEngine } from '../../engine/EngineProvider';
import { useDeviceState, useDeviceSync, useEffectiveValue, useModSources } from '../../engine/useDeviceSync';
import { useComputerKeys } from '../../hooks/useComputerKeys';
import { canRoute, modRange, type DeviceStore } from '../../model/deviceStore';
import { formatParam } from '../../model/params';
import type { Presence } from '../../primitives/types';
import { useDeviceTokens, usePrimitives } from '../../theme/Theme';
import { Scope } from '../Scope';
import { Sends } from '../Sends';
import { LFO_ICONS, OSC_ICONS, WaveIcon } from './icons';
import { BASALT_PRESETS } from './presets';

const SRC_LABEL: Record<ModSourceId, string> = { lfo: 'LFO 1', amp: 'Amp env', filt: 'Filter env' };
const LFO_HINT = [
  'Free: runs on its own, ignores notes',
  'Retrig: restarts at every new note',
  'Poly: one LFO per voice, each starts with its note',
];

/**
 * When a device runs inside the studio, the host routes its notes (sound for everyone, recording)
 * and carries presence. Standalone (no host), notes go straight to the engine.
 */
export interface DeviceHost {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
  /** People touching a control right now (param id). */
  presenceFor(control: string): Presence[];
  /** Keys other people are holding on this device. */
  peerHeld: { note: number; color: string }[];
  /** Keys this person holds on the computer keyboard (lit on the panel's keys). */
  myHeld?: number[];
  /** Everyone looking at this device (for the avatars). */
  people: Presence[];
  /** This user starts / stops touching a control (null = released). */
  touch(control: string | null): void;
  /** A param was changed by this user (for automation recording). */
  paramChanged?(id: string, value: number): void;
  /** Subtitle under the nameplate, e.g. the track name. */
  subtitle?: string;
  /** The song's key (Garnet builds its chords from it). */
  songKey?: SongKey;
  /** This track's Reverb / Delay sends (the Mixer's): shown as SEND knobs on the panel. */
  sends?: { rev: number; dly: number; set(which: 'rev' | 'dly', v: number): void };
}

/** Props every device front panel takes (Basalt, Flint…). */
export type DeviceProps = BasaltProps;

export interface BasaltProps {
  store: DeviceStore;
  host?: DeviceHost;
  /** Engine slot this instance plays in. */
  slot: number;
  /** Play from the computer keyboard (only the focused device should). */
  computerKeys?: boolean;
  user?: { name: string; color: string };
}

export function Basalt({ store, host, slot, computerKeys = true, user = { name: 'You', color: 'var(--fwm-me)' } }: BasaltProps) {
  const { engine, status, start } = useEngine();
  const P = usePrimitives();
  const tokens = useDeviceTokens('basalt');
  const state = useDeviceState(store);
  const m = store.manifest;
  // Standalone, this panel drives its own engine slot. Inside a host (the Studio) the host owns the
  // slot, so closing or switching this panel never silences the track.
  useDeviceSync(host ? null : engine, store, slot, 'basalt');

  // ---- notes -------------------------------------------------------------------------------
  const [held, setHeld] = useState<number[]>([]);
  const heldRef = useRef<number[]>([]);
  const [oct, setOct] = useState(2);
  const noteOn = useCallback(
    (n: number, v: number) => {
      heldRef.current = [...heldRef.current.filter((x) => x !== n), n];
      setHeld(heldRef.current);
      if (host) host.noteOn(n, v);
      else if (engine && status === 'on') engine.noteOn(slot, n, v);
      else if (status !== 'loading') {
        // First touch starts the audio (browsers need a gesture); play the note once it's up.
        void start();
      }
    },
    [engine, status, slot, start, host],
  );
  const noteOff = useCallback(
    (n: number) => {
      heldRef.current = heldRef.current.filter((x) => x !== n);
      setHeld(heldRef.current);
      if (host) host.noteOff(n);
      else engine?.noteOff(slot, n);
    },
    [engine, slot, host],
  );
  // When the engine comes up while keys are held, sound them.
  useEffect(() => {
    if (!host && engine && status === 'on') for (const n of heldRef.current) engine.noteOn(slot, n, 0.85);
  }, [engine, status, slot, host]);
  const low = 12 * (oct + 1);
  const sk = host?.songKey;
  const keyScale = sk && sk.scale !== 'chromatic' ? { has: (n: number) => inKey(n, sk), isRoot: (n: number) => isRoot(n, sk), snap: (n: number) => snapToKey(n, sk) } : undefined;
  useComputerKeys({
    enabled: computerKeys,
    base: low,
    songKey: host?.songKey,
    onNoteOn: noteOn,
    onNoteOff: noteOff,
    onOctave: (d) => setOct((o) => Math.min(6, Math.max(0, o + d))),
  });

  // ---- presets -----------------------------------------------------------------------------
  const presetIx = state.preset % BASALT_PRESETS.length;
  const loadPreset = (i: number) => {
    const n = (i + BASALT_PRESETS.length) % BASALT_PRESETS.length;
    store.load(BASALT_PRESETS[n], n);
  };
  // ---- modulation assign -------------------------------------------------------------------
  const [assign, setAssign] = useState<ModSourceId | null>(null);
  useEffect(() => {
    if (!assign) return;
    const end = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.closest('.fwm-target.is-target, .fwm-btn--assign')) return;
      setAssign(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAssign(null);
    document.addEventListener('pointerdown', end, true);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', end, true);
      document.removeEventListener('keydown', esc);
    };
  }, [assign]);
  const toggleAssign = (src: ModSourceId) => setAssign((a) => (a === src ? null : src));

  // ---- envelopes ---------------------------------------------------------------------------
  const [envTab, setEnvTab] = useState<'amp' | 'filt'>('amp');
  const mods = useModSources(engine, slot);

  const ctx: ParamCtx = { store, slot, assign, setAssign, host };
  const people = host?.people ?? [{ userId: 'me', name: user.name, color: user.color }];
  const lfoMode = state.params.lmode;
  const top = held[held.length - 1] ?? null;

  return (
    <div className={'fwm-dev' + (assign ? ' is-assigning' : '')} data-device="basalt" style={tokens as CSSProperties}>
      <div className="fwm-dev__hdr">
        <div className="fwm-plate">
          <b>
            BASAL<i>T</i>
          </b>
          <span>{host?.subtitle ? `Mono bass synth · ${host.subtitle}` : 'Mono bass synthesizer'}</span>
        </div>
        <div className="fwm-who" aria-label="People on this device">
          {people.map((p) => (
            <div key={p.userId} className="fwm-av" style={{ background: p.color }} title={p.name}>
              {p.name[0]}
            </div>
          ))}
        </div>
        <Scope engine={status === 'on' ? engine : null} note={top} />
        <Sends host={host} />
        <div className="fwm-preset">
          <P.Button variant="hw" label="Previous preset" onPress={() => loadPreset(presetIx - 1)}>‹</P.Button>
          <P.Screen variant="preset">
            {String(presetIx + 1).padStart(2, '0')} {BASALT_PRESETS[presetIx].name}
          </P.Screen>
          <P.Button variant="hw" label="Next preset" onPress={() => loadPreset(presetIx + 1)}>›</P.Button>
        </div>
      </div>

      <div className="fwm-secs">
        <section className="fwm-sec">
          <h4>Oscillator</h4>
          <div className="fwm-waves">
            {OSC_ICONS.map((k, i) => (
              <P.Button key={k} variant="wave" label={m.params[0].options![i]} icon={<WaveIcon kind={k} />}
                pressed={state.params.wave === i} onPress={() => store.setParam('wave', i)} />
            ))}
          </div>
          <div className="fwm-row">
            <ParamKnob ctx={ctx} id="tune" />
            <ParamKnob ctx={ctx} id="shape" />
            <ParamKnob ctx={ctx} id="sub" />
          </div>
        </section>

        <section className="fwm-sec">
          <h4>Filter</h4>
          <div className="fwm-row">
            <ParamKnob ctx={ctx} id="cut" size="lg" />
            <ParamKnob ctx={ctx} id="res" />
            <ParamKnob ctx={ctx} id="envamt" />
            <ParamKnob ctx={ctx} id="drive" />
          </div>
        </section>

        <section className="fwm-sec">
          <h4>Envelopes</h4>
          <div className="fwm-seg">
            <P.Button variant="seg" label="Amp" pressed={envTab === 'amp'} onPress={() => setEnvTab('amp')} />
            <P.Button variant="seg" label="Filter" pressed={envTab === 'filt'} onPress={() => setEnvTab('filt')} />
          </div>
          <P.Screen variant="readout" label={envTab === 'amp' ? 'Amp env' : 'Filter env → cutoff (Env amt)'}>
            <EnvGraph params={state.params} tab={envTab} level={mods ? mods[envTab === 'amp' ? 1 : 2] : null} />
          </P.Screen>
          <div className="fwm-env">
            {(['A', 'D', 'S', 'R'] as const).map((n) => (
              <ParamFader key={envTab + n} ctx={ctx} id={`${envTab}.${n}`} label={n} />
            ))}
          </div>
          <P.Button variant="assign" pressed={assign === envTab} label={`Assign ${SRC_LABEL[envTab]}`}
            onPress={() => toggleAssign(envTab)} />
        </section>

        <section className="fwm-sec">
          <h4>
            LFO 1<span className="fwm-led" style={{ opacity: mods ? 0.25 + 0.75 * ((mods[0] + 1) / 2) : 0.6 }} />
          </h4>
          <div className="fwm-waves">
            {LFO_ICONS.map((k, i) => (
              <P.Button key={k} variant="wave" label={`LFO 1 ${m.params[18].options![i]}`} icon={<WaveIcon kind={k} />}
                pressed={state.params.lwave === i} onPress={() => store.setParam('lwave', i)} />
            ))}
          </div>
          <div className="fwm-seg">
            {['Free', 'Retrig', 'Poly'].map((label, i) => (
              <P.Button key={label} variant="seg" label={label} pressed={lfoMode === i} onPress={() => store.setParam('lmode', i)} />
            ))}
          </div>
          <p className="fwm-silk fwm-hint">{LFO_HINT[lfoMode] ?? ''}</p>
          <div className="fwm-row">
            <ParamKnob ctx={ctx} id="lrate" />
            <ParamKnob ctx={ctx} id="lamt" />
          </div>
          <P.Button variant="assign" pressed={assign === 'lfo'} label="Assign LFO 1" onPress={() => toggleAssign('lfo')} />
          <ul className="fwm-mods">
            {state.routes.map((r, i) => {
              const t = m.params.find((p) => p.id === r.target)!;
              const tLabel = r.target.includes('.') ? `${SRC_LABEL[r.target.split('.')[0] as ModSourceId]} ${t.label}` : t.label;
              const name = `${SRC_LABEL[r.src]} → ${tLabel}`;
              return (
                <li key={r.src + r.target}>
                  <span>{name}</span>
                  <input type="range" min={-100} max={100} value={Math.round(r.depth * 100)} aria-label={`Depth of ${name}`}
                    onChange={(e) => store.setRouteDepth(i, Number(e.target.value) / 100)}
                    onPointerDown={() => host?.touch(`route:${r.src}>${r.target}`)} onPointerUp={() => host?.touch(null)} />
                  <button type="button" aria-label={`Remove ${name}`} onClick={() => store.removeRoute(i)}>×</button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="fwm-sec">
          <h4>Output</h4>
          <div className="fwm-row">
            <ParamKnob ctx={ctx} id="glide" />
            <ParamKnob ctx={ctx} id="lvl" />
          </div>
        </section>
      </div>

      <div className="fwm-perf">
        <div className="fwm-oct">
          <span className="fwm-silk">Octave</span>
          <P.Button variant="hw" label="Octave up" onPress={() => setOct((o) => Math.min(6, o + 1))}>+</P.Button>
          <P.Screen variant="readout">C{oct}</P.Screen>
          <P.Button variant="hw" label="Octave down" onPress={() => setOct((o) => Math.max(0, o - 1))}>−</P.Button>
        </div>
        <P.Keys low={low} high={low + 24} held={host?.myHeld?.length ? [...held, ...host.myHeld] : held} peerHeld={host?.peerHeld} onNoteOn={noteOn} onNoteOff={noteOff} scale={keyScale} />
      </div>
    </div>
  );
}

// ---- param-bound controls ------------------------------------------------------------------

export interface ParamCtx {
  store: DeviceStore;
  slot: number;
  assign: ModSourceId | null;
  setAssign(s: ModSourceId | null): void;
  host?: DeviceHost;
}

function useParam(ctx: ParamCtx, id: string) {
  const { engine, status } = useEngine();
  const state = useDeviceState(ctx.store);
  const m = ctx.store.manifest;
  const index = m.params.findIndex((p) => p.id === id);
  const spec = m.params[index];
  const live = useEffectiveValue(status === 'on' ? engine : null, ctx.slot, index);
  const range = modRange(state, id);
  const target = !!ctx.assign && canRoute(m, ctx.assign, id);
  const onTargetDown = (e: RPointerEvent) => {
    if (!target || !ctx.assign) return;
    e.stopPropagation();
    e.preventDefault();
    ctx.store.addRoute({ src: ctx.assign, target: id, depth: ctx.assign === 'lfo' ? 0.35 : 0.4 });
    ctx.setAssign(null);
  };
  return {
    spec,
    value: state.params[id],
    onChange: (v: number) => {
      ctx.store.setParam(id, v);
      ctx.host?.paramChanged?.(id, v);
    },
    presence: ctx.host?.presenceFor(id) ?? [],
    onGestureStart: () => ctx.host?.touch(id),
    onGestureEnd: () => ctx.host?.touch(null),
    format: (v: number) => formatParam(spec, v),
    modulation: range ? { ...range, current: live ?? undefined } : undefined,
    target,
    onTargetDown,
  };
}

export function ParamKnob({ ctx, id, size, format }: { ctx: ParamCtx; id: string; size?: 'md' | 'lg'; format?: (v: number) => string }) {
  const { Knob } = usePrimitives();
  const p = useParam(ctx, id);
  return (
    <div className={'fwm-target' + (p.target ? ' is-target' : '')} onPointerDownCapture={p.onTargetDown}>
      <Knob value={p.value} onChange={p.onChange} label={p.spec.label} format={format ?? p.format} size={size}
        modulation={p.modulation} defaultValue={p.spec.default} presence={p.presence}
        onGestureStart={p.onGestureStart} onGestureEnd={p.onGestureEnd} />
    </div>
  );
}

function ParamFader({ ctx, id, label }: { ctx: ParamCtx; id: string; label: string }) {
  const { Fader } = usePrimitives();
  const p = useParam(ctx, id);
  return (
    <div className={'fwm-target' + (p.target ? ' is-target' : '')} onPointerDownCapture={p.onTargetDown}>
      <Fader value={p.value} onChange={p.onChange} label={label} format={p.format} modulation={p.modulation}
        defaultValue={p.spec.default} presence={p.presence} onGestureStart={p.onGestureStart} onGestureEnd={p.onGestureEnd} />
    </div>
  );
}

/** ADSR shape of the selected envelope, with the other one faint behind it, and the live level. */
function EnvGraph({ params, tab, level }: { params: Readonly<Record<string, number>>; tab: 'amp' | 'filt'; level: number | null }) {
  const path = (e: string) => {
    const a = params[`${e}.A`] * 45 + 2;
    const d = params[`${e}.D`] * 55 + 2;
    const r = params[`${e}.R`] * 55 + 2;
    const s = 48 - params[`${e}.S`] * 40;
    const hold = 196 - a - d - r;
    return `M2 48 L${2 + a} 8 L${2 + a + d} ${s} L${2 + a + d + hold} ${s} L${2 + a + d + hold + r} 48`;
  };
  const other = tab === 'amp' ? 'filt' : 'amp';
  return (
    <svg viewBox="0 0 200 50" preserveAspectRatio="none" className="fwm-envgraph">
      <path d={path(other)} className="fwm-envgraph__other" />
      <path d={path(tab)} className="fwm-envgraph__main" />
      {level != null && level > 0.001 && <line x1="0" x2="200" y1={48 - level * 40} y2={48 - level * 40} className="fwm-envgraph__level" />}
    </svg>
  );
}
