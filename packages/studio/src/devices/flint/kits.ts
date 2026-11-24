// Flint factory kits: 8 pads each. A pad is any drum type in any character, so a kit can be
// four kicks, two snares and two open hats. Unlisted params use the manifest defaults.
import type { Preset } from '../basalt/presets';

export const DRUM_TYPES = ['Kick', 'Snare', 'Clap', 'Closed hat', 'Open hat', 'Tom', 'Rim', 'Perc'] as const;
export const CHARACTERS = ['Analog', 'Digital', 'Noise', 'Vintage'] as const;
export const CHARACTER_HINT = [
  'Round and warm: clean sine bodies, smooth decays.',
  'Crisp and bright: harder edges, a little bit-crushed.',
  'Airy: built mostly from filtered noise.',
  'Thick and saturated: rounder waves pushed into soft overdrive, a bit darker.',
];
/** Pad i (0–7) plays note FIRST_PAD + i; accented hits are FIRST_PAD + 12 + i. */
export const FIRST_PAD = 36;
export const ACCENT_OFFSET = 12;

type Pad = [type: number, character: number, tune?: number, decay?: number, tone?: number, level?: number];
const T = { kick: 0, snare: 1, clap: 2, chat: 3, ohat: 4, tom: 5, rim: 6, perc: 7 };
const C = { analog: 0, digital: 1, noise: 2, vintage: 3 };

function kit(name: string, pads: Pad[]): Preset {
  const params: Record<string, number> = {};
  pads.forEach(([type, ch, tune = 0.5, decay = 0.5, tone = 0.5, level = 0.8], i) => {
    const p = `p${i + 1}.`;
    Object.assign(params, { [p + 'type']: type, [p + 'model']: ch, [p + 'tune']: tune, [p + 'decay']: decay, [p + 'tone']: tone, [p + 'level']: level });
  });
  return { name, params, routes: [] };
}
const std = (ch: number): Pad[] => [[T.kick, ch], [T.snare, ch], [T.clap, ch], [T.chat, ch, 0.5, 0.3], [T.ohat, ch], [T.tom, ch, 0.45], [T.rim, ch], [T.perc, ch]];

export const FLINT_KITS: Preset[] = [
  kit('Basement', std(C.analog)),
  kit('Chrome', std(C.digital)),
  kit('Static', std(C.noise)),
  kit('Dusty', std(C.vintage)),
  kit('Four on the floor', [[T.kick, C.analog, 0.45, 0.6], [T.kick, C.vintage, 0.35, 0.7], [T.kick, C.digital, 0.6, 0.35], [T.kick, C.noise, 0.5, 0.4],
    [T.snare, C.analog], [T.snare, C.noise, 0.6, 0.4], [T.ohat, C.analog, 0.5, 0.55], [T.ohat, C.digital, 0.6, 0.35]]),
  kit('Steel', [[T.kick, C.digital, 0.55, 0.4, 0.7], [T.snare, C.digital, 0.6, 0.35, 0.7], [T.clap, C.digital], [T.chat, C.digital, 0.6, 0.25],
    [T.ohat, C.digital, 0.6, 0.45], [T.tom, C.digital, 0.6], [T.rim, C.digital, 0.6], [T.perc, C.digital, 0.7]]),
  kit('Sandstorm', [[T.kick, C.vintage, 0.4, 0.65], [T.snare, C.noise, 0.5, 0.55], [T.clap, C.vintage], [T.chat, C.noise, 0.5, 0.3],
    [T.ohat, C.noise, 0.5, 0.6], [T.tom, C.vintage, 0.35, 0.6], [T.rim, C.vintage], [T.perc, C.noise, 0.6]]),
  kit('Night Bus', [[T.kick, C.analog, 0.42, 0.75, 0.3], [T.snare, C.vintage, 0.45, 0.5, 0.35], [T.clap, C.analog, 0.5, 0.6, 0.4], [T.chat, C.analog, 0.45, 0.3, 0.4],
    [T.ohat, C.vintage, 0.45, 0.6, 0.4], [T.tom, C.analog, 0.3, 0.7, 0.4], [T.rim, C.analog, 0.4, 0.5, 0.4], [T.perc, C.vintage, 0.35, 0.5, 0.4]]),
];

/** True when the pads still match the kit they were loaded from. */
export function kitIsEdited(params: Readonly<Record<string, number>>, kitIndex: number): boolean {
  const k = FLINT_KITS[kitIndex];
  return !!k && Object.entries(k.params).some(([id, v]) => Math.abs((params[id] ?? 0) - v) > 1e-6);
}
