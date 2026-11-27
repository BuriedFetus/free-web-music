export function stepOf(n: number, len: number, dir: string, seed?: number): number;
export class Sequencer {
  constructor(sampleRate: number);
  playing: boolean;
  bpm: number;
  swing: number;
  pos: number;
  tracks: Map<number, { step: number }>;
  setTrack(slot: number, s: object): void;
  setPattern(slot: number, notes: { s: number; l: number; m: number; v: number }[], auto?: Record<number, (number | null)[]>): void;
  removeTrack(slot: number): void;
  setTransport(t: { playing?: boolean; bpm?: number; swing?: number; row?: number }): boolean;
  setPat(slot: number, id: string, p: { len: number; notes?: { s: number; l: number; m: number; v: number; a?: number; r?: number }[]; auto?: Record<number, (number | null)[]>; lens?: number[] }): void;
  delPat(slot: number, id: string): void;
  setSong(song: { rows: { id: string; len: number; cells: Record<number, string> }[]; loop: 'track' | 'song' } | null): void;
  cue(row: number, wait?: boolean): void;
  /** Play from `target` steps into row `row` (negative = start that many steps from now). */
  start(row: number, target: number): void;
  /** Move so row `row` is `target` steps in now, keeping the global clock. */
  seek(row: number, target: number): void;
  pending: string | null;
  song: { rows: { id: string; len: number; cells: Record<number, string> }[]; loop: 'track' | 'song' } | null;
  row: number;
  rowStart: number;
  /** Steps since Play (keeps counting when a row loops): what devices move by. */
  readonly clock: number;
  advance(frames: number, emit: (frame: number, kind: 'on' | 'off' | 'param', slot: number, a: number, b?: number) => void): void;
  flush(emit: (frame: number, kind: 'off', slot: number, a: number) => void): void;
}
/** The AudioWorklet processor (exported for tests; needs the AudioWorkletGlobalScope globals). */
export class FwmEngine {
  constructor(options: { processorOptions: { wasm: BufferSource; slots?: { slot: number; kind: number }[] } });
  msg(m: object): void;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
