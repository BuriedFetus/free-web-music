// Quartz factory sounds. Unlisted params use the manifest defaults ("Tine Keys").
import type { Preset } from '../basalt/presets';

const p = (name: string, params: Record<string, number>): Preset => ({ name, params, routes: [] });

export const QUARTZ_PRESETS: Preset[] = [
  p('Tine Keys', {}),
  p('Soft Rhodes', { depth1: 0.25, env1: 0.5, harm2: 8, depth2: 0.18, env2: 0.12, lvl2: 0.25, cut: 0.7, touch: 0.75, dec: 0.6, sus: 0.3, rel: 0.35, trem: 0.45, trate: 0.35, drive: 0.1 }),
  p('Bell Glass', { harm1: 4, depth1: 0.45, env1: 0.75, w2: 0, pitch2: 3, harm2: 7, depth2: 0.35, env2: 0.4, lvl2: 0.5, cut: 1, res: 0, touch: 0.4, dec: 0.85, sus: 0, rel: 0.7, trem: 0.1, drive: 0 }),
  p('Marimba', { harm1: 4, depth1: 0.3, env1: 0.08, lvl1: 0.9, pitch2: 3, harm2: 1, depth2: 0.15, env2: 0.05, lvl2: 0.3, cut: 0.75, touch: 0.6, dec: 0.35, sus: 0, rel: 0.25, trem: 0, drive: 0.05 }),
  p('Digital Piano', { w1: 1, harm1: 1, depth1: 0.4, env1: 0.3, pitch2: 3, harm2: 2, depth2: 0.3, env2: 0.2, lvl2: 0.4, cut: 0.8, touch: 0.7, dec: 0.7, sus: 0.15, rel: 0.4, trem: 0, drive: 0.1 }),
  p('Organ Pipe', { w1: 1, harm1: 2, depth1: 0.15, env1: 1, w2: 0, pitch2: 3, harm2: 1, depth2: 0.1, env2: 1, lvl2: 0.6, cut: 0.65, touch: 0.1, atk: 0.08, sus: 1, rel: 0.2, trem: 0.25, trate: 0.6, drive: 0.25 }),
  p('Wurly Bark', { w1: 2, harm1: 1, depth1: 0.5, env1: 0.25, harm2: 3, depth2: 0.4, env2: 0.1, lvl2: 0.45, cut: 0.6, res: 0.25, touch: 0.85, dec: 0.5, sus: 0.25, rel: 0.25, trem: 0.55, trate: 0.5, drive: 0.5 }),
  p('FM Bass', { pitch1: 0, harm1: 1, depth1: 0.55, env1: 0.18, w2: 3, pitch2: 0, harm2: 2, depth2: 0.3, env2: 0.1, lvl2: 0.3, cut: 0.5, res: 0.3, touch: 0.5, dec: 0.4, sus: 0.5, rel: 0.12, trem: 0, drive: 0.4 }),
];

export const QUARTZ_FORMAT: Record<string, (v: number) => string> = {
  depth1: (v) => (v < 0.01 ? 'Pure' : (v * v * 8).toFixed(1)),
  depth2: (v) => (v < 0.01 ? 'Pure' : (v * v * 8).toFixed(1)),
  touch: (v) => (v < 0.02 ? 'Even' : Math.round(v * 100) + '%'),
  trem: (v) => (v < 0.02 ? 'Off' : Math.round(v * 100) + '%'),
};
