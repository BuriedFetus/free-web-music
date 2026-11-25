// Normalised (0..1) parameter values ↔ physical values and display text, driven by the manifest.
// Must match the Rust mappings in packages/engine/src/devices/*.rs (see "map" in the manifest).
import type { ParamSpec } from '@fwm/engine';

export function toPhysical(spec: ParamSpec, v: number): number {
  const lo = spec.min ?? 0;
  const hi = spec.max ?? 1;
  switch (spec.map) {
    case 'exp':
      return lo * Math.pow(hi / lo, v);
    case 'exp0':
      return v <= 0 ? 0 : lo * Math.pow(hi / lo, v);
    case 'sq':
      return lo + v * v * (hi - lo);
    case 'sq0':
      return v <= 0 ? 0 : lo + v * v * (hi - lo);
    default:
      return lo + v * (hi - lo);
  }
}

export function formatParam(spec: ParamSpec, v: number): string {
  if (spec.type === 'enum') return spec.options?.[Math.round(v)] ?? String(v);
  const x = toPhysical(spec, v);
  switch (spec.unit) {
    case 'st': {
      const s = Math.round(x);
      return (s > 0 ? '+' : '') + s;
    }
    case 'ct': {
      const c = Math.round(x);
      return (c > 0 ? '+' : '') + c + ' ct';
    }
    case '%':
      return Math.round(x) + '%';
    case 'Hz':
      if (x < 10) return x.toFixed(2) + 'Hz';
      return x < 1000 ? Math.round(x) + 'Hz' : (x / 1000).toFixed(1) + 'k';
    case 's':
      return x.toFixed(1) + ' s';
    case 'dB':
      return (x > 0 ? '+' : '') + x.toFixed(0) + ' dB';
    case 'ms':
      if ((spec.map === 'exp0' || spec.map === 'sq0') && v <= 0) return 'Off';
      if (x < 10) return x.toFixed(1) + 'ms';
      return x < 1000 ? Math.round(x) + 'ms' : (x / 1000).toFixed(1) + 's';
    default:
      return spec.max === 100 ? Math.round(x) + '%' : x.toFixed(2);
  }
}
