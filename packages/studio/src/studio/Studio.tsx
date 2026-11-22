// <Studio>: the embeddable core. The host passes a Yjs doc, awareness, a live channel and the user;
// the studio never opens a network connection itself.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { Engine } from '@fwm/engine';
import { stepOf } from '@fwm/engine/worklet';
import { PresenceModel } from '../collab/presence';
import type { LiveChannel, LiveMessage, StudioUser } from '../collab/types';
import { deviceEntry } from '../devices/registry';
import { EngineProvider, useEngine } from '../engine/EngineProvider';
import { useDeviceSync } from '../engine/useDeviceSync';
import { useComputerKeys } from '../hooks/useComputerKeys';
import { Project, STEPS, type TrackInfo } from '../model/project';
import { ThemeRoot, type StudioTheme } from '../theme/Theme';
import { QUANT, StudioContext, type StudioCtx, type Workspace } from './context';
import { TopBar } from './TopBar';
import { WorkspaceGrid } from './Workspace';

export interface StudioProps {
  doc: Y.Doc;
  awareness?: Awareness | null;
  channel?: LiveChannel | null;
  user: StudioUser;
  theme?: StudioTheme;
  className?: string;
  /** Called when the audio engine has started (e.g. for a host-side recorder or tests). */
  onEngine?(engine: Engine): void;
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

const WS_DEFAULT: Workspace = { track: null, scene: 0, snap: '1/16', recQuant: '1/16' };
function loadWs(key: string): Workspace {
  try {
    return { ...WS_DEFAULT, ...JSON.parse(localStorage.getItem(key) || '{}') };
  } catch {
    return WS_DEFAULT;
  }
}

function StudioInner({ doc, awareness = null, channel = null, user }: StudioProps) {
  const project = useMemo(() => new Project(doc, { user: user.id }), [doc, user.id]);
  const presence = useMemo(() => new PresenceModel(awareness, user), [awareness, user]);
  useEffect(() => () => presence.destroy(), [presence]);
  useSyncExternalStore(project.subscribe, project.getVersion);
  const peers = useSyncExternalStore(presence.subscribe, presence.peers);
  const { engine, status, start } = useEngine();
  const live = status === 'on' ? engine : null;

  // ---- private workspace (per user, saved in this browser) ----
  const wsKey = `fwm.ws.${user.id}`;
  const [ws, setWsState] = useState<Workspace>(() => loadWs(wsKey));
  const setWs = useCallback(
    (patch: Partial<Workspace>) =>
      setWsState((w) => {
        const next = { ...w, ...patch };
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
  useEffect(() => presence.set({ track: selTrack?.id ?? null, scene: ws.scene }), [presence, selTrack?.id, ws.scene]);

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

  // ---- transport (local play/stop for now; shared tempo and swing) ----
  const [playing, setPlayingState] = useState(false);
  const [rec, setRec] = useState(false);
  const setPlaying = useCallback(
    (p: boolean) => {
      if (p && status !== 'on') void start();
      setPlayingState(p);
    },
    [status, start],
  );
  useEffect(() => {
    live?.setTransport({ playing, bpm: project.bpm, swing: project.swing });
  }, [live, playing, project.bpm, project.swing]);

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

  // ---- live recording ----
  const recHeld = useRef(new Map<string, { id: string; track: string; scene: number; s: number; startPos: number }>());
  const recPos = useCallback(() => {
    const p = live?.position();
    if (p == null || !live) return null;
    const lat = live.latency();
    // What the player heard is late by the output latency: record where they heard it.
    return p - (lat.base + lat.output) * (project.bpm / 60) * 4;
  }, [live, project]);

  const recordOn = useCallback(
    (track: TrackInfo, note: number, vel: number) => {
      const pos = recPos();
      if (pos == null) return;
      const raw = Math.max(0, pos) * track.seq.rate;
      const n = Math.floor(raw);
      const idx = stepOf(n, track.seq.len, track.seq.dir, (slots.current.get(track.id) ?? 0) + 1);
      const q = QUANT[ws.recQuant] ?? 0;
      let s = idx + (raw - n);
      if (q) s = Math.round(s / q) * q;
      if (s >= track.seq.len) s = 0;
      const id = project.addNote(track.id, ws.scene, { s, l: q || 0.25, m: note, v: vel });
      if (id) recHeld.current.set(`${track.id}:${note}`, { id, track: track.id, scene: ws.scene, s, startPos: pos });
    },
    [recPos, ws.recQuant, ws.scene, project],
  );
  const recordOff = useCallback(
    (trackId: string, note: number) => {
      const h = recHeld.current.get(`${trackId}:${note}`);
      if (!h) return;
      recHeld.current.delete(`${trackId}:${note}`);
      const t = project.track(trackId);
      const pos = recPos();
      if (!t || pos == null) return;
      const q = QUANT[ws.recQuant] ?? 0;
      const el = (pos - h.startPos) * t.seq.rate;
      const l = q ? Math.max(q, Math.round(el / q) * q) : Math.max(1 / 16, el);
      project.updateNote(h.track, h.scene, h.id, { l: Math.min(STEPS - h.s, l) });
    },
    [recPos, ws.recQuant, project],
  );

  // ---- notes ----
  const playNote = useCallback(
    (track: string, note: number, vel: number) => {
      if (status !== 'on') void start();
      const slot = slots.current.get(track);
      if (live && slot != null) live.noteOn(slot, note, vel);
      channel?.send({ t: 'on', track, note, vel, user: user.id });
      const t = project.track(track);
      if (rec && playing && t) recordOn(t, note, vel);
    },
    [status, start, live, channel, user.id, project, rec, playing, recordOn],
  );
  const releaseNote = useCallback(
    (track: string, note: number) => {
      const slot = slots.current.get(track);
      if (live && slot != null) live.noteOff(slot, note);
      channel?.send({ t: 'off', track, note, user: user.id });
      recordOff(track, note);
    },
    [live, channel, user.id, recordOff],
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

  // ---- notes from other people: play on our own copy of their instrument ----
  const [peerHeld, setPeerHeld] = useState<Record<string, { note: number; color: string; user: string }[]>>({});
  const peersRef = useRef(peers);
  peersRef.current = peers;
  const liveRef = useRef(live);
  liveRef.current = live;
  useEffect(() => {
    if (!channel) return;
    return channel.subscribe((m: LiveMessage) => {
      if (m.user === user.id) return;
      const slot = slots.current.get(m.track);
      const e = liveRef.current;
      if (e && slot != null) {
        if (m.t === 'on') e.noteOn(slot, m.note, m.vel);
        else e.noteOff(slot, m.note);
      }
      const color = peersRef.current.find((p) => p.user.id === m.user)?.user.color ?? 'var(--fwm-peer)';
      setPeerHeld((h) => {
        const list = (h[m.track] ?? []).filter((x) => !(x.note === m.note && x.user === m.user));
        if (m.t === 'on') list.push({ note: m.note, color, user: m.user });
        return { ...h, [m.track]: list };
      });
    });
  }, [channel, user.id]);
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
  const entry = selTrack ? deviceEntry(selTrack.device) : null;
  useComputerKeys({
    enabled: !!selTrack,
    base: (entry?.rootNote ?? 48) + octave * 12,
    onNoteOn: (n, v) => selTrack && playNote(selTrack.id, n, v),
    onNoteOff: (n) => selTrack && releaseNote(selTrack.id, n),
    onOctave: (d) => setOctave((o) => Math.max(-3, Math.min(4, o + d))),
  });
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.('input, textarea, select, [contenteditable=true]')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) project.redo();
        else project.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        project.redo();
      } else if (e.code === 'Space' && !t.closest?.('button, [role=slider]')) {
        e.preventDefault();
        setPlaying(!playing);
      }
    };
    addEventListener('keydown', kd);
    return () => removeEventListener('keydown', kd);
  }, [project, playing, setPlaying]);

  const ctx: StudioCtx = {
    project, presence, user, channel, ws, setWs, playing, setPlaying, rec, setRec, slotOf,
    playNote, releaseNote, audition, peerHeld, toast,
  };

  return (
    <StudioContext.Provider value={ctx}>
      {live && tracks.map((t) => {
        const slot = slots.current.get(t.id);
        return slot == null ? null : <TrackEngine key={t.id} project={project} track={t} slot={slot} scene={ws.scene} />;
      })}
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

/** Keeps one track's device, sequencer settings and current pattern mirrored in the engine. */
function TrackEngine({ project, track, slot, scene }: { project: Project; track: TrackInfo; slot: number; scene: number }) {
  const { engine } = useEngine();
  const sent = useRef('');
  const seqKey = useRef('');
  const manifest = deviceEntry(track.device)!.manifest!;
  const store = project.deviceStore(track.id, manifest)!;
  useDeviceSync(engine, store, slot, track.device);
  // Re-send everything when the engine (re)starts.
  useEffect(() => {
    sent.current = '';
    seqKey.current = '';
  }, [engine]);
  useEffect(() => {
    if (!engine) return;
    const k = JSON.stringify(track.seq);
    if (k !== seqKey.current) {
      seqKey.current = k;
      engine.setTrack(slot, track.seq);
    }
    const notes = project.notes(track.id, scene).map(([, n]) => n);
    const auto = project.automationAll(track.id, scene);
    const pk = JSON.stringify([notes, auto]);
    if (pk !== sent.current) {
      sent.current = pk;
      engine.setPattern(slot, notes, auto);
    }
  });
  return null;
}
