// The window layout: 2×2 resizable panels, each showing any view. It belongs to this user only
// (saved in their browser), so rearranging never changes anyone else's screen.
import { useCallback, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { Peer } from '../collab/presence';
import { useStudio } from './context';
import { DeviceView } from './views/DeviceView';
import { LibraryView } from './views/LibraryView';
import { MixerView } from './views/MixerView';
import { RollView } from './views/RollView';
import { SeqView } from './views/SeqView';

const VIEWS = { seq: 'Song arrangement', roll: 'Piano roll', device: 'Device', mixer: 'Mixer', library: 'Library' } as const;
type ViewId = keyof typeof VIEWS;

interface Layout {
  views: ViewId[];
  c1: number;
  r1: number;
  max: number;
}
const DEFAULT: Layout = { views: ['seq', 'device', 'roll', 'library'], c1: 48, r1: 46, max: -1 };

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
    <div ref={grid} className={'fwm-ws' + (L.max >= 0 ? ' is-max' : '')} style={{ '--c1': L.c1 + '%', '--r1': L.r1 + '%' } as CSSProperties}>
      {L.views.map((v, i) => (
        <section key={i} className={'fwm-pane' + (L.max === i ? ' is-maxed' : '')} data-i={i} aria-label={VIEWS[v]}>
          <header className="fwm-ph">
            <select value={v} aria-label={`Panel ${i + 1} view`}
              onChange={(e) => {
                const views = L.views.slice();
                views[i] = e.target.value as ViewId;
                save({ ...L, views });
                e.target.blur();
              }}>
              {Object.entries(VIEWS).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
            {v === 'roll' || v === 'device' ? <TrackTabs peers={peers} /> : <PaneContext view={v} />}
            <button type="button" className="fwm-ib" aria-pressed={L.max === i} aria-label={L.max === i ? 'Restore panels' : 'Maximise panel'}
              onClick={() => save({ ...L, max: L.max === i ? -1 : i })}>
              {L.max === i ? '⤡' : '⤢'}
            </button>
          </header>
          <div className={'fwm-pb' + (v === 'seq' || v === 'roll' || v === 'mixer' ? ' is-blue' : '')}>
            {v === 'seq' && <SeqView peers={peers} />}
            {v === 'roll' && <RollView peers={peers} />}
            {v === 'device' && <DeviceView peers={peers} />}
            {v === 'mixer' && <MixerView peers={peers} />}
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
        : 'Bring a device in to add an instrument';
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
