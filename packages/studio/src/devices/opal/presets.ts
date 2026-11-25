// Opal factory sounds. Unlisted params use the manifest defaults ("Warm Pad").
import type { Preset } from '../basalt/presets';

const p = (name: string, params: Record<string, number>): Preset => ({ name, params, routes: [] });

export const OPAL_PRESETS: Preset[] = [
  p('Warm Pad', {}),
  p('Ensemble Strings', { w1: 0, shape: 0.1, stack: 3, detune: 0.3, w2: 0, int2: 1, fine2: 0.6, mix2: 0.45, air: 0.04, cut: 0.55, res: 0.1, fenv: 0.2, swell: 0.35, atk: 0.35, sus: 0.9, rel: 0.5, drift: 0.25, move: 0.1, chorus: 2, width: 0.85 }),
  p('Glass', { w1: 2, shape: 0.55, stack: 1, detune: 0.2, w2: 3, int2: 4, mix2: 0.35, air: 0.12, cut: 0.7, res: 0.35, fenv: 0.25, swell: 0.1, atk: 0.12, dec: 0.75, sus: 0.45, rel: 0.7, rate: 0.45, move: 0.35, chorus: 3, width: 0.9 }),
  p('Dark Drone', { w1: 0, stack: 3, detune: 0.5, w2: 0, int2: 0, mix2: 0.55, air: 0.15, cut: 0.25, res: 0.45, fenv: 0.15, swell: 0.8, atk: 0.7, sus: 1, rel: 0.75, drift: 0.6, rate: 0.12, move: 0.55, chorus: 1, width: 1 }),
  p('Choir Air', { w1: 1, shape: 0.6, stack: 2, detune: 0.3, w2: 3, int2: 3, mix2: 0.25, air: 0.45, cut: 0.4, res: 0.55, fenv: 0.1, swell: 0.6, atk: 0.55, sus: 0.85, rel: 0.6, rate: 0.2, move: 0.4, chorus: 2, width: 0.8 }),
  p('Super Saw', { w1: 0, shape: 0, stack: 3, detune: 0.62, w2: 0, int2: 3, mix2: 0.3, air: 0, cut: 0.72, res: 0.15, fenv: 0.3, swell: 0.05, atk: 0.05, dec: 0.5, sus: 0.85, rel: 0.35, drift: 0.2, move: 0, chorus: 0, width: 1 }),
  p('Dream Keys', { w1: 2, shape: 0.25, stack: 1, detune: 0.25, w2: 3, int2: 3, mix2: 0.5, air: 0.03, cut: 0.48, res: 0.2, fenv: 0.55, swell: 0.02, atk: 0.02, dec: 0.55, sus: 0.35, rel: 0.6, drift: 0.35, move: 0.15, chorus: 1, width: 0.75 }),
  p('Slow Bloom', { w1: 1, shape: 0.35, stack: 2, detune: 0.4, w2: 0, int2: 2, mix2: 0.3, air: 0.08, cut: 0.18, res: 0.4, fenv: 0.85, swell: 0.85, atk: 0.6, sus: 0.9, rel: 0.8, drift: 0.3, rate: 0.15, move: 0.3, chorus: 2, width: 0.9 }),
];

/** Knob readouts in plain words where numbers say little. */
export const OPAL_FORMAT: Record<string, (v: number) => string> = {
  drift: (v) => (v < 0.02 ? 'Off' : Math.round(v * 100) + '%'),
  move: (v) => (v < 0.02 ? 'Still' : Math.round(v * 100) + '%'),
  air: (v) => (v < 0.02 ? 'Off' : Math.round(v * 100) + '%'),
};
