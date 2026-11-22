import { useSyncExternalStore } from 'react';
import type { Peer } from '../collab/presence';
import { useEngine } from '../engine/EngineProvider';
import { SCENES } from '../model/project';
import { useStudio } from './context';

/** Live transport position "scene bar.beat.step", from the engine. */
function usePosition(): string | null {
  const { engine, status } = useEngine();
  return useSyncExternalStore(
    (fn) => (engine && status === 'on' ? engine.subscribe(fn) : () => {}),
    () => {
      const p = status === 'on' ? engine?.last?.transport : null;
      if (!p?.playing) return null;
      const s = Math.floor(p.pos);
      return `${Math.floor(s / 16) + 1}.${Math.floor((s % 16) / 4) + 1}.${(s % 4) + 1}`;
    },
    () => null,
  );
}

export function TopBar({ peers, octave }: { peers: Peer[]; octave: number }) {
  const { project, ws, setWs, playing, setPlaying, rec, setRec, user } = useStudio();
  const { status, start, stop } = useEngine();
  const pos = usePosition();
  const trackName = (id: string | null) => (id ? project.track(id)?.name : null);

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
          {SCENES[ws.scene]} {pos ?? '1.1.1'}
        </span>
        <span className="fwm-bpm">
          <button type="button" className="fwm-tb fwm-tb--sm" aria-label="Slower" onClick={() => project.setBpm(project.bpm - 1)}>−</button>
          <span className="fwm-lcdt" aria-label="Tempo">{project.bpm} BPM</span>
          <button type="button" className="fwm-tb fwm-tb--sm" aria-label="Faster" onClick={() => project.setBpm(project.bpm + 1)}>+</button>
        </span>
        <span className="fwm-scenes" role="group" aria-label="Scene">
          {SCENES.map((name, i) => (
            <button key={name} type="button" className="fwm-tb fwm-tb--sm" aria-pressed={ws.scene === i}
              aria-label={`Scene ${name}`} onClick={() => setWs({ scene: i })}>
              {name}
            </button>
          ))}
        </span>
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
              {trackName(p.track) ? ` · ${trackName(p.track)} ${SCENES[p.scene] ?? ''}` : ''}
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
