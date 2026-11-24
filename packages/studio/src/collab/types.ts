// What the host app provides for collaboration. The studio itself never opens a network connection.
import type { Awareness } from 'y-protocols/awareness';

export interface StudioUser {
  id: string;
  name: string;
  /** Any CSS colour. Used for this person's rings, tags and avatar. */
  color: string;
}

/** Live performance events (keyboard jamming). Small, frequent, never stored. */
export type LiveMessage =
  | { t: 'on'; track: string; note: number; vel: number; user: string }
  | { t: 'off'; track: string; note: number; user: string };

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
