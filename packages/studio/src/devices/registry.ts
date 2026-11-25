// The device library. Adding a device = a manifest + DSP in the engine + a UI component + an entry here.
import type { ComponentType } from 'react';
import type { DeviceId, DeviceManifest } from '@fwm/engine';
import basaltManifest from '@fwm/engine/devices/basalt.json';
import flintManifest from '@fwm/engine/devices/flint.json';
import garnetManifest from '@fwm/engine/devices/garnet.json';
import { Basalt, type DeviceProps } from './basalt/Basalt';
import { BASALT_PRESETS, type Preset } from './basalt/presets';
import { Flint } from './flint/Flint';
import { FLINT_KITS } from './flint/kits';
import { Garnet } from './garnet/Garnet';
import { GARNET_PRESETS } from './garnet/presets';
import opalManifest from '@fwm/engine/devices/opal.json';
import { Opal } from './opal/Opal';
import { OPAL_PRESETS } from './opal/presets';

export interface DeviceEntry {
  id: string;
  name: string;
  kind: string;
  category: 'Synths' | 'Strings' | 'Drums' | 'Keys & pads';
  /** Range shown in the piano roll (MIDI notes). */
  roll: { low: number; high: number };
  /** Default pitch when a step is switched on in the main sequencer. */
  rootNote: number;
  available: boolean;
  /** When it arrives, for devices not built yet. */
  soon?: string;
  manifest?: DeviceManifest;
  Component?: ComponentType<DeviceProps>;
  presets?: Preset[];
  /** How notes are edited and played: a piano roll and piano keys, or drum pads (grid + A–K keys). */
  layout?: 'piano' | 'pads';
}

export const LIBRARY: DeviceEntry[] = [
  {
    id: 'basalt', name: 'Basalt', kind: 'Mono bass synth', category: 'Synths', roll: { low: 24, high: 60 }, rootNote: 36,
    available: true, manifest: basaltManifest as DeviceManifest, Component: Basalt, presets: BASALT_PRESETS,
  },
  {
    id: 'garnet', name: 'Garnet', kind: 'String synth: strum & pick', category: 'Strings', roll: { low: 40, high: 84 }, rootNote: 52,
    available: true, manifest: garnetManifest as DeviceManifest, Component: Garnet, presets: GARNET_PRESETS,
  },
  { id: 'cobalt', name: 'Cobalt', kind: 'Chip lead + arpeggiator', category: 'Synths', roll: { low: 60, high: 96 }, rootNote: 72, available: false, soon: 'Phase 5' },
  { id: 'quartz', name: 'Quartz', kind: 'FM keys', category: 'Keys & pads', roll: { low: 42, high: 78 }, rootNote: 60, available: false, soon: 'Phase 5' },
  {
    id: 'opal', name: 'Opal', kind: 'Pad synth: 8 voices, stack & chorus', category: 'Keys & pads', roll: { low: 36, high: 84 }, rootNote: 60,
    available: true, manifest: opalManifest as DeviceManifest, Component: Opal, presets: OPAL_PRESETS,
  },
  {
    id: 'flint', name: 'Flint', kind: 'Drum machine', category: 'Drums', roll: { low: 36, high: 43 }, rootNote: 36, layout: 'pads',
    available: true, manifest: flintManifest as DeviceManifest, Component: Flint, presets: FLINT_KITS,
  },
];

export const deviceEntry = (id: DeviceId | string) => LIBRARY.find((d) => d.id === id);
