// State of one device instance: parameter values and modulation routes.
// Phase 1 keeps it in memory. Phase 2 backs the same interface with a Y.Map in the shared
// project doc, so components and the engine sync never change.
import type { DeviceManifest, ModSourceId } from '@fwm/engine';

export interface Route {
  src: ModSourceId;
  target: string;
  /** -1..1. LFO routes are additionally scaled by the LFO Amount. */
  depth: number;
}

export interface DeviceState {
  params: Readonly<Record<string, number>>;
  routes: readonly Route[];
}

export interface DeviceStore {
  manifest: DeviceManifest;
  getState(): DeviceState;
  subscribe(fn: () => void): () => void;
  setParam(id: string, value: number): void;
  /** Replace everything (presets). Missing params fall back to defaults. */
  load(patch: { params?: Record<string, number>; routes?: Route[] }): void;
  addRoute(route: Route): boolean;
  setRouteDepth(index: number, depth: number): void;
  removeRoute(index: number): void;
}

export const MAX_ROUTES = 16;

export function defaults(manifest: DeviceManifest): Record<string, number> {
  return Object.fromEntries(manifest.params.map((p) => [p.id, p.default]));
}

/** A source may only target continuous, modulatable params that are not its own controls. */
export function canRoute(manifest: DeviceManifest, src: ModSourceId, target: string): boolean {
  const spec = manifest.params.find((p) => p.id === target);
  const source = manifest.modSources.find((s) => s.id === src);
  return !!spec && !!source && spec.type === 'float' && !!spec.mod && !source.noTargets.includes(target);
}

/** Range a param sweeps under its routes, as offsets from the knob value (for the purple arc). */
export function modRange(state: DeviceState, target: string): { low: number; high: number } | null {
  let low = 0;
  let high = 0;
  let any = false;
  for (const r of state.routes) {
    if (r.target !== target) continue;
    any = true;
    const d = r.depth * (r.src === 'lfo' ? (state.params.lamt ?? 1) : 1);
    if (r.src === 'lfo') {
      low -= Math.abs(d);
      high += Math.abs(d);
    } else if (d > 0) high += d;
    else low += d;
  }
  return any ? { low, high } : null;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function createDeviceStore(manifest: DeviceManifest, init?: Partial<DeviceState>): DeviceStore {
  let state: DeviceState = {
    params: { ...defaults(manifest), ...init?.params },
    routes: init?.routes ? [...init.routes] : [],
  };
  const listeners = new Set<() => void>();
  const emit = (next: DeviceState) => {
    state = next;
    for (const fn of listeners) fn();
  };
  const spec = (id: string) => manifest.params.find((p) => p.id === id);

  return {
    manifest,
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setParam(id, value) {
      const s = spec(id);
      if (!s) return;
      const v = s.type === 'enum' ? Math.round(value) : clamp01(value);
      if (state.params[id] === v) return;
      emit({ ...state, params: { ...state.params, [id]: v } });
    },
    load(patch) {
      emit({
        params: { ...defaults(manifest), ...patch.params },
        routes: (patch.routes ?? []).filter((r) => canRoute(manifest, r.src, r.target)).slice(0, MAX_ROUTES),
      });
    },
    addRoute(route) {
      if (!canRoute(manifest, route.src, route.target)) return false;
      if (state.routes.length >= MAX_ROUTES) return false;
      if (state.routes.some((r) => r.src === route.src && r.target === route.target)) return false;
      emit({ ...state, routes: [...state.routes, { ...route, depth: Math.max(-1, Math.min(1, route.depth)) }] });
      return true;
    },
    setRouteDepth(index, depth) {
      if (!state.routes[index]) return;
      const routes = state.routes.slice();
      routes[index] = { ...routes[index], depth: Math.max(-1, Math.min(1, depth)) };
      emit({ ...state, routes });
    },
    removeRoute(index) {
      if (!state.routes[index]) return;
      emit({ ...state, routes: state.routes.filter((_, i) => i !== index) });
    },
  };
}
