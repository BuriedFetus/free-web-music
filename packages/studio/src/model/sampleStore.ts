// Geode's tapes: the recorded sound, kept in this browser and sent live to the others in the session,
// never to a server and never in the song (the song only holds a TapeMeta: fingerprint, length, name).
//
// A tape is 16-bit PCM, planar (left, then right). Recordings are rounded to 16 bits before they are
// fingerprinted, so every computer that has the tape has exactly the same numbers and the same hash.
// Sharing: the tape goes out in chunks on the host's live channel ({t:'smp'} messages, ~24 KB of PCM
// as base64 each). Someone who is missing a tape asks for it ({t:'smp?'}); whoever has it answers.
import type { TapeMeta } from './project';

export interface Tape extends TapeMeta {
  /** 16-bit PCM, planar: frames × ch. */
  pcm: Int16Array;
}

/** Where tapes are kept between visits. The host may supply one (its own storage); otherwise IndexedDB in this browser. */
export interface TapeStorage {
  get(hash: string): Promise<Tape | null>;
  put(tape: Tape): Promise<void>;
}

/** One piece of a tape on the live channel. */
export interface TapeChunk {
  t: 'smp';
  from: string;
  hash: string;
  name: string;
  frames: number;
  sr: number;
  ch: 1 | 2;
  /** Piece i of n. */
  i: number;
  n: number;
  /** base64 of this piece's bytes (little-endian Int16). */
  data: string;
}
/** "Who has this tape?" */
export interface TapeAsk {
  t: 'smp?';
  from: string;
  hash: string;
}

export const MAX_SECONDS = 30;
/** Bytes of PCM per chunk (base64 makes it 4/3 bigger on the wire). */
export const CHUNK_BYTES = 24 * 1024;

// ---- encode / decode ----

/** Float channels → 16-bit PCM, planar. Identical channels become mono (half the size to send). */
export function toPcm(l: Float32Array, r?: Float32Array | null): { pcm: Int16Array; ch: 1 | 2 } {
  const n = l.length;
  const q = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  let stereo = !!r && r.length === n;
  if (stereo) {
    stereo = false;
    for (let i = 0; i < n; i++) if (q(l[i]) !== q(r![i])) { stereo = true; break; }
  }
  const pcm = new Int16Array(stereo ? 2 * n : n);
  for (let i = 0; i < n; i++) pcm[i] = q(l[i]);
  if (stereo) for (let i = 0; i < n; i++) pcm[n + i] = q(r![i]);
  return { pcm, ch: stereo ? 2 : 1 };
}

/** 16-bit PCM → float channels (r = l for mono). */
export function fromPcm(t: Pick<Tape, 'pcm' | 'frames' | 'ch'>): { l: Float32Array; r: Float32Array } {
  const n = t.frames;
  const l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = t.pcm[i] / 32767;
  if (t.ch === 1) return { l, r: l };
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) r[i] = t.pcm[n + i] / 32767;
  return { l, r };
}

/** Fingerprint of a tape's PCM and rate: two 32-bit FNV-1a passes, 16 hex digits. The same everywhere. */
export function hashPcm(pcm: Int16Array, sr: number, ch: number): string {
  let a = 0x811c9dc5 ^ sr;
  let b = 0x01000193 ^ (ch * 0x9e3779b9);
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] & 0xffff;
    a = Math.imul(a ^ v, 0x01000193) >>> 0;
    b = Math.imul(b ^ (v + i), 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function makeTape(l: Float32Array, r: Float32Array | null | undefined, sr: number, name: string): Tape {
  const { pcm, ch } = toPcm(l, r);
  return { hash: hashPcm(pcm, sr, ch), name, frames: l.length, sr, ch, pcm };
}

export const metaOf = (t: Tape): TapeMeta => ({ hash: t.hash, name: t.name, frames: t.frames, sr: t.sr, ch: t.ch });

const toB64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The tape in pieces for the live channel. */
export function chunkTape(t: Tape, from: string, bytes = CHUNK_BYTES): TapeChunk[] {
  const u8 = new Uint8Array(t.pcm.buffer, t.pcm.byteOffset, t.pcm.byteLength);
  const n = Math.max(1, Math.ceil(u8.length / bytes));
  const out: TapeChunk[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ t: 'smp', from, hash: t.hash, name: t.name, frames: t.frames, sr: t.sr, ch: t.ch, i, n, data: toB64(u8.subarray(i * bytes, (i + 1) * bytes)) });
  }
  return out;
}

/** Collects pieces of tapes as they arrive; `add` returns the whole tape once its last piece is in and it checks out. */
export class TapeAssembler {
  private parts = new Map<string, { got: (Uint8Array | null)[]; have: number; c: TapeChunk }>();
  add(c: TapeChunk): Tape | null {
    if (!c || c.t !== 'smp' || !(c.n > 0) || c.i < 0 || c.i >= c.n || c.frames > MAX_SECONDS * 2 * 192_000) return null;
    let p = this.parts.get(c.hash);
    if (!p || p.got.length !== c.n) {
      p = { got: new Array(c.n).fill(null), have: 0, c };
      this.parts.set(c.hash, p);
    }
    if (!p.got[c.i]) {
      p.got[c.i] = fromB64(c.data);
      p.have++;
    }
    if (p.have < c.n) return null;
    this.parts.delete(c.hash);
    const total = p.got.reduce((s, x) => s + x!.length, 0);
    if (total !== c.frames * c.ch * 2) return null;
    const u8 = new Uint8Array(total);
    let o = 0;
    for (const x of p.got) {
      u8.set(x!, o);
      o += x!.length;
    }
    const pcm = new Int16Array(u8.buffer);
    if (hashPcm(pcm, c.sr, c.ch) !== c.hash) return null; // damaged on the way: ask again later
    return { hash: c.hash, name: c.name, frames: c.frames, sr: c.sr, ch: c.ch, pcm };
  }
  /** 0..1 for a tape on its way, or null. */
  progress(hash: string): number | null {
    const p = this.parts.get(hash);
    return p ? p.have / p.got.length : null;
  }
  drop(hash: string) {
    this.parts.delete(hash);
  }
}

// ---- recording helpers ----

/**
 * A finished recording: from the first sound to the last (silence trimmed at both ends, with a few ms
 * kept before the first sound), normalised to a peak of 0.9. Null if there was nothing to keep.
 */
export function finishRecording(l: Float32Array, r: Float32Array, sr: number, floor = 0.002): { l: Float32Array; r: Float32Array } | null {
  const n = Math.min(l.length, r.length);
  let a = 0;
  while (a < n && Math.abs(l[a]) < floor && Math.abs(r[a]) < floor) a++;
  let b = n;
  while (b > a && Math.abs(l[b - 1]) < floor && Math.abs(r[b - 1]) < floor) b--;
  a = Math.max(0, a - Math.round(sr * 0.005));
  b = Math.min(n, b + Math.round(sr * 0.05));
  if (b - a < sr * 0.05) return null;
  let pk = 0;
  for (let i = a; i < b; i++) pk = Math.max(pk, Math.abs(l[i]), Math.abs(r[i]));
  const g = 0.9 / Math.max(pk, 1e-4);
  const ol = new Float32Array(b - a);
  const or = new Float32Array(b - a);
  for (let i = a; i < b; i++) {
    ol[i - a] = l[i] * g;
    or[i - a] = r[i] * g;
  }
  return { l: ol, r: or };
}

/** Resample a channel to another rate (4-point Hermite), e.g. a 44.1 kHz tape on a 48 kHz computer. */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to || !x.length) return x;
  const n = Math.max(1, Math.round((x.length * to) / from));
  const out = new Float32Array(n);
  const step = from / to;
  const at = (i: number) => x[Math.max(0, Math.min(x.length - 1, i))];
  for (let k = 0; k < n; k++) {
    const p = k * step;
    const i = Math.floor(p);
    const f = p - i;
    const y0 = at(i - 1), y1 = at(i), y2 = at(i + 1), y3 = at(i + 2);
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    out[k] = ((c3 * f + c2) * f + c1) * f + y1;
  }
  return out;
}

/** The demo tape: a glassy sung chord with a few plucks on top (3 s), for trying Geode before recording. */
export function demoTape(sr: number): Tape {
  const n = Math.floor(sr * 3);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const ch = [57, 61, 64, 69];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let s = 0;
    ch.forEach((m, j) => {
      const f = 440 * 2 ** ((m - 69) / 12) * (1 + 0.004 * Math.sin(2 * Math.PI * 5.2 * t + j));
      for (let h = 1; h <= 5; h++) s += Math.sin(2 * Math.PI * f * h * t + h * j) * (0.22 / h) * (h === 2 ? 1.4 : 1);
    });
    const sw = Math.min(1, t * 3) * Math.min(1, (3 - t) * 4);
    let pl = 0;
    [0.3, 1.1, 1.7, 2.3].forEach((t0, j) => {
      if (t > t0) {
        const tt = t - t0;
        pl += Math.sin(2 * Math.PI * 440 * 2 ** ((76 + j * 3 - 69) / 12) * tt) * Math.exp(-tt * 6) * 0.5;
      }
    });
    L[i] = s * 0.18 * sw + pl * 0.6;
    R[i] = s * 0.18 * sw * 0.9 + pl * 0.45 + Math.sin(2 * Math.PI * 0.3 * t) * s * 0.02;
  }
  return makeTape(L, R, sr, 'Demo tape');
}

// ---- keeping tapes ----

/** IndexedDB in this browser (or nothing, where there is none: tapes then last for this visit). */
export function browserTapeStorage(): TapeStorage {
  const idb = typeof indexedDB !== 'undefined' ? indexedDB : null;
  let db: Promise<IDBDatabase | null> | null = null;
  const open = () =>
    (db ??= new Promise((res) => {
      if (!idb) return res(null);
      try {
        const rq = idb.open('fwm-tapes', 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore('tapes', { keyPath: 'hash' });
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => res(null);
      } catch {
        res(null);
      }
    }));
  return {
    async get(hash) {
      const d = await open();
      if (!d) return null;
      return new Promise((res) => {
        try {
          const rq = d.transaction('tapes').objectStore('tapes').get(hash);
          rq.onsuccess = () => {
            const v = rq.result as (TapeMeta & { pcm: ArrayBuffer }) | undefined;
            res(v ? { ...v, pcm: new Int16Array(v.pcm) } : null);
          };
          rq.onerror = () => res(null);
        } catch {
          res(null);
        }
      });
    },
    async put(t) {
      const d = await open();
      if (!d) return;
      await new Promise<void>((res) => {
        try {
          const tx = d.transaction('tapes', 'readwrite');
          tx.objectStore('tapes').put({ ...metaOf(t), pcm: t.pcm.slice().buffer, saved: Date.now() });
          tx.oncomplete = () => res();
          tx.onerror = () => res();
        } catch {
          res();
        }
      });
    },
  };
}

/**
 * The tapes this studio knows (in memory, backed by a TapeStorage), and the ones on their way.
 * Subscribe to hear when a tape arrives or a download moves on.
 */
export class TapeStore {
  private mem = new Map<string, Tape>();
  private asm = new TapeAssembler();
  private fns = new Set<() => void>();
  private version = 0;
  constructor(private storage: TapeStorage | null) {}
  subscribe = (fn: () => void) => {
    this.fns.add(fn);
    return () => void this.fns.delete(fn);
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    for (const f of this.fns) f();
  }
  has(hash: string) {
    return this.mem.has(hash);
  }
  peek(hash: string) {
    return this.mem.get(hash) ?? null;
  }
  /** From memory, else from storage (then kept in memory). */
  async get(hash: string): Promise<Tape | null> {
    const m = this.mem.get(hash);
    if (m) return m;
    const s = (await this.storage?.get(hash).catch(() => null)) ?? null;
    if (s && hashPcm(s.pcm, s.sr, s.ch) === s.hash) {
      this.mem.set(hash, s);
      this.emit();
      return s;
    }
    return null;
  }
  put(t: Tape) {
    if (this.mem.has(t.hash)) return;
    this.mem.set(t.hash, t);
    this.asm.drop(t.hash);
    void this.storage?.put(t).catch(() => {});
    this.emit();
  }
  /** A piece arrived from the live channel. Returns the tape when it is complete. */
  receive(c: TapeChunk): Tape | null {
    if (this.mem.has(c.hash)) return null;
    const t = this.asm.add(c);
    if (t) this.put(t);
    else this.emit();
    return t;
  }
  progress(hash: string) {
    return this.asm.progress(hash);
  }
}
