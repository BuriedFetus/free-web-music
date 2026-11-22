import { useMemo } from 'react';
import type { Peer } from '../../collab/presence';
import type { DeviceHost } from '../../devices/basalt/Basalt';
import { deviceEntry } from '../../devices/registry';
import { useEngine } from '../../engine/EngineProvider';
import { useStudio } from '../context';
import { toPresence } from './common';

export function DeviceView({ peers }: { peers: Peer[] }) {
  const st = useStudio();
  const { engine } = useEngine();
  const t = st.ws.track ? st.project.track(st.ws.track) : null;
  const entry = t ? deviceEntry(t.device) : null;
  const store = t && entry?.manifest ? st.project.deviceStore(t.id, entry.manifest) : null;
  const slot = t ? st.slotOf(t.id) : undefined;

  const host = useMemo<DeviceHost | null>(() => {
    if (!t) return null;
    const here = peers.filter((p) => p.track === t.id);
    return {
      noteOn: (n, v) => st.playNote(t.id, n, v),
      noteOff: (n) => st.releaseNote(t.id, n),
      presenceFor: (control) => peers.filter((p) => p.touch?.track === t.id && p.touch.control === control).map(toPresence),
      peerHeld: st.peerHeld[t.id] ?? [],
      people: [{ userId: 'me', name: st.user.name, color: st.user.color }, ...here.map(toPresence)],
      touch: (control) => st.presence.set({ touch: control ? { track: t.id, control } : null }),
      paramChanged: (id, v) => {
        // Rec + Play: knob moves are written as automation on the step that is playing.
        if (!st.rec || !st.playing || slot == null) return;
        const step = engine?.last?.devices[slot]?.step ?? -1;
        if (step >= 0) st.project.setAutomation(t.id, st.ws.scene, id, step, v);
      },
      subtitle: t.name,
    };
  }, [t?.id, t?.name, peers, st, engine, slot]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!t || !entry?.Component || !store || !host)
    return <p className="fwm-empty">No track selected. Bring a device in from the Library to make one.</p>;
  const C = entry.Component;
  return (
    <div className="fwm-devwrap">
      <C key={t.id} store={store} host={host} slot={slot ?? 0} computerKeys={false} />
      <p className="fwm-devnote">
        Notes come from the main sequencer (scene {'ABCD'[st.ws.scene]}), edited in the Piano roll. Keys you play are heard by
        everyone in the session.
      </p>
    </div>
  );
}
