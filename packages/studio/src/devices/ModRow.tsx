// Modulation, as on Basalt, for the poly synths (Opal, Quartz): an LFO wave, three Assign buttons (press
// one, then click the knob it should move), live lights, and the list of routes with their depth.
import { useEffect, useState, type ReactNode } from 'react';
import type { ModSourceId } from '@fwm/engine';
import { useEngine } from '../engine/EngineProvider';
import { useDeviceState, useModSources } from '../engine/useDeviceSync';
import { usePrimitives } from '../theme/Theme';
import type { ParamCtx } from './basalt/Basalt';

/** Assign mode: which source is waiting for a knob click (Esc or a click elsewhere cancels). */
export function useAssign() {
  const [assign, setAssign] = useState<ModSourceId | null>(null);
  useEffect(() => {
    if (!assign) return;
    const end = (e: Event) => {
      if ((e.target as HTMLElement).closest('.fwm-target.is-target, .fwm-btn--assign')) return;
      setAssign(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAssign(null);
    document.addEventListener('pointerdown', end, true);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', end, true);
      document.removeEventListener('keydown', esc);
    };
  }, [assign]);
  return [assign, setAssign] as const;
}

export function ModRow({ ctx, labels, hint, children }: { ctx: ParamCtx; labels: Record<ModSourceId, string>; hint: string; children?: ReactNode }) {
  const P = usePrimitives();
  const { engine, status } = useEngine();
  const { store, host, slot, assign, setAssign } = ctx;
  const state = useDeviceState(store);
  const m = store.manifest;
  const mods = useModSources(status === 'on' ? engine : null, slot);
  // only the sources this device has (Geode: Motion and the Breath envelope)
  const SRC = (Object.entries(labels) as [ModSourceId, string][]).filter(([id]) => !m.modSources?.length || m.modSources.some((s) => s.id === id));
  const lwave = m.params.find((p) => p.id === 'lwave');
  const set = (id: string, v: number) => {
    store.setParam(id, v);
    host?.paramChanged?.(id, v);
  };
  const SRC_LABEL = labels;
  return (
    <>
      <div className="fwm-brk">Modulation</div>
      <div className="fwm-opal__mod">
        {lwave?.options && (
          <div className="fwm-seg" role="group" aria-label="LFO wave">
            {lwave.options.map((w, i) => (
              <P.Button key={w} variant="seg" label={`LFO ${w}`} pressed={Math.round(state.params.lwave ?? 0) === i} onPress={() => set('lwave', i)}>{w}</P.Button>
            ))}
          </div>
        )}
        {children}
        {SRC.map(([id, label]) => (
          <span key={id} className="fwm-opal__src">
            <span className="fwm-led" style={{ opacity: mods ? 0.25 + 0.75 * (id === 'lfo' ? (mods[0] + 1) / 2 : mods[id === 'amp' ? 1 : 2]) : 0.6 }} />
            <P.Button variant="assign" pressed={assign === id} label={`Assign ${label}`} onPress={() => setAssign(assign === id ? null : id)} />
          </span>
        ))}
        <p className="fwm-silk fwm-opal__hint">{assign ? `Now click the knob ${SRC_LABEL[assign]} should move (Esc: cancel).` : hint}</p>
        <ul className="fwm-mods">
          {state.routes.map((r, i) => {
            const name = `${SRC_LABEL[r.src]} → ${m.params.find((p) => p.id === r.target)?.label ?? r.target}`;
            return (
              <li key={r.src + r.target}>
                <span>{name}</span>
                <input type="range" min={-100} max={100} value={Math.round(r.depth * 100)} aria-label={`Depth of ${name}`}
                  onChange={(e) => store.setRouteDepth(i, Number(e.target.value) / 100)}
                  onPointerDown={() => host?.touch(`route:${r.src}>${r.target}`)} onPointerUp={() => host?.touch(null)} />
                <button type="button" aria-label={`Remove ${name}`} onClick={() => store.removeRoute(i)}>×</button>
              </li>
            );
          })}
        </ul>
      </div>

    </>
  );
}
