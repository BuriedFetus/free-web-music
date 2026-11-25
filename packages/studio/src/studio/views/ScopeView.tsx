// Scope: a large oscilloscope of the master (after the effects) or one instrument (after its fader).
// Wave: triggered on a rising zero crossing so the wave stands still; 5–40 ms across the screen; the
// height follows the level (shown in dB). Spectrum: FFT, log frequency, falling smoothly. Freeze holds
// the picture. These choices are yours only (like your panel layout); nothing here changes the song.
import { useEffect, useRef, useState } from 'react';
import { useEngine } from '../../engine/EngineProvider';
import { useStudio } from '../context';

const ZOOMS = [5, 10, 20, 40];
type Mode = 'wave' | 'spec';
const N = 4096;

/** In-place radix-2 FFT (re, im of length N, a power of 2). */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}
const HANN = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));

export function ScopeView() {
  const { project, slotOf } = useStudio();
  const { engine, status } = useEngine();
  const tracks = project.tracks();
  const [src, setSrc] = useState<string>('master');
  const [mode, setMode] = useState<Mode>('wave');
  const [zoom, setZoom] = useState(20);
  const [frozen, setFrozen] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const opts = useRef({ mode, zoom, frozen });
  opts.current = { mode, zoom, frozen };
  const source = src === 'master' || tracks.some((t) => t.id === src) ? src : 'master';
  const slot = source === 'master' ? 'master' : slotOf(source) ?? null;

  // Tell the engine what to probe while this panel is open.
  useEffect(() => {
    if (!engine || status !== 'on' || slot == null) return;
    engine.setProbe(slot);
    return () => engine.setProbe(null);
  }, [engine, status, slot]);

  useEffect(() => {
    const c = canvas.current!;
    const g = c.getContext('2d');
    if (!g) return;
    let raf = 0;
    let held: Float32Array | null = null;
    let drawnFrozen = '';
    let gain = 1;
    const spec = new Float32Array(N / 2).fill(-120);
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { mode, zoom, frozen } = opts.current;
      const d = devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (!w || !h) return;
      // Frozen: keep the picture exactly as it is (redraw only if the size or the view changes).
      const key = `${w}x${h}:${mode}:${zoom}`;
      if (frozen && drawnFrozen === key) return;
      drawnFrozen = frozen ? key : '';
      if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) {
        c.width = Math.round(w * d);
        c.height = Math.round(h * d);
      }
      const live = engine?.last?.probe;
      if (!frozen && live) held = live;
      const b = held;
      const fs = engine?.context.sampleRate ?? 48000;
      const css = getComputedStyle(c);
      const ink = css.getPropertyValue('--fwm-roll-ink').trim() || '#fff';
      const line = css.color;
      const glow = parseFloat(css.getPropertyValue('--fwm-glow')) || 0;
      g.setTransform(d, 0, 0, d, 0, 0);
      g.clearRect(0, 0, w, h);
      g.font = '12px ' + (css.getPropertyValue('--fwm-font-ui') || 'sans-serif');
      g.fillStyle = ink;
      g.strokeStyle = ink;
      g.lineWidth = 1;
      if (mode === 'wave') {
        // grid: 10 time divisions, centre line
        g.globalAlpha = 0.12;
        for (let i = 1; i < 10; i++) {
          g.beginPath();
          g.moveTo((w * i) / 10, 0);
          g.lineTo((w * i) / 10, h);
          g.stroke();
        }
        g.globalAlpha = 0.3;
        g.beginPath();
        g.moveTo(0, h / 2);
        g.lineTo(w, h / 2);
        g.stroke();
        g.globalAlpha = 0.6;
        g.fillText(`${zoom} ms`, w - 46, h - 8);
        g.fillText(`${zoom / 10} ms / div`, 8, h - 8);
        g.globalAlpha = 1;
        if (!b) return;
        const win = Math.min(N - 1200, Math.round((zoom / 1000) * fs));
        // trigger: the latest rising zero crossing that leaves a full window after it
        let st = N - win - 1;
        for (let i = N - win - 1; i > Math.max(1, N - win - 1200); i--) {
          if (b[i - 1] <= 0 && b[i] > 0) {
            st = i;
            break;
          }
        }
        let pk = 0;
        for (let i = st; i < st + win; i++) pk = Math.max(pk, Math.abs(b[i]));
        const target = (h / 2 - 8) / Math.max(0.02, pk);
        gain = gain + (target - gain) * 0.15; // follows the level smoothly
        g.beginPath();
        const step = Math.max(1, Math.floor(win / (w * 2)));
        for (let i = 0; i < win; i += step) {
          const x = (i / win) * w;
          const y = h / 2 - b[st + i] * gain;
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.strokeStyle = line;
        g.lineWidth = 2;
        g.shadowColor = line;
        g.shadowBlur = 10 * glow;
        g.stroke();
        g.shadowBlur = 0;
        if (readout.current) readout.current.textContent = pk > 1e-5 ? `peak ${(20 * Math.log10(pk)).toFixed(1)} dB` : 'silent';
      } else {
        const lo = 30;
        const hi = Math.min(20000, fs / 2);
        const xOf = (f: number) => (Math.log(f / lo) / Math.log(hi / lo)) * w;
        const yOf = (db: number) => h - ((db + 96) / 90) * h; // −96 … −6 dB
        g.globalAlpha = 0.15;
        for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
          g.beginPath();
          g.moveTo(xOf(f), 0);
          g.lineTo(xOf(f), h);
          g.stroke();
        }
        for (const db of [-24, -48, -72]) {
          g.beginPath();
          g.moveTo(0, yOf(db));
          g.lineTo(w, yOf(db));
          g.stroke();
        }
        g.globalAlpha = 0.6;
        for (const [f, l] of [[100, '100'], [1000, '1k'], [10000, '10k']] as const) g.fillText(l, xOf(f) + 3, h - 8);
        for (const db of [-24, -48, -72]) g.fillText(`${db} dB`, 6, yOf(db) - 4);
        g.globalAlpha = 1;
        if (!b) return;
        if (!frozen) {
          for (let i = 0; i < N; i++) {
            re[i] = b[i] * HANN[i];
            im[i] = 0;
          }
          fft(re, im);
          for (let k = 1; k < N / 2; k++) {
            const mag = Math.hypot(re[k], im[k]) * (4 / N); // Hann: ×2 window gain, ×2 one-sided
            const db = 20 * Math.log10(mag + 1e-9);
            spec[k] = Math.max(db, spec[k] - 1.2); // rises at once, falls smoothly
          }
        }
        g.beginPath();
        g.moveTo(0, h);
        let top = -120;
        for (let x = 0; x <= w; x += 2) {
          const f0 = lo * Math.pow(hi / lo, x / w);
          const f1 = lo * Math.pow(hi / lo, (x + 2) / w);
          const k0 = Math.max(1, Math.floor((f0 / fs) * N));
          const k1 = Math.max(k0 + 1, Math.ceil((f1 / fs) * N));
          let db = -120;
          for (let k = k0; k < k1 && k < N / 2; k++) db = Math.max(db, spec[k]);
          top = Math.max(top, db);
          g.lineTo(x, Math.max(0, yOf(db)));
        }
        g.lineTo(w, h);
        g.closePath();
        g.fillStyle = line;
        g.globalAlpha = 0.2;
        g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = line;
        g.lineWidth = 2;
        g.shadowColor = line;
        g.shadowBlur = 8 * glow;
        g.stroke();
        g.shadowBlur = 0;
        if (readout.current) readout.current.textContent = top > -100 ? `top ${top.toFixed(0)} dB` : 'silent';
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return (
    <div className="fwm-scopev">
      <div className="fwm-scopev__bar">
        <select value={source} aria-label="What the scope shows" onChange={(e) => { setSrc(e.target.value); e.target.blur(); }}>
          <option value="master">Master (after effects)</option>
          {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="fwm-grp" role="group" aria-label="Mode">
          <button type="button" className="fwm-tb fwm-tb--xs" aria-pressed={mode === 'wave'} onClick={() => setMode('wave')}>Wave</button>
          <button type="button" className="fwm-tb fwm-tb--xs" aria-pressed={mode === 'spec'} onClick={() => setMode('spec')}>Spectrum</button>
        </span>
        {mode === 'wave' && (
          <span className="fwm-grp" role="group" aria-label="Time across the screen">
            {ZOOMS.map((z) => (
              <button key={z} type="button" className="fwm-tb fwm-tb--xs" aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z} ms</button>
            ))}
          </span>
        )}
        <button type="button" className="fwm-tb fwm-tb--xs" aria-pressed={frozen} title="Hold the picture" onClick={() => setFrozen(!frozen)}>Freeze</button>
        <span className="fwm-scopev__read" ref={readout} />
      </div>
      <div className="fwm-scopev__screen">
        <canvas ref={canvas} aria-label={mode === 'wave' ? 'Live waveform' : 'Live spectrum'} />
        {status !== 'on' && <p className="fwm-scopev__msg">Turn Sound on and press Play to see the sound</p>}
      </div>
    </div>
  );
}
