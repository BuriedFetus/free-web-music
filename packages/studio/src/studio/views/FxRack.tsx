// The effects chain: its own panel (Effects in the panel menu), and below the Mixer when that panel is maximised. It is drawn the way the sound flows:
// INSTRUMENTS ➜ effect ➜ effect ➜ … ➜ MASTER. Drag an effect by its title to move it (or ◀ ▶),
// onto the shelf to take it out (or ×), and back from the shelf to put it in. Shared like the rest.
import { useRef, useState, type DragEvent } from 'react';
import type { Peer } from '../../collab/presence';
import {
  DELAY_DIVS, FX_DEFAULTS, FX_NAMES, LOFI_KEYS, delayToneHz, fmtHz, lofiAgeHz, lowpassHz, lowpassQ, reverbSeconds, reverbToneHz,
  type FxId, type LofiKey,
} from '../../model/fx';
import { usePrimitives } from '../../theme/Theme';
import { useStudio } from '../context';
import { toPresence } from './common';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const LOFI_LABELS: Record<LofiKey, string> = { wow: 'Wow', flutter: 'Flutter', saturation: 'Saturation', age: 'Age', noise: 'Noise', crackle: 'Crackle', mix: 'Mix' };
const SUB: Record<FxId, string> = {
  reverb: "fed by the strips' Reverb knobs",
  delay: "fed by the strips' Delay knobs",
  lofi: 'tape & vinyl',
  lowpass: 'sweep the whole song',
};

export function FxRack({ peers }: { peers: Peer[] }) {
  const { project, presence } = useStudio();
  const P = usePrimitives();
  const chain = project.fxChain;
  const shelf = project.fxShelf;
  const flow = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<FxId | null>(null);
  const [drop, setDrop] = useState<number | 'shelf' | null>(null);
  const get = (k: string) => project.fx(k);
  const num = (k: string) => Number(get(k));
  const who = (k: string) => peers.filter((p) => p.touch?.track === 'fx' && p.touch.control === k).map(toPresence);
  const touch = (k: string | null) => presence.set({ touch: k ? { track: 'fx', control: k } : null });
  const knob = (k: string, label: string, format: (v: number) => string, size: 'md' | 'lg' = 'md') => (
    <P.Knob key={k} label={label} size={size} value={num(k)} defaultValue={Number(FX_DEFAULTS[k])} format={format}
      onChange={(v) => project.setFx(k, v)} presence={who(k)} onGestureStart={() => touch(k)} onGestureEnd={() => touch(null)} />
  );
  const move = (id: FxId, to: number | null) => {
    const c = chain.filter((x) => x !== id);
    if (to != null) c.splice(Math.max(0, Math.min(to, c.length)), 0, id);
    project.setFxChain(c);
  };
  // Where a drop lands in the chain: before the first effect whose middle is right of the pointer.
  const dropIndex = (x: number) => {
    const units = [...(flow.current?.querySelectorAll<HTMLElement>('.fwm-fxu') ?? [])].filter((u) => u.dataset.fx !== drag);
    const i = units.findIndex((u) => {
      const r = u.getBoundingClientRect();
      return x < r.left + r.width / 2;
    });
    return i < 0 ? units.length : i;
  };
  const startDrag = (id: FxId) => (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    const unit = (e.currentTarget as HTMLElement).closest('.fwm-fxu');
    if (unit) e.dataTransfer.setDragImage(unit, 30, 20);
    setDrag(id);
  };
  const endDrag = () => {
    setDrag(null);
    setDrop(null);
  };
  const others = chain.filter((x) => x !== drag);

  const body = (id: FxId) => {
    if (id === 'reverb')
      return (
        <>
          <Pic kind="reverb" get={num} />
          <div className="fwm-fxu__knobs">
            {knob('reverb.size', 'Size', (v) => reverbSeconds(v).toFixed(1) + ' s')}
            {knob('reverb.predelay', 'Pre-delay', (v) => Math.round(v * 100) + ' ms')}
            {knob('reverb.tone', 'Tone', (v) => fmtHz(reverbToneHz(v)))}
            {knob('reverb.return', 'Return', pct)}
          </div>
        </>
      );
    if (id === 'delay')
      return (
        <>
          <Pic kind="delay" get={num} pingpong={!!get('delay.pingpong')} />
          <div className="fwm-fxu__seg" role="group" aria-label="Delay time">
            {DELAY_DIVS.map(([label], i) => (
              <button key={label} type="button" className="fwm-tb fwm-tb--xs" aria-pressed={num('delay.div') === i}
                title={`Echo every ${label} note, in time with the song`} onClick={() => project.setFx('delay.div', i)}>{label}</button>
            ))}
            <button type="button" className="fwm-tb fwm-tb--xs" aria-pressed={!!get('delay.pingpong')}
              title="Echoes bounce left and right" onClick={() => project.setFx('delay.pingpong', !get('delay.pingpong'))}>Ping-pong</button>
          </div>
          <div className="fwm-fxu__knobs">
            {knob('delay.feedback', 'Feedback', pct)}
            {knob('delay.tone', 'Tone', (v) => fmtHz(delayToneHz(v)))}
            {knob('delay.return', 'Return', pct)}
          </div>
        </>
      );
    if (id === 'lofi') {
      const style = get('lofi.style') === 'vinyl' ? 'vinyl' : 'tape';
      return (
        <>
          <Pic kind="lofi" get={(k) => num(k.replace('lofi.', `lofi.${style}.`))} />
          <div className="fwm-fxu__seg" role="group" aria-label="Style">
            {(['tape', 'vinyl'] as const).map((st) => (
              <button key={st} type="button" className="fwm-tb fwm-tb--xs" aria-pressed={style === st}
                title={st === 'tape' ? 'Tape: wobble, warmth, hiss (keeps its own settings)' : 'Vinyl: subtle wobble, darker, surface noise and crackle (keeps its own settings)'}
                onClick={() => project.setFx('lofi.style', st)}>{st === 'tape' ? 'Tape' : 'Vinyl'}</button>
            ))}
          </div>
          <div className="fwm-fxu__knobs">
            {LOFI_KEYS.map((k) => knob(`lofi.${style}.${k}`, LOFI_LABELS[k], k === 'age' ? (v) => fmtHz(lofiAgeHz(v)) : pct))}
          </div>
        </>
      );
    }
    return (
      <>
        <Pic kind="lowpass" get={num} />
        <div className="fwm-fxu__knobs fwm-fxu__knobs--lp">
          {knob('lowpass.cutoff', 'Cutoff', (v) => (v >= 0.999 ? 'Open' : fmtHz(lowpassHz(v))), 'lg')}
          {knob('lowpass.resonance', 'Resonance', (v) => lowpassQ(v).toFixed(1))}
        </div>
      </>
    );
  };

  const unit = (id: FxId, i: number) => {
    const on = !!get(id + '.on');
    const name = FX_NAMES[id];
    const cls = 'fwm-fxu' + (on ? '' : ' is-off') + (drag === id ? ' is-dragging' : '')
      + (drop === others.indexOf(id) && drag !== id ? ' is-drop-before' : '')
      + (drop === others.length && others[others.length - 1] === id ? ' is-drop-after' : '');
    return (
      <div key={id} className={cls} data-fx={id} role="group" aria-label={`${name} (step ${i + 1} of the chain)`}>
        <div className="fwm-fxu__h" draggable onDragStart={startDrag(id)} onDragEnd={endDrag}
          title={`Drag to move ${name} in the chain, or onto the shelf to take it out`}>
          <span className="fwm-fxu__grip" aria-hidden="true">⠿</span>
          <b>{name}</b>
          <span className="fwm-fxu__mv">
            <button type="button" disabled={i === 0} aria-label={`Move ${name} earlier`} title="Earlier in the chain" onClick={() => move(id, i - 1)}>◀</button>
            <button type="button" disabled={i === chain.length - 1} aria-label={`Move ${name} later`} title="Later in the chain" onClick={() => move(id, i + 1)}>▶</button>
            <button type="button" aria-label={`Take ${name} out of the chain`} title="Take out of the chain (to the shelf)" onClick={() => move(id, null)}>×</button>
          </span>
        </div>
        <div className="fwm-fxu__s">
          <small>{SUB[id]}</small>
          <button type="button" className="fwm-tb fwm-tb--xs fwm-fxu__on" aria-pressed={on} aria-label={`${name} ${on ? 'on' : 'off'}`}
            onClick={() => project.setFx(id + '.on', !on)}>{on ? 'On' : 'Off'}</button>
        </div>
        {body(id)}
      </div>
    );
  };

  return (
    <div className="fwm-fxrack">
      <div ref={flow} className="fwm-fxflow" aria-label="Effects chain, in the order the sound goes through"
        onDragOver={(e) => {
          if (!drag) return;
          e.preventDefault();
          setDrop(dropIndex(e.clientX));
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop(null)}
        onDrop={(e) => {
          if (!drag) return;
          e.preventDefault();
          move(drag, dropIndex(e.clientX));
          endDrag();
        }}>
        <div className={'fwm-endcap' + (drop === 0 && !others.length ? ' is-drop' : '')}>
          <b>INSTRUMENTS</b>
          <small>their Reverb and Delay knobs feed those effects</small>
        </div>
        <span className="fwm-arrow" aria-hidden="true">➜</span>
        {chain.map((id, i) => (
          <span key={id} className="fwm-fxstep">
            {unit(id, i)}
            <span className="fwm-arrow" aria-hidden="true">➜</span>
          </span>
        ))}
        <div className="fwm-endcap">
          <b>MASTER</b>
          <small>to your speakers</small>
        </div>
      </div>
      <div className={'fwm-shelf' + (drop === 'shelf' ? ' is-over' : '')}
        onDragOver={(e) => {
          if (!drag) return;
          e.preventDefault();
          setDrop('shelf');
        }}
        onDrop={(e) => {
          if (!drag) return;
          e.preventDefault();
          move(drag, null);
          endDrag();
        }}>
        <span>{shelf.length ? 'Not in the chain (drag back in, or click):' : 'Drag an effect here to take it out of the chain'}</span>
        {shelf.map((id) => (
          <button key={id} type="button" className="fwm-fxchip" draggable onDragStart={startDrag(id)} onDragEnd={endDrag}
            title={`Add ${FX_NAMES[id]} back at the end of the chain`} onClick={() => move(id, chain.length)}>{FX_NAMES[id]}</button>
        ))}
      </div>
    </div>
  );
}

/** A small drawing of what each effect does, from its settings. */
function Pic({ kind, get, pingpong }: { kind: FxId; get: (k: string) => number; pingpong?: boolean }) {
  const W = 240;
  const H = 64;
  let inner = null;
  if (kind === 'reverb') {
    const t60 = reverbSeconds(get('reverb.size'));
    const pre = get('reverb.predelay') * 100;
    let d = `M0 ${H}`;
    for (let x = 0; x <= W; x += 3) {
      const t = (x / W) * 6000 - pre;
      const jitter = 0.6 + 0.4 * Math.abs(Math.sin(x * 12.9898) * 43758.5453 % 1); // steady "noise", no flicker
      d += ` L${x} ${t < 0 ? H : H - (H - 6) * Math.exp((-t / 1000) * (6.9 / t60)) * jitter}`;
    }
    inner = <path className="fwm-fxpic__fill" d={`${d} L${W} ${H}Z`} />;
  } else if (kind === 'delay') {
    const beats = DELAY_DIVS[get('delay.div')]?.[1] ?? 0.75;
    const fb = get('delay.feedback') * 0.92;
    const bars = [];
    for (let k = 0, a = 1; k < 14 && a > 0.03; k++, a *= fb) {
      const x = 8 + k * beats * 40;
      if (x > W - 6) break;
      bars.push(<rect key={k} className="fwm-fxpic__fill" x={x} y={H - 4 - a * (H - 10) + (pingpong ? (k % 2 ? 2 : -2) : 0)} width={6} height={a * (H - 10)} rx={2} />);
    }
    inner = <>{bars}</>;
  } else if (kind === 'lofi') {
    const drive = 1 + get('lofi.saturation') * 5;
    const norm = Math.tanh(drive);
    let d = '';
    let ph = 0;
    for (let x = 0; x <= W; x++) {
      ph += 0.075 * (1 + get('lofi.wow') * 0.35 * Math.sin((x / W) * Math.PI * 2) + get('lofi.flutter') * 0.12 * Math.sin(x * 0.45));
      const noise = (Math.sin(x * 78.233) * 43758.5453) % 1;
      const y = Math.tanh(Math.sin(ph) * drive) / norm + noise * get('lofi.noise') * 0.12;
      d += `${x ? 'L' : 'M'}${x} ${H / 2 - y * (H / 2 - 8) * (1 - get('lofi.age') * 0.3)}`;
    }
    const ticks = Array.from({ length: Math.round(get('lofi.crackle') * 14) }, (_, k) => {
      const x = ((k * 97.13) % 1) * W + ((k * 37) % W);
      const h = 4 + ((k * 7) % 14);
      return <rect key={k} className="fwm-fxpic__fill" x={x % W} y={H / 2 - h / 2} width={2} height={h} />;
    });
    inner = <>{ticks}<path className="fwm-fxpic__line" d={d} /></>;
  } else {
    const open = get('lowpass.cutoff') >= 0.999;
    const fc = lowpassHz(get('lowpass.cutoff'));
    const Q = lowpassQ(get('lowpass.resonance'));
    let d = '';
    for (let x = 0; x <= W; x += 2) {
      const f = 20 * Math.pow(1000, x / W);
      const r = f / fc;
      const mag = open ? 1 : 1 / Math.sqrt((1 - r * r) ** 2 + (r / Q) ** 2);
      const db = Math.max(-40, Math.min(18, 20 * Math.log10(mag)));
      d += `${x ? 'L' : 'M'}${x} ${H * 0.35 - db * ((H * 0.6) / 40)}`;
    }
    inner = <path className="fwm-fxpic__line" d={d} />;
  }
  return (
    <div className="fwm-fxpic" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">{inner}</svg>
    </div>
  );
}
