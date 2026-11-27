// What the host app provides for collaboration. The studio itself never opens a network connection.
import type { Awareness } from 'y-protocols/awareness';

export interface StudioUser {
  id: string;
  name: string;
  /** Any CSS colour. Used for this person's rings, tags and avatar. */
  color: string;
}

/**
 * Live performance events (keyboard jamming, knob turns). Small, frequent, never stored.
 * `from` is the sender's studio session and `at` the moment it was played on the sender's clock
 * (performance.now() ms, when it was heard there), so others can play it with even timing.
 */
export type NoteMessage =
  | { t: 'on'; track: string; note: number; vel: number; user: string; from?: string; at?: number }
  | { t: 'off'; track: string; note: number; user: string; from?: string; at?: number }
  /** A knob turned live (the value also goes through the doc; this copy carries its timing). */
  | { t: 'param'; track: string; id: string; v: number; user: string; from: string; at: number };

/**
 * Shared transport (one Play for everyone). `from` is one open studio (a tab), so the same person
 * in two tabs is two sessions. Times are the sender's performance.now() (ms); the receiver converts
 * them with the clock difference it measured (ping / pong).
 */
export type TransportMessage =
  | { t: 'ping'; from: string; user: string; a: number; alone: boolean; /** output delay, ms */ lat?: number }
  | { t: 'pong'; from: string; to: string; a: number; b: number }
  | { t: 'hello'; from: string }
  | {
      t: 'tp';
      from: string;
      user: string;
      kind: 'play' | 'stop' | 'cue' | 'loop' | 'beat' | 'state';
      /** Version of the shared transport: each Play / Stop / TRACK click / loop change adds 1. */
      n: number;
      playing: boolean;
      /** Song row (TRACK) id, and how many steps into it the song is at `time`. */
      row: string | null;
      pos: number;
      time: number;
      /** Sender's clock when sent (lets a receiver that has no clock difference yet guess). */
      sent: number;
      loop: 'track' | 'song';
      next?: string | null;
      wait?: boolean;
    };

/**
 * Geode's tapes (recorded sound), sent live and never stored by the studio on a server: a piece of a tape
 * ({t:'smp'}, ~32 KB of base64 each, a few per 40 ms while one is being sent) and "who has this tape?" ({t:'smp?'}).
 */
export type TapeMessage = import('../model/sampleStore').TapeChunk | import('../model/sampleStore').TapeAsk;

/** Everything on the live channel. The host relays these as they are, to everyone in the session. */
export type LiveMessage = NoteMessage | TransportMessage | TapeMessage;

/** A low-latency ephemeral message channel to everyone in the session (e.g. a WebRTC data channel). */
export interface LiveChannel {
  send(msg: LiveMessage): void;
  subscribe(fn: (msg: LiveMessage) => void): () => void;
}

export type { Awareness };

/** One saved song, as listed by the host. */
export interface SongSummary {
  id: string;
  name: string;
  /** Last saved, ms since 1970. */
  updated: number;
}

/**
 * Where songs are saved: provided by the host (its server, IndexedDB, files…). The studio only calls these.
 * A song is a plain JSON object (SongFile); store it as is.
 */
export interface SongLibrary {
  list(): Promise<SongSummary[]>;
  load(id: string): Promise<import('../model/project').SongFile>;
  /** Save `file`: overwrite `id` when given, otherwise create a new entry. Resolves to the song's id. */
  save(file: import('../model/project').SongFile, id?: string | null): Promise<string>;
  remove?(id: string): Promise<void>;
}
