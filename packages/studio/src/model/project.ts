// The shared project, stored in the host's Yjs doc. Everything here is seen by every collaborator.
//
// Words: a "track" in this code is one instrument lane (shown as the instrument). The song is a list of
// rows that the UI calls TRACK 1, TRACK 2…; here they are "rows", to keep the two apart.
//
// Layout (top-level types never conflict when two people start at once):
//   fwm.meta       Y.Map    { schema, bpm, swing, keyRoot, keyScale }
//   fwm.order      Y.Array  track ids, in display order
//   fwm.meta       also holds the master: masterLevel
//   fwm.tracks     Y.Map    trackId → Y.Map { device, name, seq: Y.Map{dir,rate,own,mute},
//                                              mixer as flat keys (no nested map to race over):
//                                              'mix.level', 'mix.pan', 'mix.solo', 'mix.rev', 'mix.dly',
//                                              params: Y.Map<paramId, number>, routes: Y.Array<Route>,
//                                              pats: Y.Array<patternId> (this instrument's patterns, in order) }
//   fwm.patterns   Y.Map    `${trackId}|${patternId}` → Y.Map { name, len, notes: Y.Map<noteId, Note>,
//                                                               auto: Y.Map<`${param}@${step}`, number> }
//   fwm.fx         Y.Map    master effects, flat keys (see model/fx.ts): chain, 'reverb.size', 'lofi.tape.wow'…
//   fwm.song       Y.Array  rows: Y.Map { id, cells: Y.Map<trackId, patternId> } (no entry = silent)
// Patterns belong to one instrument. A row plays, for each instrument, the pattern in its cell; it lasts as
// long as its longest pattern and shorter ones repeat inside it.
// Nested maps are created together with their parent, so two people never race to create the same one.
//
// Every local edit is tagged with this user's `origin`, so the UndoManager only undoes your own changes.
import * as Y from 'yjs';
import type { DeviceId, DeviceManifest, Direction, SeqNote } from '@fwm/engine';
import { canRoute, defaults, MAX_ROUTES, type DeviceState, type DeviceStore, type Route } from './deviceStore';
import { DEFAULT_KEY, SCALES, type SongKey } from './scales';
import { clampFx, FX_ALL, FX_DEFAULTS, type FxId } from './fx';

export const SCHEMA = 2;
/** Steps (16th notes) in a bar. */
export const BAR = 16;
/** Longest pattern: 8 bars. */
export const MAX_LEN = 128;

/** A note. Drum hits may also carry an accent (`a: 1`) and a roll (`r`: 2–4 quick hits). */
export interface Note extends SeqNote {
  a?: number;
  r?: number;
}
export interface SeqSettings {
  dir: Direction;
  rate: number;
  own: boolean;
  mute: boolean;
  /** Drum machines: muted pads and soloed pads, as bit masks (bit i = pad i). */
  pmute: number;
  psolo: number;
}
/** Drum pads: pad i plays note PAD_NOTE + i. */
export const PAD_NOTE = 36;
export const PADS = 8;
/** Longest drum row. */
export const MAX_ROW = 64;
export interface TrackInfo {
  id: string;
  device: DeviceId;
  name: string;
  seq: SeqSettings;
}
/**
 * An instrument's mixer strip. Mute is the instrument's `seq.mute` (one Mute, shown in the Song
 * arrangement and the Mixer). level: 0..1 (0.8 = 0 dB); pan: -1..1; rev / dly: send amounts 0..1.
 */
export interface MixSettings {
  level: number;
  pan: number;
  solo: boolean;
  rev: number;
  dly: number;
}
export const DEFAULT_MIX: MixSettings = { level: 0.8, pan: 0, solo: false, rev: 0, dly: 0 };
/** Fader position (0..1) in dB, as the engine applies it: gain = (v / 0.8)³, so 0.8 = 0 dB, 1 = +5.8 dB. */
export const faderDb = (v: number) => (v <= 0 ? -Infinity : 60 * Math.log10(Math.min(1, v) / 0.8));
const MIX_KEYS = Object.keys(DEFAULT_MIX) as (keyof MixSettings)[];
function clampMix<K extends keyof MixSettings>(k: K, v: MixSettings[K]): MixSettings[K] {
  if (k === 'solo') return !!v as MixSettings[K];
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_MIX[k];
  return (k === 'pan' ? Math.max(-1, Math.min(1, n)) : Math.max(0, Math.min(1, n))) as MixSettings[K];
}
export interface PatternInfo {
  id: string;
  name: string;
  /** Length in steps (1…MAX_LEN). */
  len: number;
}
/** A whole song as a plain object: what a host saves and loads (see SongLibrary). */
export interface SongFile {
  schema: number;
  name: string;
  bpm: number;
  swing: number;
  key: SongKey;
  /** Master fader (0..1, 0.8 = 0 dB). Missing in older files: 0 dB. */
  master?: { level: number };
  /** Master effects (keys of model/fx.ts FX_DEFAULTS). Missing: defaults. */
  fx?: Record<string, number | boolean | string>;
  tracks: {
    id: string;
    device: DeviceId;
    name: string;
    preset: number;
    seq: SeqSettings;
    params: Record<string, number>;
    routes: Route[];
    /** Missing in older files: defaults. */
    mix?: MixSettings;
    patterns: { id: string; name: string; len: number; notes: Note[]; auto: Record<string, number>; lens?: Record<string, number> }[];
  }[];
  rows: SongRow[];
}

/** FNV-1a hash of a string (to tell whether the song changed since it was saved, the same on every client). */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

export interface SongRow {
  id: string;
  /** trackId → patternId; a missing track is silent in this row. */
  cells: Record<string, string>;
}

const DEFAULT_SEQ: SeqSettings = { dir: 'fwd', rate: 1, own: false, mute: false, pmute: 0, psolo: 0 };
const uid = (p: string) => p + Math.random().toString(36).slice(2, 10);
export const patternKey = (track: string, pat: string) => `${track}|${pat}`;
const clampLen = (v: number) => Math.max(1, Math.min(MAX_LEN, Math.round(v)));

export class Project {
  readonly doc: Y.Doc;
  readonly origin: object;
  readonly meta: Y.Map<unknown>;
  readonly order: Y.Array<string>;
  readonly tracksMap: Y.Map<Y.Map<unknown>>;
  readonly patterns: Y.Map<Y.Map<unknown>>;
  readonly song: Y.Array<Y.Map<unknown>>;
  readonly fxMap: Y.Map<unknown>;
  readonly undoManager: Y.UndoManager;
  private version = 0;
  private listeners = new Set<() => void>();
  private stores = new Map<string, { map: Y.Map<unknown>; store: DeviceStore }>();
  /** Knob turns made here (not undo, presets or peers): the studio sends their timing to everyone live. */
  private paramListeners = new Set<(track: string, id: string, v: number) => void>();
  onLocalParam(fn: (track: string, id: string, v: number) => void) {
    this.paramListeners.add(fn);
    return () => this.paramListeners.delete(fn);
  }
  /** @internal */
  localParam(track: string, id: string, v: number) {
    for (const fn of this.paramListeners) fn(track, id, v);
  }

  constructor(doc: Y.Doc, origin: object = {}) {
    this.doc = doc;
    this.origin = origin;
    this.meta = doc.getMap('fwm.meta');
    this.order = doc.getArray('fwm.order');
    this.tracksMap = doc.getMap('fwm.tracks');
    this.patterns = doc.getMap('fwm.patterns');
    this.song = doc.getArray('fwm.song');
    this.fxMap = doc.getMap('fwm.fx');
    this.undoManager = new Y.UndoManager([this.meta, this.order, this.tracksMap, this.patterns, this.song, this.fxMap], {
      trackedOrigins: new Set([origin]),
      captureTimeout: 400, // a knob drag or a note drag is one undo step
    });
    const bump = () => {
      this.version++;
      for (const fn of this.listeners) fn();
    };
    for (const t of [this.meta, this.order, this.tracksMap, this.patterns, this.song, this.fxMap]) t.observeDeep(bump);
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

  /** The song key, shared: everyone sees the same highlighted rows. */
  get key(): SongKey {
    const root = this.meta.get('keyRoot') as number | undefined;
    const scale = this.meta.get('keyScale') as string | undefined;
    return { root: root ?? DEFAULT_KEY.root, scale: scale && SCALES[scale] ? scale : DEFAULT_KEY.scale };
  }
  setKey(k: Partial<SongKey>) {
    this.action(() => {
      if (k.root != null) this.meta.set('keyRoot', ((Math.round(k.root) % 12) + 12) % 12);
      if (k.scale != null && SCALES[k.scale]) this.meta.set('keyScale', k.scale);
    });
  }

  // ---- mixer (shared like everything in the song) ----
  mix(track: string): MixSettings {
    const t = this.tracksMap.get(track);
    const out = { ...DEFAULT_MIX };
    if (!t) return out;
    for (const k of MIX_KEYS) {
      const v = t.get('mix.' + k);
      if (v != null) (out as Record<string, unknown>)[k] = clampMix(k, v as never);
    }
    return out;
  }
  /** Fader and knob moves (merge into one undo step while dragging). Solo is its own step. */
  setMix(track: string, patch: Partial<MixSettings>) {
    const t = this.tracksMap.get(track);
    if (!t) return;
    const write = () => {
      for (const k of MIX_KEYS) if (patch[k] != null) t.set('mix.' + k, clampMix(k, patch[k] as never));
    };
    if (patch.solo != null) this.action(write);
    else this.transact(write);
  }
  get masterLevel(): number {
    const v = this.meta.get('masterLevel') as number | undefined;
    return v != null && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_MIX.level;
  }
  setMasterLevel(v: number) {
    this.transact(() => this.meta.set('masterLevel', Math.max(0, Math.min(1, v))));
  }

  // ---- master effects ----
  /** An effects setting (see model/fx.ts for the keys and their defaults). */
  fx(key: string): number | boolean | string {
    const v = this.fxMap.get(key);
    return (v === undefined ? undefined : clampFx(key, v)) ?? FX_DEFAULTS[key];
  }
  /** Knob drags merge into one undo step; switches (on, style, chain, ping-pong, time) are their own steps. */
  setFx(key: string, value: number | boolean | string) {
    const v = clampFx(key, value);
    if (v === undefined || v === this.fx(key)) return;
    const write = () => this.fxMap.set(key, v);
    if (typeof v === 'number' && key !== 'delay.div') this.transact(write);
    else this.action(write);
  }
  /** The effects the mix goes through, in order. */
  get fxChain(): FxId[] {
    return String(this.fx('chain')).split(',').filter(Boolean) as FxId[];
  }
  setFxChain(ids: FxId[]) {
    this.setFx('chain', ids.join(','));
  }
  /** Effects not in the chain (the shelf). */
  get fxShelf(): FxId[] {
    const c = this.fxChain;
    return FX_ALL.filter((id) => !c.includes(id));
  }

  // ---- the song as a whole: name, save state, file, INIT ----
  get songName(): string {
    return (this.meta.get('name') as string) || 'Untitled';
  }
  renameSong(name: string) {
    const n = name.trim().slice(0, 60);
    if (n && n !== this.songName) this.action(() => this.meta.set('name', n));
  }
  /** Id of the saved song this is (in the host's song library), or null if never saved. */
  get songId(): string | null {
    return (this.meta.get('songId') as string) || null;
  }
  /** The song as a plain object (ids kept, so TRACK cells still point at the right patterns). */
  toFile(): SongFile {
    return {
      schema: SCHEMA,
      name: this.songName,
      bpm: this.bpm,
      swing: this.swing,
      key: this.key,
      master: { level: this.masterLevel },
      fx: Object.fromEntries(Object.keys(FX_DEFAULTS).map((k) => [k, this.fx(k)])),
      tracks: this.tracks().map((t) => {
        const m = this.tracksMap.get(t.id)!;
        return {
          id: t.id,
          device: t.device,
          name: t.name,
          preset: (m.get('preset') as number) ?? 0,
          seq: t.seq,
          params: (m.get('params') as Y.Map<number>).toJSON() as Record<string, number>,
          routes: (m.get('routes') as Y.Array<Route>).toArray(),
          mix: this.mix(t.id),
          patterns: this.patternList(t.id).map((p) => ({
            ...p,
            notes: this.notes(t.id, p.id).map(([, n]) => n),
            auto: (this.autoMap(t.id, p.id)?.toJSON() ?? {}) as Record<string, number>,
            ...(this.lensMap(t.id, p.id)?.size ? { lens: this.lensMap(t.id, p.id)!.toJSON() as Record<string, number> } : {}),
          })),
        };
      }),
      rows: this.rows(),
    };
  }
  private contentHash(file: SongFile = this.toFile()): string {
    const { name: _n, ...rest } = file;
    return hash(JSON.stringify(rest));
  }
  private hashCache = { version: -1, value: '' };
  /** True when the song has changed since it was last saved (or opened), as seen by everyone. */
  get unsaved(): boolean {
    if (this.hashCache.version !== this.version) this.hashCache = { version: this.version, value: this.contentHash() };
    return this.hashCache.value !== this.meta.get('savedHash');
  }
  /** Record that `file` (from toFile) was saved under `id`. Edits made while saving still count as unsaved. */
  markSaved(id: string, file: SongFile = this.toFile()) {
    this.transact(() => {
      this.meta.set('songId', id);
      this.meta.set('savedHash', this.contentHash(file));
    });
  }
  /**
   * Replace the whole song with `file`, for everyone in the session (one undo step). `id` is its id in the
   * song library (null for a new song). Devices the studio doesn't know are skipped.
   */
  loadFile(file: SongFile, manifests: Partial<Record<string, DeviceManifest>>, id: string | null) {
    this.action(() => {
      this.replaceAll(file, manifests, id);
      this.meta.set('savedHash', this.contentHash());
    });
    this.stores.clear();
  }
  private replaceAll(file: SongFile, manifests: Partial<Record<string, DeviceManifest>>, id: string | null) {
    {
      for (const k of [...this.meta.keys()]) if (k !== 'schema') this.meta.delete(k);
      for (const k of [...this.fxMap.keys()]) this.fxMap.delete(k);
      for (const [k, v] of Object.entries(file.fx ?? {})) {
        const c = clampFx(k, v);
        if (c !== undefined) this.fxMap.set(k, c);
      }
      this.order.delete(0, this.order.length);
      for (const k of [...this.tracksMap.keys()]) this.tracksMap.delete(k);
      for (const k of [...this.patterns.keys()]) this.patterns.delete(k);
      this.song.delete(0, this.song.length);
      this.meta.set('schema', SCHEMA);
      this.meta.set('name', file.name || 'Untitled');
      this.meta.set('bpm', Math.max(40, Math.min(240, Math.round(file.bpm || 120))));
      this.meta.set('swing', Math.max(0, Math.min(0.6, file.swing || 0)));
      const ml = Number(file.master?.level);
      if (Number.isFinite(ml)) this.meta.set('masterLevel', Math.max(0, Math.min(1, ml)));
      if (file.key) {
        this.meta.set('keyRoot', file.key.root);
        this.meta.set('keyScale', SCALES[file.key.scale] ? file.key.scale : 'chromatic');
      }
      const known = new Set<string>();
      for (const ft of file.tracks ?? []) {
        const manifest = manifests[ft.device];
        if (!manifest) continue;
        known.add(ft.id);
        const t = new Y.Map<unknown>();
        t.set('device', ft.device);
        t.set('name', ft.name);
        t.set('preset', ft.preset ?? 0);
        const seq = new Y.Map<unknown>();
        for (const [k, v] of Object.entries({ ...DEFAULT_SEQ, ...ft.seq })) if (k !== 'len') seq.set(k, v);
        t.set('seq', seq);
        const params = new Y.Map<number>();
        for (const [k, v] of Object.entries({ ...defaults(manifest), ...ft.params })) params.set(k, v);
        t.set('params', params);
        const routes = new Y.Array<Route>();
        routes.push((ft.routes ?? []).filter((r) => canRoute(manifest, r.src, r.target)).slice(0, MAX_ROUTES));
        t.set('routes', routes);
        for (const k of MIX_KEYS) if (ft.mix?.[k] != null) t.set('mix.' + k, clampMix(k, ft.mix[k] as never));
        const pats = new Y.Array<string>();
        t.set('pats', pats);
        this.tracksMap.set(ft.id, t);
        this.order.push([ft.id]);
        for (const fp of ft.patterns ?? []) {
          const p = new Y.Map<unknown>();
          p.set('name', fp.name || 'P');
          p.set('len', clampLen(fp.len || BAR));
          const notes = new Y.Map<Note>();
          for (const n of fp.notes ?? []) notes.set(uid('n'), clampNote(n));
          const auto = new Y.Map<number>();
          for (const [k, v] of Object.entries(fp.auto ?? {})) auto.set(k, v);
          const lens = new Y.Map<number>();
          for (const [k, v] of Object.entries(fp.lens ?? {})) lens.set(k, Math.max(1, Math.min(MAX_ROW, Math.round(v))));
          p.set('notes', notes);
          p.set('auto', auto);
          p.set('lens', lens);
          this.patterns.set(patternKey(ft.id, fp.id), p);
          pats.push([fp.id]);
        }
      }
      const rows = file.rows?.length ? file.rows : [{ id: uid('r'), cells: {} }];
      for (const r of rows) {
        const row = this.makeRow(Object.fromEntries(Object.entries(r.cells).filter(([t]) => known.has(t))));
        row.set('id', r.id);
        this.song.push([row]);
      }
      if (id) this.meta.set('songId', id);
    }
  }
  /** Start from scratch: one instrument (`manifest`, e.g. Basalt) with an empty P1 in TRACK 1, 120 BPM, no key. */
  initSong(manifest: DeviceManifest, init?: { params?: Record<string, number>; routes?: Route[] }) {
    this.action(() => {
      this.replaceAll({ schema: SCHEMA, name: 'Untitled', bpm: 120, swing: 0, key: { root: 0, scale: 'chromatic' }, tracks: [], rows: [] }, {}, null);
      this.addTrackRaw(manifest, init, 0, null);
      this.meta.set('savedHash', this.contentHash());
    });
    this.stores.clear();
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

  /**
   * Bring a device in from the library: this creates a track (an instrument) with one empty pattern, P1,
   * placed in song row `row` (default: the first row; a first row is made if the song has none).
   * Copies of the same device are fine.
   */
  addTrack(manifest: DeviceManifest, init?: { params?: Record<string, number>; routes?: Route[] }, preset = 0, row?: string | null): string {
    let id = '';
    this.action(() => {
      id = this.addTrackRaw(manifest, init, preset, row);
    });
    return id;
  }
  private addTrackRaw(manifest: DeviceManifest, init?: { params?: Record<string, number>; routes?: Route[] }, preset = 0, row?: string | null): string {
    const id = uid('t');
    const sameKind = this.tracks().filter((t) => t.device === manifest.id).length;
    {
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
      const pats = new Y.Array<string>();
      t.set('pats', pats);
      this.tracksMap.set(id, t);
      this.order.push([id]);
      const pat = this.makePattern(id, pats, 'P1', BAR);
      if (!this.song.length) this.song.push([this.makeRow()]);
      const r = (row && this.rowMap(row)) || this.song.get(0);
      (r.get('cells') as Y.Map<string>).set(id, pat);
    }
    return id;
  }
  /** A new empty pattern (inside a transaction). */
  private makePattern(track: string, pats: Y.Array<string>, name: string, len: number, from?: Y.Map<unknown>, withAuto = true): string {
    const id = uid('p');
    const p = new Y.Map<unknown>();
    p.set('name', name);
    p.set('len', clampLen(len));
    const notes = new Y.Map<Note>();
    const auto = new Y.Map<number>();
    const lens = new Y.Map<number>();
    if (from) {
      for (const v of (from.get('notes') as Y.Map<Note>).values()) notes.set(uid('n'), v);
      if (withAuto) for (const [k, v] of (from.get('auto') as Y.Map<number>).entries()) auto.set(k, v);
      for (const [k, v] of ((from.get('lens') as Y.Map<number> | undefined)?.entries() ?? [])) lens.set(k, v);
    }
    p.set('notes', notes);
    p.set('auto', auto);
    p.set('lens', lens);
    this.patterns.set(patternKey(track, id), p);
    pats.push([id]);
    return id;
  }
  private makeRow(cells?: Record<string, string>): Y.Map<unknown> {
    const r = new Y.Map<unknown>();
    r.set('id', uid('r'));
    const c = new Y.Map<string>();
    for (const [k, v] of Object.entries(cells ?? {})) c.set(k, v);
    r.set('cells', c);
    return r;
  }

  removeTrack(id: string) {
    this.action(() => {
      const i = this.order.toArray().indexOf(id);
      if (i >= 0) this.order.delete(i, 1);
      for (const p of this.patternIds(id)) this.patterns.delete(patternKey(id, p));
      this.tracksMap.delete(id);
      for (const r of this.song.toArray()) (r.get('cells') as Y.Map<string>).delete(id);
    });
    this.stores.delete(id);
  }

  /** Rename a track (the name shows on the device, the sequencer and the tabs). Blank names are ignored. */
  renameTrack(id: string, name: string) {
    const n = name.trim().slice(0, 40);
    const t = this.tracksMap.get(id);
    if (!n || !t || t.get('name') === n) return;
    this.action(() => t.set('name', n));
  }

  setSeq(id: string, patch: Partial<SeqSettings>) {
    const seq = this.tracksMap.get(id)?.get('seq') as Y.Map<unknown> | undefined;
    if (!seq) return;
    this.action(() => {
      for (const [k, v] of Object.entries(patch)) seq.set(k, v);
    });
  }

  // ---- patterns (each belongs to one instrument) ----
  private patternIds(track: string): string[] {
    const pats = this.tracksMap.get(track)?.get('pats') as Y.Array<string> | undefined;
    return pats ? pats.toArray() : [];
  }
  /** An instrument's patterns, in order. */
  patternList(track: string): PatternInfo[] {
    return this.patternIds(track).map((p) => this.patternInfo(track, p)).filter((p): p is PatternInfo => !!p);
  }
  patternInfo(track: string, pat: string | null | undefined): PatternInfo | null {
    const m = pat ? this.patMap(track, pat) : undefined;
    if (!m || !pat) return null;
    return { id: pat, name: (m.get('name') as string) || 'P?', len: (m.get('len') as number) || BAR };
  }
  /** New pattern for an instrument: empty, or a copy of `copyOf`. Named P<n> (or "<name> 2" for a copy). */
  addPattern(track: string, copyOf?: string): string | null {
    const pats = this.tracksMap.get(track)?.get('pats') as Y.Array<string> | undefined;
    if (!pats) return null;
    const from = copyOf ? this.patMap(track, copyOf) : undefined;
    const taken = new Set(this.patternList(track).map((p) => p.name));
    let name: string;
    if (from) {
      const base = (from.get('name') as string) || 'P';
      let k = 2;
      while (taken.has(`${base} ${k}`)) k++;
      name = `${base} ${k}`;
    } else {
      let k = this.patternIds(track).length + 1;
      while (taken.has(`P${k}`)) k++;
      name = `P${k}`;
    }
    let id = '';
    this.action(() => {
      id = this.makePattern(track, pats, name, (from?.get('len') as number) ?? BAR, from);
    });
    return id;
  }
  renamePattern(track: string, pat: string, name: string) {
    const m = this.patMap(track, pat);
    const n = name.trim().slice(0, 24);
    if (!m || !n || m.get('name') === n) return;
    this.action(() => m.set('name', n));
  }
  /** Pattern length in steps, 1…MAX_LEN. Notes past the end are kept (silent) in case it grows again. */
  setPatternLen(track: string, pat: string, len: number) {
    const m = this.patMap(track, pat);
    if (!m || m.get('len') === clampLen(len)) return;
    this.action(() => m.set('len', clampLen(len)));
  }

  private patMap(track: string, pat: string) {
    return this.patterns.get(patternKey(track, pat));
  }
  private notesMap(track: string, pat: string) {
    return this.patMap(track, pat)?.get('notes') as Y.Map<Note> | undefined;
  }
  private lensMap(track: string, pat: string) {
    return this.patMap(track, pat)?.get('lens') as Y.Map<number> | undefined;
  }
  /** Drum patterns: the length of each pad row (rows never set follow the pattern length). */
  rowLens(track: string, pat: string): number[] {
    const len = this.patternInfo(track, pat)?.len ?? BAR;
    const m = this.lensMap(track, pat);
    return Array.from({ length: PADS }, (_, i) => m?.get(String(i)) ?? len);
  }
  /** Set one pad row's length (1…MAX_ROW). The pattern is as long as its longest row. */
  setRowLen(track: string, pat: string, pad: number, len: number) {
    const p = this.patMap(track, pat);
    if (!p) return;
    const v = Math.max(1, Math.min(MAX_ROW, Math.round(len)));
    const cur = this.rowLens(track, pat);
    if (cur[pad] === v) return;
    cur[pad] = v;
    this.action(() => {
      let m = p.get('lens') as Y.Map<number> | undefined;
      if (!m) {
        m = new Y.Map<number>();
        p.set('lens', m);
      }
      cur.forEach((l, i) => m!.get(String(i)) !== l && m!.set(String(i), l)); // fix every row, so they no longer follow the pattern length
      p.set('len', Math.max(...cur));
    });
  }
  private autoMap(track: string, pat: string) {
    return this.patMap(track, pat)?.get('auto') as Y.Map<number> | undefined;
  }

  notes(track: string, pat: string): [string, Note][] {
    const m = this.notesMap(track, pat);
    if (!m) return [];
    return [...m.entries()].sort((a, b) => a[1].s - b[1].s || a[1].m - b[1].m);
  }
  addNote(track: string, pat: string, note: Note): string | null {
    const m = this.notesMap(track, pat);
    if (!m) return null;
    const id = uid('n');
    this.transact(() => m.set(id, clampNote(note)));
    return id;
  }
  updateNote(track: string, pat: string, id: string, patch: Partial<Note>) {
    const m = this.notesMap(track, pat);
    const n = m?.get(id);
    if (!m || !n) return;
    this.transact(() => m.set(id, clampNote({ ...n, ...patch })));
  }
  deleteNote(track: string, pat: string, id: string) {
    const m = this.notesMap(track, pat);
    if (m?.has(id)) this.transact(() => m.delete(id));
  }
  /**
   * One note per pitch at a time: notes on the same pitch never overlap. The note `keep` (the one just drawn,
   * moved or resized) wins: a note that starts before it is cut short where it begins, a note that starts
   * under it is removed. With no `keep`, later notes win (used after quantize).
   */
  resolveOverlaps(track: string, pat: string, keep?: string) {
    const m = this.notesMap(track, pat);
    if (!m) return;
    const EPS = 1e-6;
    const edits: [string, Note | null][] = [];
    const k = keep ? m.get(keep) : undefined;
    if (keep && k) {
      for (const [id, n] of m.entries()) {
        if (id === keep || n.m !== k.m) continue;
        if (n.s < k.s - EPS && n.s + n.l > k.s + EPS) edits.push([id, k.s - n.s >= 1 / 64 ? { ...n, l: k.s - n.s } : null]);
        else if (n.s >= k.s - EPS && n.s < k.s + k.l - EPS) edits.push([id, null]);
      }
    } else {
      const byPitch = new Map<number, [string, Note][]>();
      for (const e of m.entries()) (byPitch.get(e[1].m) ?? byPitch.set(e[1].m, []).get(e[1].m)!).push(e);
      for (const list of byPitch.values()) {
        list.sort((a, b) => a[1].s - b[1].s);
        for (let i = 0; i < list.length - 1; i++) {
          const [id, n] = list[i];
          const next = list[i + 1][1];
          if (n.s + n.l > next.s + EPS) edits.push([id, next.s - n.s >= 1 / 64 ? { ...n, l: next.s - n.s } : null]);
        }
      }
    }
    if (!edits.length) return;
    this.transact(() => {
      for (const [id, n] of edits) n ? m.set(id, clampNote(n)) : m.delete(id);
    });
  }
  /** Remove every note (and automation) of one pattern. Undo brings it back. */
  clearPattern(track: string, pat: string) {
    const m = this.notesMap(track, pat);
    const a = this.autoMap(track, pat);
    this.action(() => {
      m?.clear();
      a?.clear();
    });
  }
  /** Snap starts and lengths of all notes to a grid (in steps; 0 = leave as is). */
  quantize(track: string, pat: string, grid: number) {
    const m = this.notesMap(track, pat);
    if (!m || !grid) return;
    const len = this.patternInfo(track, pat)?.len ?? MAX_LEN;
    this.action(() => {
      for (const [id, n] of m.entries()) {
        const l = Math.max(grid, Math.round(n.l / grid) * grid);
        const s = Math.max(0, Math.min(len - grid, Math.round(n.s / grid) * grid)); // the start stays inside the pattern
        m.set(id, clampNote({ ...n, s, l }));
      }
    });
    this.resolveOverlaps(track, pat);
  }

  /** Automation lane values per step of the pattern (null = no point), for one param. */
  automation(track: string, pat: string, param: string): (number | null)[] {
    const a = this.autoMap(track, pat);
    const len = this.patternInfo(track, pat)?.len ?? BAR;
    return Array.from({ length: len }, (_, i) => (a?.get(`${param}@${i}`) as number | undefined) ?? null);
  }
  /** All automated params of a pattern → lanes. */
  automationAll(track: string, pat: string): Record<string, (number | null)[]> {
    const a = this.autoMap(track, pat);
    const out: Record<string, (number | null)[]> = {};
    if (!a) return out;
    for (const [k, v] of a.entries()) {
      const [param, step] = k.split('@');
      (out[param] ??= Array(MAX_LEN).fill(null))[Number(step)] = v;
    }
    return out;
  }
  setAutomation(track: string, pat: string, param: string, step: number, value: number | null) {
    const a = this.autoMap(track, pat);
    if (!a || step < 0 || step >= MAX_LEN) return;
    this.transact(() => {
      if (value == null) a.delete(`${param}@${step}`);
      else a.set(`${param}@${step}`, Math.max(0, Math.min(1, value)));
    });
  }
  clearAutomation(track: string, pat: string, param: string) {
    const a = this.autoMap(track, pat);
    if (!a) return;
    this.action(() => {
      for (const k of [...a.keys()]) if (k.startsWith(param + '@')) a.delete(k);
    });
  }

  // ---- song: rows (TRACK 1, TRACK 2… in the UI) ----
  private rowMap(id: string) {
    return this.song.toArray().find((r) => r.get('id') === id);
  }
  rows(): SongRow[] {
    return this.song.toArray().map((r) => ({ id: r.get('id') as string, cells: (r.get('cells') as Y.Map<string>).toJSON() as Record<string, string> }));
  }
  /** The pattern an instrument plays in a row (null = silent). */
  cell(row: string | null | undefined, track: string): string | null {
    const r = row ? this.rowMap(row) : undefined;
    const p = (r?.get('cells') as Y.Map<string> | undefined)?.get(track);
    return p && this.patMap(track, p) ? p : null;
  }
  setCell(row: string, track: string, pat: string | null) {
    const c = this.rowMap(row)?.get('cells') as Y.Map<string> | undefined;
    if (!c) return;
    this.action(() => (pat ? c.set(track, pat) : c.delete(track)));
  }
  /** Put a pattern in a row (drag and drop in the song arrangement). From the same instrument: the same
   *  pattern, or with `copy` a separate copy ("Groove 2"). From another instrument (`from`): always a copy
   *  on this one (same notes and length; automation stays behind, it belongs to the other instrument's
   *  knobs). With `row` null, a new TRACK at the end plays it. One undo step. Returns the row and pattern. */
  placePattern(row: string | null, track: string, pat: string, copy = false, from = track): { row: string; pat: string } | null {
    const src = this.patMap(from, pat);
    const pats = this.tracksMap.get(track)?.get('pats') as Y.Array<string> | undefined;
    if (!src || !pats || (row && !this.rowMap(row))) return null;
    let out: { row: string; pat: string } | null = null;
    this.action(() => {
      let id = pat;
      if (from !== track) {
        const name = (src.get('name') as string) || 'P';
        const taken = new Set(this.patternList(track).map((p) => p.name));
        let k = 2;
        let n = name;
        while (taken.has(n)) n = `${name} ${k++}`;
        const same = this.track(from)?.device === this.track(track)?.device;
        id = this.makePattern(track, pats, n, (src.get('len') as number) ?? BAR, src, same);
      } else if (copy) id = this.addPattern(track, pat) ?? pat;
      const r = row ?? this.addRow();
      (this.rowMap(r)!.get('cells') as Y.Map<string>).set(track, id);
      out = { row: r, pat: id };
    });
    return out;
  }
  /** How long a pattern takes to play once in a track, in steps of the song clock (rate ½× = twice as long). */
  playLen(track: string, pat: string | null | undefined): number {
    const info = this.patternInfo(track, pat);
    return info ? info.len / (this.track(track)?.seq.rate || 1) : 0;
  }
  /** How long a row plays, in steps: its longest pattern (one bar when it is empty). */
  rowLen(row: string): number {
    const lens = this.trackIds().map((t) => this.playLen(t, this.cell(row, t)));
    return Math.max(0, ...lens) || BAR;
  }
  /** Add an empty row after `after` (default: at the end), or a copy of it with `copy`. Returns its id. */
  addRow(after?: string | null, copy = false): string {
    const i = after ? this.song.toArray().findIndex((r) => r.get('id') === after) : -1;
    const src = after && copy ? this.rows()[i]?.cells : undefined;
    const r = this.makeRow(src);
    this.action(() => this.song.insert(i >= 0 ? i + 1 : this.song.length, [r]));
    return r.get('id') as string;
  }
  removeRow(id: string) {
    const i = this.song.toArray().findIndex((r) => r.get('id') === id);
    if (i < 0 || this.song.length < 2) return;
    this.action(() => this.song.delete(i, 1));
  }

  // ---- device state ----
  /** The device store of a track, backed by the shared doc (same interface as the Phase 1 local store). */
  deviceStore(track: string, manifest: DeviceManifest): DeviceStore | null {
    const t = this.tracksMap.get(track);
    if (!t) return null;
    // A track brought back by undo (or re-created remotely) is a new Y.Map: rebuild its store then.
    const cached = this.stores.get(track);
    if (cached && cached.map === t) return cached.store;
    const store = createYDeviceStore(this, t, manifest, track);
    this.stores.set(track, { map: t, store });
    return store;
  }
}

function clampNote(n: Note): Note {
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const s = r3(Math.max(0, Math.min(MAX_LEN - 1 / 64, n.s)));
  const l = r3(Math.max(1 / 64, Math.min(MAX_LEN - s, n.l)));
  const out: Note = { s, l, m: Math.max(0, Math.min(127, Math.round(n.m))), v: Math.max(0.05, Math.min(1, n.v)) };
  if (n.a) out.a = 1;
  if (n.r && n.r > 1) out.r = Math.min(4, Math.round(n.r));
  return out;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function createYDeviceStore(project: Project, t: Y.Map<unknown>, manifest: DeviceManifest, track: string): DeviceStore {
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
      project.localParam(track, id, v);
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
