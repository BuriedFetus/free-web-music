// "+ Add" in the Device panel's header: pick an instrument, it becomes a new track and shows right away.
// The Song arrangement's own "+ Add instrument" brings the Device panel forward and opens this menu
// (askAddInstrument), and the new instrument then plays P1 in the TRACK selected there.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { LIBRARY, type DeviceEntry } from '../devices/registry';
import { useStudio, type StudioCtx } from './context';

/** Add `d` as a new track (its first sound), select it, say so. With `row`: its P1 plays in that TRACK. */
export function addInstrument(st: Pick<StudioCtx, 'project' | 'setWs' | 'toast'>, d: DeviceEntry, row?: string | null) {
  if (!d.available || !d.manifest) return;
  const id = st.project.addTrack(d.manifest, d.presets?.[0], 0, row);
  st.setWs({ track: id });
  st.toast(row ? `${st.project.track(id)?.name} added, playing P1 in this TRACK` : `${st.project.track(id)?.name} added as a new track`);
}

/** A request from the Song arrangement, waiting for the Device panel's menu (it may not be on screen yet). */
let asked: { row: string | null } | null = null;
const ASK = 'fwm:add-instrument';
/** Bring the Device panel forward and open its + Add instrument menu; the pick plays in `row`. */
export function askAddInstrument(row: string | null) {
  asked = { row };
  dispatchEvent(new CustomEvent('fwm:open-view', { detail: 'device' }));
  dispatchEvent(new Event(ASK));
}

export function AddInstrument() {
  const st = useStudio();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<CSSProperties>({});
  const [row, setRow] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const take = () => {
      if (!asked) return;
      setRow(asked.row);
      asked = null;
      setOpen(true);
    };
    take(); // the panel just came on screen for this request
    addEventListener(ASK, take);
    return () => removeEventListener(ASK, take);
  }, []);
  useEffect(() => {
    if (!open) setRow(undefined);
  }, [open]);
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
      <button ref={btn} type="button" className="fwm-addinst" aria-label="+ Add instrument" title="Add an instrument" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        + Add<span className="fwm-long"> instrument</span>
      </button>
      {open && (
        <div ref={menu} className="fwm-addmenu" role="menu" aria-label="Add an instrument" style={at}>
          {cats.map((c) => (
            <div key={c} className="fwm-addmenu__cat">
              <span>{c}</span>
              {LIBRARY.filter((d) => d.category === c).map((d) => (
                <button key={d.id} type="button" role="menuitem" disabled={!d.available} aria-label={`Add ${d.name}`}
                  onClick={() => {
                    addInstrument(st, d, row);
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

/** "Remove" beside it: takes the instrument the Device panel shows out of the song (Undo brings it back). */
export function RemoveInstrument() {
  const { project, ws, toast } = useStudio();
  const t = ws.track ? project.track(ws.track) : null;
  if (!t) return null;
  return (
    <button type="button" className="fwm-rminst" aria-label={`Remove ${t.name} from the song`} title={`Remove ${t.name} from the song (Undo brings it back)`}
      onClick={() => {
        project.removeTrack(t.id);
        toast(`Removed ${t.name}`, { label: 'Undo', run: () => project.undo() });
      }}>
      <span className="fwm-long">Remove</span>
      <span className="fwm-short" aria-hidden="true">✕</span>
    </button>
  );
}
