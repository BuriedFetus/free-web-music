// The Library is the manual: a picture of every instrument (the real panel, not playable here) to click,
// then a few pages per instrument with numbered spots on the panel. Adding instruments to the song is
// done from the Device panel (+ Add instrument), or with the Add button on an instrument's pages.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DeviceHost } from '../../devices/basalt/Basalt';
import { LIBRARY, type DeviceEntry } from '../../devices/registry';
import { createDeviceStore } from '../../model/deviceStore';
import { addInstrument } from '../AddInstrument';
import { useStudio } from '../context';
import { MANUAL, locate, type Chapter } from '../manual';

/** The panels here are pictures: notes go nowhere, nothing reaches the engine (slot -1). */
const PREVIEW_HOST: DeviceHost = {
  noteOn: () => {},
  noteOff: () => {},
  presenceFor: () => [],
  peerHeld: [],
  people: [{ userId: 'me', name: 'You', color: 'var(--fwm-me)' }],
  touch: () => {},
  subtitle: 'manual',
  sends: { rev: 0.2, dly: 0.1, set: () => {} },
};

function Picture({ d }: { d: DeviceEntry }) {
  const store = useMemo(() => createDeviceStore(d.manifest!, d.presets?.[0]), [d]);
  const C = d.Component!;
  return (
    <div className="fwm-man__pic" ref={(el) => el?.setAttribute('inert', '')}>
      <C store={store} host={PREVIEW_HOST} slot={-1} computerKeys={false} />
    </div>
  );
}

export function LibraryView() {
  const [open, setOpen] = useState<{ device: string; page: number } | null>(null);
  const ch = open ? MANUAL.find((c) => c.device === open.device) : null;
  if (open && ch) return <ChapterView ch={ch} page={open.page} setPage={(page) => setOpen({ device: open.device, page })} back={() => setOpen(null)} />;
  return (
    <div className="fwm-man">
      <h2>The manual</h2>
      <p className="fwm-man__lead">Click an instrument to see how it works. To put one in your song, use <b>+ Add instrument</b> in the Device panel.</p>
      <div className="fwm-man__grid">
        {LIBRARY.map((d) => {
          const c = MANUAL.find((x) => x.device === d.id);
          return d.available && d.Component && c ? (
            <button key={d.id} type="button" className="fwm-man__card" aria-label={`How ${d.name} works`} onClick={() => setOpen({ device: d.id, page: 0 })}>
              <span className="fwm-man__shot"><Picture d={d} /></span>
              <span className="fwm-man__name"><b>{d.name}</b> {d.kind}</span>
              <span className="fwm-man__pages">{c.pages.length} pages ›</span>
            </button>
          ) : (
            <div key={d.id} className="fwm-man__card is-soon">
              <span className="fwm-man__shot fwm-man__shot--soon"><i className="fwm-thumb" data-device={d.id}>{d.name.toUpperCase()}</i></span>
              <span className="fwm-man__name"><b>{d.name}</b> {d.kind}</span>
              <span className="fwm-man__pages">Coming in {d.soon}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChapterView({ ch, page, setPage, back }: { ch: Chapter; page: number; setPage(p: number): void; back(): void }) {
  const st = useStudio();
  const d = LIBRARY.find((x) => x.id === ch.device)!;
  const pg = ch.pages[Math.min(page, ch.pages.length - 1)];
  const [spot, setSpot] = useState(0);
  useEffect(() => setSpot(0), [page, ch.device]);
  const stage = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<({ x: number; y: number } | null)[]>([]);
  // spots follow the panel as it lays out (and as the panel resizes)
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const place = () => setPos(pg.spots.map((s) => locate(el, el, s.at)));
    place();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    ro?.observe(el);
    const t = setInterval(place, 700);
    return () => {
      ro?.disconnect();
      clearInterval(t);
    };
  }, [pg]);
  const n = ch.pages.length;
  return (
    <div className="fwm-man fwm-man--ch">
      <nav className="fwm-man__nav" aria-label={`${d.name} manual`}>
        <button type="button" className="fwm-btn-ui fwm-btn-ui--sm" onClick={back}>‹ All instruments</button>
        <b>{d.name}</b>
        <div className="fwm-man__tabs" role="tablist" aria-label="Pages">
          {ch.pages.map((p, i) => (
            <button key={p.title} type="button" role="tab" aria-selected={i === page} onClick={() => setPage(i)}>{i + 1}. {p.title}</button>
          ))}
        </div>
        <button type="button" className="fwm-btn-ui fwm-btn-ui--sm fwm-man__add" onClick={() => addInstrument(st, d)}>+ Add {d.name} to the song</button>
      </nav>
      <div className="fwm-man__body">
        <div className="fwm-man__stage" ref={stage}>
          <Picture d={d} />
          {pg.spots.map((s, i) =>
            pos[i] ? (
              <button key={s.at + i} type="button" className={'fwm-man__spot' + (i === spot ? ' is-on' : '')} style={{ left: pos[i]!.x, top: pos[i]!.y }}
                aria-label={`${i + 1}: ${s.title}`} aria-pressed={i === spot} onClick={() => setSpot(i)}>
                {i + 1}
              </button>
            ) : null,
          )}
        </div>
        <article className="fwm-man__text">
          <h3>{pg.title}</h3>
          {pg.body.map((t, i) => <p key={i}>{t}</p>)}
          <ol className="fwm-man__notes">
            {pg.spots.map((s, i) => (
              <li key={s.at + i} className={i === spot ? 'is-on' : ''} onClick={() => setSpot(i)}>
                <b>{s.title}</b>
                {i === spot && <span>{s.text}</span>}
              </li>
            ))}
          </ol>
          <div className="fwm-man__pager">
            <button type="button" className="fwm-btn-ui fwm-btn-ui--sm" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Back</button>
            <span>Page {page + 1} of {n}</span>
            <button type="button" className="fwm-btn-ui fwm-btn-ui--sm" disabled={page >= n - 1} onClick={() => setPage(page + 1)}>Next ›</button>
          </div>
        </article>
      </div>
    </div>
  );
}
