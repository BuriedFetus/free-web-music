// Quartz: FM keys, front panel. The synth family layout: two rows (each a carrier pushed by its own
// modulator) with the FILTER block on the right, then AMP and PLAY. Only theme primitives and --dev-* tokens.
import { type CSSProperties } from 'react';
import { useEngine } from '../../engine/EngineProvider';
import { useDeviceState, useDeviceSync } from '../../engine/useDeviceSync';
import { useDeviceTokens, usePrimitives } from '../../theme/Theme';
import type { DeviceProps } from '../basalt/Basalt';
import { GKnob, StepDial, defaultsOf } from '../garnet/Garnet';
import { Scope } from '../Scope';
import { Sends } from '../Sends';
import { QUARTZ_FORMAT, QUARTZ_PRESETS } from './presets';

export function Quartz({ store, host, slot, user = { name: 'You', color: 'var(--fwm-me)' } }: DeviceProps) {
  const { engine, status } = useEngine();
  const P = usePrimitives();
  const tokens = useDeviceTokens('quartz');
  const state = useDeviceState(store);
  useDeviceSync(host ? null : engine, store, slot, 'quartz');

  const presetIx = state.preset % QUARTZ_PRESETS.length;
  const edited = Object.entries({ ...defaultsOf(store), ...QUARTZ_PRESETS[presetIx].params }).some(([id, v]) => Math.abs((state.params[id] ?? 0) - v) > 1e-6);
  const loadPreset = (i: number) => {
    const n = (i + QUARTZ_PRESETS.length) % QUARTZ_PRESETS.length;
    store.load(QUARTZ_PRESETS[n], n);
  };
  const set = (id: string, v: number) => {
    store.setParam(id, v);
    host?.paramChanged?.(id, v);
  };
  const people = host?.people ?? [{ userId: 'me', name: user.name, color: user.color }];
  const knob = (id: string, size?: 'lg') => <GKnob key={id} store={store} host={host} id={id} set={set} size={size} fmt={QUARTZ_FORMAT} />;
  const dial = (id: string) => <StepDial key={id} store={store} host={host} id={id} set={set} />;

  return (
    <div className="fwm-dev fwm-opal fwm-quartz" data-device="quartz" style={tokens as CSSProperties}>
      <div className="fwm-dev__hdr">
        <div className="fwm-plate">
          <b>
            QUART<i>Z</i>
          </b>
          <span>{host?.subtitle ? `FM keys · ${host.subtitle}` : 'FM keys · 8 voices'}</span>
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
            {String(presetIx + 1).padStart(2, '0')} {QUARTZ_PRESETS[presetIx].name}
            {edited && <small className="fwm-garnet__edited"> edited</small>}
          </P.Screen>
          <P.Button variant="hw" label="Next sound" onPress={() => loadPreset(presetIx + 1)}>›</P.Button>
          <Scope engine={status === 'on' ? engine : null} note={null} label="Keys" />
        </div>
      </div>

      <div className="fwm-garnet__face fwm-opal__face">
        <div>
          <div className="fwm-brk">Operators</div>
          {[1, 2].map((r) => (
            <div key={r} className="fwm-garnet__row">
              <span className="fwm-garnet__rn">ROW {r}</span>
              {dial(`w${r}`)}
              {dial(`pitch${r}`)}
              {dial(`harm${r}`)}
              {knob(`depth${r}`)}
              {knob(`env${r}`)}
              {knob(`lvl${r}`)}
            </div>
          ))}
        </div>
        <div>
          <div className="fwm-brk">Filter</div>
          <div className="fwm-opal__filter">
            {knob('cut', 'lg')}
            {knob('res', 'lg')}
            {knob('touch')}
          </div>
        </div>
      </div>

      <div className="fwm-opal__low">
        <div>
          <div className="fwm-brk">Amp</div>
          <div className="fwm-garnet__play">{['atk', 'dec', 'sus', 'rel'].map((id) => knob(id))}</div>
        </div>
        <div>
          <div className="fwm-brk">Play</div>
          <div className="fwm-garnet__play">{['trem', 'trate', 'drive', 'lvl'].map((id) => knob(id))}</div>
        </div>
      </div>
    </div>
  );
}
