import { useMemo } from 'react';
import type { Peer } from '../../collab/presence';
import type { DeviceHost } from '../../devices/basalt/Basalt';
import { deviceEntry } from '../../devices/registry';
import { useEngine } from '../../engine/EngineProvider';
import { useStudio } from '../context';
import { toPresence } from './common';
import { TrackNameInput } from './TrackName';

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
      myHeld: st.myHeld[t.id] ?? [],
      people: [{ userId: 'me', name: st.user.name, color: st.user.color }, ...here.map(toPresence)],
      touch: (control) => st.presence.set({ touch: control ? { track: t.id, control } : null }),
      paramChanged: (id, v) => {
        // Rec + Play: knob moves are written as automation on the step that is playing.
        if (!st.rec || !st.playing || slot == null) return;
        const step = engine?.last?.devices[slot]?.step ?? -1;
        const pat = st.project.cell(engine?.last?.transport.row, t.id); // the TRACK that is playing
        if (step >= 0 && pat) st.project.setAutomation(t.id, pat, id, step, v);
      },
      subtitle: t.name,
      songKey: st.project.key,
    };
  }, [t?.id, t?.name, peers, st, engine, slot]); // eslint-disable-line react-hooks/exhaustive-deps

  if (host && t) {
    const mix = st.project.mix(t.id);
    host.sends = { rev: mix.rev, dly: mix.dly, set: (k, v) => st.project.setMix(t.id, { [k]: v }) };
    if (entry?.layout !== 'pads') {
      const base = (entry?.rootNote ?? 48) + st.octave * 12;
      host.octave = { low: Math.floor(base / 12) * 12, shift: (d) => st.setOctave(st.octave + d) };
    }
    if (t.device === 'geode') {
      const tp = st.tapes;
      const meta = st.project.tape(t.id);
      host.geode = {
        status: tp.status(t.id),
        rec: tp.rec?.geode === t.id ? tp.rec : null,
        busy: !!tp.rec && tp.rec.geode !== t.id,
        inputs: st.project.tracks().filter((x) => x.id !== t.id).map((x) => ({ id: x.id, name: x.name, muted: x.seq.mute })),
        record: (input) => tp.record(t.id, input),
        stop: () => tp.stop(),
        demo: () => tp.demo(t.id),
        file: (f) => tp.file(t.id, f),
        clear: () => tp.clear(t.id),
        tape: () => (meta ? tp.store.peek(meta.hash) : null),
        subscribe: tp.store.subscribe,
        version: tp.store.getVersion,
      };
    }
  }
  if (!t || !entry?.Component || !store || !host)
    return <p className="fwm-empty">No instrument yet. Click + Add instrument above to bring one in.</p>;
  const C = entry.Component;
  return (
    <div className="fwm-devwrap">
      <label className="fwm-devname">
        Track name
        <TrackNameInput key={t.id} track={t.id} name={t.name} />
      </label>
      <C key={t.id} store={store} host={host} slot={slot ?? 0} computerKeys={false} />
      <p className="fwm-devnote">
        Notes come from the pattern {t.name} plays in the selected TRACK, edited in the Piano roll. Keys you play are heard by
        everyone in the session.
      </p>
    </div>
  );
}
