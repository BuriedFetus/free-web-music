// The shared project, stored in the host's Yjs doc. Everything here is seen by every collaborator.
//
// Layout (top-level types never conflict when two people start at once):
//   fwm.meta       Y.Map    { schema, bpm, swing }
//   fwm.order      Y.Array  track ids, in display order
//   fwm.tracks     Y.Map    trackId → Y.Map { device, name, seq: Y.Map{len,dir,rate,own,mute},
//                                              params: Y.Map<paramId, number>, routes: Y.Array<Route> }
//   fwm.patterns   Y.Map    `${trackId}|${scene}` → Y.Map { notes: Y.Map<noteId, Note>, auto: Y.Map<`${param}@${step}`, number> }
// Nested maps are created together with their track, so two people never race to create the same one.
//
// Every local edit is tagged with this user's `origin`, so the UndoManager only undoes your own changes.
import * as Y from 'yjs';
import type { DeviceId, DeviceManifest, Direction, SeqNote } from '@fwm/engine';
import { canRoute, defaults, MAX_ROUTES, type DeviceState, type DeviceStore, type Route } from './deviceStore';

export const SCHEMA = 1;
export const SCENES = ['A', 'B', 'C', 'D'] as const;
export const STEPS = 16;

export interface Note extends SeqNote {}
export interface SeqSettings {
  len: number;
  dir: Direction;
  rate: number;
  own: boolean;
  mute: boolean;
}
export interface TrackInfo {
  id: string;
  device: DeviceId;
  name: string;
  seq: SeqSettings;
}

const DEFAULT_SEQ: SeqSettings = { len: 16, dir: 'fwd', rate: 1, own: false, mute: false };
const uid = (p: string) => p + Math.random().toString(36).slice(2, 10);
export const patternKey = (track: string, scene: number) => `${track}|${scene}`;

export class Project {
  readonly doc: Y.Doc;
  readonly origin: object;
  readonly meta: Y.Map<unknown>;
  readonly order: Y.Array<string>;
  readonly tracksMap: Y.Map<Y.Map<unknown>>;
  readonly patterns: Y.Map<Y.Map<unknown>>;
  readonly undoManager: Y.UndoManager;
  private version = 0;
  private listeners = new Set<() => void>();
  private stores = new Map<string, { map: Y.Map<unknown>; store: DeviceStore }>();

  constructor(doc: Y.Doc, origin: object = {}) {
    this.doc = doc;
    this.origin = origin;
    this.meta = doc.getMap('fwm.meta');
    this.order = doc.getArray('fwm.order');
    this.tracksMap = doc.getMap('fwm.tracks');
    this.patterns = doc.getMap('fwm.patterns');
    this.undoManager = new Y.UndoManager([this.meta, this.order, this.tracksMap, this.patterns], {
      trackedOrigins: new Set([origin]),
      captureTimeout: 400, // a knob drag or a note drag is one undo step
    });
    const bump = () => {
      this.version++;
      for (const fn of this.listeners) fn();
    };
    for (const t of [this.meta, this.order, this.tracksMap, this.patterns]) t.observeDeep(bump);
    this.undoManager.on('stack-item-added', bump);
    this.undoManager.on('stack-item-popped', bump);
  }

  // ---- subscription (for React useSyncExternalStore) ----
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;

  transact(fn: () => void) {
    this.doc.transact(fn, this.origin);
  }
  /** A discrete action (add track, clear, quantize…): always its own undo step, never merged. */
  private action(fn: () => void) {
    this.undoManager.stopCapturing();
    this.transact(fn);
    this.undoManager.stopCapturing();
  }
  undo() {
    this.undoManager.undo();
  }
  redo() {
    this.undoManager.redo();
  }
  canUndo() {
    return this.undoManager.undoStack.length > 0;
  }
  canRedo() {
    return this.undoManager.redoStack.length > 0;
  }

  // ---- transport (shared settings) ----
  get bpm(): number {
    return (this.meta.get('bpm') as number) ?? 120;
  }
  setBpm(v: number) {
    this.transact(() => this.meta.set('bpm', Math.max(40, Math.min(240, Math.round(v)))));
  }
  get swing(): number {
    return (this.meta.get('swing') as number) ?? 0;
  }
  setSwing(v: number) {
    this.transact(() => this.meta.set('swing', Math.max(0, Math.min(0.6, v))));
  }

  // ---- tracks ----
  trackIds(): string[] {
    return this.order.toArray().filter((id) => this.tracksMap.has(id));
  }
  track(id: string): TrackInfo | null {
    const t = this.tracksMap.get(id);
    if (!t) return null;
    const seq = t.get('seq') as Y.Map<unknown>;
    return {
      id,
      device: t.get('device') as DeviceId,
      name: t.get('name') as string,
      seq: { ...DEFAULT_SEQ, ...(seq.toJSON() as Partial<SeqSettings>) },
    };
  }
  tracks(): TrackInfo[] {
    return this.trackIds().map((id) => this.track(id)!);
  }

  /** Bring a device in from the library: this creates a track. Copies of the same device are fine. */
  addTrack(manifest: DeviceManifest, init?: { params?: Record<string, number>; routes?: Route[] }, preset = 0): string {
    const id = uid('t');
    const sameKind = this.tracks().filter((t) => t.device === manifest.id).length;
    this.action(() => {
      const t = new Y.Map<unknown>();
      t.set('device', manifest.id);
      t.set('name', manifest.name + (sameKind ? ' ' + (sameKind + 1) : ''));
      t.set('preset', preset);
      const seq = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(DEFAULT_SEQ)) seq.set(k, v);
      t.set('seq', seq);
      const params = new Y.Map<number>();
      for (const [k, v] of Object.entries({ ...defaults(manifest), ...init?.params })) params.set(k, v);
      t.set('params', params);
      const routes = new Y.Array<Route>();
      routes.push((init?.routes ?? []).filter((r) => canRoute(manifest, r.src, r.target)).slice(0, MAX_ROUTES));
      t.set('routes', routes);
      this.tracksMap.set(id, t);
      this.order.push([id]);
      SCENES.forEach((_, s) => {
        const p = new Y.Map<unknown>();
        p.set('notes', new Y.Map<Note>());
        p.set('auto', new Y.Map<number>());
        this.patterns.set(patternKey(id, s), p);
      });
    });
    return id;
  }

  removeTrack(id: string) {
    this.action(() => {
      const i = this.order.toArray().indexOf(id);
      if (i >= 0) this.order.delete(i, 1);
      this.tracksMap.delete(id);
      SCENES.forEach((_, s) => this.patterns.delete(patternKey(id, s)));
    });
    this.stores.delete(id);
  }

  renameTrack(id: string, name: string) {
    this.transact(() => this.tracksMap.get(id)?.set('name', name.slice(0, 40)));
  }

  setSeq(id: string, patch: Partial<SeqSettings>) {
    const seq = this.tracksMap.get(id)?.get('seq') as Y.Map<unknown> | undefined;
    if (!seq) return;
    this.action(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (k === 'len') seq.set(k, Math.max(1, Math.min(STEPS, Math.round(v as number))));
        else seq.set(k, v);
      }
    });
  }

  // ---- patterns ----
  private pattern(track: string, scene: number) {
    return this.patterns.get(patternKey(track, scene));
  }
  private notesMap(track: string, scene: number) {
    return this.pattern(track, scene)?.get('notes') as Y.Map<Note> | undefined;
  }
  private autoMap(track: string, scene: number) {
    return this.pattern(track, scene)?.get('auto') as Y.Map<number> | undefined;
  }

  notes(track: string, scene: number): [string, Note][] {
    const m = this.notesMap(track, scene);
    if (!m) return [];
    return [...m.entries()].sort((a, b) => a[1].s - b[1].s || a[1].m - b[1].m);
  }
  addNote(track: string, scene: number, note: Note): string | null {
    const m = this.notesMap(track, scene);
    if (!m) return null;
    const id = uid('n');
    this.transact(() => m.set(id, clampNote(note)));
    return id;
  }
  updateNote(track: string, scene: number, id: string, patch: Partial<Note>) {
    const m = this.notesMap(track, scene);
    const n = m?.get(id);
    if (!m || !n) return;
    this.transact(() => m.set(id, clampNote({ ...n, ...patch })));
  }
  deleteNote(track: string, scene: number, id: string) {
    const m = this.notesMap(track, scene);
    if (m?.has(id)) this.transact(() => m.delete(id));
  }
  /** Remove every note (and automation) of one pattern. Undo brings it back. */
  clearPattern(track: string, scene: number) {
    const m = this.notesMap(track, scene);
    const a = this.autoMap(track, scene);
    this.action(() => {
      m?.clear();
      a?.clear();
    });
  }
  /** Snap starts and lengths of all notes to a grid (in steps; 0 = leave as is). */
  quantize(track: string, scene: number, grid: number) {
    const m = this.notesMap(track, scene);
    if (!m || !grid) return;
    this.action(() => {
      for (const [id, n] of m.entries()) {
        const l = Math.max(grid, Math.round(n.l / grid) * grid);
        const s = Math.max(0, Math.min(STEPS - l, Math.round(n.s / grid) * grid));
        m.set(id, clampNote({ ...n, s, l }));
      }
    });
  }

  /** Automation lane values per step (null = no point), for one param. */
  automation(track: string, scene: number, param: string): (number | null)[] {
    const a = this.autoMap(track, scene);
    return Array.from({ length: STEPS }, (_, i) => (a?.get(`${param}@${i}`) as number | undefined) ?? null);
  }
  /** All automated params of a pattern → lanes. */
  automationAll(track: string, scene: number): Record<string, (number | null)[]> {
    const a = this.autoMap(track, scene);
    const out: Record<string, (number | null)[]> = {};
    if (!a) return out;
    for (const [k, v] of a.entries()) {
      const [param, step] = k.split('@');
      (out[param] ??= Array(STEPS).fill(null))[Number(step)] = v;
    }
    return out;
  }
  setAutomation(track: string, scene: number, param: string, step: number, value: number | null) {
    const a = this.autoMap(track, scene);
    if (!a || step < 0 || step >= STEPS) return;
    this.transact(() => {
      if (value == null) a.delete(`${param}@${step}`);
      else a.set(`${param}@${step}`, Math.max(0, Math.min(1, value)));
    });
  }
  clearAutomation(track: string, scene: number, param: string) {
    const a = this.autoMap(track, scene);
    if (!a) return;
    this.action(() => {
      for (const k of [...a.keys()]) if (k.startsWith(param + '@')) a.delete(k);
    });
  }

  // ---- device state ----
  /** The device store of a track, backed by the shared doc (same interface as the Phase 1 local store). */
  deviceStore(track: string, manifest: DeviceManifest): DeviceStore | null {
    const t = this.tracksMap.get(track);
    if (!t) return null;
    // A track brought back by undo (or re-created remotely) is a new Y.Map: rebuild its store then.
    const cached = this.stores.get(track);
    if (cached && cached.map === t) return cached.store;
    const store = createYDeviceStore(this, t, manifest);
    this.stores.set(track, { map: t, store });
    return store;
  }
}

function clampNote(n: Note): Note {
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const s = r3(Math.max(0, Math.min(STEPS - 1 / 64, n.s)));
  const l = r3(Math.max(1 / 64, Math.min(STEPS - s, n.l)));
  return { s, l, m: Math.max(0, Math.min(127, Math.round(n.m))), v: Math.max(0.05, Math.min(1, n.v)) };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function createYDeviceStore(project: Project, t: Y.Map<unknown>, manifest: DeviceManifest): DeviceStore {
  const params = t.get('params') as Y.Map<number>;
  const routes = t.get('routes') as Y.Array<Route>;
  const read = (): DeviceState => ({
    params: { ...defaults(manifest), ...(params.toJSON() as Record<string, number>) },
    routes: routes.toArray(),
    preset: (t.get('preset') as number | undefined) ?? 0,
  });
  let state = read();
  const listeners = new Set<() => void>();
  const update = () => {
    state = read();
    for (const fn of listeners) fn();
  };
  params.observe(update);
  routes.observe(update);
  t.observe((e) => e.keysChanged.has('preset') && update());
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
      project.transact(() => params.set(id, v));
    },
    load(patch, preset = 0) {
      project.transact(() => {
        t.set('preset', preset);
        for (const [k, v] of Object.entries({ ...defaults(manifest), ...patch.params })) params.set(k, v);
        routes.delete(0, routes.length);
        routes.push((patch.routes ?? []).filter((r) => canRoute(manifest, r.src, r.target)).slice(0, MAX_ROUTES));
      });
    },
    addRoute(route) {
      const rs = routes.toArray();
      if (!canRoute(manifest, route.src, route.target) || rs.length >= MAX_ROUTES) return false;
      if (rs.some((r) => r.src === route.src && r.target === route.target)) return false;
      project.transact(() => routes.push([{ ...route, depth: Math.max(-1, Math.min(1, route.depth)) }]));
      return true;
    },
    setRouteDepth(index, depth) {
      const r = routes.get(index);
      if (!r) return;
      project.transact(() => {
        routes.delete(index, 1);
        routes.insert(index, [{ ...r, depth: Math.max(-1, Math.min(1, depth)) }]);
      });
    },
    removeRoute(index) {
      if (index < routes.length) project.transact(() => routes.delete(index, 1));
    },
  };
}
