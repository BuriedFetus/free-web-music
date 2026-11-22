import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { FaderProps } from './types';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
// Track geometry (px): cap travel inside a 110px track with a 20px cap and 4px margins.
const H = 110;
const CAP = 20;
const PAD = 4;
const y = (v: number) => PAD + (1 - v) * (H - CAP - 2 * PAD) + CAP / 2;

/** Vertical fader. Click or drag anywhere on the track, arrow keys, double-click = default. */
export function Fader({ value, onChange, label, format, modulation, presence = [], defaultValue, onGestureStart, onGestureEnd }: FaderProps) {
  const [active, setActive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const peer = presence[0];
  const fromEvent = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return clamp01(1 - (e.clientY - r.top - PAD - CAP / 2) / (r.height - CAP - 2 * PAD));
  };
  const key = (e: KeyboardEvent) => {
    const s = e.shiftKey ? 0.01 : 0.05;
    if (e.key === 'ArrowUp') onChange(clamp01(value + s));
    else if (e.key === 'ArrowDown') onChange(clamp01(value - s));
    else return;
    e.preventDefault();
  };
  const lo = modulation && clamp01(value + modulation.low);
  const hi = modulation && clamp01(value + modulation.high);
  return (
    <div className={'fwm-fader' + (active ? ' is-mine' : '') + (peer ? ' is-peer' : '')}
      style={peer ? ({ '--fwm-who': peer.color } as React.CSSProperties) : undefined}>
      <div ref={ref} className="fwm-fader__track" role="slider" tabIndex={0} aria-label={label}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-valuetext={format?.(value)}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setActive(true); onGestureStart?.(); onChange(fromEvent(e)); }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) onChange(fromEvent(e)); }}
        onPointerUp={() => { setActive(false); onGestureEnd?.(); }}
        onPointerCancel={() => { setActive(false); onGestureEnd?.(); }}
        onKeyDown={key}
        onDoubleClick={() => defaultValue != null && onChange(defaultValue)}>
        <div className="fwm-fader__cap" style={{ top: y(value) - CAP / 2 }} />
        {modulation && lo != null && hi != null && (
          <>
            <div className="fwm-fader__mbar" style={{ top: y(hi), height: Math.max(2, y(lo) - y(hi)) }} />
            {modulation.current != null && <div className="fwm-fader__mdot" style={{ top: y(clamp01(modulation.current)) }} />}
          </>
        )}
      </div>
      <span className="fwm-silk">{label}</span>
    </div>
  );
}
