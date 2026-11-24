// Main sequencer = the song arrangement. Instruments across the top, song rows (TRACK 1, TRACK 2…)
// down the side; each cell picks the pattern that instrument plays in that row. A row lasts as long as
// its longest pattern; shorter ones repeat inside it. Click a cell to edit its pattern in the Piano roll.
import { useState } from 'react';
import type { Peer } from '../../collab/presence';
import { deviceEntry, LIBRARY } from '../../devices/registry';
import { BAR, type SongRow, type TrackInfo } from '../../model/project';
import { useStudio } from '../context';
import { usePlayRow, usePlayStep } from './common';
import { TrackNameInput } from './TrackName';

/** "2 bars", "12 steps", "1 bar 4 steps". */
export function lenLabel(n: number): string {
  const b = Math.floor(n / BAR);
  const r = n % BAR;
  return [b ? `${b} bar${b > 1 ? 's' : ''}` : '', r ? `${r} step${r > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ');
}

export function SeqView({ peers }: { peers: Peer[] }) {
  const st = useStudio();
  const { project, ws, setWs, toast } = st;
  const tracks = project.tracks();
  const rows = project.rows();
  const addable = LIBRARY.filter((d) => d.available && d.manifest);
  const addInstrument = (d: (typeof addable)[number]) => {
    const id = project.addTrack(d.manifest!, d.presets?.[0], 0, ws.row);
    setWs({ track: id });
    toast(`${project.track(id)?.name} added, playing P1 in this TRACK`);
  };
  const cols = { '--n': tracks.length } as React.CSSProperties;

  return (
    <div className="fwm-sq">
      <div className="fwm-sqh">
        <label>
          Swing{' '}
          <input type="range" min={0} max={60} value={Math.round(project.swing * 100)} aria-label="Swing"
            onChange={(e) => project.setSwing(Number(e.target.value) / 100)} />
        </label>
        <span>{Math.round(project.swing * 100)}%</span>
        <span className="fwm-sqtip">Click a cell to edit its pattern in the Piano roll. A TRACK lasts as long as its longest pattern.</span>
      </div>
      {tracks.length === 0 && <p className="fwm-empty">No instruments yet. Add Basalt from the Library, or with + Instrument.</p>}
      <div className="fwm-arrw">
        <div className="fwm-arr">
          <div className="fwm-arow" style={cols}>
            <span />
            {tracks.map((t) => <InstrumentHead key={t.id} track={t} peers={peers.filter((p) => p.track === t.id)} />)}
            <span className="fwm-addis">
              {addable.map((d) => (
                <button key={d.id} type="button" className="fwm-addi" onClick={() => addInstrument(d)} title={`Add a ${d.name} (${d.kind}) to the song`}>
                  + {d.name}
                </button>
              ))}
            </span>
          </div>
          {rows.map((r, i) => (
            <Row key={r.id} row={r} index={i} tracks={tracks} peers={peers.filter((p) => p.row === r.id)} canDelete={rows.length > 1} />
          ))}
          <button type="button" className="fwm-tb fwm-tb--xs fwm-addt"
            onClick={() => setWs({ row: project.addRow() })}>+ Add TRACK</button>
        </div>
      </div>
    </div>
  );
}

function InstrumentHead({ track: t, peers }: { track: TrackInfo; peers: Peer[] }) {
  const { project, ws, setWs, toast } = useStudio();
  const [renaming, setRenaming] = useState(false);
  const entry = deviceEntry(t.device);
  return (
    <div className="fwm-ihead">
      {renaming ? (
        <TrackNameInput track={t.id} name={t.name} autoFocus onDone={() => setRenaming(false)} className="fwm-thumb fwm-ithumb" />
      ) : (
        <button type="button" className={'fwm-thumb fwm-ithumb' + (t.id === ws.track ? ' is-on' : '')} data-device={t.device}
          onClick={() => setWs({ track: t.id })} onDoubleClick={() => setRenaming(true)}
          aria-label={`Select ${t.name}`} aria-pressed={t.id === ws.track}>
          <span className="fwm-ithumb__name">{t.name}</span>
          <small>{entry?.name}</small>
          {peers.map((p) => (
            <span key={p.clientId} className="fwm-av fwm-av--xs" style={{ background: p.user.color }} title={p.user.name}>{p.user.name[0]}</span>
          ))}
        </button>
      )}
      <span className="fwm-ihead__btns">
        <button type="button" className="fwm-tb fwm-tb--xs" aria-label={`Rename ${t.name}`} title="Rename" onClick={() => setRenaming(true)}>✎</button>
        <button type="button" className="fwm-tb fwm-tb--xs" aria-pressed={t.seq.mute} aria-label={`Mute ${t.name}`}
          onClick={() => project.setSeq(t.id, { mute: !t.seq.mute })}>Mute</button>
        <button type="button" className="fwm-tb fwm-tb--xs" aria-label={`Remove ${t.name}`} title="Remove this instrument"
          onClick={() => {
            project.removeTrack(t.id);
            toast(`Removed ${t.name}`, { label: 'Undo', run: () => project.undo() });
          }}>×</button>
      </span>
    </div>
  );
}

function Row({ row, index, tracks, peers, canDelete }: { row: SongRow; index: number; tracks: TrackInfo[]; peers: Peer[]; canDelete: boolean }) {
  const { project, ws, setWs, toast, cueRow } = useStudio();
  const now = usePlayRow() === row.id;
  const len = project.rowLen(row.id);
  const longest = tracks.find((t) => project.patternInfo(t.id, row.cells[t.id])?.len === len && row.cells[t.id]);
  const sel = row.id === ws.row;
  const name = `TRACK ${index + 1}`;
  return (
    <div className={'fwm-arow' + (sel ? ' is-sel' : '') + (now ? ' is-now' : '')} style={{ '--n': tracks.length } as React.CSSProperties}>
      <button type="button" className="fwm-tl" aria-pressed={sel} aria-label={`${name}, ${lenLabel(len)}`}
        title={`Play from ${name} (while playing: jump here, on the beat)`}
        onClick={() => {
          setWs({ row: row.id });
          cueRow(row.id);
        }}>
        <b>{name}</b>
        <small>{lenLabel(len)}{longest ? ` · ${longest.name}` : ''}</small>
        {peers.map((p) => (
          <span key={p.clientId} className="fwm-av fwm-av--xs" style={{ background: p.user.color }} title={p.user.name}>{p.user.name[0]}</span>
        ))}
      </button>
      {tracks.map((t) => <Cell key={t.id} row={row.id} rowName={name} rowLen={len} track={t} now={now} />)}
      <span className="fwm-ra">
        <button type="button" className="fwm-tb fwm-tb--xs" aria-label={`Duplicate ${name}`} title={`Duplicate ${name}`}
          onClick={() => setWs({ row: project.addRow(row.id, true) })}>⧉</button>
        <button type="button" className="fwm-tb fwm-tb--xs" aria-label={`Delete ${name}`} title={`Delete ${name}`} disabled={!canDelete}
          onClick={() => {
            project.removeRow(row.id);
            toast(`Deleted ${name}`, { label: 'Undo', run: () => project.undo() });
          }}>×</button>
      </span>
    </div>
  );
}

function Cell({ row, rowName, rowLen, track: t, now }: { row: string; rowName: string; rowLen: number; track: TrackInfo; now: boolean }) {
  const { project, ws, setWs, slotOf } = useStudio();
  const info = project.patternInfo(t.id, project.cell(row, t.id));
  const on = row === ws.row && t.id === ws.track;
  const select = () => setWs({ row, track: t.id });
  if (!info)
    return (
      <button type="button" className={'fwm-cell' + (on ? ' is-on' : '')} onClick={select} aria-label={`${rowName}, ${t.name}: silent`}>
        <span className="fwm-cell__empty">—</span>
      </button>
    );
  const reps = rowLen / project.playLen(t.id, info.id);
  const idx = project.patternList(t.id).findIndex((p) => p.id === info.id);
  return (
    <button type="button" className={'fwm-cell has' + (on ? ' is-on' : '')} onClick={select}
      style={{ '--k': idx % 4, '--tw': `${(project.playLen(t.id, info.id) / rowLen) * 100}%` } as React.CSSProperties}
      aria-label={`${rowName}, ${t.name}: ${info.name}`}>
      <b>{info.name}</b>
      <small>{lenLabel(info.len)}</small>
      {reps > 1 && <span className="fwm-cell__rep">×{Number.isInteger(reps) ? reps : reps.toFixed(1)}</span>}
      <span className="fwm-cell__ticks" />
      {now && <CellProgress slot={slotOf(t.id)} len={info.len} />}
    </button>
  );
}

/** How far the pattern has played in its current repeat (only the playing cells subscribe to the clock). */
function CellProgress({ slot, len }: { slot: number | undefined; len: number }) {
  const step = usePlayStep(slot);
  return <span className="fwm-cell__pr" style={{ width: step < 0 ? 0 : `${((step + 1) / len) * 100}%` }} />;
}

