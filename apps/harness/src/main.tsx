// Dev harness: the studio core running on its own, the way a host app would mount it.
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import basaltManifest from '@fwm/engine/devices/basalt.json';
import type { DeviceManifest } from '@fwm/engine';
import { Basalt, BASALT_PRESETS, EngineProvider, ThemeRoot, createDeviceStore, useEngine } from '@fwm/studio';
import '@fwm/studio/skins/host-examples.css';
import './harness.css';

const SKINS = [
  ['', 'Default skin'],
  ['flat', 'Flat (host example)'],
  ['brand', 'Host brand (example)'],
] as const;

function SoundButton() {
  const { status, start, stop, engine } = useEngine();
  const lat = engine?.latency();
  return (
    <span className="h-sound">
      <button className="h-btn" aria-pressed={status === 'on'} onClick={() => (status === 'on' ? stop() : start())}>
        {status === 'on' ? 'Sound: on' : status === 'loading' ? 'Sound: loading…' : status === 'error' ? 'Sound: failed (see console)' : 'Sound: off'}
      </button>
      {status === 'on' && lat && (
        <small>
          output latency {Math.round((lat.base + lat.output) * 1000)} ms · {self.crossOriginIsolated ? 'isolated' : 'not isolated'}
        </small>
      )}
    </span>
  );
}

/** ?selftest: start audio, play a note, report what the engine produced (used by headless checks). */
function SelfTest() {
  const { engine, status, start } = useEngine();
  useEffect(() => {
    void start();
  }, [start]);
  useEffect(() => {
    if (status === 'error') void fetch('./log', { method: 'POST', body: 'selftest: engine failed to start' });
    if (!engine || status !== 'on') return;
    engine.noteOn(0, 45, 0.9);
    const t = setTimeout(() => {
      const scope = engine.last?.scope;
      const peak = scope ? scope.reduce((m, x) => Math.max(m, Math.abs(x)), 0) : -1;
      const eff = engine.last?.devices[0]?.eff;
      const lat = engine.latency();
      const lines = [
        `isolated: ${self.crossOriginIsolated}`,
        `context: ${engine.context.state} @ ${engine.context.sampleRate} Hz`,
        `scope peak: ${peak.toFixed(3)} ${peak > 0.02 ? 'PASS' : 'FAIL'}`,
        `live cutoff (modulated): ${eff ? eff[4].toFixed(3) : 'none'}`,
        `latency: base ${(lat.base * 1000).toFixed(1)} ms, output ${(lat.output * 1000).toFixed(1)} ms`,
      ];
      engine.noteOff(0, 45);
      void fetch('./log', { method: 'POST', body: lines.join('\n') }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [engine, status]);
  return null;
}

function App() {
  const [skin, setSkin] = useState('');
  const store = useMemo(
    () => createDeviceStore(basaltManifest as DeviceManifest, BASALT_PRESETS[0]),
    [],
  );
  return (
    <EngineProvider>
      <div className="h-page" data-fwm-theme={skin || undefined}>
        <ThemeRoot>
          <header className="h-top">
            <div>
              <h1>Basalt · harness</h1>
              <p>Phase 1: real engine, final UI. Play with A W S E D F T G Y H U J K O L P ; (Z / X = octave), or the keys.</p>
            </div>
            <div className="h-tools">
              <SoundButton />
              {SKINS.map(([id, label]) => (
                <button key={id} className="h-btn" aria-pressed={skin === id} onClick={() => setSkin(id)}>
                  {label}
                </button>
              ))}
            </div>
          </header>
          <Basalt store={store} slot={0} />
          {new URLSearchParams(location.search).has('selftest') && <SelfTest />}
        </ThemeRoot>
      </div>
    </EngineProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
