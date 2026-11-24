// Drum grid: the Piano roll panel's editor for drum machines (Flint). One row per pad, each with its own
// length; tools Draw / Accent / Roll; pad mute / solo (shared, on the instrument); a velocity lane for the
// selected row; a playhead per row while the pattern plays. Hits are ordinary notes (pad i = note 36 + i).
import { useState, useSyncExternalStore, type PointerEvent } from 'react';
import { stepOf } from '@fwm/engine/worklet';
import { DRUM_TYPES } from '../../devices/flint/kits';
import { deviceEntry } from '../../devices/registry';
import { useEngine } from '../../engine/EngineProvider';
import { useDeviceState } from '../../engine/useDeviceSync';
import { MAX_ROW, PAD_NOTE, PADS, type Note, type TrackInfo } from '../../model/project';
import { useStudio } from '../context';

type Tool = 'draw' | 'accent' | 'roll';
const TOOLS: [Tool, string, string][] = [
  ['draw', 'Draw', 'Click a step to switch it on or off'],
  ['accent', 'Accent', 'Click a step to make it louder (by Flint’s Accent knob); again to undo'],
  ['roll', 'Roll ×2 ×3 ×4', 'Click a step for quick repeated hits; click again for more, after ×4 back to one'],
];

/** Each row's playing step (or -1), when this pattern is the one playing. */
function useRowSteps(track: TrackInfo, pat: string, lens: number[]): number[] {
  const { engine, status } = useEngine();
  const { project, slotOf } = useStudio();
  const slot = slotOf(track.id) ?? 0;
  const key = useSyncExternalStore(
    (fn) => (engine && status === 'on' ? engine.subscribe(fn) : () => {}),
    () => {
      const tr = status === 'on' ? engine?.last?.transport : null;
      if (!tr?.playing || !tr.row || project.cell(tr.row, track.id) !== pat) return '';
      const n = Math.floor(tr.rowPos * (track.seq.rate || 1));
      return lens.map((L) => stepOf(n, L, track.seq.dir, slot + 1)).join(',');
    },
    () => '',
  );
  return key ? key.split(',').map(Number) : lens.map(() => -1);
}

export function DrumGrid({ track: t, pat }: { track: TrackInfo; pat: string }) {
  const st = useStudio();
  const { project } = st;
  const [tool, setTool] = useState<Tool>('draw');
  const [sel, setSel] = useState(0);
  const store = project.deviceStore(t.id, deviceEntry(t.device)!.manifest!)!;
  const dev = useDeviceState(store);
  const lens = project.rowLens(t.id, pat);
  const cols = Math.max(16, ...lens);
  const steps = useRowSteps(t, pat, lens);
  const notes = project.notes(t.id, pat);
  const at = (pad: number, step: number) => notes.find(([, n]) => n.m === PAD_NOTE + pad && Math.floor(n.s) === step);
  const padName = (i: number) => DRUM_TYPES[dev.params[`p${i + 1}.type`] ?? i] ?? `Pad ${i + 1}`;
  const { pmute, psolo } = t.seq;
  const bit = (mask: number, i: number) => ((mask >> i) & 1) === 1;
  const hear = (pad: number, n?: Note) => st.audition(t.id, PAD_NOTE + pad + (n?.a ? 12 : 0), true);

  const click = (pad: number, step: number) => {
    project.undoManager.stopCapturing();
    const hit = at(pad, step);
    const m = PAD_NOTE + pad;
    if (tool === 'draw') {
      if (hit) project.deleteNote(t.id, pat, hit[0]);
      else {
        project.addNote(t.id, pat, { s: step, l: 1, m, v: 0.8 });
        hear(pad);
      }
    } else if (tool === 'accent') {
      if (hit) project.updateNote(t.id, pat, hit[0], { a: hit[1].a ? 0 : 1 });
      else project.addNote(t.id, pat, { s: step, l: 1, m, v: 0.8, a: 1 });
      hear(pad, { s: 0, l: 1, m, v: 1, a: hit?.[1].a ? 0 : 1 });
    } else {
      const r = hit ? ((hit[1].r ?? 1) % 4) + 1 : 2;
      if (hit) project.updateNote(t.id, pat, hit[0], { r });
      else project.addNote(t.id, pat, { s: step, l: 1, m, v: 0.8, r });
    }
    project.undoManager.stopCapturing();
  };

  // Velocity lane for the selected row: drag across to draw.
  const vel = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const j = Math.max(0, Math.min(cols - 1, Math.floor(((e.clientX - r.left - 3) / (r.width - 6)) * cols)));
    const v = Math.max(0.05, Math.min(1, 1 - (e.clientY - r.top - 3) / (r.height - 6)));
    const hit = j < lens[sel] ? at(sel, j) : undefined;
    if (hit) project.updateNote(t.id, pat, hit[0], { v });
  };
  const grid = { '--cols': cols, '--w': `${cols * 21}px` } as React.CSSProperties;
  const anySolo = psolo !== 0;

  return (
    <div className="fwm-dg">
      <div className="fwm-rtb">
        <span className="fwm-dg__len">{Math.max(...lens)} steps (its longest row)</span>
        <span className="fwm-picks" role="group" aria-label="Step tool">
          {TOOLS.map(([k, label, hint]) => (
            <button key={k} type="button" className="fwm-pk" aria-pressed={tool === k} title={hint} onClick={() => setTool(k)}>{label}</button>
          ))}
        </span>
        <button type="button" className="fwm-tb fwm-tb--xs"
          onClick={() => {
            project.clearPattern(t.id, pat);
            st.toast(`Cleared ${t.name} · ${project.patternInfo(t.id, pat)?.name}`, { label: 'Undo', run: () => project.undo() });
          }}>
          Clear pattern
        </button>
      </div>
      <div className="fwm-rsc">
        <div className="fwm-dg__rows">
          {Array.from({ length: PADS }, (_, i) => {
            const L = lens[i];
            const off = bit(pmute, i) || (anySolo && !bit(psolo, i));
            return (
              <div key={i} className={'fwm-dg__row' + (off ? ' is-off' : '')} style={grid}>
                <button type="button" className={'fwm-dg__name' + (i === sel ? ' is-sel' : '')} title={`Pad ${i + 1}: select this row (velocity lane) and hear it`}
                  onClick={() => { setSel(i); hear(i); }}>
                  {i + 1} · {padName(i)}
                </button>
                <span className="fwm-dg__ms">
                  <button type="button" className="is-m" aria-pressed={bit(pmute, i)} aria-label={`Mute pad ${i + 1}`} title="Mute"
                    onClick={() => project.setSeq(t.id, { pmute: pmute ^ (1 << i) })}>M</button>
                  <button type="button" className="is-s" aria-pressed={bit(psolo, i)} aria-label={`Solo pad ${i + 1}`} title="Solo"
                    onClick={() => project.setSeq(t.id, { psolo: psolo ^ (1 << i) })}>S</button>
                </span>
                <div className="fwm-dg__cells">
                  {Array.from({ length: cols }, (_, j) => {
                    const out = j >= L;
                    const n = out ? undefined : at(i, j)?.[1];
                    const label = `Pad ${i + 1} step ${j + 1}${n ? (n.a ? ', accent' : '') + (n.r ? `, roll ×${n.r}` : '') : ''}`;
                    return (
                      <button key={j} type="button" aria-label={label} aria-pressed={!!n} tabIndex={out ? -1 : 0} aria-hidden={out || undefined}
                        className={'fwm-dc' + (j % 4 === 0 ? ' is-beat' : '') + (out ? ' is-out' : n ? ' is-on' : '') + (n?.a ? ' is-acc' : '') + (steps[i] === j ? ' is-now' : '')}
                        style={n ? ({ '--v': n.v } as React.CSSProperties) : undefined}
                        onClick={() => !out && click(i, j)}>
                        {n?.r && <span className="fwm-dc__roll">×{n.r}</span>}
                      </button>
                    );
                  })}
                </div>
                <span className="fwm-dg__lenbox" role="group" aria-label={`Pad ${i + 1} row length`}>
                  <button type="button" aria-label={`Pad ${i + 1} row shorter`} disabled={L <= 1} onClick={() => project.setRowLen(t.id, pat, i, L - 1)}>−</button>
                  <span title="Steps in this row">{L}</span>
                  <button type="button" aria-label={`Pad ${i + 1} row longer`} disabled={L >= MAX_ROW} onClick={() => project.setRowLen(t.id, pat, i, L + 1)}>+</button>
                </span>
              </div>
            );
          })}
          <div className="fwm-dg__row fwm-dg__vel" style={grid}>
            <span className="fwm-dg__vlab">Velocity</span>
            <span className="fwm-dg__vlab">{sel + 1} · {padName(sel)}</span>
            <div className="fwm-dg__vbars" aria-label={`Velocity of pad ${sel + 1}: drag across to draw`}
              onPointerDown={(e) => {
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer (tests) */ }
                project.undoManager.stopCapturing();
                vel(e);
              }}
              onPointerMove={(e) => e.buttons && vel(e)}>
              {Array.from({ length: cols }, (_, j) => {
                const n = j < lens[sel] ? at(sel, j)?.[1] : undefined;
                return (
                  <div key={j} className={'fwm-dg__vb' + (n?.a ? ' is-acc' : '')} style={j >= lens[sel] ? { visibility: 'hidden' } : undefined}>
                    {n && <i style={{ height: `${Math.round(n.v * 100)}%` }} />}
                  </div>
                );
              })}
            </div>
            <span />
          </div>
        </div>
      </div>
      <p className="fwm-hint">
        Each row has its own length (− / +) and loops on its own; the pattern is as long as its longest row, and rows start
        again with each TRACK · Draw switches steps · Accent makes a step louder (Flint’s Accent knob) · Roll plays 2–4 quick
        hits in one step · M / S mute or solo a pad for everyone · select a row to edit its velocity below.
      </p>
    </div>
  );
}
