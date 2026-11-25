// Mixer: one strip per instrument (in the Song arrangement's order) and the master.
// Strip: nameplate (click = select the instrument), Mute and Solo, Reverb and Delay sends, Pan, level
// fader with a live meter. Maximised (the panel's ⤢), the effects chain shows under the strips.
// Mute is the instrument's one Mute (the same as in the Song arrangement). Everything is in the shared
// song, so others see the faders move and a ring on the control someone is touching.
import { useEffect, useRef, type CSSProperties } from 'react';
import { MASTER_METER } from '@fwm/engine';
import type { Peer } from '../../collab/presence';
import { useEngine } from '../../engine/EngineProvider';
import { FX_NAMES } from '../../model/fx';
import { DEFAULT_MIX, faderDb, type TrackInfo } from '../../model/project';
import { useDeviceTokens, usePrimitives } from '../../theme/Theme';
import { useStudio } from '../context';
import { toPresence } from './common';
import { FxRack } from './FxRack';

const MASTER = 'master'; // presence "track" for the master strip
const fmtDb = (v: number) => {
  const db = faderDb(v);
  return db === -Infinity ? '−∞ dB' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
};
const fmtPan = (v: number) => {
  const p = Math.round((v * 2 - 1) * 100);
  return p === 0 ? 'C' : p < 0 ? `L${-p}` : `R${p}`;
};

/**
 * A peak meter (L and R bars), fed straight from the engine's ticks and drawn without React
 * re-rendering: bars fall back smoothly, a thin line holds the recent peak, red near 0 dBFS.
 */
function Meter({ index, label }: { index: number; label: string }) {
  const { engine } = useEngine();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!engine) return;
    const shown = [0, 0];
    const hold = [0, 0];
    const holdAge = [0, 0];
    const toPct = (pk: number) => Math.max(0, Math.min(100, (1 + Math.log10(pk + 1e-9) * 20 / 48) * 100)); // -48 dB … 0 dB
    return engine.subscribe((m) => {
      const el = ref.current;
      if (!el || !m.meters) return;
      for (let s = 0; s < 2; s++) {
        const pct = toPct(m.meters[index + s] ?? 0);
        shown[s] = Math.max(pct, shown[s] - 2.5);
        if (pct >= hold[s] || ++holdAge[s] > 60) {
          hold[s] = pct;
          holdAge[s] = 0;
        }
        const bar = el.children[s] as HTMLElement;
        bar.style.setProperty('--lvl', shown[s] + '%');
        bar.style.setProperty('--hold', hold[s] + '%');
        bar.classList.toggle('is-hot', (m.meters[index + s] ?? 0) > 0.98);
      }
    });
  }, [engine, index]);
  return (
    <div className="fwm-meter" ref={ref} role="img" aria-label={`${label} level meter`}>
      <i />
      <i />
    </div>
  );
}

export function MixerView({ peers, expanded = false, onExpand }: { peers: Peer[]; expanded?: boolean; onExpand?(): void }) {
  const { project, ws, setWs, presence, slotOf } = useStudio();
  const P = usePrimitives();
  const tokens = useDeviceTokens('mixer');
  const tracks = project.tracks();
  const anySolo = tracks.some((t) => project.mix(t.id).solo);
  const who = (track: string, control: string) => peers.filter((p) => p.touch?.track === track && p.touch.control === control).map(toPresence);
  const touch = (track: string, control: string | null) => presence.set({ touch: control ? { track, control } : null });

  const strip = (t: TrackInfo) => {
    const mix = project.mix(t.id);
    const slot = slotOf(t.id);
    const silent = t.seq.mute || (anySolo && !mix.solo);
    return (
      <div key={t.id} className={'fwm-strip' + (ws.track === t.id ? ' is-sel' : '') + (silent ? ' is-silent' : '')} role="group" aria-label={`${t.name} channel`}>
        <button type="button" className="fwm-strip__plate" data-device={t.device} onClick={() => setWs({ track: t.id })}
          title={`${t.name}: select this instrument`} aria-pressed={ws.track === t.id}>
          {t.name}
        </button>
        <span className="fwm-strip__ms">
          <button type="button" className="fwm-ms fwm-ms--m" aria-pressed={t.seq.mute} aria-label={`Mute ${t.name}`}
            title="Mute (the same Mute as in the Song arrangement)" onClick={() => project.setSeq(t.id, { mute: !t.seq.mute })}>M</button>
          <button type="button" className="fwm-ms fwm-ms--s" aria-pressed={mix.solo} aria-label={`Solo ${t.name}`}
            title="Solo: hear only the soloed instruments" onClick={() => project.setMix(t.id, { solo: !mix.solo })}>S</button>
        </span>
        <div className="fwm-strip__sends">
          <P.Knob label="Reverb" value={mix.rev} defaultValue={0} format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => project.setMix(t.id, { rev: v })}
            presence={who(t.id, 'mix.rev')} onGestureStart={() => touch(t.id, 'mix.rev')} onGestureEnd={() => touch(t.id, null)} />
          <P.Knob label="Delay" value={mix.dly} defaultValue={0} format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => project.setMix(t.id, { dly: v })}
            presence={who(t.id, 'mix.dly')} onGestureStart={() => touch(t.id, 'mix.dly')} onGestureEnd={() => touch(t.id, null)} />
        </div>
        <div className="fwm-strip__knobs">
          <P.Knob label="Pan" value={(mix.pan + 1) / 2} defaultValue={0.5} format={fmtPan}
            onChange={(v) => project.setMix(t.id, { pan: Math.round((v * 2 - 1) * 100) / 100 })}
            presence={who(t.id, 'mix.pan')} onGestureStart={() => touch(t.id, 'mix.pan')} onGestureEnd={() => touch(t.id, null)} />
        </div>
        <div className="fwm-strip__fader">
          {slot != null && <Meter index={slot * 2} label={t.name} />}
          <P.Fader label="Level" size="lg" value={mix.level} defaultValue={DEFAULT_MIX.level} format={fmtDb}
            onChange={(v) => project.setMix(t.id, { level: v })}
            presence={who(t.id, 'mix.level')} onGestureStart={() => touch(t.id, 'mix.level')} onGestureEnd={() => touch(t.id, null)} />
        </div>
        <span className="fwm-strip__db">{fmtDb(mix.level)}</span>
      </div>
    );
  };

  return (
    <div className={'fwm-mixer mixer' + (expanded ? ' is-expanded' : '')} data-device="mixer" style={tokens as CSSProperties}>
      <div className="fwm-mixer__desk">
        {tracks.length ? tracks.map(strip) : <p className="fwm-mixer__empty">Bring an instrument in from the Library: it gets a strip here.</p>}
        <div className="fwm-strip fwm-strip--master" role="group" aria-label="Master">
          <div className="fwm-strip__plate fwm-strip__plate--master">MASTER</div>
          <span className="fwm-strip__ms" aria-hidden="true" />
          <button type="button" className="fwm-strip__chain" onClick={onExpand} disabled={expanded}
            title={expanded ? 'The effects chain is below' : 'Show the effects (maximises this panel)'}>
            {project.fxChain.filter((id) => project.fx(id + '.on')).map((id) => FX_NAMES[id]).join(' ➜ ') || 'No effects'}
            {!expanded && <span className="fwm-strip__chainx"> ⤢</span>}
          </button>
          <div className="fwm-strip__knobs" aria-hidden="true" />
          <div className="fwm-strip__fader">
            <Meter index={MASTER_METER} label="Master" />
            <P.Fader label="Master" size="lg" value={project.masterLevel} defaultValue={DEFAULT_MIX.level} format={fmtDb}
              onChange={(v) => project.setMasterLevel(v)}
              presence={who(MASTER, 'mix.level')} onGestureStart={() => touch(MASTER, 'mix.level')} onGestureEnd={() => touch(MASTER, null)} />
          </div>
          <span className="fwm-strip__db">{fmtDb(project.masterLevel)}</span>
        </div>
      </div>
      {expanded && <FxRack peers={peers} />}
    </div>
  );
}
