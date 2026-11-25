// Opal: pad synth, front panel. The synth family layout: two oscillator rows with the FILTER block on
// the right, then AMP and MOTION (Drift, Movement, the ensemble chorus, Width). Only theme primitives
// and --dev-* tokens.
import { useEffect, useState, type CSSProperties } from 'react';
import type { ModSourceId } from '@fwm/engine';
import { useEngine } from '../../engine/EngineProvider';
import { useDeviceState, useDeviceSync, useModSources } from '../../engine/useDeviceSync';
import { useDeviceTokens, usePrimitives } from '../../theme/Theme';
import { ParamKnob, type DeviceProps, type ParamCtx } from '../basalt/Basalt';
import { StepDial, defaultsOf } from '../garnet/Garnet';
import { Scope } from '../Scope';
import { Sends } from '../Sends';
import { OPAL_FORMAT, OPAL_PRESETS } from './presets';

const CHORUS = ['Off', 'I', 'II', 'I+II'];
const SRC: [ModSourceId, string][] = [['lfo', 'LFO'], ['amp', 'Amp env'], ['filt', 'Swell env']];
const SRC_LABEL = Object.fromEntries(SRC) as Record<ModSourceId, string>;

export function Opal({ store, host, slot, user = { name: 'You', color: 'var(--fwm-me)' } }: DeviceProps) {
  const { engine, status } = useEngine();
  const P = usePrimitives();
  const tokens = useDeviceTokens('opal');
  const state = useDeviceState(store);
  useDeviceSync(host ? null : engine, store, slot, 'opal');

  const presetIx = state.preset % OPAL_PRESETS.length;
  const edited = Object.entries({ ...defaultsOf(store), ...OPAL_PRESETS[presetIx].params }).some(([id, v]) => Math.abs((state.params[id] ?? 0) - v) > 1e-6);
  const loadPreset = (i: number) => {
    const n = (i + OPAL_PRESETS.length) % OPAL_PRESETS.length;
    store.load(OPAL_PRESETS[n], n);
  };
  const set = (id: string, v: number) => {
    store.setParam(id, v);
    host?.paramChanged?.(id, v);
  };
  const people = host?.people ?? [{ userId: 'me', name: user.name, color: user.color }];
  // modulation, as on Basalt: press Assign, then click the knob it should move
  const [assign, setAssign] = useState<ModSourceId | null>(null);
  useEffect(() => {
    if (!assign) return;
    const end = (e: Event) => {
      if ((e.target as HTMLElement).closest('.fwm-target.is-target, .fwm-btn--assign')) return;
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
  const mods = useModSources(status === 'on' ? engine : null, slot);
  const ctx: ParamCtx = { store, slot, assign, setAssign, host };
  const knob = (id: string, size?: 'lg') => <ParamKnob key={id} ctx={ctx} id={id} size={size} format={OPAL_FORMAT[id]} />;
  const m = store.manifest;
  const dial = (id: string) => <StepDial key={id} store={store} host={host} id={id} set={set} />;
  const chorus = Math.round(state.params.chorus ?? 0);

  return (
    <div className="fwm-dev fwm-opal" data-device="opal" style={tokens as CSSProperties}>
      <div className="fwm-dev__hdr">
        <div className="fwm-plate">
          <b>
            OPA<i>L</i>
          </b>
          <span>{host?.subtitle ? `Pad synth · ${host.subtitle}` : 'Pad synth · 8 voices'}</span>
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
          <P.Button variant="hw" label="Previous sound" onPress={() => loadPreset(presetIx - 1)}>‹</P.Button>
          <P.Screen variant="preset">
            {String(presetIx + 1).padStart(2, '0')} {OPAL_PRESETS[presetIx].name}
            {edited && <small className="fwm-garnet__edited"> edited</small>}
          </P.Screen>
          <P.Button variant="hw" label="Next sound" onPress={() => loadPreset(presetIx + 1)}>›</P.Button>
          <Scope engine={status === 'on' ? engine : null} note={null} label="Pad" />
        </div>
      </div>

      <div className="fwm-garnet__face fwm-opal__face">
        <div>
          <div className="fwm-brk">Oscillators</div>
          <div className="fwm-garnet__row">
            <span className="fwm-garnet__rn">OSC 1</span>
            {dial('w1')}
            {knob('shape')}
            {dial('stack')}
            {knob('detune')}
          </div>
          <div className="fwm-garnet__row">
            <span className="fwm-garnet__rn">OSC 2</span>
            {dial('w2')}
            {dial('int2')}
            {knob('fine2')}
            {knob('mix2')}
            {knob('air')}
          </div>
        </div>
        <div>
          <div className="fwm-brk">Filter</div>
          <div className="fwm-opal__filter">
            {knob('cut', 'lg')}
            {knob('res', 'lg')}
            {knob('fenv')}
            {knob('swell')}
          </div>
        </div>
      </div>

      <div className="fwm-opal__low">
        <div>
          <div className="fwm-brk">Amp</div>
          <div className="fwm-garnet__play">{['atk', 'dec', 'sus', 'rel'].map((id) => knob(id))}</div>
        </div>
        <div>
          <div className="fwm-brk">Motion</div>
          <div className="fwm-garnet__play">
            {['drift', 'rate', 'move'].map((id) => knob(id))}
            <div className="fwm-opal__chorus">
              <span className="fwm-silk">Chorus</span>
              <div className="fwm-seg" role="group" aria-label="Chorus">
                {CHORUS.map((c, i) => (
                  <P.Button key={c} variant="seg" label={c === 'Off' ? 'Chorus off' : `Chorus ${c}`} pressed={chorus === i}
                    presence={i === chorus ? host?.presenceFor('chorus') : undefined} onPress={() => set('chorus', i)}>{c}</P.Button>
                ))}
              </div>
            </div>
            {['width', 'lvl'].map((id) => knob(id))}
          </div>
        </div>
      </div>

      <div className="fwm-brk">Modulation</div>
      <div className="fwm-opal__mod">
        <div className="fwm-seg" role="group" aria-label="LFO wave">
          {m.params.find((p) => p.id === 'lwave')!.options!.map((w, i) => (
            <P.Button key={w} variant="seg" label={`LFO ${w}`} pressed={Math.round(state.params.lwave ?? 0) === i} onPress={() => set('lwave', i)}>{w}</P.Button>
          ))}
        </div>
        {SRC.map(([id, label], i) => (
          <span key={id} className="fwm-opal__src">
            <span className="fwm-led" style={{ opacity: mods ? 0.25 + 0.75 * (id === 'lfo' ? (mods[0] + 1) / 2 : mods[i]) : 0.6 }} />
            <P.Button variant="assign" pressed={assign === id} label={`Assign ${label}`} onPress={() => setAssign((a) => (a === id ? null : id))} />
          </span>
        ))}
        <p className="fwm-silk fwm-opal__hint">{assign ? `Now click the knob ${SRC_LABEL[assign]} should move (Esc: cancel).` : 'Press Assign, then click a knob: the LFO (Rate, wave) or an envelope of the note played last moves it.'}</p>
        <ul className="fwm-mods">
          {state.routes.map((r, i) => {
            const name = `${SRC_LABEL[r.src]} → ${m.params.find((p) => p.id === r.target)?.label ?? r.target}`;
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
      </div>
    </div>
  );
}
