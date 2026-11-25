// Reverb / Delay send knobs on an instrument's panel. They are the same values as the Mixer strip's
// sends (the song's mix settings for this track): turning one here moves it in the Mixer, and back.
import { usePrimitives } from '../theme/Theme';
import type { DeviceHost } from './basalt/Basalt';

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function Sends({ host }: { host?: DeviceHost }) {
  const { Knob } = usePrimitives();
  const s = host?.sends;
  if (!s || !host) return null;
  return (
    <div className="fwm-sends" role="group" aria-label="Sends to the Mixer's Reverb and Delay">
      <span className="fwm-sends__t">SEND</span>
      {(['rev', 'dly'] as const).map((k) => (
        <Knob key={k} label={k === 'rev' ? 'Reverb' : 'Delay'} value={s[k]} defaultValue={0} format={pct}
          onChange={(v) => s.set(k, v)} presence={host.presenceFor(`mix.${k}`)}
          onGestureStart={() => host.touch(`mix.${k}`)} onGestureEnd={() => host.touch(null)} />
      ))}
    </div>
  );
}
