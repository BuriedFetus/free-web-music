// Factory presets. Unlisted params use the manifest defaults.
import type { Route } from '../../model/deviceStore';

export interface Preset {
  name: string;
  params: Record<string, number>;
  routes: Route[];
}

export const BASALT_PRESETS: Preset[] = [
  { name: 'Lava Bass', params: {}, routes: [{ src: 'lfo', target: 'cut', depth: 0.45 }] },
  {
    name: 'Rubber Sub',
    params: { wave: 3, shape: 0.15, sub: 0.8, cut: 0.3, res: 0.2, envamt: 0.35, drive: 0.35, glide: 0.25,
      'amp.A': 0.02, 'amp.D': 0.5, 'amp.S': 0.8, 'amp.R': 0.25, 'filt.D': 0.25, 'filt.S': 0.1 },
    routes: [],
  },
  {
    name: 'Acid Rock',
    params: { wave: 0, shape: 0, sub: 0.1, cut: 0.22, res: 0.82, envamt: 0.8, drive: 0.55, glide: 0.35,
      'amp.A': 0, 'amp.D': 0.4, 'amp.S': 0.7, 'amp.R': 0.2, 'filt.A': 0, 'filt.D': 0.38, 'filt.S': 0, 'filt.R': 0.2 },
    routes: [],
  },
  {
    name: 'Pluck Stone',
    params: { wave: 1, shape: 0.35, sub: 0.3, cut: 0.25, res: 0.45, envamt: 0.75, drive: 0.2, glide: 0,
      'amp.A': 0, 'amp.D': 0.42, 'amp.S': 0, 'amp.R': 0.3, 'filt.A': 0, 'filt.D': 0.3, 'filt.S': 0, 'filt.R': 0.25 },
    routes: [{ src: 'filt', target: 'shape', depth: 0.3 }],
  },
  {
    name: 'Dusty Reese',
    params: { wave: 0, shape: 0.6, sub: 0.5, cut: 0.45, res: 0.3, envamt: 0.3, drive: 0.45, glide: 0.3,
      'amp.A': 0.2, 'amp.D': 0.5, 'amp.S': 0.9, 'amp.R': 0.45, 'filt.S': 0.5, lwave: 1, lrate: 0.25, lamt: 0.7 },
    routes: [{ src: 'lfo', target: 'shape', depth: 0.5 }, { src: 'lfo', target: 'cut', depth: 0.15 }],
  },
];
