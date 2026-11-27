// Geode's tapes in the studio: recording one from an instrument, keeping it, and sharing it with the
// others in the session over the live channel (never through the song or a server).
//
// Recording: Mica's REC arms a recording tap on the chosen instrument (after its fader). It waits for
// sound, then records until REC is pressed again, or 30 s. While armed, the keys meant for the Geode
// play the instrument being recorded. The finished tape is trimmed, normalised and rounded to 16 bits,
// fingerprinted, kept, put on the track (song: only its TapeMeta) and sent to everyone.
// Sharing: whoever is missing a tape asks ({t:'smp?'}); someone who has it answers after a short random
// wait, unless another person already started sending it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Engine } from '@fwm/engine';
import type { LiveChannel, LiveMessage } from '../collab/types';
import type { Project, TapeMeta } from '../model/project';
import { chunkTape, demoTape, finishRecording, makeTape, MAX_SECONDS, metaOf, TapeStore, type Tape, type TapeStorage } from '../model/sampleStore';

export interface TapeRec {
  geode: string;
  input: string;
  /** armed: waiting for the first sound; rec: recording; saving: finishing. */
  phase: 'armed' | 'rec' | 'saving';
  secs: number;
  /** Input peak level, 0..1. */
  level: number;
}

export type TapeStatus = { state: 'empty' } | { state: 'ready'; meta: TapeMeta } | { state: 'loading'; meta: TapeMeta; progress: number } | { state: 'missing'; meta: TapeMeta };

export interface TapesCtl {
  store: TapeStore;
  rec: TapeRec | null;
  record(geode: string, input: string): void;
  /** Stop recording and keep it (or cancel, if nothing was heard yet). */
  stop(): void;
  cancel(): void;
  demo(geode: string): void;
  /** Load an audio file (WAV, MP3, OGG… anything the browser can decode) as the tape: first 30 s. */
  file(geode: string, f: File): Promise<void>;
  clear(geode: string): void;
  status(geode: string): TapeStatus;
  /** Where notes for `track` go now (the input instrument while its Geode records). */
  target(track: string): string;
  /** Ask the session for a tape we don't have (rate-limited). */
  ask(hash: string): void;
}

interface Cap {
  stop: () => void;
  l: Float32Array[];
  r: Float32Array[];
  n: number;
  pre: [Float32Array, Float32Array] | null;
  sr: number;
  done?: () => void;
}

const PACE_MS = 40;
const PER_TICK = 4;

export function useTapes(o: {
  project: Project;
  channel: LiveChannel | null;
  engine: Engine | null;
  session: string;
  storage?: TapeStorage | null;
  slotOf(track: string): number | undefined;
  toast(msg: string, action?: { label: string; run(): void }): void;
  start(): Promise<unknown> | void;
  resetTrim(geode: string): void;
}): TapesCtl {
  const { project, channel, engine, session } = o;
  const store = useMemo(() => new TapeStore(o.storage ?? null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [rec, setRecState] = useState<TapeRec | null>(null);
  const recRef = useRef<TapeRec | null>(null);
  const setRec = (r: TapeRec | null) => {
    recRef.current = r;
    setRecState(r);
  };
  const oRef = useRef(o);
  oRef.current = o;

  // ---- sharing ----
  const sending = useRef(new Map<string, number>()); // hash → when someone (us or another) last sent a piece
  const asked = useRef(new Map<string, number>());
  const send = useCallback(
    (t: Tape) => {
      if (!channel) return;
      const busy = sending.current.get(t.hash);
      if (busy && performance.now() - busy < 2000) return;
      const parts = chunkTape(t, session);
      sending.current.set(t.hash, performance.now());
      let i = 0;
      const tick = setInterval(() => {
        for (let k = 0; k < PER_TICK && i < parts.length; k++) channel.send(parts[i++]);
        sending.current.set(t.hash, performance.now());
        if (i >= parts.length) clearInterval(tick);
      }, PACE_MS);
    },
    [channel, session],
  );
  const ask = useCallback(
    (hash: string) => {
      const last = asked.current.get(hash) ?? -1e9;
      if (!channel || performance.now() - last < 4000 || store.has(hash)) return;
      asked.current.set(hash, performance.now());
      channel.send({ t: 'smp?', from: session, hash });
    },
    [channel, session, store],
  );
  useEffect(() => {
    if (!channel) return;
    return channel.subscribe((m: LiveMessage) => {
      if (m.t === 'smp') {
        if (m.from === session) return;
        sending.current.set(m.hash, performance.now());
        store.receive(m);
      } else if (m.t === 'smp?') {
        if (m.from === session) return;
        void store.get(m.hash).then((t) => {
          if (!t) return;
          // a short random wait: if someone else starts sending it first, let them
          setTimeout(() => {
            const busy = sending.current.get(t.hash);
            if (!busy || performance.now() - busy > 2000) send(t);
          }, 30 + Math.random() * 300);
        });
      }
    });
  }, [channel, session, store, send]);

  // ---- recording ----
  const cap = useRef<Cap | null>(null);
  const finish = useCallback(() => {
    const c = cap.current;
    const r = recRef.current;
    cap.current = null;
    if (!c || !r) return setRec(null);
    if (!c.n) {
      setRec(null);
      return oRef.current.toast('Nothing was recorded.');
    }
    const cat = (a: Float32Array[]) => {
      const out = new Float32Array(c.n);
      let i = 0;
      for (const x of a) {
        out.set(x.subarray(0, Math.min(x.length, c.n - i)), i);
        i += x.length;
        if (i >= c.n) break;
      }
      return out;
    };
    const kept = finishRecording(cat(c.l), cat(c.r), c.sr);
    setRec(null);
    if (!kept) return oRef.current.toast('Nothing was recorded (it was silent).');
    const name = `${project.track(r.input)?.name ?? 'Recording'} · ${(kept.l.length / c.sr).toFixed(1)} s`;
    const t = makeTape(kept.l, kept.r, c.sr, name);
    store.put(t);
    oRef.current.resetTrim(r.geode);
    project.setTape(r.geode, metaOf(t));
    send(t);
  }, [project, store, send]);

  const stopCap = useCallback(() => {
    const c = cap.current;
    if (!c) return;
    c.stop();
    // the last piece comes back with end = true; don't wait forever for it
    const t = setTimeout(finish, 600);
    c.done = () => {
      clearTimeout(t);
      finish();
    };
  }, [finish]);

  const record = useCallback(
    (geode: string, input: string) => {
      if (cap.current) return;
      const e = engine;
      const slot = oRef.current.slotOf(input);
      if (!e || slot == null) {
        void oRef.current.start();
        oRef.current.toast('Sound is starting: press REC again.');
        return;
      }
      const sr = e.context.sampleRate;
      const max = MAX_SECONDS * sr;
      const c: Cap = { stop: () => {}, l: [], r: [], n: 0, pre: null, sr };
      cap.current = c;
      setRec({ geode, input, phase: 'armed', secs: 0, level: 0 });
      let lastUi = 0;
      c.stop = e.capture(slot, (l, r, end) => {
        if (cap.current !== c) return;
        let pk = 0;
        for (let i = 0; i < l.length; i++) pk = Math.max(pk, Math.abs(l[i]), Math.abs(r[i]));
        const st = recRef.current;
        if (st && st.phase === 'armed') {
          if (pk > 0.004) {
            // the first sound: keep the piece before it too (the attack starts there)
            if (c.pre) {
              c.l.push(c.pre[0]);
              c.r.push(c.pre[1]);
              c.n += c.pre[0].length;
            }
            setRec({ ...st, phase: 'rec', level: pk });
          } else {
            c.pre = [l, r];
            const now = performance.now();
            if (now - lastUi > 80) {
              lastUi = now;
              setRec({ ...st, level: pk }); // the meter moves while waiting, so you can see whether sound arrives
            }
          }
        }
        if (recRef.current?.phase === 'rec' && c.n < max) {
          c.l.push(l);
          c.r.push(r);
          c.n = Math.min(max, c.n + l.length);
          const now = performance.now();
          if (now - lastUi > 80) {
            lastUi = now;
            setRec({ ...recRef.current, secs: c.n / sr, level: pk });
          }
          if (c.n >= max) {
            oRef.current.toast('30 s: Mica\'s memory is full.');
            stopCap();
          }
        }
        if (end) c.done?.();
      });
    },
    [engine, stopCap],
  );
  const cancel = useCallback(() => {
    const c = cap.current;
    cap.current = null;
    c?.stop();
    setRec(null);
  }, []);
  const stop = useCallback(() => {
    const r = recRef.current;
    if (!r) return;
    if (r.phase === 'armed') return cancel();
    setRec({ ...r, phase: 'saving' });
    stopCap();
  }, [cancel, stopCap]);
  useEffect(() => () => cap.current?.stop(), []);

  const demo = useCallback(
    (geode: string) => {
      const t = demoTape(engine?.context.sampleRate ?? 48000);
      store.put(t);
      oRef.current.resetTrim(geode);
      project.setTape(geode, metaOf(t));
      send(t);
    },
    [engine, project, store, send],
  );
  const file = useCallback(
    async (geode: string, f: File) => {
      try {
        const ctx = engine?.context ?? new OfflineAudioContext(2, 1, 48000);
        const buf = await ctx.decodeAudioData(await f.arrayBuffer());
        const sr = buf.sampleRate;
        const n = Math.min(buf.length, MAX_SECONDS * sr);
        const l = buf.getChannelData(0).slice(0, n);
        const r = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice(0, n);
        const kept = finishRecording(l, r, sr);
        if (!kept) return oRef.current.toast('That file is silent.');
        const t = makeTape(kept.l, kept.r, sr, `${f.name.replace(/\.[^.]+$/, '').slice(0, 40)} · ${(kept.l.length / sr).toFixed(1)} s`);
        store.put(t);
        oRef.current.resetTrim(geode);
        project.setTape(geode, metaOf(t));
        send(t);
        if (buf.length > n) oRef.current.toast('Mica kept the first 30 s.');
      } catch {
        oRef.current.toast("Mica can't read that file (try WAV, MP3 or OGG).");
      }
    },
    [engine, project, store, send],
  );
  const clear = useCallback(
    (geode: string) => {
      const old = project.tape(geode);
      if (!old) return;
      project.setTape(geode, null);
      oRef.current.toast('Tape removed', { label: 'Undo', run: () => project.setTape(geode, old) });
    },
    [project],
  );
  const status = useCallback(
    (geode: string): TapeStatus => {
      const meta = project.tape(geode);
      if (!meta) return { state: 'empty' };
      if (store.has(meta.hash)) return { state: 'ready', meta };
      const p = store.progress(meta.hash);
      return p != null ? { state: 'loading', meta, progress: p } : { state: 'missing', meta };
    },
    [project, store],
  );
  const target = useCallback((track: string) => (recRef.current && recRef.current.geode === track && recRef.current.phase !== 'saving' ? recRef.current.input : track), []);

  return { store, rec, record, stop, cancel, demo, file, clear, status, target, ask };
}
