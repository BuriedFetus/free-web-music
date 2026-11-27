// The window layout: 2×2 resizable panels, each showing any view. It belongs to this user only
// (saved in their browser), so rearranging never changes anyone else's screen.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { Peer } from '../collab/presence';
import { useStudio } from './context';
import { DeviceView } from './views/DeviceView';
import { AddInstrument } from './AddInstrument';
import { LibraryView } from './views/LibraryView';
import { FxView, MixerView } from './views/MixerView';
import { ScopeView } from './views/ScopeView';
import { RollView } from './views/RollView';
import { SeqView } from './views/SeqView';

const VIEWS = { seq: 'Song arrangement', roll: 'Piano roll', device: 'Device', mixer: 'Mixer', fx: 'Effects', scope: 'Scope', library: 'Library' } as const;
type ViewId = keyof typeof VIEWS;

interface Layout {
  views: ViewId[];
  c1: number;
  r1: number;
  max: number;
  /** Panels that take their whole row (the other one in that row hides). */
  wide?: number[];
}
const DEFAULT: Layout = { views: ['seq', 'device', 'roll', 'library'], c1: 48, r1: 46, max: -1, wide: [] };

function load(key: string): Layout {
  try {
    const j = JSON.parse(localStorage.getItem(key) || 'null');
    if (j && Array.isArray(j.views) && j.views.length === 4 && j.views.every((v: string) => v in VIEWS)) return { ...DEFAULT, ...j };
  } catch {
    /* ignore */
  }
  return DEFAULT;
}

export function WorkspaceGrid({ userId, peers }: { userId: string; peers: Peer[] }) {
  const key = `fwm.layout.${userId}`;
  const [L, setL] = useState<Layout>(() => load(key));
  const save = useCallback(
    (next: Layout) => {
      setL(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  const grid = useRef<HTMLDivElement>(null);
  const drag = useRef<'v' | 'h' | null>(null);
  const live = useRef(L);
  live.current = L;
  // Tab zooms: out from a full-size panel to all four, then back into the same one. With nothing to go back
  // to, Tab brings the panel under the mouse to full size. Only while the mouse is over the panels (and not
  // typing), so Tab still moves the keyboard focus everywhere else.
  const over = useRef(-1);
  const back = useRef(-1);
  const [zoom, setZoom] = useState<'in' | 'out' | null>(null);
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || over.current < 0) return;
      if ((e.target as HTMLElement).closest?.('input:not([type=range]), textarea, select, [contenteditable=true]')) return;
      e.preventDefault();
      if (e.repeat) return;
      const cur = live.current;
      if (cur.max >= 0) {
        back.current = cur.max;
        save({ ...cur, max: -1 });
        setZoom('out');
      } else {
        const i = back.current >= 0 ? back.current : over.current;
        back.current = -1;
        save({ ...cur, max: i });
        setZoom('in');
      }
    };
    addEventListener('keydown', kd, true);
    // something asks for a view (double-click a pattern → the Piano roll): show it, bring it forward
    const openView = (e: Event) => {
      const v = (e as CustomEvent<ViewId>).detail;
      if (!(v in VIEWS)) return;
      const cur = live.current;
      let i = cur.views.indexOf(v);
      const views = cur.views.slice();
      if (i < 0) {
        // put it in a panel that is not the song or the device (the last such one)
        i = [3, 2, 1, 0].find((k) => views[k] !== 'seq' && views[k] !== 'device') ?? 2;
        views[i] = v;
      }
      const wide = (cur.wide ?? []).filter((k) => k !== (i ^ 1)); // a neighbour taking the whole row would hide it
      if (cur.max >= 0 && cur.max !== i) back.current = cur.max; // Tab goes back to where you were
      save({ ...cur, views, wide, max: cur.max >= 0 ? i : -1 });
    };
    addEventListener('fwm:open-view', openView);
    return () => {
      removeEventListener('keydown', kd, true);
      removeEventListener('fwm:open-view', openView);
    };
  }, [save]);

  const splitDown = (which: 'v' | 'h') => (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = which;
  };
  const splitMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !grid.current) return;
    const r = grid.current.getBoundingClientRect();
    const cur = live.current;
    if (drag.current === 'v') setL({ ...cur, c1: Math.round(Math.max(22, Math.min(78, ((e.clientX - r.left) / r.width) * 100))) });
    else setL({ ...cur, r1: Math.round(Math.max(18, Math.min(82, ((e.clientY - r.top) / r.height) * 100))) });
  };
  const splitUp = () => {
    if (drag.current) save(live.current);
    drag.current = null;
  };

  return (
    <div ref={grid} className={'fwm-ws' + (L.max >= 0 ? ' is-max' : '') + (L.wide?.some((k) => k < 2) ? ' is-wide-top' : '') + (L.wide?.some((k) => k >= 2) ? ' is-wide-bot' : '') + (zoom ? ' is-zoom-' + zoom : '')} onAnimationEnd={() => setZoom(null)}
      onPointerLeave={() => (over.current = -1)} style={{ '--c1': L.c1 + '%', '--r1': L.r1 + '%' } as CSSProperties}>
      {L.views.map((v, i) => (
        <section key={i} className={'fwm-pane' + (L.max === i ? ' is-maxed' : '') + (L.wide?.includes(i) ? ' is-wide' : '') + (L.wide?.includes(i ^ 1) ? ' is-hid' : '')} data-i={i} aria-label={VIEWS[v]}
          onPointerMove={() => (over.current = i)} onPointerEnter={() => (over.current = i)}>
          <header className="fwm-ph">
            <select value={v} aria-label={`Panel ${i + 1} view`}
              onChange={(e) => {
                const views = L.views.slice();
                views[i] = e.target.value as ViewId;
                // Effects brings the Mixer with it: beside it in the same row, unless a Mixer is already open.
                const bring = views[i] === 'fx' && !views.includes('mixer');
                if (bring) views[i ^ 1] = 'mixer';
                save({ ...L, views, max: bring ? -1 : L.max }); // un-maximise so both show
                e.target.blur();
              }}>
              {Object.entries(VIEWS).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
            {v === 'roll' || v === 'device' ? <TrackTabs peers={peers} /> : <PaneContext view={v} />}
            {v === 'device' && <AddInstrument />}
            <button type="button" className="fwm-ib" aria-pressed={!!L.wide?.includes(i)} aria-label={L.wide?.includes(i) ? 'Half width' : 'Whole row'}
              title={L.wide?.includes(i) ? 'Back to half the width' : `Take the whole row (hides ${VIEWS[L.views[i ^ 1]]})`}
              onClick={() => {
                const w = (L.wide ?? []).filter((k) => k !== i && k !== (i ^ 1));
                save({ ...L, wide: L.wide?.includes(i) ? w : [...w, i] });
              }}>
              ⟷
            </button>
            <button type="button" className="fwm-ib" aria-pressed={L.max === i} aria-label={L.max === i ? 'Restore panels' : 'Maximise panel'} title={(L.max === i ? 'Show all panels' : 'Full size') + ' (Tab)'}
              onClick={() => save({ ...L, max: L.max === i ? -1 : i })}>
              {L.max === i ? '⤡' : '⤢'}
            </button>
          </header>
          <div className={'fwm-pb' + (v === 'seq' || v === 'roll' || v === 'mixer' || v === 'fx' || v === 'scope' ? ' is-blue' : '')}>
            {v === 'seq' && <SeqView peers={peers} />}
            {v === 'roll' && <RollView peers={peers} />}
            {v === 'device' && <DeviceView peers={peers} />}
            {v === 'mixer' && <MixerView peers={peers} expanded={L.max === i} onExpand={() => save({ ...L, max: i })} />}
            {v === 'fx' && <FxView peers={peers} />}
            {v === 'scope' && <ScopeView />}
            {v === 'library' && <LibraryView />}
          </div>
        </section>
      ))}
      <div className="fwm-split fwm-split--v" role="separator" aria-orientation="vertical" aria-label="Resize columns"
        onPointerDown={splitDown('v')} onPointerMove={splitMove} onPointerUp={splitUp} onPointerCancel={splitUp} />
      <div className="fwm-split fwm-split--h" role="separator" aria-orientation="horizontal" aria-label="Resize rows"
        onPointerDown={splitDown('h')} onPointerMove={splitMove} onPointerUp={splitUp} onPointerCancel={splitUp} />
    </div>
  );
}

function PaneContext({ view }: { view: ViewId }) {
  const { project } = useStudio();
  const n = project.trackIds().length;
  const r = project.rows().length;
  const text =
    view === 'seq'
      ? `${n} instrument${n === 1 ? '' : 's'} · ${r} TRACK${r === 1 ? '' : 's'}`
      : view === 'mixer'
        ? `${n} channel${n === 1 ? '' : 's'} + master`
        : view === 'scope'
          ? 'What you hear, drawn live'
        : view === 'fx'
          ? 'Instruments ➜ effects ➜ master'
        : 'The manual: click an instrument to see how it works';
  return <span className="fwm-ctx">{text}</span>;
}

/** One tab per track, in the Device and Piano roll headers: pick which track this view shows. */
function TrackTabs({ peers }: { peers: Peer[] }) {
  const { project, ws, setWs } = useStudio();
  const tracks = project.tracks();
  if (!tracks.length) return <span className="fwm-ctx">No track yet</span>;
  return (
    <div className="fwm-ttabs" role="tablist" aria-label="Track">
      {tracks.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === ws.track} data-device={t.device}
          className="fwm-ttab" title={`Show ${t.name}`} onClick={() => setWs({ track: t.id })}>
          {t.name}
          {peers.filter((p) => p.track === t.id).map((p) => (
            <span key={p.clientId} className="fwm-av fwm-av--xs" style={{ background: p.user.color }} title={`${p.user.name} is here`}>
              {p.user.name[0]}
            </span>
          ))}
        </button>
      ))}
    </div>
  );
}
