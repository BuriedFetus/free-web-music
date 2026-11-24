export type DeviceId = 'basalt' | 'flint';
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
  devices: Record<number, { eff: Float32Array; mods: [number, number, number]; step: number }>;
  /** row: id of the song row playing (song mode), rowPos: steps since that row started. */
  transport: { playing: boolean; pos: number; bpm: number; time: number; row: string | null; rowPos: number; next?: string | null };
}

export type Direction = 'fwd' | 'rev' | 'pp' | 'rnd';
export interface TrackSettings {
  len: number;
  dir: Direction;
  rate: number;
  own: boolean;
  mute: boolean;
  /** Drum machines: muted / soloed pads as bit masks (bit i = pad i = note 36 + i). */
  pmute: number;
  psolo: number;
}
export interface SeqNote {
  s: number;
  l: number;
  m: number;
  v: number;
  /** Accent: the hit is sent as note + 12 (Flint plays it louder). */
  a?: number;
  /** Roll: 2–4 quick hits spread over the note's length. */
  r?: number;
}

/** The song as the engine plays it: rows of {slot: patternId}; a row lasts `len` steps. */
export interface SongPlan {
  rows: { id: string; len: number; cells: Record<number, string> }[];
  loop: 'track' | 'song';
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
  /** At page time `at` (performance.now() ms), to the sample: other people's live keys and knob turns. */
  noteOnAt(slot: number, note: number, velocity: number, at: number): void;
  noteOffAt(slot: number, note: number, at: number): void;
  setParamAt(slot: number, id: string, value: number, at: number): void;
  allOff(slot: number): void;
  setParam(slot: number, id: string, value: number): void;
  paramIndex(slot: number, id: string): number;
  setRoute(slot: number, route: number, src: ModSourceId, target: string, depth: number): void;
  clearRoute(slot: number, route: number): void;
  setTransport(t: { playing?: boolean; bpm?: number; swing?: number; row?: number }): void;
  /** `lens`: drum patterns, one length per pad row (pad i = note 36 + i); rows loop on their own. */
  setPat(slot: number, id: string, pattern: { len: number; notes: SeqNote[]; auto?: Record<string, (number | null)[]>; lens?: number[] }): void;
  deletePat(slot: number, id: string): void;
  setSong(song: SongPlan | null): void;
  cue(row: number, wait?: boolean): void;
  rowPosition(): { row: string; pos: number } | null;
  /** Shared transport: start so that song row `row` (index) is `pos` steps in at page time `at` (performance.now() ms). */
  playAt(row: number, pos: number, at: number): void;
  /** While playing: move so that row `row` (index) is `pos` steps in at page time `at`. */
  seek(row: number, pos: number, at: number): void;
  /** Audio time (context seconds) heard at page time `ms`. */
  contextTime(ms: number): number;
  /** Row (id), position in it (steps) and queued row, heard at page time `at`; null when stopped. */
  where(at: number): { row: string; pos: number; next: string | null; stepsPerMs: number } | null;
  setTrack(slot: number, settings: Partial<TrackSettings>): void;
  setPattern(slot: number, notes: SeqNote[], auto?: Record<string, (number | null)[]>): void;
  position(): number | null;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  latency(): { base: number; output: number };
}

export const KINDS: Record<DeviceId, number>;
export const MOD_SOURCES: Record<ModSourceId, number>;

export function createEngine(options?: {
  /** Folder holding fwm_engine.wasm, worklet.js, basalt.json, flint.json. Default: next to this module. */
  base?: string;
  context?: BaseAudioContext;
  /** Manifests as objects or URLs. */
  manifests?: Partial<Record<DeviceId, DeviceManifest | string>>;
}): Promise<Engine>;
