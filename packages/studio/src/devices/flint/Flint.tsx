// Flint: drum machine, front panel. Layout follows the approved mock-up (design/kit/flint.html):
// kit screen, 8 pads, and the sound editor for the selected pad. Only theme primitives and --dev-* tokens.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useEngine } from '../../engine/EngineProvider';
import { useDeviceState, useDeviceSync } from '../../engine/useDeviceSync';
import { useComputerKeys } from '../../hooks/useComputerKeys';
import type { DeviceStore } from '../../model/deviceStore';
import { formatParam } from '../../model/params';
import { useDeviceTokens, usePrimitives } from '../../theme/Theme';
import type { DeviceHost, DeviceProps } from '../basalt/Basalt';
import { CHARACTER_HINT, CHARACTERS, DRUM_TYPES, FIRST_PAD, FLINT_KITS, kitIsEdited } from './kits';

const PADS = 8;

export function Flint({ store, host, slot, computerKeys = true, user = { name: 'You', color: 'var(--fwm-me)' } }: DeviceProps) {
  const { engine, status, start } = useEngine();
  const P = usePrimitives();
  const tokens = useDeviceTokens('flint');
  const state = useDeviceState(store);
  useDeviceSync(host ? null : engine, store, slot, 'flint');
  const [sel, setSel] = useState(0);
  const [lit, setLit] = useState<number[]>([]);
  const timers = useRef(new Map<number, number>());

  const flash = (pad: number) => {
    setLit((l) => (l.includes(pad) ? l : [...l, pad]));
    clearTimeout(timers.current.get(pad));
    timers.current.set(pad, window.setTimeout(() => setLit((l) => l.filter((x) => x !== pad)), 120));
  };
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  const noteOn = useCallback(
    (n: number, v: number) => {
      const pad = n - FIRST_PAD;
      if (pad >= 0 && pad < PADS) flash(pad);
      if (host) host.noteOn(n, v);
      else if (engine && status === 'on') engine.noteOn(slot, n, v);
      else if (status !== 'loading') void start();
    },
    [engine, status, slot, start, host],
  );
  const noteOff = useCallback((n: number) => (host ? host.noteOff(n) : engine?.noteOff(slot, n)), [engine, slot, host]);
  useComputerKeys({ enabled: computerKeys, base: FIRST_PAD, layout: 'pads', onNoteOn: noteOn, onNoteOff: noteOff });

  // Pads other people are hitting light up too.
  const peerPads = new Set((host?.peerHeld ?? []).map((h) => h.note - FIRST_PAD));

  const kitIx = state.preset % FLINT_KITS.length;
  const edited = kitIsEdited(state.params, kitIx);
  const loadKit = (i: number) => {
    const n = (i + FLINT_KITS.length) % FLINT_KITS.length;
    store.load(FLINT_KITS[n], n);
  };
  const people = host?.people ?? [{ userId: 'me', name: user.name, color: user.color }];
  const pad = (i: number, k: string) => state.params[`p${i + 1}.${k}`] ?? 0;
  const set = (id: string, v: number) => {
    store.setParam(id, v);
    host?.paramChanged?.(id, v);
  };
  const selType = pad(sel, 'type');
  const selChar = pad(sel, 'model');

  return (
    <div className="fwm-dev fwm-flint" data-device="flint" style={tokens as CSSProperties}>
      <div className="fwm-dev__hdr">
        <div className="fwm-plate">
          <b>
            FLIN<i>T</i>
          </b>
          <span>{host?.subtitle ? `Drum machine · ${host.subtitle}` : 'Drum machine · 8 pads'}</span>
        </div>
        <div className="fwm-who" aria-label="People on this device">
          {people.map((p) => (
            <div key={p.userId} className="fwm-av" style={{ background: p.color }} title={p.name}>
              {p.name[0]}
            </div>
          ))}
        </div>
        <div className="fwm-preset">
          <P.Button variant="hw" label="Previous kit" onPress={() => loadKit(kitIx - 1)}>‹</P.Button>
          <P.Screen variant="preset">
            {String(kitIx + 1).padStart(2, '0')} {FLINT_KITS[kitIx].name}
            {edited && <small className="fwm-flint__edited"> edited</small>}
          </P.Screen>
          <P.Button variant="hw" label="Next kit" onPress={() => loadKit(kitIx + 1)}>›</P.Button>
        </div>
      </div>

      <div className="fwm-flint__body">
        <section className="fwm-sec">
          <h4>Pads</h4>
          <div className="fwm-pads" role="group" aria-label="Pads (keys A S D F G H J K)">
            {Array.from({ length: PADS }, (_, i) => (
              <button key={i} type="button" data-pad={i}
                className={'fwm-pad' + (i === sel ? ' is-sel' : '') + (lit.includes(i) || peerPads.has(i) ? ' is-hit' : '')}
                aria-label={`Pad ${i + 1}: ${DRUM_TYPES[pad(i, 'type')]}, ${CHARACTERS[pad(i, 'model')]}`}
                aria-pressed={i === sel}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  setSel(i);
                  noteOn(FIRST_PAD + i, 0.9);
                }}
                onPointerUp={() => noteOff(FIRST_PAD + i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setSel(i);
                    noteOn(FIRST_PAD + i, 0.9);
                  }
                }}>
                <span className="fwm-pad__n">{i + 1}</span>
                <span className="fwm-pad__led" />
                <b>{DRUM_TYPES[pad(i, 'type')]}</b>
                <small>{CHARACTERS[pad(i, 'model')]}</small>
              </button>
            ))}
          </div>
          <div className="fwm-row">
            <FlintKnob store={store} host={host} id="accent" set={set} />
            <FlintKnob store={store} host={host} id="lvl" set={set} />
          </div>
          <p className="fwm-silk fwm-hint">Accent: how much louder accented steps play, for the whole kit.</p>
        </section>

        <section className="fwm-sec">
          <h4>Pad {sel + 1} sound</h4>
          <div className="fwm-flint__line">
            <span className="fwm-silk">Drum</span>
            <div className="fwm-seg fwm-seg--wrap" role="group" aria-label={`Pad ${sel + 1} drum`}>
              {DRUM_TYPES.map((t, i) => (
                <P.Button key={t} variant="seg" label={t} pressed={selType === i}
                  onPress={() => { set(`p${sel + 1}.type`, i); noteOn(FIRST_PAD + sel, 0.9); }} />
              ))}
            </div>
          </div>
          <div className="fwm-flint__line">
            <span className="fwm-silk">Character</span>
            <div className="fwm-seg" role="group" aria-label={`Pad ${sel + 1} character`}>
              {CHARACTERS.map((c, i) => (
                <P.Button key={c} variant="seg" label={c} pressed={selChar === i}
                  onPress={() => { set(`p${sel + 1}.model`, i); noteOn(FIRST_PAD + sel, 0.9); }} />
              ))}
            </div>
          </div>
          <p className="fwm-silk fwm-hint">{CHARACTER_HINT[selChar]}</p>
          <div className="fwm-row">
            {(['tune', 'decay', 'tone', 'level'] as const).map((k) => (
              <FlintKnob key={k + sel} store={store} host={host} id={`p${sel + 1}.${k}`} set={set}
                onEnd={() => noteOn(FIRST_PAD + sel, 0.9)} />
            ))}
          </div>
          <p className="fwm-flint__later">Sample: later. The goal is a pad that plays your own sound without anyone having to download it from a server.</p>
        </section>
      </div>
    </div>
  );
}

function FlintKnob({ store, host, id, set, onEnd }: { store: DeviceStore; host?: DeviceHost; id: string; set(id: string, v: number): void; onEnd?(): void }) {
  const { Knob } = usePrimitives();
  const state = useDeviceState(store);
  const spec = store.manifest.params.find((p) => p.id === id)!;
  return (
    <Knob value={state.params[id]} onChange={(v) => set(id, v)} label={spec.label} format={(v) => formatParam(spec, v)}
      defaultValue={spec.default} presence={host?.presenceFor(id) ?? []}
      onGestureStart={() => host?.touch(id)}
      onGestureEnd={() => {
        host?.touch(null);
        onEnd?.();
      }} />
  );
}
