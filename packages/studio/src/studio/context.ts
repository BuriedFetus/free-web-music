import { createContext, useContext } from 'react';
import type { PresenceModel } from '../collab/presence';
import type { LiveChannel, StudioUser } from '../collab/types';
import type { Project } from '../model/project';

export const QUANT: Record<string, number> = { '1/4': 4, '1/8': 2, '1/16': 1, '1/32': 0.5, '1/64': 0.25, Off: 0 };

/** Private to this user (never shared): what they selected and how they edit. */
export interface Workspace {
  /** Selected instrument. */
  track: string | null;
  /** Selected song row (TRACK n in the UI). The Piano roll edits the pattern in cell (row, track). */
  row: string | null;
  snap: string;
  recQuant: string;
  /** Piano roll shows only the rows in the song key. */
  fold: boolean;
  /** At the end of a TRACK: play it again ('track') or go to the next one ('song'). */
  loop: 'track' | 'song';
}

export interface StudioCtx {
  project: Project;
  presence: PresenceModel;
  user: StudioUser;
  channel: LiveChannel | null;
  ws: Workspace;
  setWs(patch: Partial<Workspace>): void;
  playing: boolean;
  setPlaying(p: boolean): void;
  rec: boolean;
  setRec(r: boolean): void;
  slotOf(track: string): number | undefined;
  /** Jump playback to a song row now (when playing), keeping the beat. */
  cueRow(row: string): void;
  /** Notes played by this user: sound, sent to everyone, recorded when Rec is on. */
  playNote(track: string, note: number, vel: number): void;
  releaseNote(track: string, note: number): void;
  /** Local audition while editing (not sent, not recorded). */
  audition(track: string, note: number, on: boolean): void;
  /** Keys others are holding, per track. */
  peerHeld: Record<string, { note: number; color: string }[]>;
  toast(msg: string, action?: { label: string; run(): void }): void;
}

export const StudioContext = createContext<StudioCtx | null>(null);
export function useStudio(): StudioCtx {
  const c = useContext(StudioContext);
  if (!c) throw new Error('useStudio must be used inside <Studio>');
  return c;
}
