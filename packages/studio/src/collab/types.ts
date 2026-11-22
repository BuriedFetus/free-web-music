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
