// The window layout: 2×2 resizable panels, each showing any view. It belongs to this user only
// (saved in their browser), so rearranging never changes anyone else's screen.
import { useCallback, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { Peer } from '../collab/presence';
import { SCENES } from '../model/project';
import { useStudio } from './context';
import { DeviceView } from './views/DeviceView';
import { LibraryView } from './views/LibraryView';
import { RollView } from './views/RollView';
import { SeqView } from './views/SeqView';

const VIEWS = { seq: 'Main sequencer', roll: 'Piano roll', device: 'Device', library: 'Library' } as const;
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
            <PaneContext view={v} />
            <button type="button" className="fwm-ib" aria-pressed={L.max === i} aria-label={L.max === i ? 'Restore panels' : 'Maximise panel'}
              onClick={() => save({ ...L, max: L.max === i ? -1 : i })}>
              {L.max === i ? '⤡' : '⤢'}
            </button>
          </header>
          <div className={'fwm-pb' + (v === 'seq' || v === 'roll' ? ' is-blue' : '')}>
            {v === 'seq' && <SeqView peers={peers} />}
            {v === 'roll' && <RollView peers={peers} />}
            {v === 'device' && <DeviceView peers={peers} />}
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
  const { project, ws } = useStudio();
  const t = ws.track ? project.track(ws.track) : null;
  const text =
    view === 'roll' || view === 'device'
      ? t ? `${t.name} · scene ${SCENES[ws.scene]}` : 'No track yet'
      : view === 'seq'
        ? `${project.trackIds().length} tracks · scene ${SCENES[ws.scene]}`
        : 'Bring a device in to make a track';
  return <span className="fwm-ctx">{text}</span>;
}
