// The preset row every instrument shares: ‹ screen › and Save. The list is the factory presets, then
// "Mine" (this person's saved sounds, kept by the host or in this browser; never in the shared song).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { UserPreset } from '../collab/types';
import type { DeviceStore } from '../model/deviceStore';
import { defaultPresetCache, type PresetCache } from '../model/myPresets';
import { usePrimitives } from '../theme/Theme';
import type { DeviceHost } from './basalt/Basalt';

export interface PresetBarProps {
  /** Instrument id ('basalt', 'geode'…): presets are kept per instrument. */
  device: string;
  store: DeviceStore;
  host?: DeviceHost;
  /** Factory presets (names), the one loaded now, and whether the sound differs from it. */
  factory: { name: string }[];
  factoryIx: number;
  edited: boolean;
  loadFactory(i: number): void;
  /** Params a preset never saves or changes (Geode: Mica's place, the tape trim). */
  keep?: string[];
  /** What a preset is called on this instrument (buttons' labels). */
  noun?: string;
  editedClass?: string;
}

const near = (a: Record<string, number>, b: Record<string, number>, ids: string[]) => ids.every((id) => Math.abs((a[id] ?? 0) - (b[id] ?? 0)) < 1e-6);

export function PresetBar({ device, store, host, factory, factoryIx, edited, loadFactory, keep = [], noun = 'sound', editedClass = 'fwm-garnet__edited' }: PresetBarProps) {
  const P = usePrimitives();
  const cache: PresetCache = host?.myPresets ?? defaultPresetCache();
  useSyncExternalStore(cache.subscribe, cache.getVersion, cache.getVersion);
  const mine = cache.get(device);
  const [cur, setCur] = useState<string | null>(null); // the saved preset loaded now (this person only)
  const sel = cur ? mine.find((p) => p.id === cur) ?? null : null;
  // someone (or this person) picked a factory preset: no saved one is loaded any more
  const lastIx = useRef(factoryIx);
  useEffect(() => {
    if (lastIx.current !== factoryIx) setCur(null);
    lastIx.current = factoryIx;
  }, [factoryIx]);

  const state = store.getState();
  const ids = sel ? Object.keys(sel.params) : [];
  const selEdited = !!sel && !near(state.params, sel.params, ids);

  const F = factory.length, n = F + mine.length;
  const at = sel ? F + mine.indexOf(sel) : factoryIx;
  const loadMine = (p: UserPreset) => {
    const now = store.getState().params;
    const kept = Object.fromEntries(keep.filter((k) => now[k] != null).map((k) => [k, now[k]]));
    store.load({ params: { ...p.params, ...kept }, routes: p.routes }, store.getState().preset);
    setCur(p.id);
  };
  const go = (i: number) => {
    const k = ((i % n) + n) % n;
    if (k < F) {
      setCur(null);
      loadFactory(k);
    } else loadMine(mine[k - F]);
  };

  // ---- the Save pop-up ----
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener('pointerdown', away, true);
    return () => removeEventListener('pointerdown', away, true);
  }, [open]);
  const snapshot = () => {
    const s = store.getState();
    const params = Object.fromEntries(Object.entries(s.params).filter(([k]) => !keep.includes(k)));
    return { params, routes: [...s.routes] };
  };
  const save = async (id?: string) => {
    const nm = name.trim() || 'My ' + noun;
    const p = await cache.save(device, { id, name: nm.slice(0, 32), ...snapshot() });
    setCur(p.id);
    setOpen(false);
  };
  const del = async (p: UserPreset) => {
    await cache.remove(device, p.id);
    setCur(null);
    setOpen(false);
  };
  const openSave = () => {
    setName(sel ? sel.name : `${factory[factoryIx]?.name ?? 'My ' + noun} (mine)`);
    setOpen(!open);
  };

  return (
    <>
      <P.Button variant="hw" label={`Previous ${noun}`} onPress={() => go(at - 1)}>‹</P.Button>
      <P.Screen variant="preset">
        {sel ? `★ ${sel.name}` : `${String(factoryIx + 1).padStart(2, '0')} ${factory[factoryIx]?.name ?? ''}`}
        {(sel ? selEdited : edited) && <small className={editedClass}> edited</small>}
      </P.Screen>
      <P.Button variant="hw" label={`Next ${noun}`} onPress={() => go(at + 1)}>›</P.Button>
      {!host?.preview && (
        <div className="fwm-psave" ref={box}>
          <P.Button variant="hw" label={`Save this ${noun}`} pressed={open} onPress={openSave}>Save</P.Button>
          {open && (
            <form className="fwm-psave__pop" role="dialog" aria-label={`Save this ${noun}`}
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                e.stopPropagation(); // typing a name never plays notes
              }}>
              <label>
                Name
                <input autoFocus value={name} maxLength={32} aria-label="Preset name" onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
              </label>
              <div className="fwm-psave__row">
                <button type="submit">Save as new</button>
                {sel && <button type="button" onClick={() => void save(sel.id)}>Replace “{sel.name}”</button>}
              </div>
              {mine.length > 0 && (
                <ul className="fwm-psave__list" aria-label="My presets">
                  {mine.map((p) => (
                    <li key={p.id} className={p.id === cur ? 'is-on' : ''}>
                      <button type="button" onClick={() => { loadMine(p); setOpen(false); }}>★ {p.name}</button>
                      <button type="button" aria-label={`Delete ${p.name}`} title="Delete" onClick={() => void del(p)}>✕</button>
                    </li>
                  ))}
                </ul>
              )}
              <small>{cache.where === 'host' ? 'Kept with your account.' : 'Kept in this browser.'} Only you see your presets.</small>
            </form>
          )}
        </div>
      )}
    </>
  );
}
