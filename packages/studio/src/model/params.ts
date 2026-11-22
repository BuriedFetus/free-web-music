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
    case '%':
      return Math.round(x) + '%';
    case 'Hz':
      if (x < 10) return x.toFixed(2) + 'Hz';
      return x < 1000 ? Math.round(x) + 'Hz' : (x / 1000).toFixed(1) + 'k';
    case 'ms':
      if (spec.map === 'exp0' && v <= 0) return 'Off';
      if (x < 10) return x.toFixed(1) + 'ms';
      return x < 1000 ? Math.round(x) + 'ms' : (x / 1000).toFixed(1) + 's';
    default:
      return x.toFixed(2);
  }
}
