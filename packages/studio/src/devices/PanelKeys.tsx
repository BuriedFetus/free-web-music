// On-screen keys with octave buttons, for a device panel (Opal, Quartz). With a song Key, notes outside
// it are dimmed and play the nearest key note (no wrong notes). Notes go through the host (heard by
// everyone, recorded) or, standalone, straight to the engine.
import { useCallback, useRef, useState } from 'react';
import { useEngine } from '../engine/EngineProvider';
import { inKey, isRoot, snapToKey } from '../model/scales';
import { usePrimitives } from '../theme/Theme';
import type { DeviceHost } from './basalt/Basalt';

export function PanelKeys({ host, slot, octave = 3 }: { host?: DeviceHost; slot: number; octave?: number }) {
  const { engine, status, start } = useEngine();
  const P = usePrimitives();
  const [held, setHeld] = useState<number[]>([]);
  const heldRef = useRef<number[]>([]);
  const [oct, setOct] = useState(octave);
  const noteOn = useCallback(
    (n: number, v: number) => {
      heldRef.current = [...heldRef.current.filter((x) => x !== n), n];
      setHeld(heldRef.current);
      if (host) host.noteOn(n, v);
      else if (engine && status === 'on') engine.noteOn(slot, n, v);
      else if (status !== 'loading') void start();
    },
    [engine, status, slot, start, host],
  );
  const noteOff = useCallback(
    (n: number) => {
      heldRef.current = heldRef.current.filter((x) => x !== n);
      setHeld(heldRef.current);
      if (host) host.noteOff(n);
      else engine?.noteOff(slot, n);
    },
    [engine, slot, host],
  );
  // in the studio the octave is the computer keyboard's (Z / X), so the A key and the first key on screen match
  const low = host?.octave ? host.octave.low : 12 * (oct + 1);
  const shown = Math.floor(low / 12) - 1;
  const sk = host?.songKey;
  const scale = sk && sk.scale !== 'chromatic' ? { has: (n: number) => inKey(n, sk), isRoot: (n: number) => isRoot(n, sk), snap: (n: number) => snapToKey(n, sk) } : undefined;
  return (
    <div className="fwm-perf">
      <div className="fwm-oct">
        <span className="fwm-silk">Octave</span>
        <P.Button variant="hw" label="Octave up" onPress={() => (host?.octave ? host.octave.shift(1) : setOct((o) => Math.min(6, o + 1)))}>+</P.Button>
        <P.Screen variant="readout">C{shown}</P.Screen>
        <P.Button variant="hw" label="Octave down" onPress={() => (host?.octave ? host.octave.shift(-1) : setOct((o) => Math.max(0, o - 1)))}>−</P.Button>
      </div>
      <P.Keys low={low} high={low + 24} held={host?.myHeld?.length ? [...held, ...host.myHeld] : held} peerHeld={host?.peerHeld} onNoteOn={noteOn} onNoteOff={noteOff} scale={scale} />
    </div>
  );
}
