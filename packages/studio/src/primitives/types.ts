// Props contracts for the replaceable primitives (docs/THEMING.md, level 3).
// A host can pass its own components with these props; devices never draw controls themselves.
import type { ComponentType, ReactNode } from 'react';

export interface Presence {
  userId: string;
  name: string;
  color: string;
}

/** Where modulation moves a control: absolute 0..1 values. */
export interface Modulation {
  low: number;
  high: number;
  /** Live value from the engine, when sound is on. */
  current?: number;
}

export interface KnobProps {
  value: number;
  onChange(v: number): void;
  label: string;
  format?(v: number): string;
  size?: 'md' | 'lg';
  modulation?: Modulation;
  presence?: Presence[];
  defaultValue?: number;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

export type FaderProps = KnobProps;

export interface ButtonProps {
  pressed?: boolean;
  onPress(): void;
  label: string;
  icon?: ReactNode;
  /** hw = hardware key, seg = segmented choice, wave = icon choice, assign = modulation assign */
  variant?: 'hw' | 'seg' | 'wave' | 'assign';
  presence?: Presence[];
  children?: ReactNode;
}

export interface ScreenProps {
  variant: 'preset' | 'scope' | 'readout';
  label?: string;
  children?: ReactNode;
}

export interface KeysProps {
  low: number;
  high: number;
  held: number[];
  peerHeld?: { note: number; color: string }[];
  onNoteOn(note: number, velocity: number): void;
  onNoteOff(note: number): void;
  /** The song's key: notes outside it are dimmed and play the nearest note of the key. */
  scale?: { has(note: number): boolean; isRoot(note: number): boolean; snap(note: number): number };
}

export interface Primitives {
  Knob: ComponentType<KnobProps>;
  Fader: ComponentType<FaderProps>;
  Button: ComponentType<ButtonProps>;
  Screen: ComponentType<ScreenProps>;
  Keys: ComponentType<KeysProps>;
}
