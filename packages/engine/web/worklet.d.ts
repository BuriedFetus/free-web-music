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
  setPat(slot: number, id: string, p: { len: number; notes?: { s: number; l: number; m: number; v: number }[]; auto?: Record<number, (number | null)[]> }): void;
  delPat(slot: number, id: string): void;
  setSong(song: { rows: { id: string; len: number; cells: Record<number, string> }[]; loop: 'track' | 'song' } | null): void;
  cue(row: number): void;
  song: { rows: { id: string; len: number; cells: Record<number, string> }[]; loop: 'track' | 'song' } | null;
  row: number;
  rowStart: number;
  advance(frames: number, emit: (frame: number, kind: 'on' | 'off' | 'param', slot: number, a: number, b?: number) => void): void;
  flush(emit: (frame: number, kind: 'off', slot: number, a: number) => void): void;
}
