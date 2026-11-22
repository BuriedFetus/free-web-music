import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { KnobProps } from './types';

const A0 = Math.PI * 0.75;
const A1 = Math.PI * 2.25;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ang = (v: number) => A0 + (A1 - A0) * v;

function arc(r: number, a0: number, a1: number) {
  const p = (a: number) => [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
}

/** Hardware-style rotary knob. Drag up/down (Shift = fine), arrow keys, double-click = default. */
export function Knob({ value, onChange, label, format, size = 'md', modulation, presence = [], defaultValue, onGestureStart, onGestureEnd }: KnobProps) {
  const gid = 'fwmk' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const [active, setActive] = useState(false);
  const drag = useRef<{ y: number; v: number } | null>(null);
  const a = ang(value);
  const peer = presence[0];

  const down = (e: PointerEvent<SVGSVGElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    drag.current = { y: e.clientY, v: value };
    setActive(true);
    onGestureStart?.();
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    onChange(clamp01(drag.current.v + (drag.current.y - e.clientY) / (e.shiftKey ? 600 : 180)));
  };
  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    setActive(false);
    onGestureEnd?.();
  };
  const key = (e: KeyboardEvent) => {
    const s = e.shiftKey ? 0.01 : 0.05;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(clamp01(value + s));
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(clamp01(value - s));
    else return;
    e.preventDefault();
  };

  const mod = modulation && {
    lo: ang(clamp01(value + modulation.low)),
    hi: ang(clamp01(value + modulation.high)),
    cur: modulation.current == null ? null : ang(clamp01(modulation.current)),
  };

  return (
    <div className={'fwm-knob' + (size === 'lg' ? ' fwm-knob--lg' : '') + (active ? ' is-mine' : '') + (peer ? ' is-peer' : '')}
      style={peer ? ({ '--fwm-who': peer.color } as React.CSSProperties) : undefined}>
      {peer && <span className="fwm-knob__tag">{peer.name}</span>}
      <svg viewBox="0 0 100 100" role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)} aria-valuetext={format?.(value)}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
        onDoubleClick={() => defaultValue != null && onChange(defaultValue)}>
        <defs>
          <radialGradient id={gid} cx="40%" cy="32%" r="75%">
            <stop offset="0" style={{ stopColor: 'var(--dev-cap)' }} />
            <stop offset="1" style={{ stopColor: 'color-mix(in srgb,var(--dev-capd) calc(var(--fwm-depth)*100%),var(--dev-cap))' }} />
          </radialGradient>
        </defs>
        <circle className="fwm-knob__ring" cx="50" cy="50" r="49" />
        <path d={arc(42, A0, A1)} className="fwm-knob__track" />
        {value > 0.005 && <path d={arc(42, A0, a)} className="fwm-knob__value" />}
        <circle cx="50" cy="53" r="31" className="fwm-knob__shadow" />
        <circle cx="50" cy="50" r="31" fill={`url(#${gid})`} />
        <circle cx="50" cy="50" r="24" className="fwm-knob__groove" />
        {mod && <path d={arc(37, mod.lo, Math.max(mod.hi, mod.lo + 0.001))} className="fwm-knob__mod" />}
        {mod && mod.cur != null && <circle cx={50 + 43 * Math.cos(mod.cur)} cy={50 + 43 * Math.sin(mod.cur)} r="5" className="fwm-knob__moddot" />}
        <line x1={50 + 10 * Math.cos(a)} y1={50 + 10 * Math.sin(a)} x2={50 + 27 * Math.cos(a)} y2={50 + 27 * Math.sin(a)} className="fwm-knob__pointer" />
      </svg>
      <span className="fwm-knob__val">{format ? format(value) : Math.round(value * 100) + '%'}</span>
      <span className="fwm-silk">{label}</span>
    </div>
  );
}
