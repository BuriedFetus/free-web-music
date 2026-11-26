// Piano roll for the pattern in the selected cell (instrument × TRACK): pick, name and size the pattern,
// edit notes with micro-timing, velocity and automation lanes. Patterns run from 1 step to 32 bars (128 beats).
// Edits go straight into the shared doc; other people's in-progress edits are outlined in their colour.
import type { Direction } from '@fwm/engine';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Peer } from '../../collab/presence';
import { deviceEntry } from '../../devices/registry';
import { formatParam } from '../../model/params';
import { inKey, isRoot, keyLabel } from '../../model/scales';
import { BAR, MAX_LEN, type Note } from '../../model/project';
import { noteName } from '../../primitives/Keys';
import { QUANT, useStudio } from '../context';
import { usePlayRow, usePlayStep } from './common';
import { lenLabel } from './SeqView';
import { DrumGrid } from './DrumGrid';
import { NameInput } from './TrackName';

const RH = 14; // row height (px)
const KEYW = 44; // key column width (px)
const SW = 14; // narrowest step (px): longer patterns scroll sideways
const DIRS: [Direction, string, string][] = [['fwd', '→', 'Forward'], ['rev', '←', 'Reverse'], ['pp', '↔', 'Ping-pong'], ['rnd', '?', 'Random']];
const RATES: [number, string][] = [[0.5, '½×'], [1, '1×'], [2, '2×']];
const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);

interface Drag {
  id: string;
  mode: 'move' | 'len';
  x0: number;
  s0: number;
  m0: number;
  row0: number;
  pitch: number;
}

export function RollView({ peers }: { peers: Peer[] }) {
  const st = useStudio();
  const { project, ws, setWs } = st;
  const t = ws.track ? project.track(ws.track) : null;
  const entry = t ? deviceEntry(t.device) : null;
  const slotStep = usePlayStep(t ? st.slotOf(t.id) : undefined);
  const playRow = usePlayRow();
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [autoParam, setAutoParam] = useState('cut');
  const prw = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null); // velocity + automation scroll sideways with the notes
  const rollSc = useRef<HTMLDivElement>(null);
  const keyHeld = useRef<number | null>(null); // piano key being pressed
  const pat = t ? project.cell(ws.row, t.id) : null;
  // Open centred on the pattern's notes (or the device's root note) when the pattern changes.
  useEffect(() => {
    if (!t || !entry || !prw.current) return;
    const ns = pat ? project.notes(t.id, pat).map(([, n]) => n.m) : [];
    const centre = ns.length ? (Math.min(...ns) + Math.max(...ns)) / 2 : entry.rootNote;
    const k = project.key;
    const fold = ws.fold && k.scale !== 'chromatic';
    let row = 0;
    for (let m = entry.roll.high; m > centre; m--) if (!fold || inKey(m, k)) row++;
    prw.current.scrollTop = row * RH - prw.current.clientHeight / 2;
  }, [t?.id, pat, ws.fold]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!t || !entry?.manifest) return <p className="fwm-empty">No instrument selected. Add one from the Library.</p>;
  const rowIds = project.rows().map((r) => r.id);
  const rowName = `TRACK ${rowIds.indexOf(ws.row ?? '') + 1}`;
  const info = project.patternInfo(t.id, pat);
  const pats = project.patternList(t.id);
  const choose = (p: string | null) => ws.row && project.setCell(ws.row, t.id, p);
  const patternBar = (
    <div className="fwm-rtb fwm-patbar">
      <span className="fwm-patbar__what">{t.name} · {rowName} plays</span>
      <span className="fwm-picks" role="group" aria-label={`Pattern ${t.name} plays in ${rowName}`}>
        <button type="button" className="fwm-pk" aria-pressed={!info} aria-label="Silent" title={`${t.name} is silent in ${rowName}`} onClick={() => choose(null)}>—</button>
        {pats.map((p) => (
          <button key={p.id} type="button" className="fwm-pk" aria-pressed={p.id === pat} onClick={() => choose(p.id)}>{p.name}</button>
        ))}
        <button type="button" className="fwm-pk" title="New empty pattern" onClick={() => choose(project.addPattern(t.id))}>+ New</button>
        <button type="button" className="fwm-pk" disabled={!pat} title="Copy this pattern into a new one"
          onClick={() => pat && choose(project.addPattern(t.id, pat))}>⧉ Copy</button>
      </span>
    </div>
  );
  if (!pat || !info)
    return (
      <div className="fwm-rl">
        {patternBar}
        <p className="fwm-empty">{t.name} is silent in {rowName}. Pick a pattern above, or + New.</p>
      </div>
    );
  // Drum machines get the drum grid (one row per pad) instead of the piano roll.
  if (entry.layout === 'pads')
    return (
      <div className="fwm-rl">
        {patternBar}
        <div className="fwm-rtb">
          <label>
            Name
            <NameInput key={pat} value={info.name} label={`Rename pattern ${info.name}`} maxLength={24} className="fwm-pname"
              onCommit={(v) => project.renamePattern(t.id, pat, v)} />
          </label>
        </div>
        <DrumGrid track={t} pat={pat} />
      </div>
    );
  const L = info.len;
  // The playhead shows only when this pattern is the one playing now.
  const step = playRow && project.cell(playRow, t.id) === pat ? slotStep : -1;
  const { low, high } = entry.roll;
  const key = project.key;
  const keyed = key.scale !== 'chromatic';
  const folded = keyed && ws.fold;
  // Rows top to bottom. Folded: only the pitches in the song key.
  const pitches = Array.from({ length: high - low + 1 }, (_, r) => high - r).filter((m) => !folded || inKey(m, key));
  const rows = pitches.length;
  const rowOf = (m: number) => pitches.indexOf(m);
  const notes = project.notes(t.id, pat);
  const hidden = folded ? notes.filter(([, n]) => n.m >= low && n.m <= high && !inKey(n.m, key)).length : 0;
  const q = QUANT[ws.snap] ?? 1;
  const manifest = entry.manifest;
  const autoSpecs = manifest.params.filter((p) => p.type === 'float' && p.mod);
  const autoSpec = autoSpecs.find((p) => p.id === autoParam) ?? autoSpecs[0]; // none for devices without knobs to automate
  const auto = autoSpec ? project.automation(t.id, pat, autoSpec.id) : [];
  const peerNote = (id: string) => peers.find((p) => p.touch?.track === t.id && p.touch.control === 'note:' + id);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = grid.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(L, ((e.clientX - r.left) / r.width) * L));
    const row = Math.max(0, Math.min(rows - 1, Math.floor((e.clientY - r.top) / RH)));
    return { x, row, m: pitches[row] };
  };
  const touch = (id: string | null) => st.presence.set({ touch: id ? { track: t.id, control: 'note:' + id } : null });

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    try { grid.current!.setPointerCapture(e.pointerId); } catch { /* synthetic pointer (tests) */ }
    const c = at(e);
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-note]');
    project.undoManager.stopCapturing(); // each edit gesture is its own undo step
    if (el) {
      const id = el.dataset.note!;
      const n = notes.find(([k]) => k === id)?.[1];
      if (!n) return;
      const r = el.getBoundingClientRect();
      drag.current = { id, mode: e.clientX > r.right - 9 ? 'len' : 'move', x0: c.x, s0: n.s, m0: n.m, row0: c.row, pitch: n.m };
      setSel(id);
      st.audition(t.id, n.m, true);
    } else {
      const s = q ? Math.min(L - q, Math.floor(c.x / q) * q) : Math.min(L - 0.25, c.x);
      const id = project.addNote(t.id, pat, { s, l: q || 0.25, m: c.m, v: 0.8 });
      if (!id) return;
      drag.current = { id, mode: 'len', x0: c.x, s0: s, m0: c.m, row0: c.row, pitch: c.m };
      setSel(id);
      st.audition(t.id, c.m, true);
    }
    touch(drag.current.id);
    e.preventDefault();
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const c = at(e);
    const n = project.notes(t.id, pat).find(([k]) => k === d.id)?.[1];
    if (!n) return;
    if (d.mode === 'len') {
      const end = q ? Math.ceil(c.x / q) * q : c.x;
      project.updateNote(t.id, pat, d.id, { l: Math.max(q || 1 / 16, end - n.s) });
    } else {
      const dx = c.x - d.x0;
      const s = Math.max(0, Math.min(L - n.l, d.s0 + (q ? Math.round(dx / q) * q : dx)));
      const m = pitches[Math.max(0, Math.min(rows - 1, rowOf(d.m0) + (c.row - d.row0)))];
      project.updateNote(t.id, pat, d.id, { s, m });
      if (m !== d.pitch) {
        st.audition(t.id, d.pitch, false);
        st.audition(t.id, m, true);
        d.pitch = m;
      }
    }
  };
  const up = () => {
    const d = drag.current;
    if (!d) return;
    st.audition(t.id, d.pitch, false);
    drag.current = null;
    touch(null);
    project.resolveOverlaps(t.id, pat, d.id); // the note you just edited wins: no stacked notes
    project.undoManager.stopCapturing();
  };
  const remove = (id: string) => {
    project.deleteNote(t.id, pat, id);
    if (sel === id) setSel(null);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = sel ? notes.find(([k]) => k === sel)?.[1] : null;
    if (!sel || !n) return;
    const g = q || 1 / 16;
    const patch: Partial<Note> | null =
      e.key === 'ArrowLeft' ? (e.shiftKey ? { l: Math.max(g, n.l - g) } : { s: Math.max(0, n.s - g) })
      : e.key === 'ArrowRight' ? (e.shiftKey ? { l: n.l + g } : { s: Math.min(L - n.l, n.s + g) })
      : e.key === 'ArrowUp' ? { m: pitches[Math.max(0, rowOf(n.m) - 1)] ?? n.m }
      : e.key === 'ArrowDown' ? { m: pitches[Math.min(rows - 1, rowOf(n.m) + 1)] ?? n.m }
      : null;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      remove(sel);
      e.preventDefault();
      return;
    }
    if (!patch) return;
    e.preventDefault();
    project.updateNote(t.id, pat, sel, patch);
    project.resolveOverlaps(t.id, pat, sel);
  };

  // Piano keys: press to hear the note, slide to play the next ones.
  const keyAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return pitches[Math.max(0, Math.min(rows - 1, Math.floor((e.clientY - r.top) / RH)))];
  };
  const keyOff = () => {
    if (keyHeld.current != null) st.audition(t.id, keyHeld.current, false);
    keyHeld.current = null;
  };
  const keyCol = {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer (tests) */ }
      keyOff();
      keyHeld.current = keyAt(e);
      st.audition(t.id, keyHeld.current, true);
      e.preventDefault();
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (keyHeld.current == null) return;
      const m = keyAt(e);
      if (m === keyHeld.current) return;
      st.audition(t.id, keyHeld.current, false);
      keyHeld.current = m;
      st.audition(t.id, m, true);
    },
    onPointerUp: keyOff,
    onPointerCancel: keyOff,
    onLostPointerCapture: keyOff,
  };

  // Velocity + automation lanes: drag across steps to draw.
  const lane = (kind: 'vel' | 'auto') => {
    const set = (e: PointerEvent<HTMLDivElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      const i = Math.max(0, Math.min(L - 1, Math.floor(((e.clientX - r.left - 4) / (r.width - 8)) * L)));
      const v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top - 4) / (r.height - 8)));
      if (kind === 'vel') {
        project.transact(() => {
          for (const [id, n] of project.notes(t.id, pat)) if (Math.floor(n.s) === i) project.updateNote(t.id, pat, id, { v: Math.max(0.05, v) });
        });
      } else if (autoSpec) project.setAutomation(t.id, pat, autoSpec.id, i, e.altKey || e.buttons === 2 ? null : v);
    };
    return {
      onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        project.undoManager.stopCapturing();
        set(e);
      },
      onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) set(e);
      },
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    };
  };

  const lenBtn = (v: number) => project.setPatternLen(t.id, pat, v);
  const minW = { minWidth: KEYW + L * SW } as React.CSSProperties;
  return (
    <div className="fwm-rl">
      {patternBar}
      <div className="fwm-rtb">
        <label>
          Name
          <NameInput key={pat} value={info.name} label={`Rename pattern ${info.name}`} maxLength={24} className="fwm-pname"
            onCommit={(v) => project.renamePattern(t.id, pat, v)} />
        </label>
        <span className="fwm-lenbox" role="group" aria-label="Pattern length">
          Length
          <button type="button" className="fwm-tb fwm-tb--xs" aria-label="One step shorter" disabled={L <= 1} onClick={() => lenBtn(L - 1)}>−</button>
          <span className="fwm-lcdt fwm-lcdt--sm" aria-label="Pattern length">{lenLabel(L)}</span>
          <button type="button" className="fwm-tb fwm-tb--xs" aria-label="One step longer" disabled={L >= MAX_LEN} onClick={() => lenBtn(L + 1)}>+</button>
          {[1, 2, 4, 8, 16, 32].map((b) => (
            <button key={b} type="button" className="fwm-tb fwm-tb--xs" aria-pressed={L === b * BAR} onClick={() => lenBtn(b * BAR)}>
              {b} bar{b > 1 ? 's' : ''}
            </button>
          ))}
        </span>
        <span className="fwm-grp" role="group" aria-label={`${t.name} direction`}>
          {DIRS.map(([d, icon, label]) => (
            <button key={d} type="button" className="fwm-tb fwm-tb--xs" aria-pressed={t.seq.dir === d} aria-label={label} title={`${label} (${t.name})`}
              onClick={() => project.setSeq(t.id, { dir: d })}>{icon}</button>
          ))}
        </span>
        <span className="fwm-grp" role="group" aria-label={`${t.name} rate`}>
          {RATES.map(([r, label]) => (
            <button key={r} type="button" className="fwm-tb fwm-tb--xs" aria-pressed={t.seq.rate === r} aria-label={`Rate ${label}`}
              onClick={() => project.setSeq(t.id, { rate: r })}>{label}</button>
          ))}
        </span>
      </div>
      <div className="fwm-rtb">
        <label>
          Snap
          <select value={ws.snap} aria-label="Snap when editing" onChange={(e) => { setWs({ snap: e.target.value }); e.target.blur(); }}>
            {Object.keys(QUANT).map((k) => <option key={k}>{k}</option>)}
          </select>
        </label>
        <label>
          Rec quantize
          <select value={ws.recQuant} aria-label="Quantize when recording" onChange={(e) => { setWs({ recQuant: e.target.value }); e.target.blur(); }}>
            {Object.keys(QUANT).map((k) => <option key={k}>{k}</option>)}
          </select>
        </label>
        <button type="button" className="fwm-tb fwm-tb--xs" aria-pressed={folded} disabled={!keyed}
          title={keyed ? `Show only the notes in ${keyLabel(key)}` : 'Pick a song key first (top bar)'}
          onClick={() => setWs({ fold: !ws.fold })}>
          Fold to key
        </button>
        <button type="button" className="fwm-tb fwm-tb--xs" disabled={!q} onClick={() => project.quantize(t.id, pat, q)}>
          Quantize notes to {ws.snap}
        </button>
        <button type="button" className="fwm-tb fwm-tb--xs"
          onClick={() => {
            project.clearPattern(t.id, pat);
            st.toast(`Cleared ${t.name} · ${info.name}`, { label: 'Undo', run: () => project.undo() });
          }}>
          Clear pattern
        </button>
      </div>
      <div className="fwm-rsc" ref={rollSc} onScroll={(e) => { if (lanesRef.current) lanesRef.current.scrollLeft = e.currentTarget.scrollLeft; }}>
      <div style={minW}>
      <div className="fwm-ruler" style={{ marginLeft: KEYW, gridTemplateColumns: `repeat(${L}, minmax(0, 1fr))` }}>
        {Array.from({ length: L }, (_, i) => (
          <span key={i} className={i % BAR === 0 ? 'is-bar' : ''}>{i % 4 === 0 ? `${Math.floor(i / BAR) + 1}.${(i % BAR) / 4 + 1}` : ''}</span>
        ))}
      </div>
      <div ref={prw} className="fwm-prw" style={{ gridTemplateColumns: `${KEYW}px minmax(0,1fr)` }}>
        <div className="fwm-pkeys" aria-label="Piano keys: press to hear a note" {...keyCol}>
          {pitches.map((m) => {
            const cls = (isBlack(m) ? ' is-b' : '') + (keyed && !inKey(m, key) ? ' is-out' : '') + (isRoot(m, key) ? ' is-root' : '');
            return (
              <div key={m} data-key={m} className={'fwm-pkr' + cls} style={{ height: RH, lineHeight: RH + 'px' }} title={noteName(m)}>
                {folded || m % 12 === 0 || isRoot(m, key) ? noteName(m) : ''}
              </div>
            );
          })}
        </div>
        <div ref={grid} className="fwm-grid" style={{ height: rows * RH, '--fwm-snapw': `${((q || 1) / L) * 100}%`, '--fwm-beatw': `${(4 / L) * 100}%`, '--fwm-barw': `${(BAR / L) * 100}%` } as React.CSSProperties} tabIndex={0} aria-label={`Piano roll, ${t.name}`}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={onKey}
          onDoubleClick={(e) => { const el = (e.target as HTMLElement).closest<HTMLElement>('[data-note]'); if (el) remove(el.dataset.note!); }}
          onContextMenu={(e) => { const el = (e.target as HTMLElement).closest<HTMLElement>('[data-note]'); if (el) { e.preventDefault(); remove(el.dataset.note!); } }}>
          {pitches.map((m) => {
            const cls = (isBlack(m) ? ' is-b' : '') + (m % 12 === 0 ? ' is-c' : '') + (keyed && !inKey(m, key) ? ' is-out' : '') + (isRoot(m, key) ? ' is-root' : '');
            return <div key={m} data-m={m} className={'fwm-gr' + cls} style={{ height: RH }} />;
          })}
          {notes.map(([id, n]) => {
            const row = rowOf(n.m);
            if (row < 0) return null;
            const peer = peerNote(id);
            const playingNow = step >= 0 && Math.floor(n.s) === step;
            return (
              <div key={id} data-note={id} title={`${noteName(n.m)} · start ${n.s} · length ${n.l} · velocity ${Math.round(n.v * 100)}%`}
                className={'fwm-nt' + (sel === id ? ' is-sel' : '') + (peer ? ' is-peer' : '') + (playingNow ? ' is-hit' : '')}
                style={{
                  left: `calc(${(n.s / L) * 100}% + 1px)`, width: `calc(${(n.l / L) * 100}% - 2px)`,
                  top: row * RH + 1, height: RH - 3, opacity: 0.45 + 0.55 * n.v,
                  ...(peer ? { '--fwm-who': peer.user.color } : {}),
                } as React.CSSProperties} />
            );
          })}
          {step >= 0 && <div className="fwm-phd" style={{ left: `${(step / L) * 100}%` }} />}
        </div>
      </div>
      </div>
      </div>
      {hidden > 0 && (
        <p className="fwm-hint" role="status">
          {hidden} note{hidden > 1 ? 's' : ''} outside {keyLabel(key)} hidden while folded.{' '}
          <button type="button" className="fwm-tb fwm-tb--xs" onClick={() => setWs({ fold: false })}>Unfold</button>
        </p>
      )}
      <div className="fwm-rsc" ref={lanesRef} onScroll={(e) => { if (rollSc.current) rollSc.current.scrollLeft = e.currentTarget.scrollLeft; }}>
      <div style={minW}>
      <div className="fwm-lanehead" style={{ marginLeft: KEYW }}>Velocity</div>
      <div className="fwm-abars" style={{ marginLeft: KEYW, gridTemplateColumns: `repeat(${L}, minmax(0, 1fr))` }} aria-label="Velocity lane" {...lane('vel')}>
        {Array.from({ length: L }, (_, i) => {
          const n = notes.find(([, x]) => Math.floor(x.s) === i)?.[1];
          return <div key={i} className="fwm-ab is-vel"><i style={{ height: `${n ? Math.round(n.v * 100) : 0}%` }} /></div>;
        })}
      </div>
{autoSpec && (<>
      <div className="fwm-lanehead" style={{ marginLeft: KEYW }}>
        <label>
          Automation
          <select value={autoSpec.id} aria-label="Automated parameter" onChange={(e) => { setAutoParam(e.target.value); e.target.blur(); }}>
            {autoSpecs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id.includes('.') ? `${p.id.startsWith('amp') ? 'Amp' : 'Filter'} ${p.label}` : p.label}
                {project.automation(t.id, pat, p.id).some((v) => v != null) ? ' •' : ''}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="fwm-tb fwm-tb--xs" onClick={() => project.clearAutomation(t.id, pat, autoSpec.id)}>Clear lane</button>
      </div>
      <div className="fwm-abars" style={{ marginLeft: KEYW, gridTemplateColumns: `repeat(${L}, minmax(0, 1fr))` }} aria-label={`Automation lane for ${autoSpec.label}`} {...lane('auto')}>
        {auto.map((v, i) => (
          <div key={i} className={'fwm-ab' + (step === i ? ' is-now' : '')} title={v == null ? 'No automation' : formatParam(autoSpec, v)}>
            {v != null && <i style={{ height: `${Math.round(v * 100)}%` }} />}
          </div>
        ))}
      </div>
</>)}
      </div>
      </div>
      <p className="fwm-hint">
        Pick, name and size the pattern at the top (it plays wherever it is used in the song) · long patterns scroll
        sideways · press a piano key to hear it · grid lines follow Snap · click to add, drag right for length · drag to move or change pitch · drag the right edge to resize · double-click to
        delete · notes on the same pitch never overlap (the one you edit wins) · arrows nudge the selected note (Shift = length) · Snap Off places notes between steps · lanes: drag to draw,
        Alt-drag or right-drag erases automation · with Rec + Play, knob moves are recorded here.
      </p>
    </div>
  );
}
