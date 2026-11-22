// The device library. Adding a device = a manifest + DSP in the engine + a UI component + an entry here.
import type { ComponentType } from 'react';
import type { DeviceId, DeviceManifest } from '@fwm/engine';
import basaltManifest from '@fwm/engine/devices/basalt.json';
import { Basalt, type BasaltProps } from './basalt/Basalt';
import { BASALT_PRESETS, type Preset } from './basalt/presets';

export interface DeviceEntry {
  id: string;
  name: string;
  kind: string;
  category: 'Synths' | 'Drums' | 'Keys & pads';
  /** Range shown in the piano roll (MIDI notes). */
  roll: { low: number; high: number };
  /** Default pitch when a step is switched on in the main sequencer. */
  rootNote: number;
  available: boolean;
  /** When it arrives, for devices not built yet. */
  soon?: string;
  manifest?: DeviceManifest;
  Component?: ComponentType<BasaltProps>;
  presets?: Preset[];
}

export const LIBRARY: DeviceEntry[] = [
  {
    id: 'basalt', name: 'Basalt', kind: 'Mono bass synth', category: 'Synths', roll: { low: 24, high: 60 }, rootNote: 36,
    available: true, manifest: basaltManifest as DeviceManifest, Component: Basalt, presets: BASALT_PRESETS,
  },
  { id: 'cobalt', name: 'Cobalt', kind: 'Chip lead + arpeggiator', category: 'Synths', roll: { low: 60, high: 96 }, rootNote: 72, available: false, soon: 'Phase 5' },
  { id: 'quartz', name: 'Quartz', kind: 'FM keys', category: 'Keys & pads', roll: { low: 42, high: 78 }, rootNote: 60, available: false, soon: 'Phase 5' },
  { id: 'opal', name: 'Opal', kind: 'Pad synth', category: 'Keys & pads', roll: { low: 42, high: 78 }, rootNote: 60, available: false, soon: 'Phase 5' },
  { id: 'flint', name: 'Flint', kind: 'Drum machine', category: 'Drums', roll: { low: 36, high: 51 }, rootNote: 36, available: false, soon: 'Phase 5' },
];

export const deviceEntry = (id: DeviceId | string) => LIBRARY.find((d) => d.id === id);
