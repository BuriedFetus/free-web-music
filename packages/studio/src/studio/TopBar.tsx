import { useState, useSyncExternalStore } from 'react';
import type { Peer } from '../collab/presence';
import { useEngine } from '../engine/EngineProvider';
import { NOTE_NAMES, SCALES } from '../model/scales';
import { useStudio } from './context';

/** Live position inside the playing TRACK: "row|bar.beat.step", from the engine. */
function usePosition(): string | null {
  const { engine, status } = useEngine();
  return useSyncExternalStore(
    (fn) => (engine && status === 'on' ? engine.subscribe(fn) : () => {}),
    () => {
      const p = status === 'on' ? engine?.last?.transport : null;
      if (!p?.playing) return null;
      const s = Math.floor(p.row != null ? p.rowPos : p.pos);
      return `${p.row ?? ''}|${Math.floor(s / 16) + 1}.${Math.floor((s % 16) / 4) + 1}.${(s % 4) + 1}`;
    },
    () => null,
  );
}

export function TopBar({ peers, octave }: { peers: Peer[]; octave: number }) {
  const { project, ws, setWs, playing, setPlaying, rec, setRec, user } = useStudio();
  const { status, start, stop } = useEngine();
  const live = usePosition();
  const [playRow, pos] = live ? live.split('|') : [null, null];
  const trackName = (id: string | null) => (id ? project.track(id)?.name : null);
  const rowIds = project.rows().map((r) => r.id);
  const rowName = (id: string | null) => (id && rowIds.includes(id) ? `TRACK ${rowIds.indexOf(id) + 1}` : '');

  return (
    <div className="fwm-topbar">
      <div className="fwm-transport" role="group" aria-label="Transport">
        <button type="button" className="fwm-tb fwm-tb--play" aria-pressed={playing} onClick={() => setPlaying(!playing)}>
          {playing ? '■ Stop' : '▶ Play'}
        </button>
        <button type="button" className="fwm-tb fwm-tb--rec" aria-pressed={rec} onClick={() => setRec(!rec)}
          title="Record: notes you play (and knob moves) are written into the selected pattern while playing">
          ● Rec
        </button>
        <span className="fwm-lcdt" aria-label="Position">
          {rowName(playRow || ws.row)} {pos ?? '1.1.1'}
        </span>
        <span className="fwm-grp" role="group" aria-label="Loop">
          <button type="button" className="fwm-tb fwm-tb--sm" aria-pressed={ws.loop === 'track'} title="Repeat the TRACK that is playing"
            onClick={() => setWs({ loop: 'track' })}>⟲ Loop TRACK</button>
          <button type="button" className="fwm-tb fwm-tb--sm" aria-pressed={ws.loop === 'song'} title="Play the TRACKs in order, then start again"
            onClick={() => setWs({ loop: 'song' })}>⟲ Loop SONG</button>
        </span>
        <span className="fwm-bpm">
          <button type="button" className="fwm-tb fwm-tb--sm" aria-label="Slower" onClick={() => project.setBpm(project.bpm - 1)}>−</button>
          <BpmField />
          <button type="button" className="fwm-tb fwm-tb--sm" aria-label="Faster" onClick={() => project.setBpm(project.bpm + 1)}>+</button>
        </span>
        <label className="fwm-songkey" title="Song key, for every instrument: the Piano roll highlights it and can fold to it">
          Key
          <select value={project.key.root} aria-label="Key root note" disabled={project.key.scale === 'chromatic'}
            onChange={(e) => { project.setKey({ root: Number(e.target.value) }); e.target.blur(); }}>
            {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
          <select value={project.key.scale} aria-label="Scale"
            onChange={(e) => { project.setKey({ scale: e.target.value }); e.target.blur(); }}>
            {Object.entries(SCALES).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
          </select>
        </label>
      </div>
      <div className="fwm-grp">
        <button type="button" className="fwm-ib" aria-label="Undo (your changes)" title="Undo your own last change (Ctrl+Z)"
          disabled={!project.canUndo()} onClick={() => project.undo()}>↶</button>
        <button type="button" className="fwm-ib" aria-label="Redo" title="Redo (Ctrl+Shift+Z)"
          disabled={!project.canRedo()} onClick={() => project.redo()}>↷</button>
      </div>
      <div className="fwm-people" aria-label="People in this session">
        <span className="fwm-pchip">
          <span className="fwm-av" style={{ background: user.color }}>{user.name[0]}</span>
          <span>{user.name} (you){trackName(ws.track) ? ` · ${trackName(ws.track)}` : ''}</span>
        </span>
        {peers.map((p) => (
          <span key={p.clientId} className="fwm-pchip">
            <span className="fwm-av" style={{ background: p.user.color }}>{p.user.name[0]}</span>
            <span>
              {p.user.name}
              {trackName(p.track) ? ` · ${trackName(p.track)} ${rowName(p.row)}` : ''}
              {p.touch && project.track(p.touch.track) && !p.touch.control.startsWith('note:') ? ` · ${p.touch.control}` : ''}
            </span>
          </span>
        ))}
      </div>
      <div className="fwm-grow" />
      <span className="fwm-hintline" title="Computer keyboard plays the selected track">
        Keys A–; · Z/X octave {octave >= 0 ? '+' : ''}{octave} · Space play
      </span>
      <button type="button" className="fwm-btn-ui" aria-pressed={status === 'on'}
        onClick={() => (status === 'on' ? stop() : start())}>
        {status === 'on' ? 'Sound: on' : status === 'loading' ? 'Sound: loading…' : status === 'error' ? 'Sound: failed' : 'Sound: off'}
      </button>
    </div>
  );
}

/** Tempo readout: click it and type a number (40–240), Enter to set, Escape to cancel. */
function BpmField() {
  const { project, toast } = useStudio();
  const [draft, setDraft] = useState<string | null>(null);
  if (draft == null)
    return (
      <button type="button" className="fwm-lcdt fwm-bpmbtn" aria-label={`Tempo ${project.bpm} BPM, click to type`} title="Click to type a tempo"
        onClick={() => setDraft(String(project.bpm))}>
        {project.bpm} BPM
      </button>
    );
  const done = (ok: boolean) => {
    const v = Math.round(Number(draft));
    if (ok && Number.isFinite(v) && v >= 40 && v <= 240) project.setBpm(v);
    else if (ok && draft.trim() && draft !== String(project.bpm)) toast('Tempo is 40 to 240 BPM');
    setDraft(null);
  };
  return (
    <input className="fwm-lcdt fwm-bpmin" aria-label="Tempo in BPM" inputMode="numeric" autoFocus value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
      onBlur={() => done(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') done(true);
        else if (e.key === 'Escape') setDraft(null);
      }} />
  );
}
