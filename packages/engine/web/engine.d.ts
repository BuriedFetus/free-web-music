export type DeviceId = 'basalt';
export type ModSourceId = 'lfo' | 'amp' | 'filt';

export interface ParamSpec {
  id: string;
  label: string;
  section: string;
  type: 'float' | 'enum';
  default: number;
  options?: string[];
  unit?: string;
  map?: 'lin' | 'exp' | 'exp0';
  min?: number;
  max?: number;
  mod?: boolean;
}

export interface ModSourceSpec {
  id: ModSourceId;
  label: string;
  bipolar: boolean;
  noTargets: string[];
}

export interface DeviceManifest {
  id: DeviceId;
  name: string;
  kind: 'instrument' | 'sequencer' | 'effect' | 'recorder';
  version: number;
  voices: string;
  description: string;
  params: ParamSpec[];
  modSources: ModSourceSpec[];
}

export interface EngineTick {
  t: 'tick';
  /** Last 2048 output samples, oldest first. */
  scope: Float32Array;
  /** Per slot: modulated param values (manifest order) and mod source values [lfo, amp, filt]. */
  devices: Record<number, { eff: Float32Array; mods: [number, number, number] }>;
}

export interface Engine {
  context: BaseAudioContext;
  node: AudioWorkletNode;
  manifest: Record<DeviceId, DeviceManifest>;
  last: EngineTick | null;
  onTick: ((m: EngineTick) => void) | null;
  subscribe(fn: (m: EngineTick) => void): () => void;
  add(slot: number, device: DeviceId): void;
  remove(slot: number): void;
  noteOn(slot: number, note: number, velocity?: number): void;
  noteOff(slot: number, note: number): void;
  allOff(slot: number): void;
  setParam(slot: number, id: string, value: number): void;
  paramIndex(slot: number, id: string): number;
  setRoute(slot: number, route: number, src: ModSourceId, target: string, depth: number): void;
  clearRoute(slot: number, route: number): void;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  latency(): { base: number; output: number };
}

export const KINDS: Record<DeviceId, number>;
export const MOD_SOURCES: Record<ModSourceId, number>;

export function createEngine(options?: {
  /** Folder holding fwm_engine.wasm, worklet.js, basalt.json. Default: next to this module. */
  base?: string;
  context?: BaseAudioContext;
  /** Manifests as objects or URLs. */
  manifests?: Partial<Record<DeviceId, DeviceManifest | string>>;
}): Promise<Engine>;
