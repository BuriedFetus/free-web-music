// Garnet factory sounds (the approved mock-up's seven). Unlisted params use the manifest defaults.
import type { Preset } from '../basalt/presets';

const p = (name: string, params: Record<string, number>): Preset => ({ name, params, routes: [] });

export const GARNET_PRESETS: Preset[] = [
  p('Clean Electric', {}),
  p('Warm Jazz', { pick: 0.6, hard: 0.22, sustain: 0.45, bright: 0.32, body: 2, reso: 0.6, tone: 0.4, drive: 0.1, cab: 1, pres: 0.4 }),
  p('Nylon', { pick: 0.42, hard: 0.18, sustain: 0.45, bright: 0.45, body: 0, reso: 0.7, tone: 0.5, drive: 0, cab: 0, pres: 0.5 }),
  p('Steel Acoustic', { pick: 0.15, hard: 0.75, sustain: 0.65, bright: 0.75, body: 1, reso: 0.65, tone: 0.6, drive: 0, cab: 0, pres: 0.6 }),
  p('Crunch', { pick: 0.12, hard: 0.8, sustain: 0.75, bright: 0.7, body: 3, reso: 0.5, tone: 0.6, drive: 0.6, cab: 2, pres: 0.55, dist: 0.25 }),
  p('Warm Fuzz', { pick: 0.45, hard: 0.5, sustain: 0.8, bright: 0.45, body: 3, reso: 0.6, tone: 0.4, drive: 0.2, cab: 1, pres: 0.35, dist: 0.45, ring: 0.7 }),
  p('Metal', { pick: 0.1, hard: 0.9, sustain: 0.8, bright: 0.65, body: 3, reso: 0.45, tone: 0.55, drive: 0.35, cab: 2, pres: 0.5, dist: 0.9, ring: 0.3, strum: 0.1 }),
  p('Funk Mute', { pick: 0.1, hard: 0.85, sustain: 0.5, bright: 0.75, body: 3, reso: 0.5, tone: 0.65, drive: 0.08, cab: 1, pres: 0.65, mute: 1, strum: 0.2 }),
  p('Lead Drive', { pick: 0.15, hard: 0.7, sustain: 0.95, bright: 0.6, body: 3, reso: 0.4, tone: 0.55, drive: 0.85, cab: 2, pres: 0.5, vib: 0.35, slide: 0.3, ring: 0.8, dist: 0.55 }),
];

/** Knob readouts in the mock-up's words. */
export const GARNET_FORMAT: Record<string, (v: number) => string> = {
  pick: (v) => (v < 0.34 ? 'Bridge' : v < 0.67 ? 'Middle' : 'Neck'),
  hard: (v) => (v < 0.34 ? 'Thumb' : v < 0.67 ? 'Soft' : 'Hard'),
  sustain: (v) => (0.35 + v * v * 7.5).toFixed(1) + ' s',
  strum: (v) => Math.round(6 + v * v * 60) + ' ms',
  slide: (v) => (v <= 0 ? 'Off' : Math.round((0.004 + v * v * 0.3) * 1000) + ' ms'),
  ring: (v) => (v < 0.05 ? 'Damped' : v > 0.95 ? 'Let ring' : Math.round(v * 100) + '%'),
  dist: (v) => (v <= 0.005 ? 'Off' : `${v < 0.34 ? 'Warm' : v < 0.67 ? 'Crunch' : 'Metal'} ${Math.round(v * 100)}%`),
};
