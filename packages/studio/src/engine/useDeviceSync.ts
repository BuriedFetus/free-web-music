// Mirrors a device store into the engine: creates the device in a slot, then sends only what
// changes. Works the same whether the change came from this user, a preset, or (Phase 2) a peer.
import { useEffect, useSyncExternalStore } from 'react';
import type { DeviceId, Engine } from '@fwm/engine';
import { MAX_ROUTES, type DeviceState, type DeviceStore } from '../model/deviceStore';

export function useDeviceSync(engine: Engine | null, store: DeviceStore, slot: number, device: DeviceId, held?: HeldParams | null) {
  useEffect(() => {
    if (!engine) return;
    engine.add(slot, device);
    let sent: DeviceState | null = null;
    const push = () => {
      const s = store.getState();
      for (const p of store.manifest.params) {
        const v = s.params[p.id];
        // A knob someone is turning live plays from their timed messages; the doc catches up after.
        if ((!sent || sent.params[p.id] !== v) && !held?.isHeld(slot, p.id)) engine.setParam(slot, p.id, v);
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
    // When the live turn ends, the knob goes to the doc's value (the last word, in case a message was lost).
    const unhold = held?.onRelease(slot, (id) => engine.setParam(slot, id, store.getState().params[id]));
    return () => {
      unsub();
      unhold?.();
      engine.remove(slot);
    };
  }, [engine, store, slot, device, held]);
}

/** Knobs another person is turning live, per engine slot, until a moment (page ms). */
export class HeldParams {
  private until = new Map<string, number>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private release = new Map<number, (id: string) => void>();
  hold(slot: number, id: string, until: number) {
    const k = `${slot}:${id}`;
    this.until.set(k, until);
    clearTimeout(this.timers.get(k));
    this.timers.set(k, setTimeout(() => {
      this.until.delete(k);
      this.timers.delete(k);
      this.release.get(slot)?.(id);
    }, Math.max(0, until - performance.now())));
  }
  isHeld(slot: number, id: string) {
    return this.until.has(`${slot}:${id}`);
  }
  onRelease(slot: number, fn: (id: string) => void) {
    this.release.set(slot, fn);
    return () => {
      if (this.release.get(slot) === fn) this.release.delete(slot);
    };
  }
  clear() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.until.clear();
  }
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
