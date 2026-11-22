// Presence is semantic: "Mira is turning Cutoff on Basalt 2", never screen pixels. Each viewer draws it
// in their own layout. It travels through Yjs awareness (ephemeral, not stored in the project).
import type { Awareness } from 'y-protocols/awareness';
import type { StudioUser } from './types';

export interface Touch {
  track: string;
  /** Param id ('cut', 'amp.A'…), 'note:<id>' for a note being edited, or 'step:<n>'. */
  control: string;
}

export interface PresenceState {
  user: StudioUser;
  /** Track this person is focused on. */
  track: string | null;
  /** Scene they are editing. */
  scene: number;
  touch: Touch | null;
}

export interface Peer extends PresenceState {
  clientId: number;
}

export class PresenceModel {
  private local: PresenceState;
  private listeners = new Set<() => void>();
  private cache: Peer[] = [];
  constructor(
    private awareness: Awareness | null,
    user: StudioUser,
  ) {
    this.local = { user, track: null, scene: 0, touch: null };
    this.publish();
    awareness?.on('change', this.refresh);
    this.refresh();
  }
  private publish() {
    this.awareness?.setLocalStateField('fwm', this.local);
  }
  private refresh = () => {
    const out: Peer[] = [];
    if (this.awareness) {
      for (const [clientId, st] of this.awareness.getStates()) {
        if (clientId === this.awareness.clientID) continue;
        const p = (st as { fwm?: PresenceState }).fwm;
        if (p?.user) out.push({ ...p, clientId });
      }
    }
    this.cache = out;
    for (const fn of this.listeners) fn();
  };
  get me(): PresenceState {
    return this.local;
  }
  set(patch: Partial<PresenceState>) {
    const next = { ...this.local, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.local)) return;
    this.local = next;
    this.publish();
  }
  peers = (): Peer[] => this.cache;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  destroy() {
    this.awareness?.off('change', this.refresh);
  }
}
