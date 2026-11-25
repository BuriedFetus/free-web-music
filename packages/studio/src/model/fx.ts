// The master effects, as stored in the shared song (top-level Y.Map `fwm.fx`, flat keys).
// The chain lists the effects the mix goes through, in order; the others sit on the shelf.
// Lo-fi keeps separate settings per style (Tape, Vinyl), so switching style never loses a tweak.

export type FxId = 'reverb' | 'delay' | 'lofi' | 'lowpass';
export const FX_ALL: FxId[] = ['reverb', 'delay', 'lofi', 'lowpass'];
export const FX_NAMES: Record<FxId, string> = { reverb: 'Reverb', delay: 'Delay', lofi: 'Lo-fi', lowpass: 'Low-pass' };
export type LofiStyle = 'tape' | 'vinyl';
export const LOFI_KEYS = ['wow', 'flutter', 'saturation', 'age', 'noise', 'crackle', 'mix'] as const;
export type LofiKey = (typeof LOFI_KEYS)[number];
/** Delay time choices, in beats (quarter notes). */
export const DELAY_DIVS: [label: string, beats: number][] = [['1/16', 0.25], ['1/8', 0.5], ['1/8.', 0.75], ['1/4', 1], ['1/4.', 1.5]];

const LOFI_STYLES: Record<LofiStyle, Record<LofiKey, number>> = {
  tape: { wow: 0.35, flutter: 0.3, saturation: 0.5, age: 0.35, noise: 0, crackle: 0, mix: 1 },
  vinyl: { wow: 0.15, flutter: 0.05, saturation: 0.2, age: 0.55, noise: 0, crackle: 0, mix: 1 },
};

/** Every key with its default. Numbers are 0..1 unless noted. */
export const FX_DEFAULTS = {
  chain: 'reverb,delay,lofi,lowpass',
  'reverb.on': true,
  'reverb.size': 0.45, // decay 0.4 … 6 s
  'reverb.predelay': 0.2, // 0 … 100 ms
  'reverb.tone': 0.6,
  'reverb.return': 0.7,
  'delay.on': true,
  'delay.div': 2, // index in DELAY_DIVS
  'delay.feedback': 0.45,
  'delay.tone': 0.55,
  'delay.pingpong': true,
  'delay.return': 0.6,
  'lofi.on': false,
  'lofi.style': 'tape',
  ...Object.fromEntries(Object.entries(LOFI_STYLES).flatMap(([st, vals]) => Object.entries(vals).map(([k, v]) => [`lofi.${st}.${k}`, v]))),
  'lowpass.on': true,
  'lowpass.cutoff': 1, // 60 Hz … 20 kHz; fully open = untouched
  'lowpass.resonance': 0.2,
} as Record<string, number | boolean | string>;

/** A stored value, made safe (type, range); unknown keys give undefined. */
export function clampFx(key: string, v: unknown): number | boolean | string | undefined {
  const d = FX_DEFAULTS[key];
  if (d === undefined) return undefined;
  if (typeof d === 'boolean') return !!v;
  if (key === 'chain') {
    const ids = String(v ?? '').split(',').filter((x, i, a) => (FX_ALL as string[]).includes(x) && a.indexOf(x) === i);
    return ids.join(',');
  }
  if (key === 'lofi.style') return v === 'vinyl' ? 'vinyl' : 'tape';
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  if (key === 'delay.div') return Math.max(0, Math.min(DELAY_DIVS.length - 1, Math.round(n)));
  return Math.max(0, Math.min(1, n));
}

/** Everything the engine needs, from the stored values and the tempo. */
export function engineFx(get: (key: string) => unknown, bpm: number): Record<string, number> {
  const n = (k: string) => Number(get(k));
  const b = (k: string) => (get(k) ? 1 : 0);
  const style = get('lofi.style') === 'vinyl' ? 'vinyl' : 'tape';
  const out: Record<string, number> = {
    'reverb.on': b('reverb.on'),
    'reverb.size': n('reverb.size'),
    'reverb.predelay': n('reverb.predelay') * 0.1,
    'reverb.tone': n('reverb.tone'),
    'reverb.return': n('reverb.return'),
    'delay.on': b('delay.on'),
    'delay.time': Math.min(2, (DELAY_DIVS[n('delay.div')]?.[1] ?? 0.75) * (60 / Math.max(40, bpm))),
    'delay.feedback': n('delay.feedback'),
    'delay.tone': n('delay.tone'),
    'delay.pingpong': b('delay.pingpong'),
    'delay.return': n('delay.return'),
    'lofi.on': b('lofi.on'),
    'lofi.vinyl': style === 'vinyl' ? 1 : 0,
    'lowpass.on': b('lowpass.on'),
    'lowpass.cutoff': n('lowpass.cutoff'),
    'lowpass.resonance': n('lowpass.resonance'),
  };
  for (const k of LOFI_KEYS) out['lofi.' + k] = n(`lofi.${style}.${k}`);
  return out;
}

// Display helpers (the engine uses the same curves).
export const reverbSeconds = (v: number) => 0.4 + v * 5.6;
export const reverbToneHz = (v: number) => 800 * Math.pow(20, v);
export const delayToneHz = (v: number) => 500 * Math.pow(28, v);
export const lofiAgeHz = (v: number) => 18000 * Math.pow(3000 / 18000, v);
export const lowpassHz = (v: number) => 60 * Math.pow(20000 / 60, v);
export const lowpassQ = (v: number) => 0.7 + v * 14;
export const fmtHz = (f: number) => (f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + 'k' : Math.round(f) + '') + ' Hz';
