// Dev harness: plays the part of the host app.
//   /             the studio, synced between tabs (open a second tab = a second person)
//   /?basalt      Phase 1 view: Basalt alone
//   ?selftest     plays a note and POSTs what the engine produced to ./log (headless checks)
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import basaltManifest from '@fwm/engine/devices/basalt.json';
import flintManifest from '@fwm/engine/devices/flint.json';
import type { DeviceManifest, Engine } from '@fwm/engine';
import { Basalt, BASALT_PRESETS, FLINT_KITS, EngineProvider, Project, Studio, ThemeRoot, createDeviceStore, useEngine } from '@fwm/studio';
import '@fwm/studio/skins/host-examples.css';
import { localSongs } from './songStore';
import { connectTabs, tabUser } from './tabSync';
import './harness.css';

const SKINS = [
  ['', 'Default'],
  ['flat', 'Flat'],
  ['brand', 'Brand'],
] as const;
const params = new URLSearchParams(location.search);

function SkinButtons({ skin, setSkin }: { skin: string; setSkin(s: string): void }) {
  return (
    <span className="h-skins" role="group" aria-label="Skin (host example)">
      {SKINS.map(([id, label]) => (
        <button key={id} className="h-btn h-btn--sm" aria-pressed={skin === id} onClick={() => setSkin(id)}>
          {label}
        </button>
      ))}
    </span>
  );
}

// ---------- the studio, as the friend's app would mount it ----------
const session = params.has('basalt') ? null : connectTabs('fwm-demo' + (params.get('room') ?? ''));
const engineRef: { current: Engine | null } = { current: null };
const me = tabUser(params.has('newuser'));

/** First visit: start with one Basalt and a bass line so there is something to play. */
function seed() {
  if (!session) return;
  const p = new Project(session.doc, { seed: true });
  if (p.trackIds().length) return;
  const m = basaltManifest as DeviceManifest;
  // A small song: TRACK 1 plays the bass line "Groove", TRACK 2 a slower 2-bar "Drift".
  // ?flint=first: Flint is the first (selected) instrument (screenshots).
  if (params.get('flint') === 'first') p.addTrack(flintManifest as DeviceManifest, FLINT_KITS[0], 0);
  const id = p.addTrack(m, BASALT_PRESETS[0], 0);
  const groove = p.patternList(id)[0].id;
  p.renamePattern(id, groove, 'Groove');
  p.renameSong('Demo');
  const line: [number, number, number, number][] = [[0, 2, 36, 0.9], [3, 1, 36, 0.6], [6, 2, 39, 0.8], [8, 1, 36, 0.9], [10, 1, 31, 0.7], [11, 1, 34, 0.7], [12, 3, 36, 1]];
  for (const [s, l, n, v] of line) p.addNote(id, groove, { s, l, m: n, v });
  const drift = p.addPattern(id)!;
  p.renamePattern(id, drift, 'Drift');
  p.setPatternLen(id, drift, 32);
  for (const [s, l, n, v] of [[0, 6, 36, 0.8], [8, 6, 31, 0.7], [16, 6, 34, 0.8], [24, 8, 29, 0.7]] as const) p.addNote(id, drift, { s, l, m: n, v });
  const r2 = p.addRow();
  p.setCell(r2, id, drift);
  // Drums (Flint): "Beat" in TRACK 1, "Fill" in TRACK 2. The rim row runs 12 steps against 16.
  const dr = p.addTrack(flintManifest as DeviceManifest, FLINT_KITS[0], 0);
  if (params.has('drumsfirst')) p.order.insert(0, [p.order.get(p.order.length - 1)]), p.order.delete(p.order.length - 1, 1); // screenshots: Drums selected
  p.renameTrack(dr, 'Drums');
  const beat = p.patternList(dr)[0].id;
  p.renamePattern(dr, beat, 'Beat');
  const hit = (pat: string, pad: number, steps: number[], extra: { a?: number; r?: number; v?: number } = {}) =>
    steps.forEach((s) => p.addNote(dr, pat, { s, l: 1, m: 36 + pad, v: extra.v ?? (s % 4 === 0 ? 0.9 : 0.7), ...extra }));
  hit(beat, 0, [0, 8, 10]);
  hit(beat, 1, [4, 12]);
  hit(beat, 3, [0, 2, 4, 6, 8, 10, 12, 14], { v: 0.6 });
  hit(beat, 6, [3, 7, 10], { v: 0.5 });
  p.setRowLen(dr, beat, 6, 12);
  const fill = p.addPattern(dr, beat)!;
  p.renamePattern(dr, fill, 'Fill');
  hit(fill, 1, [13], { r: 2 });
  hit(fill, 1, [14], { r: 3 });
  hit(fill, 1, [15], { r: 4, a: 1 });
  hit(fill, 5, [10, 11]);
  p.setCell(r2, dr, fill);
  // ?seednow=3: extra copies, to see several tracks at once.
  for (let i = 1; i < Number(params.get('seednow') || 1); i++) p.addTrack(m, BASALT_PRESETS[i % BASALT_PRESETS.length], 0);
  p.undoManager.clear(); // the demo is not something you can undo
  // ?flint: add a Flint too (screenshots).
  if (params.has('flint') && params.get('flint') !== 'first') p.addTrack(flintManifest as DeviceManifest, FLINT_KITS[0], 0);
  // ?key=0,minor: start with a song key set (the demo line is in C minor).
  const k = params.get('key')?.split(',');
  if (k) p.setKey({ root: Number(k[0]), scale: k[1] });
}

if (params.has('seednow')) seed(); // screenshots: start with the demo track already there

function StudioPage() {
  const [skin, setSkin] = useState('');
  useEffect(() => {
    const role = params.get('e2e');
    if (role) {
      void import('./e2e').then((x) => x.runE2E(role, session!, engineRef));
      return;
    }
    const t = setTimeout(seed, 600); // give other tabs a moment to send their project first
    // ?ghost: a hidden second person in the same room (screenshots of people chips and shared play).
    if (params.has('ghost')) {
      const f = document.createElement('iframe');
      f.hidden = true;
      f.src = `${location.pathname}?newuser&room=${encodeURIComponent(params.get('room') ?? '')}`;
      document.body.appendChild(f);
    }
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="h-studio" data-fwm-theme={skin || undefined}>
      <div className="h-strip">
        <b>free-web-music · harness</b>
        <span>You are <i style={{ color: me.color }}>{me.name}</i>. Open this page in another tab to be a second person.</span>
        <span className="h-grow" />
        <SkinButtons skin={skin} setSkin={setSkin} />
      </div>
      <Studio doc={session!.doc} awareness={session!.awareness} channel={session!.channel} user={me} songs={localSongs}
        onEngine={(e) => (engineRef.current = e)} />
    </div>
  );
}

// ---------- Phase 1 view: Basalt alone ----------
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

/** ?selftest: start audio, play a note, report what the engine produced. */
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

function BasaltPage() {
  const [skin, setSkin] = useState('');
  const store = useMemo(() => createDeviceStore(basaltManifest as DeviceManifest, BASALT_PRESETS[0]), []);
  return (
    <EngineProvider>
      <div className="h-page" data-fwm-theme={skin || undefined}>
        <ThemeRoot>
          <header className="h-top">
            <div>
              <h1>Basalt · harness</h1>
              <p>Phase 1 view. Play with A W S E D F T G Y H U J K O L P ; (Z / X = octave), or the keys.</p>
            </div>
            <div className="h-tools">
              <SoundButton />
              <SkinButtons skin={skin} setSkin={setSkin} />
            </div>
          </header>
          <Basalt store={store} slot={0} />
          {params.has('selftest') && <SelfTest />}
        </ThemeRoot>
      </div>
    </EngineProvider>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode>{params.has('basalt') ? <BasaltPage /> : <StudioPage />}</StrictMode>);
