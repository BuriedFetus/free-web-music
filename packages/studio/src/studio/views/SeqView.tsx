// Song arrangement (the main sequencer; the UI calls it "Song arrangement"). Instruments across the top, song rows (TRACK 1, TRACK 2…)
// down the side; each cell picks the pattern that instrument plays in that row. A row lasts as long as
// its longest pattern; shorter ones repeat inside it. Click a cell to edit its pattern in the Piano roll.
// Drag a cell to another TRACK of the same instrument to play its pattern there too (hold Ctrl or Alt when
// dropping for a separate copy), onto another instrument for a copy of it there (melodies to melodic
// instruments, drum patterns to drum machines), or onto "+ Add TRACK" for a new TRACK that plays it.
// Double-click a cell to open its pattern in the Piano roll (an empty one gets a new pattern); right-click,
// the ✕ on hover, or Delete empties it. Everything is undoable.
import { createContext, useContext, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Peer } from '../../collab/presence';
import { deviceEntry, LIBRARY } from '../../devices/registry';
import { BAR, PAD_NOTE, PADS, type SongRow, type TrackInfo } from '../../model/project';
import { useStudio } from '../context';
import { usePlayNext, usePlayRow, usePlayStep } from './common';
import { TrackNameInput } from './TrackName';

/** "2 bars", "12 steps", "1 bar 4 steps". */
export function lenLabel(n: number): string {
  const b = Math.floor(n / BAR);
  const r = n % BAR;
  return [b ? `${b} bar${b > 1 ? 's' : ''}` : '', r ? `${r} step${r > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ');
}

/** A cell being dragged: which pattern, where the pointer is, which cell it is over. */
interface Drag {
  track: string;
  pat: string;
  name: string;
  from: string;
  x: number;
  y: number;
  /** The cell under the pointer (row null = the "+ Add TRACK" button: a new TRACK). */
  over: { row: string | null; track: string } | null;
  copy: boolean;
}
/** What dropping `d` where it is would do, in words, or why it can't. */
type DropVerdict = { ok: true; copy: boolean; text: string } | { ok: false; text: string };
interface DragApi {
  drag: Drag | null;
  verdict(d: Drag): DropVerdict;
  start(e: RPointerEvent, row: string, track: string, pat: string, name: string): void;
  /** True right after a drag ends (the click that follows must not select the cell). */
  justDragged: React.MutableRefObject<boolean>;
}
const DragCtx = createContext<DragApi | null>(null);

export function SeqView({ peers }: { peers: Peer[] }) {
  const st = useStudio();
  const { project, ws, setWs, toast } = st;
  const tracks = project.tracks();
  const rows = project.rows();
  const rowName = (id: string) => `TRACK ${rows.findIndex((r) => r.id === id) + 1}`;
  const layoutOf = (t: string) => deviceEntry(project.track(t)?.device ?? '')?.layout ?? 'piano';
  const verdict = (d: Drag): DropVerdict => {
    const o = d.over;
    if (!o || (o.row === d.from && o.track === d.track)) return { ok: false, text: 'drop it on another cell' };
    const where = o.row ? rowName(o.row) : 'a new TRACK';
    if (o.track === d.track) return { ok: true, copy: d.copy, text: `→ ${where} · ${d.copy ? 'separate copy' : 'same pattern (Ctrl: copy)'}` };
    const to = project.track(o.track)?.name ?? '';
    if (layoutOf(o.track) !== layoutOf(d.track))
      return { ok: false, text: layoutOf(d.track) === 'pads' ? 'drum patterns only go to drum machines' : `${to} plays drum pads, not notes` };
    return { ok: true, copy: true, text: `→ ${to}, ${where} · a copy` };
  };
  const [drag, setDrag] = useState<Drag | null>(null);
  const justDragged = useRef(false);
  const start = (e: RPointerEvent, from: string, track: string, pat: string, name: string) => {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let cur: Drag | null = null;
    // the panel that scrolls: dragging near its top or bottom edge scrolls it, to reach every TRACK
    let scroller: HTMLElement | null = e.currentTarget as HTMLElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
    const move = (ev: PointerEvent) => {
      if (!cur && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        if (ev.clientY < r.top + 36) scroller.scrollTop -= 14;
        else if (ev.clientY > r.bottom - 36) scroller.scrollTop += 14;
      }
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-cell-row], [data-drop-newrow]');
      cur = { track, pat, name, from, x: ev.clientX, y: ev.clientY, copy: ev.ctrlKey || ev.altKey || ev.metaKey,
        over: !el ? null : el.dataset.cellRow ? { row: el.dataset.cellRow, track: el.dataset.cellTrack! } : { row: null, track } };
      setDrag(cur);
    };
    const end = (drop: boolean, ev?: PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cancel);
      removeEventListener('keydown', esc, true);
      setDrag(null);
      if (!cur) return;
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
      const o = cur.over;
      const v = verdict({ ...cur, copy: ev ? ev.ctrlKey || ev.altKey || ev.metaKey : cur.copy });
      if (!drop || !o || !v.ok) return;
      const done = project.placePattern(o.row, o.track, pat, v.copy, track);
      if (!done) return;
      setWs({ row: done.row, track: o.track });
      const where = project.rows().findIndex((r) => r.id === done.row) + 1;
      const pname = project.patternInfo(o.track, done.pat)?.name;
      toast(
        o.track !== track
          ? `${pname}: a copy of ${name} for ${project.track(o.track)?.name}, in TRACK ${where}`
          : v.copy
            ? `${pname}: a separate copy of ${name}, in TRACK ${where}`
            : `${name} also plays in TRACK ${where} (the same pattern: editing it changes both)`,
        { label: 'Undo', run: () => project.undo() },
      );
    };
    const up = (ev: PointerEvent) => end(true, ev);
    const cancel = () => end(false);
    const esc = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      end(false);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', cancel);
    addEventListener('keydown', esc, true);
  };
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
        <span className="fwm-sqtip">Click a cell to edit its pattern in the Piano roll. Drag it to another TRACK or instrument (hold Ctrl for a separate copy), or onto + Add TRACK. Double-click a cell to open its pattern (an empty one gets a new pattern); right-click or ✕ empties it. A TRACK lasts as long as its longest pattern.</span>
      </div>
      {tracks.length === 0 && <p className="fwm-empty">No instruments yet. Add Basalt from the Library, or with + Instrument.</p>}
      <DragCtx.Provider value={{ drag, verdict, start, justDragged }}>
      <div className={'fwm-arrw' + (drag ? ' is-dragging' : '')}>
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
          <button type="button" data-drop-newrow="" title="Add a TRACK (or drop a cell here: a new TRACK that plays it)"
            className={'fwm-tb fwm-tb--xs fwm-addt' + (drag?.over && drag.over.row === null ? ' is-drop-ok' : '')}
            onClick={() => setWs({ row: project.addRow() })}>+ Add TRACK</button>
        </div>
      </div>
      </DragCtx.Provider>
      {drag && (
        <div className={'fwm-dragghost' + (verdict(drag).ok ? ' is-ok' : '')}
          style={{ left: drag.x + 14, top: drag.y + 10 }} aria-hidden="true">
          <b>{drag.name}</b>
          <span>{verdict(drag).text}</span>
        </div>
      )}
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
  const next = usePlayNext() === row.id;
  const len = project.rowLen(row.id);
  const longest = tracks.find((t) => project.patternInfo(t.id, row.cells[t.id])?.len === len && row.cells[t.id]);
  const sel = row.id === ws.row;
  const name = `TRACK ${index + 1}`;
  return (
    <div className={'fwm-arow' + (sel ? ' is-sel' : '') + (now ? ' is-now' : '') + (next ? ' is-next' : '')} style={{ '--n': tracks.length } as React.CSSProperties}>
      <button type="button" className="fwm-tl" aria-pressed={sel} aria-label={`${name}, ${lenLabel(len)}`}
        title={`Play from ${name} (while playing: switch here when the playing TRACK ends, or at once with Wait off)`}
        onClick={() => {
          setWs({ row: row.id });
          cueRow(row.id);
        }}>
        <b>{name}</b>
        {next && <span className="fwm-tl__next">next</span>}
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
  const { project, ws, setWs, slotOf, toast } = useStudio();
  const dnd = useContext(DragCtx)!;
  const info = project.patternInfo(t.id, project.cell(row, t.id));
  const on = row === ws.row && t.id === ws.track;
  const select = () => {
    if (!dnd.justDragged.current) setWs({ row, track: t.id });
  };
  const d = dnd.drag;
  const over = d?.over?.row === row && d.over.track === t.id;
  const dragCls =
    (d && d.from === row && d.track === t.id ? ' is-drag-src' : '') +
    (over && !(d.from === row && d.track === t.id) ? (dnd.verdict(d).ok ? ' is-drop-ok' : ' is-drop-no') : '');
  const cellAttrs = { 'data-cell-row': row, 'data-cell-track': t.id };
  const empty = () => {
    if (!info) return;
    project.setCell(row, t.id, null);
    toast(`${info.name} taken out of ${rowName} (it stays in ${t.name}'s patterns)`, { label: 'Undo', run: () => project.undo() });
  };
  // double-click: into the pattern (the Piano roll shows it, and comes forward if it was hidden)
  const open = () => {
    setWs({ row, track: t.id });
    dispatchEvent(new CustomEvent('fwm:open-view', { detail: 'roll' }));
  };
  if (!info)
    return (
      <button type="button" className={'fwm-cell' + (on ? ' is-on' : '') + dragCls} onClick={select} aria-label={`${rowName}, ${t.name}: silent`} {...cellAttrs}
        title="Double-click: a new pattern here" onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={() => {
          const id = project.addPattern(t.id);
          project.setCell(row, t.id, id);
          open();
        }}>
        <span className="fwm-cell__empty">—</span>
      </button>
    );
  const reps = rowLen / project.playLen(t.id, info.id);
  const idx = project.patternList(t.id).findIndex((p) => p.id === info.id);
  return (
    <div className="fwm-cellw">
    <button type="button" className={'fwm-cell has' + (on ? ' is-on' : '') + dragCls} onClick={select} {...cellAttrs}
      onPointerDown={(e) => e.button === 0 && dnd.start(e, row, t.id, info.id, info.name)}
      onDoubleClick={open}
      onContextMenu={(e) => {
        e.preventDefault();
        empty();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          empty();
        }
      }}
      title={`${info.name}: double-click to open, drag to another TRACK or instrument (Ctrl: a separate copy), right-click to empty`}
      style={{ '--k': idx % 4, '--tw': `${(project.playLen(t.id, info.id) / rowLen) * 100}%` } as React.CSSProperties}
      aria-label={`${rowName}, ${t.name}: ${info.name}`}>
      <span className="fwm-cell__top">
        <b>{info.name}</b>
        <small>{lenLabel(info.len)}</small>
        {reps > 1 && <span className="fwm-cell__rep">×{Number.isInteger(reps) ? reps : reps.toFixed(1)}</span>}
      </span>
      <PatternPreview track={t} pattern={info.id} len={info.len} />
      <span className="fwm-cell__ticks" />
      {now && <CellProgress slot={slotOf(t.id)} len={info.len} />}
    </button>
    <button type="button" className="fwm-cell__x" aria-label={`Empty ${rowName}, ${t.name}`} title={`Take ${info.name} out of ${rowName}`} onClick={empty}>✕</button>
    </div>
  );
}

/**
 * A small picture of the pattern: notes by position, length and pitch (a mini piano roll), or for a drum
 * machine one row of hits per pad. Bars and beats are marked, so you can read the rhythm at a glance.
 */
function PatternPreview({ track, pattern, len }: { track: TrackInfo; pattern: string; len: number }) {
  const { project } = useStudio();
  const notes = project.notes(track.id, pattern).map(([, n]) => n);
  const pads = deviceEntry(track.device)?.layout === 'pads';
  const H = 24;
  let rows: number;
  let rowOf: (m: number) => number;
  if (pads) {
    rows = PADS;
    rowOf = (m) => PADS - 1 - Math.max(0, Math.min(PADS - 1, m - PAD_NOTE)); // pad 1 at the bottom
  } else {
    const ms = notes.map((n) => n.m);
    const lo = Math.min(...ms);
    const hi = Math.max(...ms);
    const span = Math.max(12, hi - lo + 1); // at least an octave tall, so a few notes don't fill it
    const base = lo - Math.floor((span - (hi - lo + 1)) / 2);
    rows = span;
    rowOf = (m) => span - 1 - (m - base);
  }
  const rh = H / rows;
  const grid = [];
  for (let b = 4; b < len; b += 4) grid.push(<rect key={b} className={b % BAR ? 'fwm-cell__beat' : 'fwm-cell__bar'} x={(b / len) * 100} y={0} width={0.4} height={H} />);
  return (
    <svg className="fwm-cell__pv" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {grid}
      {notes.map((n, i) => {
        if (n.s >= len) return null;
        const x = (n.s / len) * 100;
        const w = pads ? Math.max(0.9, 60 / len) : Math.max(0.8, (Math.min(n.l, len - n.s) / len) * 100 - 0.4);
        return <rect key={i} className="fwm-cell__note" x={x} y={rowOf(n.m) * rh + rh * 0.1} width={w} height={Math.max(1.4, rh * 0.8)} rx={0.4} opacity={0.45 + 0.55 * n.v} />;
      })}
    </svg>
  );
}

/** How far the pattern has played in its current repeat, and a playhead over its preview (only playing cells subscribe). */
function CellProgress({ slot, len }: { slot: number | undefined; len: number }) {
  const step = usePlayStep(slot);
  if (step < 0) return <span className="fwm-cell__pr" style={{ width: 0 }} />;
  return (
    <>
      <span className="fwm-cell__pr" style={{ width: `${((step + 1) / len) * 100}%` }} />
      <span className="fwm-cell__ph" style={{ left: `calc(9px + (100% - 18px) * ${(step + 0.5) / len})` }} />
    </>
  );
}

