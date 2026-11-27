// <Studio>: the embeddable core. The host passes a Yjs doc, awareness, a live channel and the user;
// the studio never opens a network connection itself.
import { lookStorageKey, prepareLook } from '../model/look';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { Engine } from '@fwm/engine';
import { stepOf } from '@fwm/engine/worklet';
import { PresenceModel } from '../collab/presence';
import { LiveTiming } from '../collab/liveTiming';
import { TransportSync, type Loop, type TransportTarget } from '../collab/transport';
import type { LiveChannel, LiveMessage, PresetLibrary, SongLibrary, StudioUser } from '../collab/types';
import { browserPresetLibrary, PresetCache } from '../model/myPresets';
import { deviceEntry } from '../devices/registry';
import { EngineProvider, useEngine } from '../engine/EngineProvider';
import { HeldParams, useDeviceSync } from '../engine/useDeviceSync';
import { useComputerKeys } from '../hooks/useComputerKeys';
import { engineFx } from '../model/fx';
import { BAR, MAX_LEN, Project, type TrackInfo } from '../model/project';
import { ThemeRoot, type StudioTheme } from '../theme/Theme';
import { browserTapeStorage, fromPcm, resample, type TapeStorage } from '../model/sampleStore';
import { useTapes, type TapesCtl } from './useTapes';
import { QUANT, StudioContext, type StudioCtx, type Workspace } from './context';
import { TopBar } from './TopBar';
import { WorkspaceGrid } from './Workspace';

export interface StudioProps {
  doc: Y.Doc;
  awareness?: Awareness | null;
  channel?: LiveChannel | null;
  user: StudioUser;
  /** Where songs are saved and opened from (Song menu). Without it, songs can't be saved. */
  songs?: SongLibrary | null;
  theme?: StudioTheme;
  className?: string;
  /** Called when the audio engine has started (e.g. for a host-side recorder or tests). */
  onEngine?(engine: Engine): void;
  /** This person's own look (a stylesheet only they see), if the host keeps it, e.g. in their profile.
   *  Leave it undefined and the studio keeps it in this browser. See docs/LOOKS.md. */
  look?: string | null;
  /** Called when the person keeps a new look (null = back to the default). */
  onLookChange?(css: string | null): void;
  /** Where Geode's tapes (recorded sound) are kept between visits. Leave it out and the studio keeps
   *  them in this browser (IndexedDB); null = only for this visit. They are never put in the song. */
  tapes?: TapeStorage | null;
  /** Where each person's own presets are kept (with their account). Without it: in this browser. */
  presets?: PresetLibrary | null;
}

export function Studio(props: StudioProps) {
  return (
    <EngineProvider onEngine={props.onEngine}>
      <ThemeRoot theme={props.theme} className={'fwm-studio' + (props.className ? ' ' + props.className : '')}>
        <StudioInner {...props} />
      </ThemeRoot>
    </EngineProvider>
  );
}

const WS_DEFAULT: Workspace = { track: null, row: null, snap: '1/16', recQuant: '1/16', fold: false, loop: 'song', cueWait: true, liveMode: 'even' };
function loadWs(key: string): Workspace {
  try {
    return { ...WS_DEFAULT, ...JSON.parse(localStorage.getItem(key) || '{}') };
  } catch {
    return WS_DEFAULT;
  }
}

function StudioInner({ doc, awareness = null, channel = null, songs = null, user, look: hostLook, onLookChange, tapes: tapeStorage, presets }: StudioProps) {
  const myPresets = useMemo(() => (presets ? new PresetCache(presets, 'host') : new PresetCache(browserPresetLibrary(user.id), 'browser')), [presets, user.id]);
  const project = useMemo(() => new Project(doc, { user: user.id }), [doc, user.id]);
  const presence = useMemo(() => new PresenceModel(awareness, user), [awareness, user]);
  useEffect(() => () => presence.destroy(), [presence]);
  useSyncExternalStore(project.subscribe, project.getVersion);
  const peers = useSyncExternalStore(presence.subscribe, presence.peers);
  const { engine, status, start } = useEngine();
  const live = status === 'on' ? engine : null;

  // ---- my look: a stylesheet only this person sees (kept by the host, or in this browser) ----
  const lookKey = lookStorageKey(user.id);
  const [ownLook, setOwnLook] = useState<string | null>(() => {
    try {
      return localStorage.getItem(lookKey);
    } catch {
      return null;
    }
  });
  const [lookPreview, setLookPreview] = useState<string | null>(null);
  const lookOff = typeof location !== 'undefined' && /[?&]nolook(=|&|$)/.test(location.search);
  const keptLook = hostLook !== undefined ? hostLook : ownLook;
  const setLook = useCallback(
    (css: string | null) => {
      const v = css && css.trim() ? css : null;
      onLookChange?.(v);
      if (hostLook === undefined) {
        setOwnLook(v);
        try {
          if (v) localStorage.setItem(lookKey, v);
          else localStorage.removeItem(lookKey);
        } catch {
          /* no storage: kept for this visit only */
        }
      }
    },
    [hostLook, onLookChange, lookKey],
  );
  const shownLook = lookOff ? null : (lookPreview ?? keptLook);
  const lookCss = useMemo(() => prepareLook(shownLook).css, [shownLook]);

  // ---- private workspace (per user, saved in this browser) ----
  const wsKey = `fwm.ws.${user.id}`;
  const [ws, setWsState] = useState<Workspace>(() => loadWs(wsKey));
  const wsRef = useRef(ws); // the latest settings, also between a change and the next render
  wsRef.current = ws;
  const setWs = useCallback(
    (patch: Partial<Workspace>) =>
      setWsState((w) => {
        const next = { ...w, ...patch };
        wsRef.current = next;
        try {
          localStorage.setItem(wsKey, JSON.stringify(next));
        } catch {
          /* storage may be unavailable */
        }
        return next;
      }),
    [wsKey],
  );
  const tracks = project.tracks();
  const selTrack = tracks.find((t) => t.id === ws.track) ?? tracks[0] ?? null;
  useEffect(() => {
    if ((selTrack?.id ?? null) !== ws.track) setWs({ track: selTrack?.id ?? null });
  }, [selTrack?.id, ws.track, setWs]);
  const rows = project.rows();
  const selRow = rows.find((r) => r.id === ws.row) ?? rows[0] ?? null;
  useEffect(() => {
    if ((selRow?.id ?? null) !== ws.row) setWs({ row: selRow?.id ?? null });
  }, [selRow?.id, ws.row, setWs]);
  useEffect(() => presence.set({ track: selTrack?.id ?? null, row: selRow?.id ?? null }), [presence, selTrack?.id, selRow?.id]);

  // ---- engine slots: one per track, local to this client ----
  const slots = useRef(new Map<string, number>());
  for (const id of [...slots.current.keys()]) if (!tracks.some((t) => t.id === id)) slots.current.delete(id);
  for (const t of tracks) {
    if (slots.current.has(t.id)) continue;
    const used = new Set(slots.current.values());
    let s = 0;
    while (used.has(s) && s < 16) s++;
    if (s < 16) slots.current.set(t.id, s);
  }
  const slotOf = useCallback((track: string) => slots.current.get(track), []);

  // ---- toasts ----
  const [toastState, setToast] = useState<{ msg: string; action?: { label: string; run(): void }; id: number } | null>(null);
  const toast = useCallback((msg: string, action?: { label: string; run(): void }) => {
    setToast({ msg, action, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toastState) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toastState]);

  // ---- transport: one Play for everyone in the session (see collab/transport.ts); tempo and swing are in the song ----
  const peersRef = useRef(peers);
  peersRef.current = peers;
  const nameOf = (id: string) => peersRef.current.find((p) => p.user.id === id)?.user.name ?? 'Someone';
  // Times given to the engine are "page time when it is heard". The soonest anything can be heard is
  // now + this computer's output delay: Play and other people's keys are never planned sooner.
  const outLatency = useRef(0);
  const heardNow = useCallback(() => performance.now() + outLatency.current, []);
  const sync = useMemo(
    () =>
      new TransportSync(channel, user.id, {
        latency: () => outLatency.current,
        loop: wsRef.current.loop,
        onRemote: (kind, who, s) => {
          if (kind === 'loop') setWs({ loop: s.loop });
          else if (kind === 'play') toast(`${nameOf(who)} pressed Play`);
          else if (kind === 'stop') toast(`${nameOf(who)} stopped`);
          else if (kind === 'state') toast(`Joined ${nameOf(who)}'s song where it is`);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channel, user.id],
  );
  useEffect(() => () => sync.destroy(), [sync]);
  const timing = useMemo(() => new LiveTiming(sync, heardNow), [sync, heardNow]);
  const held = useMemo(() => new HeldParams(), []);
  useEffect(() => () => held.clear(), [held]);
  const tp = useSyncExternalStore(sync.subscribe, sync.getSnapshot);
  const playing = tp.playing;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const selRowRef = useRef(selRow?.id ?? null);
  selRowRef.current = selRow?.id ?? null;
  useEffect(() => {
    if (!live) return sync.setTarget(null);
    const idx = (row: string) => Math.max(0, rowsRef.current.findIndex((r) => r.id === row));
    const target: TransportTarget = {
      play: (row, pos, at) => live.playAt(idx(row), pos, at),
      seek: (row, pos, at) => live.seek(idx(row), pos, at),
      stop: () => live.setTransport({ playing: false }),
      cue: (row, wait) => live.cue(idx(row), wait),
      where: (at) => live.where(at),
    };
    sync.setTarget(target);
    return () => sync.setTarget(null);
  }, [live, sync]);
  const [rec, setRecOn] = useState(false);
  const [recMode, setRecMode] = useState<'over' | 'replace'>('over');
  const setRec = useCallback((r: boolean, mode: 'over' | 'replace' = 'over') => {
    setRecOn(r);
    setRecMode(mode);
  }, []);
  // Play starts from the selected TRACK.
  const setPlaying = useCallback(
    (p: boolean, since?: { t0: number; stepsPerMs: number }) => {
      if (p && status !== 'on') void start();
      if (p) {
        const row = selRowRef.current ?? rowsRef.current[0]?.id;
        if (row) sync.play(row, since);
      } else sync.stop();
    },
    [status, start, sync],
  );
  useEffect(() => {
    live?.setTransport({ bpm: project.bpm, swing: project.swing });
  }, [live, project.bpm, project.swing]);
  const anySolo = tracks.some((t) => project.mix(t.id).solo);
  useEffect(() => {
    live?.setMaster({ level: project.masterLevel });
  }, [live, project.masterLevel]);
  const cueRow = useCallback(
    (row: string) => {
      if (playing && rowsRef.current.some((r) => r.id === row)) sync.cue(row, wsRef.current.cueWait);
    },
    [playing, sync],
  );
  const setLoop = useCallback(
    (loop: Loop) => {
      setWs({ loop });
      sync.setLoop(loop);
    },
    [setWs, sync],
  );
  const setAlone = useCallback((a: boolean) => sync.setAlone(a), [sync]);

  // ---- live recording ----
  const recHeld = useRef(new Map<string, { id: string; track: string; pat: string; s: number; startPos: number; startMs?: number }>());
  // What the player heard is late by the output latency: record where they heard it.
  const latSteps = useCallback(() => {
    const lat = live?.latency();
    return lat ? (lat.base + lat.output) * (project.bpm / 60) * 4 : 0;
  }, [live, project]);
  const recPos = useCallback(() => {
    const p = live?.position();
    return p == null ? null : p - latSteps();
  }, [live, latSteps]);

  const strumRec = useRef<{ track: string; pat: string; free: number; s: number; t: number } | null>(null);
  // A recording take, per instrument: from its first note, time runs on from there (it never wraps when
  // the song loops); the pattern grows ahead of it, bar by bar, up to MAX_LEN, then the take wraps and overdubs.
  // (startPos NaN = the take began before the song was playing: it is pinned on the next note)
  const recTake = useRef(new Map<string, { pat: string; startPos: number; startFree: number; startMs: number }>());
  useEffect(() => {
    if (!rec || !playing) recTake.current.clear();
  }, [rec, playing]);
  const recordOn = useCallback(
    (track: TrackInfo, note: number, vel: number) => {
      const q0 = QUANT[ws.recQuant] ?? 0;
      const wallSteps = (ms: number) => (ms / 1000) * (project.bpm / 60) * 4 * track.seq.rate;
      if (!playing) {
        // Rec armed, song stopped: the first note starts the song and lands at the very start of the pattern
        const now = performance.now();
        let take = recTake.current.get(track.id);
        if (!take) {
          let row = selRowRef.current ?? rowsRef.current[0]?.id;
          if (!row) row = project.addRow();
          let tp = project.cell(row, track.id);
          if (!tp) {
            tp = project.addPattern(track.id);
            if (!tp) return;
            project.setCell(row, track.id, tp);
          } else if (recMode === 'replace') project.clearPattern(track.id, tp);
          take = { pat: tp, startPos: NaN, startFree: 0, startMs: now };
          recTake.current.set(track.id, take);
          // the song's step 0 is this note (it starts that far in after the head start, so later notes stay in time)
          setPlaying(true, { t0: now, stepsPerMs: (project.bpm / 60) * 4 / 1000 });
        }
        const free = wallSteps(now - take.startMs);
        const s0 = Math.min(MAX_LEN - 0.01, q0 ? Math.round(free / q0) * q0 : free);
        const id = project.addNote(track.id, take.pat, { s: s0, l: q0 || 0.25, m: note, v: vel });
        if (id) recHeld.current.set(`${track.id}:${note}`, { id, track: track.id, pat: take.pat, s: s0, startPos: NaN, startMs: now });
        return;
      }
      const pos = recPos();
      const rp = live?.rowPosition();
      if (pos == null || !rp) return;
      // Record into the pattern this instrument plays in the TRACK that is playing; an empty cell gets a new pattern.
      let pat = project.cell(rp.row, track.id);
      if (!pat) {
        pat = project.addPattern(track.id);
        if (!pat) return;
        project.setCell(rp.row, track.id, pat);
      }
      let len = project.patternInfo(track.id, pat)?.len ?? 16;
      const q = QUANT[ws.recQuant] ?? 0;
      let free: number;
      const take = recTake.current.get(track.id);
      if (take && take.pat === pat && !Number.isNaN(take.startPos)) {
        free = (take.startFree + (pos - take.startPos) * track.seq.rate) % MAX_LEN;
      } else if (take && take.pat === pat) {
        // the take began with the song: pin it to the song's position now
        const raw = Math.max(0, rp.pos - latSteps()) * track.seq.rate;
        free = raw;
        take.startPos = pos - raw / track.seq.rate;
      } else {
        const raw = Math.max(0, rp.pos - latSteps()) * track.seq.rate;
        const n = Math.floor(raw);
        const idx = stepOf(n, len, track.seq.dir, (slots.current.get(track.id) ?? 0) + 1);
        free = idx + (raw - n);
        recTake.current.set(track.id, { pat, startPos: pos, startFree: free, startMs: performance.now() });
        // replace: the take's first note clears the pattern
        if (recMode === 'replace') project.clearPattern(track.id, pat);
      }
      let s = q ? Math.round(free / q) * q : free;
      // A strum (Garnet: notes a few ms apart) stays a strum: the first note snaps to the grid, the rest
      // keep their distance from it, so quantize never splits a chord across two steps.
      const now = performance.now();
      const g = strumRec.current;
      const inStrum = !!q && track.device === 'garnet' && !!g && g.track === track.id && g.pat === pat && now - g.t < 75 && free >= g.free;
      if (inStrum) {
        s = g!.s + (free - g!.free);
        g!.t = now;
      } else strumRec.current = { track: track.id, pat, free, s, t: now };
      if (s >= MAX_LEN) s -= MAX_LEN;
      if (s >= len) {
        len = Math.min(MAX_LEN, Math.ceil((s + 0.001) / BAR) * BAR);
        project.setPatternLen(track.id, pat, len);
      }
      const id = project.addNote(track.id, pat, { s, l: q || 0.25, m: note, v: vel });
      if (id) recHeld.current.set(`${track.id}:${note}`, { id, track: track.id, pat, s, startPos: pos });
    },
    [recPos, latSteps, live, ws.recQuant, project, recMode, playing, setPlaying],
  );
  // keep each take's pattern a bar ahead of the playhead, so the song never loops back mid-take
  useEffect(() => {
    if (!rec || !playing) return;
    const id = setInterval(() => {
      const pos = recPos();
      if (pos == null) return;
      for (const [track, take] of recTake.current) {
        const t = project.track(track);
        const len = project.patternInfo(track, take.pat)?.len;
        if (!t || len == null) continue;
        if (Number.isNaN(take.startPos)) {
          // a take that started the song: pin it to the song's clock now that it plays
          const rp = live?.rowPosition();
          if (!rp) continue;
          take.startPos = pos - Math.max(0, rp.pos - latSteps());
          take.startFree = 0;
          continue;
        }
        const cur = take.startFree + (pos - take.startPos) * t.seq.rate;
        if (cur < MAX_LEN && cur > len - BAR) project.setPatternLen(track, take.pat, Math.min(MAX_LEN, (Math.floor(cur / BAR) + 2) * BAR));
      }
    }, 200);
    return () => clearInterval(id);
  }, [rec, playing, recPos, project, live, latSteps]);
  const recordOff = useCallback(
    (trackId: string, note: number) => {
      const h = recHeld.current.get(`${trackId}:${note}`);
      if (!h) return;
      recHeld.current.delete(`${trackId}:${note}`);
      const t = project.track(trackId);
      const pos = recPos();
      if (!t) return;
      const q = QUANT[ws.recQuant] ?? 0;
      let el: number;
      if (h.startMs != null) el = ((performance.now() - h.startMs) / 1000) * (project.bpm / 60) * 4 * t.seq.rate;
      else if (pos == null) return;
      else el = (pos - h.startPos) * t.seq.rate;
      const l = q ? Math.max(q, Math.round(el / q) * q) : Math.max(1 / 16, el);
      const len = project.patternInfo(h.track, h.pat)?.len ?? MAX_LEN;
      project.updateNote(h.track, h.pat, h.id, { l: Math.min(len - h.s, l) });
    },
    [recPos, ws.recQuant, project],
  );

  // ---- Geode's tapes: recording, keeping, sharing (see useTapes.ts) ----
  const tapes = useTapes({
    project, channel, engine: live, session: sync.session, slotOf, toast, start,
    storage: tapeStorage === undefined ? browserTapeStorage() : tapeStorage,
    resetTrim: (geode) => {
      const m = deviceEntry('geode')?.manifest;
      const st = m ? project.deviceStore(geode, m) : null;
      st?.setParam('start', 0);
      st?.setParam('end', 1);
    },
  });
  // While a Geode records, its keys play the instrument being recorded; a key is released where it was pressed.
  const noteTo = useRef(new Map<string, string>());

  // ---- notes ----
  // When this key is heard here (page ms): others play it at this moment + their buffer.
  const lat = live?.latency();
  outLatency.current = lat ? (lat.base + lat.output) * 1000 : 0;
  const heardAt = heardNow;
  const playNote = useCallback(
    (to: string, note: number, vel: number) => {
      const track = tapes.target(to);
      noteTo.current.set(`${to}:${note}`, track);
      if (status !== 'on') void start();
      const slot = slots.current.get(track);
      if (live && slot != null) live.noteOn(slot, note, vel);
      channel?.send({ t: 'on', track, note, vel, user: user.id, from: sync.session, at: heardAt() });
      const t = project.track(track);
      if (rec && t) recordOn(t, note, vel);
    },
    [status, start, live, channel, user.id, project, rec, recordOn, sync, heardAt, tapes],
  );
  const releaseNote = useCallback(
    (from: string, note: number) => {
      const track = noteTo.current.get(`${from}:${note}`) ?? from;
      noteTo.current.delete(`${from}:${note}`);
      const slot = slots.current.get(track);
      if (live && slot != null) live.noteOff(slot, note);
      channel?.send({ t: 'off', track, note, user: user.id, from: sync.session, at: heardAt() });
      recordOff(track, note);
    },
    [live, channel, user.id, recordOff, sync, heardAt],
  );
  const audition = useCallback(
    (track: string, note: number, on: boolean) => {
      const slot = slots.current.get(track);
      if (!live || slot == null) return;
      if (on) live.noteOn(slot, note, 0.8);
      else live.noteOff(slot, note);
    },
    [live],
  );

  // ---- my knob turns: their timing goes out live (the value itself also goes through the doc) ----
  useEffect(() => {
    if (!channel) return;
    const off = project.onLocalParam((track, id, v) => channel.send({ t: 'param', track, id, v, user: user.id, from: sync.session, at: heardAt() }));
    return () => void off();
  }, [project, channel, user.id, sync, heardAt]);

  // ---- notes from other people: play on our own copy of their instrument ----
  const [peerHeld, setPeerHeld] = useState<Record<string, { note: number; color: string; user: string }[]>>({});
  const liveRef = useRef(live);
  liveRef.current = live;
  useEffect(() => {
    if (!channel) return;
    return channel.subscribe((m: LiveMessage) => {
      if (m.t !== 'on' && m.t !== 'off' && m.t !== 'param') return;
      if (m.from ? m.from === sync.session : m.user === user.id) return;
      const slot = slots.current.get(m.track);
      const e = liveRef.current;
      const mode = wsRef.current.liveMode;
      if (m.t === 'param') {
        // Tight: the doc's update is the turn, on arrival. Even: play the turn at its own pace.
        if (mode !== 'even' || !e || slot == null || !m.from) return;
        const at = timing.when(m.from, m.at, 'even');
        try {
          e.setParamAt(slot, m.id, m.v, at);
        } catch {
          return; // a param this device doesn't have
        }
        held.hold(slot, m.id, at + 250);
        return;
      }
      const at = m.from ? timing.when(m.from, m.at, mode, { id: `${m.track}:${m.note}`, on: m.t === 'on' }) : heardNow();
      const soon = at <= heardNow() + 1;
      if (e && slot != null) {
        if (m.t === 'on') soon ? e.noteOn(slot, m.note, m.vel) : e.noteOnAt(slot, m.note, m.vel, at);
        else soon ? e.noteOff(slot, m.note) : e.noteOffAt(slot, m.note, at);
      }
      const color = peersRef.current.find((p) => p.user.id === m.user)?.user.color ?? 'var(--fwm-peer)';
      const show = () =>
        setPeerHeld((h) => {
          const list = (h[m.track] ?? []).filter((x) => !(x.note === m.note && x.user === m.user));
          if (m.t === 'on') list.push({ note: m.note, color, user: m.user });
          return { ...h, [m.track]: list };
        });
      if (soon) show();
      else setTimeout(show, at - heardNow()); // the key lights when it sounds
    });
  }, [channel, user.id, sync, timing, held, heardNow]);
  // Someone left while holding keys: release them.
  useEffect(() => {
    const ids = new Set(peers.map((p) => p.user.id));
    setPeerHeld((h) => {
      let changed = false;
      const next: typeof h = {};
      for (const [t, list] of Object.entries(h)) {
        const keep = list.filter((x) => ids.has(x.user));
        if (keep.length !== list.length) {
          changed = true;
          const slot = slots.current.get(t);
          for (const x of list) if (!ids.has(x.user) && slot != null) liveRef.current?.noteOff(slot, x.note);
        }
        next[t] = keep;
      }
      return changed ? next : h;
    });
  }, [peers]);

  // ---- keyboard: computer keys play the selected track; Space = play/stop; Ctrl+Z = undo ----
  const [octave, setOctave] = useState(0);
  const keyTrack = useRef(new Map<number, string>());
  // notes this person holds on the computer keyboard, per track (the panel's keys light up)
  const [myHeld, setMyHeld] = useState<Record<string, number[]>>({});
  const holdKey = (t: string, n: number, on: boolean) =>
    setMyHeld((h) => ({ ...h, [t]: on ? [...(h[t] ?? []).filter((x) => x !== n), n] : (h[t] ?? []).filter((x) => x !== n) }));
  const entry = selTrack ? deviceEntry(selTrack.device) : null;
  const padLayout = entry?.layout === 'pads';
  useComputerKeys({
    enabled: !!selTrack,
    base: padLayout ? entry!.rootNote : (entry?.rootNote ?? 48) + octave * 12,
    layout: padLayout ? 'pads' : 'piano',
    songKey: project.key,
    // A key is released on the track it started on, even if you switched track while holding it.
    onNoteOn: (n, v) => {
      if (!selTrack) return;
      keyTrack.current.set(n, selTrack.id);
      holdKey(selTrack.id, n, true);
      playNote(selTrack.id, n, v);
    },
    onNoteOff: (n) => {
      const t = keyTrack.current.get(n) ?? selTrack?.id;
      keyTrack.current.delete(n);
      if (t) {
        holdKey(t, n, false);
        releaseNote(t, n);
      }
    },
    onOctave: (d) => setOctave((o) => Math.max(-3, Math.min(4, o + d))),
  });
  useEffect(() => {
    // Space is always play/stop (outside text fields). Without this, Space "clicks" whatever button
    // you clicked last: a step, Clear, Mute, or remove track.
    const typing = (e: KeyboardEvent) => !!(e.target as HTMLElement).closest?.('input:not([type=range]), textarea, select, [contenteditable=true]');
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e)) e.preventDefault();
    };
    const kd = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) project.redo();
        else project.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        project.redo();
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;
        // Shift+Space arms / disarms Rec (overdub); Space plays / stops
        if (e.shiftKey) setRec(!rec);
        else setPlaying(!playing);
      }
    };
    addEventListener('keydown', kd, true);
    addEventListener('keyup', ku, true);
    return () => {
      removeEventListener('keydown', kd, true);
      removeEventListener('keyup', ku, true);
    };
  }, [project, playing, setPlaying, rec, setRec]);

  const ctx: StudioCtx = {
    project, presence, user, channel, songs, myPresets, ws, setWs, playing, setPlaying, alone: tp.alone, setAlone, setLoop,
    transport: sync, liveTiming: timing, rec, setRec, recMode, slotOf, cueRow,
    playNote, releaseNote, audition, peerHeld, myHeld, toast, tapes, octave, setOctave: (o: number) => setOctave(Math.max(-3, Math.min(4, o))),
    look: { css: keptLook, set: setLook, preview: lookPreview, setPreview: setLookPreview, hostKeeps: hostLook !== undefined, off: lookOff },
  };

  return (
    <StudioContext.Provider value={ctx}>
      {live && tracks.map((t) => {
        const slot = slots.current.get(t.id);
        // Solo: when any instrument is soloed, only soloed ones are heard. Mute silences notes and live keys.
        const audible = !t.seq.mute && (!anySolo || project.mix(t.id).solo);
        return slot == null ? null : <TrackEngine key={t.id} project={project} track={t} slot={slot} held={held} audible={audible} tapes={tapes} />;
      })}
      {live && <SongEngine project={project} slotOf={slotOf} loop={ws.loop} />}
      {live && <FxEngine project={project} />}
      {lookCss && <style data-fwm-look="">{lookCss}</style>}
      <div className="fwm-app">
        <TopBar peers={peers} octave={octave} />
        <WorkspaceGrid userId={user.id} peers={peers} />
      </div>
      {toastState && (
        <div className="fwm-toast" role="status" key={toastState.id}>
          <span>{toastState.msg}</span>
          {toastState.action && (
            <button type="button" onClick={() => { toastState.action!.run(); setToast(null); }}>
              {toastState.action.label}
            </button>
          )}
        </div>
      )}
    </StudioContext.Provider>
  );
}

/** Keeps one instrument's device, sequencer settings and all its patterns mirrored in the engine. */
function TrackEngine({ project, track, slot, held, audible, tapes }: { project: Project; track: TrackInfo; slot: number; held: HeldParams; audible: boolean; tapes: TapesCtl }) {
  const { engine } = useEngine();
  const sent = useRef(new Map<string, string>()); // patternId → what the engine has
  const seqKey = useRef('');
  const mixKey = useRef('');
  const manifest = deviceEntry(track.device)!.manifest!;
  const store = project.deviceStore(track.id, manifest)!;
  useDeviceSync(engine, store, slot, track.device, held);
  // Geode: load its tape into the engine (after the device is made), or ask the session for it
  const tape = track.device === 'geode' ? project.tape(track.id) : null;
  const have = useSyncExternalStore(tapes.store.subscribe, () => (tape ? tapes.store.has(tape.hash) : false));
  useEffect(() => {
    if (!engine || track.device !== 'geode') return;
    if (!tape) {
      void engine.setSample(slot, new Float32Array(0));
      return;
    }
    let dead = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void tapes.store.get(tape.hash).then((t) => {
      if (dead) return;
      if (!t) {
        // nobody sent it yet: ask, and keep asking now and then until someone who has it is here
        tapes.ask(tape.hash);
        timer = setInterval(() => tapes.ask(tape.hash), 5000);
        return;
      }
      const sr = engine.context.sampleRate;
      const { l, r } = fromPcm(t);
      void engine.setSample(slot, resample(l, t.sr, sr), t.ch === 2 ? resample(r, t.sr, sr) : undefined);
    });
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [engine, store, slot, track.device, tape?.hash, have]); // eslint-disable-line react-hooks/exhaustive-deps
  // Re-send everything when the engine (re)starts or the device is re-created (removing a device
  // in the worklet also forgets its patterns).
  useEffect(() => {
    sent.current = new Map();
    seqKey.current = '';
    mixKey.current = ''; // a re-created device starts at 0 dB in the engine: send the strip again
  }, [engine, store]);
  useEffect(() => {
    if (!engine) return;
    const k = JSON.stringify(track.seq);
    if (k !== seqKey.current) {
      seqKey.current = k;
      engine.setTrack(slot, track.seq);
    }
    const mix = project.mix(track.id);
    const strip = { level: mix.level, pan: mix.pan, mute: !audible, sendA: mix.rev, sendB: mix.dly };
    const mk = JSON.stringify(strip);
    if (mk !== mixKey.current) {
      mixKey.current = mk;
      engine.setMix(slot, strip);
    }
    const seen = new Set<string>();
    const pads = deviceEntry(track.device)?.layout === 'pads';
    for (const p of project.patternList(track.id)) {
      seen.add(p.id);
      const data = {
        len: p.len,
        notes: project.notes(track.id, p.id).map(([, n]) => n),
        auto: project.automationAll(track.id, p.id),
        ...(pads ? { lens: project.rowLens(track.id, p.id) } : {}),
      };
      const pk = JSON.stringify(data);
      if (sent.current.get(p.id) === pk) continue;
      sent.current.set(p.id, pk);
      engine.setPat(slot, p.id, data);
    }
    for (const id of [...sent.current.keys()]) {
      if (seen.has(id)) continue;
      sent.current.delete(id);
      engine.deletePat(slot, id);
    }
  });
  return null;
}

/** Keeps the master effects (settings, chain order) mirrored in the engine; the delay time follows the tempo. */
function FxEngine({ project }: { project: Project }) {
  const { engine } = useEngine();
  const sent = useRef(new Map<string, number>());
  const chainSent = useRef('');
  useEffect(() => {
    sent.current = new Map();
    chainSent.current = '';
  }, [engine]);
  useEffect(() => {
    if (!engine) return;
    const want = engineFx((k) => project.fx(k), project.bpm);
    const changed: Record<string, number> = {};
    for (const [k, v] of Object.entries(want)) {
      if (sent.current.get(k) === v) continue;
      sent.current.set(k, v);
      changed[k] = v;
    }
    if (Object.keys(changed).length) engine.setFx(changed);
    const chain = project.fxChain.join(',');
    if (chain !== chainSent.current) {
      chainSent.current = chain;
      engine.setChain(project.fxChain);
    }
  });
  return null;
}

/** Sends the song (which pattern each instrument plays in each TRACK, and how long each TRACK is). */
function SongEngine({ project, slotOf, loop }: { project: Project; slotOf(track: string): number | undefined; loop: 'track' | 'song' }) {
  const { engine } = useEngine();
  const sent = useRef('');
  useEffect(() => {
    sent.current = '';
  }, [engine]);
  useEffect(() => {
    if (!engine) return;
    const rows = project.rows().map((r) => {
      const cells: Record<number, string> = {};
      for (const [t, p] of Object.entries(r.cells)) {
        const slot = slotOf(t);
        if (slot != null && project.patternInfo(t, p)) cells[slot] = p;
      }
      return { id: r.id, len: project.rowLen(r.id), cells };
    });
    const plan = { rows, loop };
    const k = JSON.stringify(plan);
    if (k === sent.current) return;
    sent.current = k;
    engine.setSong(rows.length ? plan : null);
  });
  return null;
}
