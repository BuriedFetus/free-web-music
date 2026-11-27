// Opal: pad synth, front panel. The synth family layout: two oscillator rows with the FILTER block on
// the right, then AMP and MOTION (Drift, Movement, the ensemble chorus, Width). Only theme primitives
// and --dev-* tokens.
import { type CSSProperties } from 'react';
import type { ModSourceId } from '@fwm/engine';
import { useEngine } from '../../engine/EngineProvider';
import { useDeviceState, useDeviceSync } from '../../engine/useDeviceSync';
import { useDeviceTokens, usePrimitives } from '../../theme/Theme';
import { ParamKnob, type DeviceProps, type ParamCtx } from '../basalt/Basalt';
import { StepDial, defaultsOf } from '../garnet/Garnet';
import { Scope } from '../Scope';
import { PanelKeys } from '../PanelKeys';
import { ModRow, useAssign } from '../ModRow';
import { Sends } from '../Sends';
import { OPAL_FORMAT, OPAL_PRESETS } from './presets';

const CHORUS = ['Off', 'I', 'II', 'I+II'];
const SRC_LABEL: Record<ModSourceId, string> = { lfo: 'LFO', amp: 'Amp env', filt: 'Swell env' };

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
  const [assign, setAssign] = useAssign();
  const ctx: ParamCtx = { store, slot, assign, setAssign, host };
  const knob = (id: string, size?: 'lg') => <ParamKnob key={id} ctx={ctx} id={id} size={size} format={OPAL_FORMAT[id]} />;
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
          <Scope engine={status === 'on' && !host?.preview ? engine : null} note={null} label="Pad" />
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

      <ModRow ctx={ctx} labels={SRC_LABEL} hint="Press Assign, then click a knob: the LFO (Rate, wave) or an envelope of the note played last moves it." />

      <PanelKeys host={host} slot={slot} />
    </div>
  );
}
