import { describe, expect, it } from 'vitest';
import manifestJson from '@fwm/engine/devices/basalt.json';
import type { DeviceManifest } from '@fwm/engine';
import { canRoute, createDeviceStore, defaults, modRange } from '../src/model/deviceStore';
import { formatParam, toPhysical } from '../src/model/params';
import { BASALT_PRESETS } from '../src/devices/basalt/presets';

const m = manifestJson as DeviceManifest;
const spec = (id: string) => m.params.find((p) => p.id === id)!;

describe('param mapping', () => {
  it('matches the engine maps', () => {
    expect(toPhysical(spec('cut'), 0)).toBeCloseTo(20);
    expect(toPhysical(spec('cut'), 1)).toBeCloseTo(20480);
    expect(toPhysical(spec('amp.A'), 0)).toBeCloseTo(0.5);
    expect(toPhysical(spec('glide'), 0)).toBe(0);
  });
  it('formats for display', () => {
    expect(formatParam(spec('tune'), 0.5)).toBe('0');
    expect(formatParam(spec('tune'), 1)).toBe('+12');
    expect(formatParam(spec('glide'), 0)).toBe('Off');
    expect(formatParam(spec('cut'), 1)).toBe('20.5k');
    expect(formatParam(spec('lrate'), 0)).toBe('0.10Hz');
    expect(formatParam(spec('wave'), 2)).toBe('Triangle');
    expect(formatParam(spec('amp.D'), 1)).toBe('10.0s');
  });
});

describe('device store', () => {
  it('starts from defaults and clamps', () => {
    const s = createDeviceStore(m);
    expect(s.getState().params).toEqual(defaults(m));
    s.setParam('cut', 3);
    expect(s.getState().params.cut).toBe(1);
    s.setParam('wave', 2.4);
    expect(s.getState().params.wave).toBe(2);
  });
  it('notifies and keeps snapshots immutable', () => {
    const s = createDeviceStore(m);
    const before = s.getState();
    let n = 0;
    s.subscribe(() => n++);
    s.setParam('res', 0.1);
    expect(n).toBe(1);
    expect(before.params.res).toBe(0.55);
    s.setParam('res', 0.1); // no change, no event
    expect(n).toBe(1);
  });
  it('enforces routing rules', () => {
    expect(canRoute(m, 'lfo', 'cut')).toBe(true);
    expect(canRoute(m, 'amp', 'filt.D')).toBe(true); // envelopes can target envelopes
    expect(canRoute(m, 'lfo', 'lrate')).toBe(false); // no self-modulation
    expect(canRoute(m, 'amp', 'amp.R')).toBe(false);
    expect(canRoute(m, 'lfo', 'wave')).toBe(false); // enums are not modulatable
    const s = createDeviceStore(m);
    expect(s.addRoute({ src: 'lfo', target: 'cut', depth: 0.5 })).toBe(true);
    expect(s.addRoute({ src: 'lfo', target: 'cut', depth: 0.2 })).toBe(false); // duplicate
    expect(s.addRoute({ src: 'filt', target: 'filt.S', depth: 0.2 })).toBe(false);
  });
  it('computes the modulation range like the engine', () => {
    const s = createDeviceStore(m, { routes: [{ src: 'lfo', target: 'cut', depth: 0.5 }, { src: 'amp', target: 'cut', depth: -0.2 }] });
    const r = modRange(s.getState(), 'cut')!;
    expect(r.high).toBeCloseTo(0.5 * 0.6);
    expect(r.low).toBeCloseTo(-0.5 * 0.6 - 0.2);
    expect(modRange(s.getState(), 'res')).toBeNull();
  });
  it('presets only use real params and valid routes', () => {
    for (const p of BASALT_PRESETS) {
      for (const id of Object.keys(p.params)) expect(spec(id), `${p.name}: ${id}`).toBeTruthy();
      for (const r of p.routes) expect(canRoute(m, r.src, r.target), `${p.name}: ${r.src}→${r.target}`).toBe(true);
    }
  });
});
