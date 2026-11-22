// Mirrors a device store into the engine: creates the device in a slot, then sends only what
// changes. Works the same whether the change came from this user, a preset, or (Phase 2) a peer.
import { useEffect, useSyncExternalStore } from 'react';
import type { DeviceId, Engine } from '@fwm/engine';
import { MAX_ROUTES, type DeviceState, type DeviceStore } from '../model/deviceStore';

export function useDeviceSync(engine: Engine | null, store: DeviceStore, slot: number, device: DeviceId) {
  useEffect(() => {
    if (!engine) return;
    engine.add(slot, device);
    let sent: DeviceState | null = null;
    const push = () => {
      const s = store.getState();
      for (const p of store.manifest.params) {
        const v = s.params[p.id];
        if (!sent || sent.params[p.id] !== v) engine.setParam(slot, p.id, v);
      }
      if (!sent || sent.routes !== s.routes) {
        for (let r = 0; r < MAX_ROUTES; r++) {
          const route = s.routes[r];
          if (route) engine.setRoute(slot, r, route.src, route.target, route.depth);
          else engine.clearRoute(slot, r);
        }
      }
      sent = s;
    };
    push();
    const unsub = store.subscribe(push);
    return () => {
      unsub();
      engine.remove(slot);
    };
  }, [engine, store, slot, device]);
}

/** Subscribe to the device store from React. */
export function useDeviceState(store: DeviceStore): DeviceState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** Live (modulated) value of one param from the engine, rounded so idle knobs don't re-render. */
export function useEffectiveValue(engine: Engine | null, slot: number, index: number): number | null {
  return useSyncExternalStore(
    (fn) => (engine ? engine.subscribe(fn) : () => {}),
    () => {
      const v = engine?.last?.devices[slot]?.eff[index];
      return v == null ? null : Math.round(v * 500) / 500;
    },
    () => null,
  );
}

/** Live mod source values [lfo, amp env, filter env]. */
export function useModSources(engine: Engine | null, slot: number): readonly [number, number, number] | null {
  const key = useSyncExternalStore(
    (fn) => (engine ? engine.subscribe(fn) : () => {}),
    () => {
      const m = engine?.last?.devices[slot]?.mods;
      return m ? m.map((x) => Math.round(x * 200) / 200).join(',') : '';
    },
    () => '',
  );
  return key ? (key.split(',').map(Number) as unknown as [number, number, number]) : null;
}
