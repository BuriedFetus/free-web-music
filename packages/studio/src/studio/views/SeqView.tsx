// Main sequencer: one row per track, all following the same clock. Length, direction and rate are
// per track, so a 12-step ping-pong line can run against a 16-step one.
import type { Direction } from '@fwm/engine';
import type { Peer } from '../../collab/presence';
import { deviceEntry } from '../../devices/registry';
import { SCENES, STEPS, type TrackInfo } from '../../model/project';
import { useStudio } from '../context';
import { usePlayStep } from './common';

const DIRS: [Direction, string, string][] = [['fwd', '→', 'Forward'], ['rev', '←', 'Reverse'], ['pp', '↔', 'Ping-pong'], ['rnd', '?', 'Random']];
const RATES: [number, string][] = [[0.5, '½×'], [1, '1×'], [2, '2×']];

export function SeqView({ peers }: { peers: Peer[] }) {
  const { project, ws } = useStudio();
  const tracks = project.tracks();
  return (
    <div className="fwm-sq">
      <div className="fwm-sqh">
        <span>Clock: internal</span>
        <span className="fwm-lcdt">{project.bpm} BPM</span>
        <label>
          Swing{' '}
          <input type="range" min={0} max={60} value={Math.round(project.swing * 100)} aria-label="Swing"
            onChange={(e) => project.setSwing(Number(e.target.value) / 100)} />
        </label>
        <span>{Math.round(project.swing * 100)}%</span>
        <span>Scene {SCENES[ws.scene]}</span>
      </div>
      {tracks.length === 0 && <p className="fwm-empty">No tracks yet. Open the Library and add Basalt.</p>}
      {tracks.map((t) => (
        <SeqRow key={t.id} track={t} peers={peers.filter((p) => p.track === t.id)} />
      ))}
      <p className="fwm-sqnote">
        Every track follows this clock. Click a step to switch a note on or off; open the Piano roll for pitch, length and
        micro-timing. "Own seq" lets a device run its built-in sequencer (Cobalt's arpeggiator, coming in Phase 5).
      </p>
    </div>
  );
}

function SeqRow({ track: t, peers }: { track: TrackInfo; peers: Peer[] }) {
  const { project, ws, setWs, slotOf, toast } = useStudio();
  const entry = deviceEntry(t.device);
  const notes = project.notes(t.id, ws.scene);
  const step = usePlayStep(slotOf(t.id));
  const q = t.seq;
  const hasOwnSeq = false; // no device with a built-in sequencer yet
  const toggle = (i: number) => {
    project.undoManager.stopCapturing();
    const here = notes.filter(([, n]) => Math.floor(n.s) === i);
    if (here.length) project.transact(() => here.forEach(([id]) => project.deleteNote(t.id, ws.scene, id)));
    else {
      const last = notes.filter(([, n]) => n.s < i).pop()?.[1] ?? notes[0]?.[1];
      project.addNote(t.id, ws.scene, { s: i, l: 1, m: last?.m ?? entry?.rootNote ?? 48, v: 0.85 });
    }
  };
  return (
    <div className={'fwm-sqr' + (t.id === ws.track ? ' is-sel' : '')}>
      <button type="button" className="fwm-thumb fwm-thumb--sm" data-device={t.device} onClick={() => setWs({ track: t.id })}
        aria-label={`Select ${t.name}`} aria-pressed={t.id === ws.track}>
        {t.name.toUpperCase()}
        {peers.map((p) => (
          <span key={p.clientId} className="fwm-av fwm-av--xs" style={{ background: p.user.color }} title={p.user.name}>{p.user.name[0]}</span>
        ))}
      </button>
      <div className={'fwm-lane16' + (q.own ? ' is-own' : '')}>
        {Array.from({ length: STEPS }, (_, i) => (
          <button key={i} type="button" aria-label={`${t.name} step ${i + 1}`}
            aria-pressed={notes.some(([, n]) => Math.floor(n.s) === i)}
            className={'fwm-c' + (i >= q.len ? ' is-off' : '') + (step === i ? ' is-now' : '')}
            onClick={() => toggle(i)} />
        ))}
      </div>
      <div className="fwm-sqc">
        <button type="button" className="fwm-tb fwm-tb--xs" aria-label="Shorter" onClick={() => project.setSeq(t.id, { len: q.len - 1 })}>−</button>
        <span className="fwm-lcdt fwm-lcdt--sm" title="Track length in steps">{q.len}</span>
        <button type="button" className="fwm-tb fwm-tb--xs" aria-label="Longer" onClick={() => project.setSeq(t.id, { len: q.len + 1 })}>+</button>
        <span className="fwm-grp">
          {DIRS.map(([d, icon, label]) => (
            <button key={d} type="button" className="fwm-tb fwm-tb--xs" aria-pressed={q.dir === d} aria-label={label} title={label}
              onClick={() => project.setSeq(t.id, { dir: d })}>{icon}</button>
          ))}
        </span>
        <span className="fwm-grp">
          {RATES.map(([r, label]) => (
            <button key={r} type="button" className="fwm-tb fwm-tb--xs" aria-pressed={q.rate === r} aria-label={`Rate ${label}`}
              onClick={() => project.setSeq(t.id, { rate: r })}>{label}</button>
          ))}
        </span>
        <button type="button" className="fwm-tb fwm-tb--xs" aria-pressed={q.mute} onClick={() => project.setSeq(t.id, { mute: !q.mute })}>Mute</button>
        <button type="button" className="fwm-tb fwm-tb--xs" aria-label={`Clear ${t.name} pattern in scene ${SCENES[ws.scene]}`}
          onClick={() => {
            project.clearPattern(t.id, ws.scene);
            toast(`Cleared ${t.name}, scene ${SCENES[ws.scene]}`, { label: 'Undo', run: () => project.undo() });
          }}>Clear</button>
        <button type="button" className="fwm-tb fwm-tb--xs" aria-pressed={q.own} disabled={!hasOwnSeq}
          title={hasOwnSeq ? 'Let the device run its own built-in sequencer, synced to this clock' : `${entry?.name} has no built-in sequencer`}
          onClick={() => project.setSeq(t.id, { own: !q.own })}>Own seq</button>
        <button type="button" className="fwm-tb fwm-tb--xs" aria-label={`Remove ${t.name}`}
          onClick={() => {
            project.removeTrack(t.id);
            toast(`Removed ${t.name}`, { label: 'Undo', run: () => project.undo() });
          }}>×</button>
      </div>
    </div>
  );
}
