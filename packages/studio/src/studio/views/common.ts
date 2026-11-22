import { useSyncExternalStore } from 'react';
import type { Peer } from '../../collab/presence';
import { useEngine } from '../../engine/EngineProvider';
import type { Presence } from '../../primitives/types';

export const toPresence = (p: Peer): Presence => ({ userId: String(p.clientId), name: p.user.name, color: p.user.color });

/** Step the sequencer is playing on a slot right now (-1 when stopped). */
export function usePlayStep(slot: number | undefined): number {
  const { engine, status } = useEngine();
  return useSyncExternalStore(
    (fn) => (engine && status === 'on' ? engine.subscribe(fn) : () => {}),
    () => {
      const t = engine?.last;
      if (status !== 'on' || !t?.transport.playing || slot == null) return -1;
      return t.devices[slot]?.step ?? -1;
    },
    () => -1,
  );
}
