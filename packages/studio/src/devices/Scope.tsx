// Live waveform from the engine, triggered on a rising zero crossing so it stands still.
import { useEffect, useRef } from 'react';
import type { Engine } from '@fwm/engine';

export function Scope({ engine, note, label = 'Scope' }: { engine: Engine | null; note: number | null; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const noteRef = useRef(note);
  noteRef.current = note;

  useEffect(() => {
    const c = canvas.current!;
    const g = c.getContext('2d');
    if (!g) return; // no canvas support (tests, very old browsers)
    let raf = 0;
    const draw = () => {
      const d = devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) {
        c.width = Math.round(w * d);
        c.height = Math.round(h * d);
      }
      g.setTransform(d, 0, 0, d, 0, 0);
      g.clearRect(0, 0, w, h);
      const col = getComputedStyle(c).color;
      g.strokeStyle = col;
      g.globalAlpha = 0.18;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, h / 2);
      g.lineTo(w, h / 2);
      g.stroke();
      g.globalAlpha = 1;
      const b = engine?.last?.scope;
      if (b && w > 0) {
        const fs = engine!.context.sampleRate;
        const hz = 440 * Math.pow(2, ((noteRef.current ?? 36) - 69) / 12);
        const n = b.length;
        const W = Math.max(200, Math.min(1200, Math.round((2.5 * fs) / hz)));
        let st = n - W - 1;
        for (let i = n - W - 1; i > Math.max(1, n - W - 801); i--) {
          if (b[i - 1] <= 0 && b[i] > 0) {
            st = i;
            break;
          }
        }
        let pk = 0;
        for (let i = st; i < st + W; i++) pk = Math.max(pk, Math.abs(b[i]));
        const k = (h / 2 - 5) / Math.max(0.3, pk);
        g.beginPath();
        for (let i = 0; i < W; i++) {
          const X = (i / (W - 1)) * w;
          const Y = h / 2 - b[st + i] * k;
          if (i) g.lineTo(X, Y);
          else g.moveTo(X, Y);
        }
        g.lineWidth = 2;
        g.shadowColor = col;
        g.shadowBlur = 8 * (parseFloat(getComputedStyle(c).getPropertyValue('--fwm-glow')) || 0);
        g.stroke();
        g.shadowBlur = 0;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return (
    <div className="fwm-lcd fwm-lcd--scope">
      <small className="fwm-lcd__label">{label}</small>
      <canvas ref={canvas} aria-label="Live waveform" />
    </div>
  );
}
