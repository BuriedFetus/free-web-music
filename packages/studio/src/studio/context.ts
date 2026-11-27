import { createContext, useContext } from 'react';
import type { PresenceModel } from '../collab/presence';
import type { LiveChannel, SongLibrary, StudioUser } from '../collab/types';
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
  /** Clicking a TRACK while playing: switch when the playing TRACK ends (true) or at once. */
  cueWait: boolean;
  /** Other people's live keys and knob turns: steady and slightly late ('even') or on arrival ('tight'). */
  liveMode: 'even' | 'tight';
}

export interface StudioCtx {
  project: Project;
  presence: PresenceModel;
  user: StudioUser;
  channel: LiveChannel | null;
  /** The host's song storage, if it has one. */
  songs: SongLibrary | null;
  /** This person's saved presets. */
  myPresets: import('../model/myPresets').PresetCache;
  ws: Workspace;
  setWs(patch: Partial<Workspace>): void;
  /** Playing, for everyone in the session (or only me when alone). */
  playing: boolean;
  setPlaying(p: boolean): void;
  /** Play alone: my Play / Stop / TRACK clicks only affect me. */
  alone: boolean;
  setAlone(a: boolean): void;
  /** Loop TRACK / Loop SONG, shared with the group. */
  setLoop(loop: 'track' | 'song'): void;
  /** Shared transport and live timing (clocks, delays), for the people chips. */
  transport: import('../collab/transport').TransportSync;
  liveTiming: import('../collab/liveTiming').LiveTiming;
  rec: boolean;
  /** Overdub (add notes) or replace (the first note clears the pattern). */
  recMode: 'over' | 'replace';
  setRec(r: boolean, mode?: 'over' | 'replace'): void;
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
  /** Notes this person holds on the computer keyboard, per track. */
  myHeld: Record<string, number[]>;
  toast(msg: string, action?: { label: string; run(): void }): void;
  /** The computer keyboard's octave shift (Z / X), -3..4; the panels' octave buttons move it too. */
  octave: number;
  setOctave(o: number): void;
  /** Geode's tapes: recording, keeping and sharing them. */
  tapes: import('./useTapes').TapesCtl;
  /** This person's own look (a stylesheet only they see; never in the shared song). */
  look: LookCtl;
}

export interface LookCtl {
  /** The kept look, or null for the default. */
  css: string | null;
  /** Keep a look (null = back to the default). */
  set(css: string | null): void;
  /** Try a look without keeping it (null = stop trying). */
  preview: string | null;
  setPreview(css: string | null): void;
  /** The host app keeps it (e.g. in the person's profile), so it follows them to other computers. */
  hostKeeps: boolean;
  /** Looks are switched off for this page (?nolook). */
  off: boolean;
}

export const StudioContext = createContext<StudioCtx | null>(null);
export function useStudio(): StudioCtx {
  const c = useContext(StudioContext);
  if (!c) throw new Error('useStudio must be used inside <Studio>');
  return c;
}
