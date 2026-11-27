// Geode's starting points. They never hold a tape (the tape is yours): they set how it plays.
import type { Preset } from '../basalt/presets';
import { formatParam } from '../../model/params';

export const GEODE_PRESETS: Preset[] = [
  { name: 'Cosy Room', params: {}, routes: [] },
  { name: 'Frozen Lake', params: { temp: 0.04, room: 0.82, wet: 0.55, grains: 0.9, gsize: 0.6, gdens: 0.35, breath: 0.85, ewet: 0.2 }, routes: [] },
  { name: 'Summer Street', params: { temp: 0.97, air: 0.65, room: 0.25, wet: 0.2, grains: 0.45, ewet: 0.35, fb: 0.55, breath: 0.3 }, routes: [] },
  { name: 'Plain Tape', params: { grains: 0, room: 0.2, wet: 0.15, ewet: 0, temp: 0.5, air: 0, breath: 0.35 }, routes: [] },
  { name: 'Chopped', params: { mode: 2, grains: 0, breath: 0.08, ewet: 0.15, wet: 0.15, temp: 0.6 }, routes: [] },
  { name: 'Backwards Dream', params: { mode: 1, grains: 0.3, room: 0.7, wet: 0.5, ewet: 0.4, fb: 0.6, breath: 0.8, temp: 0.3 }, routes: [] },
  { name: 'Wobbly Walk', params: { walk: 3, wbars: 1, mdepth: 0.45, mto: 1 + 4, mrate: 3, air: 0.4, grains: 0.6 }, routes: [] },
  { name: 'Crunchy Toy', params: { crunch: 0.55, temp: 0.85, grains: 0.2, room: 0.15, wet: 0.2, breath: 0.1, speed: 0.8 }, routes: [] },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const secs = (x: number) => (x < 1 ? `${Math.round(x * 1000)} ms` : `${x.toFixed(2)} s`);

/** How the front controls read (the numbers people see). */
export const GEODE_FORMAT: Record<string, (v: number) => string> = {
  air: (v) => (v < 0.03 ? 'Shut' : pct(v)),
  room: (v) => `${Math.round(lerp(3, 60, v * v))} m`,
  fb: (v) => `${Math.max(0, Math.round(Math.log(0.01) / Math.log(Math.max(0.01, v * 0.92))))} bounces`,
  breath: (v) => (v < 0.2 ? 'Pluck' : v > 0.8 ? 'Swell' : pct(v)),
  light: (v) => (v < 0.03 ? 'Off' : pct(v)),
  grains: (v) => (v < 0.02 ? 'Plain' : pct(v)),
  crunch: (v) => (v < 0.02 ? 'Clean' : pct(v)),
  gsize: (v) => `${Math.round(lerp(20, 300, v ** 1.3))} ms`,
  gdens: (v) => `${Math.round(lerp(4, 60, v))} /s`,
  speed: (v) => `${(0.25 * 8 ** v).toFixed(2)}×`,
  lfade: (v) => `${Math.round(lerp(5, 250, v))} ms`,
  atk: (v) => secs(lerp(0.003, 3, v * v)),
  dec: (v) => secs(lerp(0.05, 3, v * v)),
  rel: (v) => secs(lerp(0.03, 5, v * v)),
  decay: (v) => secs(lerp(0.3, 8, v ** 1.3)),
  gpitch: (v) => `${lerp(-7, 9, v) >= 0 ? '+' : ''}${lerp(-7, 9, v).toFixed(1)} st`,
  gspeed: (v) => `${lerp(0, 2, v).toFixed(2)}×`,
};
export const fmtOf = (id: string, spec?: Parameters<typeof formatParam>[0]) => GEODE_FORMAT[id] ?? ((v: number) => (spec ? formatParam(spec, v) : pct(v)));
