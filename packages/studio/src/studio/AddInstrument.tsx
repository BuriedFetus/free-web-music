// "+ Add" in the Device panel's header: pick an instrument, it becomes a new track and shows right away.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { LIBRARY, type DeviceEntry } from '../devices/registry';
import { useStudio, type StudioCtx } from './context';

/** Add `d` as a new track (its first sound), select it, say so. */
export function addInstrument(st: Pick<StudioCtx, 'project' | 'setWs' | 'toast'>, d: DeviceEntry) {
  if (!d.available || !d.manifest) return;
  const id = st.project.addTrack(d.manifest, d.presets?.[0], 0);
  st.setWs({ track: id });
  st.toast(`${st.project.track(id)?.name} added as a new track`);
}

export function AddInstrument() {
  const st = useStudio();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<CSSProperties>({});
  useEffect(() => {
    if (!open) return;
    const r = btn.current!.getBoundingClientRect();
    const right = innerWidth - r.right;
    setAt({ top: r.bottom + 6, right: Math.max(8, right) });
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    addEventListener('pointerdown', away, true);
    addEventListener('keydown', esc);
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      removeEventListener('pointerdown', away, true);
      removeEventListener('keydown', esc);
    };
  }, [open]);
  const cats = [...new Set(LIBRARY.map((d) => d.category))];
  return (
    <>
      <button ref={btn} type="button" className="fwm-addinst" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        + Add instrument
      </button>
      {open && (
        <div ref={menu} className="fwm-addmenu" role="menu" aria-label="Add an instrument" style={at}>
          {cats.map((c) => (
            <div key={c} className="fwm-addmenu__cat">
              <span>{c}</span>
              {LIBRARY.filter((d) => d.category === c).map((d) => (
                <button key={d.id} type="button" role="menuitem" disabled={!d.available} aria-label={`Add ${d.name}`}
                  onClick={() => {
                    addInstrument(st, d);
                    setOpen(false);
                  }}>
                  <i className="fwm-thumb fwm-thumb--sm" data-device={d.id}>{d.name.toUpperCase()}</i>
                  <span><b>{d.name}</b><small>{d.available ? d.kind : `Coming in ${d.soon}`}</small></span>
                </button>
              ))}
            </div>
          ))}
          <p>Each one becomes its own track. Add the same instrument as often as you like. To learn how one works, open the Library (the manual).</p>
        </div>
      )}
    </>
  );
}
