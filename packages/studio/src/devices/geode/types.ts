// What the studio gives a Geode panel for its tape (see studio/useTapes.ts). Standalone, the panel
// makes a small local one (demo tape only).
import type { Tape } from '../../model/sampleStore';
import type { TapeRec, TapeStatus } from '../../studio/useTapes';

export interface GeodeHost {
  status: TapeStatus;
  /** This Geode is recording (or waiting for sound). */
  rec: TapeRec | null;
  /** Another Geode is recording right now (one at a time). */
  busy: boolean;
  /** Instruments it can record from (every other track). */
  inputs: { id: string; name: string }[];
  record(input: string): void;
  /** Stop and keep it (or cancel when nothing was heard yet). */
  stop(): void;
  demo(): void;
  clear(): void;
  /** The tape's sound, when this computer has it (for the film strip). */
  tape(): Tape | null;
  subscribe(fn: () => void): () => void;
  version(): number;
}
