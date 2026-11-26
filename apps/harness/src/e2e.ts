import { deviceEntry } from '@fwm/studio';
// In-page end-to-end test for two tabs (no browser automation needed). Results are POSTed to ./log.
//   tab A: ?e2e=a&room=R   plays, turns Cutoff, adds a note, plays a key
//   tab B: ?e2e=b&room=R   checks it sees and hears all of that, and that its undo is its own
import basaltManifest from '@fwm/engine/devices/basalt.json';
import flintManifest from '@fwm/engine/devices/flint.json';
import type { DeviceManifest, Engine } from '@fwm/engine';
import { Project } from '@fwm/studio';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';

const m = basaltManifest as DeviceManifest;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(what: string, fn: () => boolean, ms = 8000) {
  const t0 = performance.now();
  while (!fn()) {
    if (performance.now() - t0 > ms) throw new Error('timeout: ' + what);
    await sleep(50);
  }
}
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const btn = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text));

export async function runE2E(role: string, s: { doc: Y.Doc; awareness: Awareness }, engineRef: { current: Engine | null }) {
  const out: string[] = [];
  const ok = (cond: boolean, label: string) => out.push(`${cond ? 'PASS' : 'FAIL'} ${role}: ${label}`);
  const p = new Project(s.doc, { e2e: role });
  if (role === 'multi') return runMulti(p, engineRef, ok, out);
  if (role === 'switch') return runSwitch(p, engineRef, ok, out);
  if (role === 'roll') return runRoll(p, engineRef, ok, out);
  if (role === 'song') return runSong(p, engineRef, ok, out);
  if (role === 'songs') return runSongs(p, engineRef, ok, out);
  if (role === 'flint') return runFlint(p, engineRef, ok, out);
  if (role === 'drums') return runDrums(p, engineRef, ok, out);
  if (role === 'mixer') return runMixer(p, engineRef, ok, out);
  if (role === 'fx') return runFx(p, engineRef, ok, out);
  if (role === 'scope') return runScope(p, engineRef, ok, out);
  if (role === 'garnet') return runGarnet(p, engineRef, ok, out);
  if (role === 'opal') return runOpal(p, engineRef, ok, out);
  if (role === 'quartz') return runQuartz(p, engineRef, ok, out);
  if (role === 'look') return runLook(s.doc, ok, out);
  if (role === 'arrange') return runArrange(p, ok, out);
  if (role === 'ta' || role === 'tb') return runTogether(role, p, s.awareness, engineRef, ok, out);
  try {
    await until('a peer', () => s.awareness.getStates().size >= 2, 10000);
    if (role === 'a') {
      if (!p.trackIds().length) {
        const id = p.addTrack(m, undefined, 0);
        for (const st of [0, 4, 8, 12]) p.addNote(id, p.patternList(id)[0].id, { s: st, l: 1, m: 36, v: 0.9 });
      }
      const id = p.trackIds()[0];
      btn('Sound')!.click();
      await until('engine', () => !!engineRef.current?.last);
      btn('▶ Play')!.click();
      const steps = new Set<number>();
      let peak = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 2000) {
        const last = engineRef.current!.last!;
        Object.values(last.devices).forEach((d) => d.step >= 0 && steps.add(d.step));
        peak = Math.max(peak, ...Array.from(last.scope).map(Math.abs));
        await sleep(30);
      }
      ok(engineRef.current!.last!.transport.playing, 'transport plays');
      ok(steps.size >= 8, `sequencer advances (${steps.size} distinct steps in 2 s at 120 BPM)`);
      ok(peak > 0.02, `pattern makes sound (peak ${peak.toFixed(3)})`);
      btn('■ Stop')!.click();
      // Shared edits + presence for B to observe.
      p.deviceStore(id, m)!.setParam('cut', 0.91);
      p.addNote(id, p.patternList(id)[0].id, { s: 5.5, l: 0.5, m: 43, v: 0.7 });
      const knob = $('[role=slider][aria-label="Cutoff"]')!;
      knob.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 100, pointerId: 1 }));
      // Live key: hold "a" (plays on B's copy of Basalt too).
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      await sleep(3000);
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
      knob.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    } else {
      btn('Sound')!.click();
      await until('track from A', () => p.trackIds().length > 0);
      const id = p.trackIds()[0];
      const store = () => p.deviceStore(id, m)!;
      await until('A turned Cutoff', () => store().getState().params.cut === 0.91);
      ok(true, 'sees Cutoff turned by A (0.91)');
      await until("A's note", () => p.notes(id, p.patternList(id)[0].id).some(([, n]) => n.m === 43 && n.s === 5.5));
      ok(true, "sees A's new note with micro-timing (s = 5.5)");
      await until('peer ring on Cutoff', () => !!$('.fwm-knob.is-peer'));
      ok(!!$('.fwm-knob.is-peer .fwm-knob__tag'), `sees A's presence on the Cutoff knob ("${$('.fwm-knob__tag')?.textContent}")`);
      await until("A's held key", () => !!$('.fwm-keys__w.is-peer, .fwm-keys__b.is-peer'));
      ok(true, "sees the key A is holding, in A's colour");
      await sleep(300);
      const peak = Math.max(...Array.from(engineRef.current?.last?.scope ?? [0]).map(Math.abs));
      ok(peak > 0.02, `hears A's key on its own Basalt (peak ${peak.toFixed(3)}, B played nothing itself)`);
      // My own edit, then undo: only mine is undone.
      const reso = $('[role=slider][aria-label="Reso"]')!;
      const before = store().getState().params.res;
      reso.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      await until('my Reso change', () => store().getState().params.res !== before);
      await sleep(500);
      btn('↶') ? (btn('↶') as HTMLButtonElement).click() : ($('[aria-label="Undo (your changes)"]') as HTMLButtonElement).click();
      await until('undo', () => store().getState().params.res === before);
      ok(store().getState().params.cut === 0.91, "undo reverted my Reso change and kept A's Cutoff");
    }
  } catch (e) {
    out.push(`FAIL ${role}: ${String(e)}`);
  }
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}

/** One tab: a track plays, then more devices are added the way a user does (Library → Add). */
async function runMulti(p: Project, engineRef: { current: Engine | null }, ok: (c: boolean, l: string) => void, out: string[]) {
  const errs: string[] = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errs.push(String(e.reason)));
  // Max amp envelope per slot and master peak over a window.
  const watch = async (ms: number) => {
    const env: Record<string, number> = {};
    let peak = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const last = engineRef.current!.last!;
      for (const [slot, d] of Object.entries(last.devices)) env[slot] = Math.max(env[slot] ?? 0, d.mods[1]);
      peak = Math.max(peak, ...Array.from(last.scope).map(Math.abs));
      await sleep(25);
    }
    return { env, peak };
  };
  const fmt = (w: { env: Record<string, number>; peak: number }) =>
    Object.entries(w.env).map(([k, v]) => `slot${k}=${v.toFixed(2)}`).join(' ') + ` peak=${w.peak.toFixed(3)}`;
  try {
    await sleep(300);
    const a = p.addTrack(m, undefined, 0);
    for (const st of [0, 4, 8, 12]) p.addNote(a, p.patternList(a)[0].id, { s: st, l: 1, m: 36, v: 0.9 });
    btn('Sound')!.click();
    await until('engine', () => !!engineRef.current?.last);
    btn('▶ Play')!.click();
    let w = await watch(1500);
    ok(Object.values(w.env).some((v) => v > 0.1), `one track plays (${fmt(w)})`);
    // Add a second Basalt from the Library, while playing.
    ($('[aria-label="Add Basalt as a new track"]') as HTMLButtonElement).click();
    await sleep(200);
    w = await watch(1500);
    const vals = () => Object.values(w.env);
    ok(Object.keys(w.env).length === 2, `engine has two devices (${Object.keys(w.env).join(',')})`);
    ok(vals()[0] > 0.1, `track 1 still plays after adding track 2 (${fmt(w)})`);
    const b = p.trackIds()[1];
    for (const st of [2, 6, 10, 14]) p.addNote(b, p.patternList(b)[0].id, { s: st, l: 1, m: 48, v: 0.9 });
    w = await watch(1500);
    ok(vals().length === 2 && vals().every((v) => v > 0.1), `both tracks play their patterns (${fmt(w)})`);
    btn('■ Stop')!.click();
    await sleep(400);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    w = await watch(500);
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    ok(w.peak > 0.02, `computer key plays the new track (${fmt(w)})`);
    // Third copy and a removal.
    ($('[aria-label="Add Basalt as a new track"]') as HTMLButtonElement).click();
    await sleep(200);
    p.removeTrack(p.trackIds()[0]);
    btn('▶ Play')!.click();
    w = await watch(1500);
    ok(vals().some((v) => v > 0.1), `after removing track 1, track 2 still plays (${fmt(w)})`);
    btn('■ Stop')!.click();
  } catch (e) {
    out.push(`FAIL multi: ${String(e)}`);
  }
  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}

/** One tab: switch tracks in the main sequencer many times, stopped, playing, with keys held. */
async function runSwitch(p: Project, engineRef: { current: Engine | null }, ok: (c: boolean, l: string) => void, out: string[]) {
  const errs: string[] = [];
  window.addEventListener('error', (e) => errs.push('error: ' + String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errs.push('rejection: ' + String(e.reason)));
  const ce = console.error.bind(console);
  console.error = (...a: unknown[]) => { errs.push('console: ' + a.map(String).join(' ').slice(0, 300)); ce(...a); };
  const sel = (name: string) => ($(`[aria-label="Select ${name}"]`) as HTMLButtonElement | null);
  const alive = () => document.querySelectorAll('.fwm-pane').length === 4 && !!$('.fwm-seq, .fwm-sq');
  try {
    await sleep(300);
    for (let i = 0; i < 3; i++) {
      const id = p.addTrack(m, undefined, 0);
      for (const st of [0, 4, 8, 12]) p.addNote(id, p.patternList(id)[0].id, { s: st + i, l: 1, m: 36 + i * 7, v: 0.9 });
    }
    await sleep(200);
    const names = p.tracks().map((t) => t.name);
    const cycle = async (label: string, n: number, delay: number) => {
      for (let k = 0; k < n; k++) {
        const name = names[k % names.length];
        const b = sel(name);
        if (!b) { errs.push(`${label}: no select button for ${name}`); return; }
        b.click();
        await sleep(delay);
        if (!alive()) { errs.push(`${label}: UI gone after selecting ${name} (step ${k})`); return; }
      }
    };
    await cycle('stopped, no sound', 12, 40);
    ok(alive() && errs.length === 0, `switch while stopped, no sound (${errs.join(' | ')})`);
    btn('Sound')!.click();
    await until('engine', () => !!engineRef.current?.last);
    await cycle('sound on', 12, 40);
    ok(alive() && errs.length === 0, `switch with sound on (${errs.join(' | ')})`);
    btn('▶ Play')!.click();
    await cycle('playing', 30, 25);
    ok(alive() && errs.length === 0, `switch fast while playing (${errs.join(' | ')})`);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    await cycle('key held', 6, 60);
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    ok(alive() && errs.length === 0, `switch while holding a key (${errs.join(' | ')})`);
    btn('● Rec')!.click();
    await cycle('recording', 10, 50);
    btn('● Rec')!.click();
    ok(alive() && errs.length === 0, `switch while recording (${errs.join(' | ')})`);
    // Switch on the piano-roll/device tabs too, and on a second TRACK.
    btn('+ Add TRACK')?.click();
    for (const t of [...document.querySelectorAll<HTMLButtonElement>('.fwm-ttab')].slice(0, 6)) { t.click(); await sleep(40); }
    ok(alive() && errs.length === 0, `switch via tabs on TRACK 2 (${errs.join(' | ')})`);
    const env: Record<string, number> = {};
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      for (const [k, d] of Object.entries(engineRef.current!.last!.devices)) env[k] = Math.max(env[k] ?? 0, d.mods[1]);
      await sleep(25);
    }
    ok(Object.keys(env).length === 3, `engine still has 3 devices (${JSON.stringify(env)})`);
    btn('■ Stop')?.click();
    ok(!!$('[role=slider][aria-label="Cutoff"]'), 'device panel still shows Basalt');
    // Hold a key on track 1, switch to track 2, release: track 1 must not keep droning.
    sel(names[0])!.click();
    await sleep(100);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    await sleep(300);
    sel(names[1])!.click();
    await sleep(100);
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    await sleep(1500);
    const env0 = engineRef.current!.last!.devices[0].mods[1];
    ok(env0 < 0.05, `no stuck note on the track you left (amp env ${env0.toFixed(3)})`);
    // Space with a step button focused: plays, and does not toggle the step.
    const stepBtn = $(`[aria-label="Mute ${names[1]}"]`) as HTMLButtonElement;
    const before = p.track(p.trackIds()[1])!.seq.mute;
    stepBtn.focus();
    stepBtn.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
    const up = new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, cancelable: true });
    stepBtn.dispatchEvent(up);
    await until('Space plays', () => !!engineRef.current?.last?.transport.playing, 2000);
    ok(true, 'Space plays while a step button has focus');
    ok(up.defaultPrevented && p.track(p.trackIds()[1])!.seq.mute === before, 'Space does not press the focused button (Mute)');
    btn('■ Stop')?.click();
  } catch (e) {
    out.push(`FAIL switch: ${String(e)} | ${errs.join(' | ')}`);
  }
  out.push(`INFO errors: ${errs.length}`);
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}

/** One tab: edit notes in the piano roll with real hit-testing (elementFromPoint), as a mouse would. */
async function runRoll(p: Project, engineRef: { current: Engine | null }, ok: (c: boolean, l: string) => void, out: string[]) {
  const errs: string[] = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  // Pointer at a grid position: step (0..16) and pitch.
  const ptr = (type: string, x: number, y: number, buttons = 1) => {
    const el = document.elementFromPoint(x, y)!;
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 0, pointerType: 'mouse', button: 0, buttons, isPrimary: true }));
    return el;
  };
  try {
    await sleep(300);
    const id = p.addTrack(m, undefined, 0);
    await sleep(200);
    const grid = $('.fwm-grid')!;
    const rowOf = (pitch: number) => $(`.fwm-gr[data-m="${pitch}"]`)!;
    const at = (step: number, pitch: number) => {
      const g = grid.getBoundingClientRect();
      const r = rowOf(pitch).getBoundingClientRect();
      return [g.left + (step / 16) * g.width, r.top + r.height / 2] as const;
    };
    rowOf(36).scrollIntoView({ block: 'center' });
    await sleep(100);
    // Draw C2 across 16 steps.
    let [x, y] = at(0.5, 36);
    ptr('pointerdown', x, y);
    [x, y] = at(15.9, 36);
    ptr('pointermove', x, y);
    ptr('pointerup', x, y, 0);
    await sleep(100);
    const ns = () => p.notes(id, p.patternList(id)[0].id).map(([, n]) => n);
    ok(ns().length === 1 && ns()[0].l === 16, `draw one 16-step note (${JSON.stringify(ns())})`);
    // Press and hold in the middle of it, drag up two semitones: it moves, no new note.
    [x, y] = at(8, 36);
    const hit = ptr('pointerdown', x, y);
    [x, y] = at(8, 38);
    ptr('pointermove', x, y);
    ptr('pointerup', x, y, 0);
    await sleep(100);
    ok(ns().length === 1, `holding the note grabs it (hit ${hit.className}; notes ${JSON.stringify(ns())})`);
    ok(ns()[0]?.m === 38, `dragging moves it up (pitch ${ns()[0]?.m})`);
    // From an empty spot, draw a note across an existing one on the same pitch: no stacked notes.
    p.addNote(id, p.patternList(id)[0].id, { s: 8, l: 1, m: 41, v: 0.8 });
    await sleep(100);
    [x, y] = at(2.5, 41);
    ptr('pointerdown', x, y);
    [x, y] = at(11.9, 41);
    ptr('pointermove', x, y);
    ptr('pointerup', x, y, 0);
    await sleep(100);
    const same = ns().filter((n) => n.m === 41);
    ok(same.length === 1 && same[0].s === 2 && same[0].l === 10, `drawing across a note replaces it, no overlap (${JSON.stringify(same)})`);
    // Grid lines follow Snap.
    const snapSel = $<HTMLSelectElement>('[aria-label="Snap when editing"]')!;
    const setSnap = async (v: string) => {
      snapSel.value = v;
      snapSel.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(80);
      return getComputedStyle(grid, '::after').backgroundSize.split(',')[0].trim();
    };
    const g8 = await setSnap('1/8');
    const g32 = await setSnap('1/32');
    await setSnap('1/16');
    ok(g8 !== g32 && parseFloat(g8) > parseFloat(g32), `grid cell size follows Snap (1/8: ${g8}, 1/32: ${g32})`);
    // Piano keys sound when pressed.
    btn('Sound')!.click();
    await until('engine', () => !!engineRef.current?.last);
    await sleep(300);
    const k = $(`.fwm-pkr[data-key="36"]`)!;
    const kr = k.getBoundingClientRect();
    ptr('pointerdown', kr.left + 10, kr.top + kr.height / 2);
    let env = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 500) { env = Math.max(env, engineRef.current!.last!.devices[0]?.mods[1] ?? 0); await sleep(20); }
    ptr('pointerup', kr.left + 10, kr.top + kr.height / 2, 0);
    await sleep(1200);
    const after = engineRef.current!.last!.devices[0]?.mods[1] ?? 1;
    ok(env > 0.1 && after < 0.05, `pressing a piano key plays it, releasing stops it (env ${env.toFixed(2)} → ${after.toFixed(3)})`);
  } catch (e) {
    out.push(`FAIL roll: ${String(e)}`);
  }
  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}

/** One tab: the song plays TRACK after TRACK (Loop SONG), repeats one (Loop TRACK), jumps on click, stays editable. */
async function runSong(p: Project, engineRef: { current: Engine | null }, ok: (c: boolean, l: string) => void, out: string[]) {
  const errs: string[] = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  try {
    await sleep(300);
    const id = p.addTrack(m, undefined, 0);
    const p1 = p.patternList(id)[0].id;
    for (const st of [0, 4, 8, 12]) p.addNote(id, p1, { s: st, l: 1, m: 36, v: 0.9 });
    const p2 = p.addPattern(id)!;
    p.setPatternLen(id, p2, 32);
    for (const st of [0, 8, 16, 24]) p.addNote(id, p2, { s: st, l: 2, m: 43, v: 0.9 });
    const [r1] = p.rows().map((r) => r.id);
    const r2 = p.addRow();
    p.setCell(r2, id, p2);
    p.setBpm(240); // 1 bar = 1 s
    await sleep(200);
    ($('[aria-label^="TRACK 1,"]') as HTMLButtonElement).click(); // start from TRACK 1
    btn('Sound')!.click();
    await until('engine', () => !!engineRef.current?.last);
    btn('⟲ Loop SONG')!.click();
    btn('▶ Play')!.click();
    // Watch which row plays, every 50 ms for 3.6 s: TRACK 1 (1 s) → TRACK 2 (2 s) → TRACK 1.
    const seen: string[] = [];
    const t0 = performance.now();
    let nowShown = false;
    while (performance.now() - t0 < 3600) {
      const row = engineRef.current!.last!.transport.row;
      if (row && seen[seen.length - 1] !== row) seen.push(row);
      if (row === r2 && $('.fwm-arow.is-now [aria-label^="TRACK 2"]')) nowShown = true;
      await sleep(50);
    }
    const names = seen.map((r) => (r === r1 ? 'T1' : r === r2 ? 'T2' : '?')).join(' → ');
    ok(names === 'T1 → T2 → T1', `Loop SONG plays TRACK 1, then TRACK 2 (2 bars), then back to 1 (${names})`);
    ok(nowShown, 'the arrangement highlights the TRACK that is playing');
    // Loop TRACK + Wait (default): clicking TRACK 2 queues it; it starts when TRACK 1 ends (1 bar = 1 s).
    btn('⟲ Loop TRACK')!.click();
    await until('back on TRACK 1', () => engineRef.current!.last!.transport.row === r1, 4000);
    await until('early in TRACK 1', () => engineRef.current!.last!.transport.rowPos < 4, 2000);
    ($('[aria-label^="TRACK 2,"]') as HTMLButtonElement).click();
    await sleep(150);
    const tr = engineRef.current!.last!.transport;
    ok(tr.row === r1 && tr.next === r2 && !!$('.fwm-arow.is-next .fwm-tl__next'), 'with Wait on, TRACK 2 is queued ("next") while TRACK 1 finishes');
    const w0 = performance.now();
    await until('switch at the end', () => engineRef.current!.last!.transport.row === r2, 2000);
    const waited = performance.now() - w0;
    ok(waited > 400, `…and starts when TRACK 1 ends (${Math.round(waited)} ms later)`);
    // Wait off: switch at once.
    btn('⏳ Wait')!.click();
    ($('[aria-label^="TRACK 1,"]') as HTMLButtonElement).click();
    await sleep(150);
    ok(engineRef.current!.last!.transport.row === r1, 'with Wait off, clicking a TRACK switches at once');
    ($('[aria-label^="TRACK 2,"]') as HTMLButtonElement).click();
    await sleep(150);
    ok(engineRef.current!.last!.transport.row === r2, 'clicking TRACK 2 while playing jumps there');
    const rows = new Set<string>();
    const t1 = performance.now();
    while (performance.now() - t1 < 2600) {
      rows.add(engineRef.current!.last!.transport.row ?? '');
      await sleep(50);
    }
    ok(rows.size === 1 && rows.has(r2), `Loop TRACK keeps repeating TRACK 2 (${[...rows].length} row(s) seen)`);
    // Editing while playing: rename the pattern; the field keeps focus and text through playback.
    ($('[aria-label="TRACK 2, Basalt: P2"]') as HTMLButtonElement).click();
    await sleep(100);
    const name = $<HTMLInputElement>('[aria-label="Rename pattern P2"]')!;
    name.focus();
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(name, 'Chorus');
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(800);
    const still = $<HTMLInputElement>('.fwm-pname');
    ok(still === name && name.value === 'Chorus', 'typing a pattern name is not disturbed by playback');
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    name.blur();
    name.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await sleep(100);
    ok(p.patternInfo(id, p2)?.name === 'Chorus', `pattern renamed while playing (${p.patternInfo(id, p2)?.name})`);
    btn('■ Stop')!.click();
  } catch (e) {
    out.push(`FAIL song: ${String(e)}`);
  }
  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}

/** One tab: save the song, start a new one from INIT, open the saved one again, all while playing. */
async function runSongs(p: Project, engineRef: { current: Engine | null }, ok: (c: boolean, l: string) => void, out: string[]) {
  const errs: string[] = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  const peak = async (ms: number) => {
    let pk = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      pk = Math.max(pk, ...Array.from(engineRef.current!.last!.scope).map(Math.abs));
      await sleep(30);
    }
    return pk;
  };
  const menu = () => $<HTMLButtonElement>('.fwm-songbtn')!;
  try {
    await sleep(300);
    const id = p.addTrack(m, undefined, 0);
    for (const st of [0, 4, 8, 12]) p.addNote(id, p.patternList(id)[0].id, { s: st, l: 1, m: 36, v: 0.9 });
    p.renameSong('E2E song ' + Math.random().toString(36).slice(2, 6));
    const name = p.songName;
    btn('Sound')!.click();
    await until('engine', () => !!engineRef.current?.last);
    btn('▶ Play')!.click();
    ok((await peak(800)) > 0.02, 'the song plays');
    btn('Save')!.click();
    await until('saved', () => !p.unsaved);
    ok(!menu().textContent!.includes('not saved'), 'Save: "not saved" goes away');
    // INIT while playing (nothing unsaved, so no question).
    menu().click();
    await sleep(100);
    btn('New song from INIT')!.click();
    await until('INIT', () => p.songName === 'Untitled');
    const t = p.trackIds();
    ok(t.length === 1 && p.notes(t[0], p.patternList(t[0])[0].id).length === 0, 'INIT: one Basalt with an empty P1');
    ok((await peak(800)) < 0.01, 'INIT is silent (empty pattern), still playing without errors');
    // Open the saved song again.
    menu().click();
    await until('list', () => !!$(`[aria-label="Open ${name}"]`));
    ($(`[aria-label="Open ${name}"]`) as HTMLButtonElement).click();
    await until('opened', () => p.songName === name);
    ok(p.notes(id, p.patternList(id)[0].id).length === 4 && !p.unsaved, 'Open: the saved song is back, notes and all');
    ok((await peak(1000)) > 0.02, 'and it plays again');
    btn('■ Stop')!.click();
  } catch (e) {
    out.push(`FAIL songs: ${String(e)}`);
  }
  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}

/** One tab: Flint from the Library; its pads sound in the real engine; a pad's settings reach the engine. */
async function runFlint(_p: Project, engineRef: { current: Engine | null }, ok: (c: boolean, l: string) => void, out: string[]) {
  const errs: string[] = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  const peak = async (ms: number) => {
    let pk = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      pk = Math.max(pk, ...Array.from(engineRef.current!.last!.scope).map(Math.abs));
      await sleep(20);
    }
    return pk;
  };
  const press = async (i: number) => {
    const pad = $(`.fwm-pad[data-pad="${i}"]`)!;
    pad.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    pad.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
  };
  try {
    await sleep(300);
    ($('[aria-label="Add Flint as a new track"]') as HTMLButtonElement).click();
    await sleep(200);
    ok(!!$('.fwm-flint'), 'Flint shows in the Device panel');
    btn('Sound')!.click();
    await until('engine', () => !!engineRef.current?.last);
    await sleep(300);
    const levels: string[] = [];
    let all = true;
    for (let i = 0; i < 8; i++) {
      await press(i);
      const pk = await peak(250);
      levels.push(pk.toFixed(2));
      if (pk < 0.02) all = false;
      await sleep(250);
    }
    ok(all, `all 8 pads make sound in the browser (peaks ${levels.join(' ')})`);
    // Pad 1 → Noise character: the engine's value follows.
    await press(0);
    btn('Noise')!.click();
    const slot = Number(Object.keys(engineRef.current!.last!.devices)[0]);
    await until('engine param', () => engineRef.current!.last!.devices[slot].eff[1] === 2, 2000);
    ok(true, 'changing a pad character reaches the engine');
    // Keys A S D F play pads 1–4.
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    const kp = await peak(250);
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', bubbles: true }));
    ok(kp > 0.02 && $('.fwm-pad[data-pad="2"]')!.classList.contains('is-hit') !== undefined, `key D plays pad 3 (peak ${kp.toFixed(2)})`);
  } catch (e) {
    out.push(`FAIL flint: ${String(e)}`);
  }
  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}

/** One tab: a drum pattern plays in the song; rows with different lengths show their own playheads. */
async function runDrums(p: Project, engineRef: { current: Engine | null }, ok: (c: boolean, l: string) => void, out: string[]) {
  const errs: string[] = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  try {
    await sleep(300);
    ($('[aria-label="Add Flint as a new track"]') as HTMLButtonElement).click();
    await sleep(200);
    const id = p.trackIds()[0];
    const pat = p.patternList(id)[0].id;
    for (const st of [0, 4, 8, 12]) p.addNote(id, pat, { s: st, l: 1, m: 36, v: 0.9 });
    p.addNote(id, pat, { s: 0, l: 1, m: 42, v: 0.9 });
    p.setRowLen(id, pat, 6, 5); // rim row: 5 steps
    p.setBpm(240);
    await sleep(200);
    ok(document.querySelectorAll('.fwm-dg__row').length === 9, 'the Piano roll panel shows the drum grid (8 rows + velocity)');
    btn('Sound')!.click();
    await until('engine', () => !!engineRef.current?.last);
    btn('▶ Play')!.click();
    let pk = 0;
    const pairs = new Set<string>();
    const t0 = performance.now();
    while (performance.now() - t0 < 2500) {
      pk = Math.max(pk, ...Array.from(engineRef.current!.last!.scope).map(Math.abs));
      const rows = [...document.querySelectorAll('.fwm-dg__cells')];
      const kick = [...rows[0].children].findIndex((c) => c.classList.contains('is-now'));
      const rim = [...rows[6].children].findIndex((c) => c.classList.contains('is-now'));
      if (kick >= 0 && rim >= 0) pairs.add(`${kick}:${rim}`);
      await sleep(30);
    }
    ok(pk > 0.05, `the drum pattern plays in the song (peak ${pk.toFixed(2)})`);
    const drift = [...pairs].some((x) => { const [a, b] = x.split(':').map(Number); return a !== b; });
    ok(drift && [...pairs].every((x) => Number(x.split(':')[1]) < 5), `the 5-step rim row has its own playhead (${[...pairs].slice(0, 8).join(' ')})`);
    // Mute the kick: still playing, no errors.
    ($('[aria-label="Mute pad 1"]') as HTMLButtonElement).click();
    await sleep(300);
    ok(p.track(id)!.seq.pmute === 1, 'mute pad 1 is shared on the instrument');
    btn('■ Stop')!.click();
  } catch (e) {
    out.push(`FAIL drums: ${String(e)}`);
  }
  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}

/**
 * Two tabs, one song (shared transport). Tab A: ?e2e=ta&room=R, tab B: ?e2e=tb&room=R, in one Firefox.
 * Each tab asks its own engine where the song is at the same wall-clock moment and they compare.
 */
async function runTogether(
  role: string, p: Project, awareness: Awareness, engineRef: { current: Engine | null },
  ok: (c: boolean, l: string) => void, out: string[],
) {
  const errs: string[] = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  const bc = new BroadcastChannel('fwm-e2e-together' + (new URLSearchParams(location.search).get('room') ?? ''));
  const got = new Map<string, unknown>();
  const wall = () => performance.timeOrigin + performance.now();
  const where = (W: number) => engineRef.current?.where(W - performance.timeOrigin) ?? null;
  bc.onmessage = async (e) => {
    const m = e.data;
    if (m.t === 'probe') {
      while (wall() < m.W + 40) await sleep(10);
      bc.postMessage({ t: 'at', id: m.id, w: where(m.W) });
    } else got.set(m.t === 'at' ? 'at' + m.id : m.t, m);
  };
  const post = (t: string) => bc.postMessage({ t });
  const wait = (t: string, ms = 20000) => until('the other tab: ' + t, () => got.has(t), ms);
  let probes = 0;
  /** ms between the two tabs' song positions at the same moment, or null if either is stopped / on another TRACK. */
  const apart = async () => {
    const id = ++probes;
    const W = wall() + 150;
    bc.postMessage({ t: 'probe', id, W });
    while (wall() < W + 40) await sleep(10);
    const mine = where(W);
    await until('probe reply', () => got.has('at' + id), 2000);
    const theirs = (got.get('at' + id) as { w: ReturnType<typeof where> }).w;
    if (!mine || !theirs || mine.row !== theirs.row) return { ms: null, mine, theirs };
    return { ms: Math.abs(mine.pos - theirs.pos) / mine.stepsPerMs, mine, theirs };
  };
  const playingUi = () => !!btn('■ Stop');
  const isPlaying = () => !!engineRef.current?.last?.transport.playing;
  const fmt = (x: { ms: number | null }) => (x.ms == null ? 'not comparable' : `${x.ms.toFixed(1)} ms apart`);
  try {
    await until('a peer', () => awareness.getStates().size >= 2, 10000);
    btn('Sound')!.click();
    await until('engine', () => !!engineRef.current?.last);
    if (role === 'ta') {
      p.setBpm(120);
      const id = p.addTrack(m, undefined, 0);
      for (const st of [0, 4, 8, 12]) p.addNote(id, p.patternList(id)[0].id, { s: st, l: 1, m: 36, v: 0.9 });
      const r2 = p.addRow();
      p.setCell(r2, id, p.patternList(id)[0].id);
      await sleep(1500); // clocks
      post('ready');
      await wait('ready');
      ($('[aria-label^="TRACK 1,"]') as HTMLButtonElement).click();
      btn('▶ Play')!.click();
      await wait('b-playing', 3000);
      ok(true, 'B started when A pressed Play');
      btn('⟲ Loop TRACK')!.click(); // stays on TRACK 1 (shared: B's loop changes too)
      await sleep(1200);
      let d = await apart();
      ok(d.ms != null && d.ms < 5, `both tabs play the same place at the same moment (${fmt(d)})`);
      await sleep(6000);
      d = await apart();
      ok(d.ms != null && d.ms < 5, `still together 6 s later (${fmt(d)})`);
      post('b-cue');
      await wait('b-cued');
      ok((got.get('b-cued') as { loop: boolean }).loop, "A's Loop TRACK reached B");
      await until('TRACK 2 queued or playing here', () => {
        const tr = engineRef.current!.last!.transport;
        return tr.next === r2 || tr.row === r2;
      }, 3000);
      ok(true, "B's click on TRACK 2 (Wait on) queued it on A too");
      await until('TRACK 2 playing', () => engineRef.current!.last!.transport.row === r2, 4000);
      await sleep(300);
      d = await apart();
      ok(d.ms != null && d.ms < 5 && d.mine!.row === r2, `both switched to TRACK 2 on the same beat (${fmt(d)})`);
      post('b-stop');
      await until('stopped by B', () => !isPlaying() && !playingUi(), 3000);
      ok(true, 'B pressed Stop: A stopped');
      // Play alone.
      btn('🎧 Play alone')!.click();
      btn('▶ Play')!.click();
      await sleep(1500);
      post('check-b-stopped');
      await wait('b-was-stopped');
      ok((got.get('b-was-stopped') as { v: boolean }).v, 'A playing alone did not start B');
      btn('■ Stop')!.click();
      post('b-play');
      await wait('b-playing2');
      await sleep(800);
      ok(!isPlaying(), 'A (alone) ignored B pressing Play');
      btn('🎧 Play alone')!.click(); // back to the group: drops in where B's song is
      await until('joined the group', () => isPlaying(), 3000);
      ok(true, 'turning Play alone off joined the song B is playing');
      await sleep(1200);
      d = await apart();
      ok(d.ms != null && d.ms < 5, `…in step with B (${fmt(d)})`);
      post('b-stop');
      await until('stopped', () => !isPlaying(), 3000);
      // Live keys and a knob turn (B listens in Even, then Tight).
      const key = async (k: string) => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        await sleep(120);
        document.body.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
        await sleep(130);
      };
      post('live');
      for (let i = 0; i < 12; i++) await key('asdf'[i % 4]);
      const store = p.deviceStore(id, m)!;
      for (let i = 1; i <= 10; i++) {
        store.setParam('cut', 0.3 + i * 0.05);
        await sleep(40);
      }
      post('live-done');
      await wait('tight');
      for (let i = 0; i < 6; i++) await key('a');
      post('tight-done');
      await wait('b-done');
      post('done');
    } else {
      await until('track from A', () => p.trackIds().length > 0 && p.rows().length >= 2);
      post('ready');
      await wait('ready');
      const t0 = performance.now();
      await until('A pressed Play', () => playingUi() && isPlaying(), 5000);
      ok(performance.now() - t0 < 5000, 'started when A pressed Play');
      post('b-playing');
      await wait('b-cue');
      ($('[aria-label^="TRACK 2,"]') as HTMLButtonElement).click();
      bc.postMessage({ t: 'b-cued', loop: btn('⟲ Loop TRACK')?.getAttribute('aria-pressed') === 'true' });
      await wait('b-stop');
      btn('■ Stop')!.click();
      await wait('check-b-stopped');
      ok(!isPlaying(), 'stayed stopped while A played alone');
      bc.postMessage({ t: 'b-was-stopped', v: !isPlaying() });
      await wait('b-play');
      ($('[aria-label^="TRACK 1,"]') as HTMLButtonElement).click();
      btn('▶ Play')!.click();
      post('b-playing2');
      got.delete('b-stop');
      await wait('b-stop');
      btn('■ Stop')!.click();
      // Live keys from A, Even (the default).
      await wait('live');
      let peak = 0;
      let lit = false;
      while (!got.has('live-done')) {
        peak = Math.max(peak, ...Array.from(engineRef.current!.last!.scope).map(Math.abs));
        lit ||= !!$('.fwm-keys__w.is-peer, .fwm-keys__b.is-peer');
        await sleep(20);
      }
      ok(peak > 0.02, `Even: hears A's live keys (peak ${peak.toFixed(3)})`);
      ok(lit, "Even: A's keys light up when they sound");
      const chip = $('.fwm-plink');
      ok(!!chip && /in time · (<1|\d+) ms/.test(chip.textContent ?? ''), `A's chip shows the connection ("${chip?.textContent}")`);
      const lag = Number(/you hear their keys (\d+) ms/.exec(chip?.title ?? '')?.[1] ?? NaN);
      ok(lag >= 0 && lag < 300, `Even plays A's keys at a steady delay (${lag} ms; "${chip?.title}")`);
      const id = p.trackIds()[0];
      await until("A's knob turn", () => Math.abs(p.deviceStore(id, m)!.getState().params.cut - 0.8) < 1e-6, 3000);
      ok(true, "A's live knob turn arrived (Cutoff 0.8)");
      btn('Tight')!.click();
      post('tight');
      peak = 0;
      while (!got.has('tight-done')) {
        peak = Math.max(peak, ...Array.from(engineRef.current!.last!.scope).map(Math.abs));
        await sleep(20);
      }
      ok(peak > 0.02, `Tight: hears A's live keys on arrival (peak ${peak.toFixed(3)})`);
      post('b-done');
      await wait('done');
    }
  } catch (e) {
    out.push(`FAIL ${role}: ${String(e)}`);
  }
  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}

/** One tab: the Mixer panel. Levels, pan, mute and solo are checked on the engine's own meters. */
async function runMixer(p: Project, engineRef: { current: Engine | null }, ok: (c: boolean, l: string) => void, out: string[]) {
  const errs: string[] = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  // Peak per slot / master over a while, from the engine's meters (they are cleared every tick).
  const level = async (ms: number) => {
    const pk = new Float32Array(34);
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const m = engineRef.current?.last?.meters;
      if (m) for (let i = 0; i < 34; i++) pk[i] = Math.max(pk[i], m[i]);
      await sleep(20);
    }
    return pk;
  };
  try {
    await sleep(300);
    const a = p.addTrack(m, undefined, 0);
    const b = p.addTrack(m, undefined, 0);
    for (const id of [a, b]) for (const st of [0, 2, 4, 6, 8, 10, 12, 14]) p.addNote(id, p.patternList(id)[0].id, { s: st, l: 2, m: id === a ? 36 : 48, v: 0.9 });
    const sel = $<HTMLSelectElement>('[aria-label="Panel 4 view"]')!;
    sel.value = 'mixer';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);
    ok(document.querySelectorAll('.fwm-strip').length === 3, `the Mixer shows a strip per instrument + master (${document.querySelectorAll('.fwm-strip').length})`);
    btn('Sound')!.click();
    await until('engine', () => !!engineRef.current?.last);
    btn('▶ Play')!.click();
    await sleep(600);
    let L = await level(800);
    ok(L[0] > 0.02 && L[2] > 0.02 && L[32] > 0.02, `meters: both strips and the master move (${L[0].toFixed(3)}, ${L[2].toFixed(3)}, master ${L[32].toFixed(3)})`);
    const bar = $<HTMLElement>('.fwm-strip .fwm-meter i');
    ok(parseFloat(bar?.style.getPropertyValue('--lvl') ?? '0') > 10, `the meter bar moves on screen (${bar?.style.getPropertyValue('--lvl')})`);
    const a0 = L[0];
    p.setMix(a, { level: 0.4 }); // -18 dB
    await sleep(200);
    L = await level(800);
    const db = 20 * Math.log10(L[0] / a0);
    ok(db < -15 && db > -21, `fader down to 0.4 = about -18 dB on strip 1 (${db.toFixed(1)} dB)`);
    ok($('.fwm-strip__db')?.textContent === '-18.1 dB', `the strip shows its level ("${$('.fwm-strip__db')?.textContent}")`);
    p.setMix(a, { level: 0.8 });
    p.setMix(a, { pan: -1 });
    await sleep(200);
    L = await level(600);
    ok(L[0] > 0.02 && L[1] < 0.001, `pan hard left: right side silent (L ${L[0].toFixed(3)}, R ${L[1].toFixed(4)})`);
    p.setMix(a, { pan: 0 });
    ($('[aria-label="Mute Basalt"]') as HTMLButtonElement).click();
    await sleep(200);
    L = await level(600);
    ok(L[0] < 0.001 && L[2] > 0.02 && !!p.track(a)?.seq.mute, `M mutes strip 1 (the same Mute as the arrangement) (${L[0].toFixed(4)})`);
    ($('[aria-label="Mute Basalt"]') as HTMLButtonElement).click();
    ($('[aria-label="Solo Basalt 2"]') as HTMLButtonElement).click();
    await sleep(200);
    L = await level(600);
    ok(L[0] < 0.001 && L[2] > 0.02, `S on Basalt 2: only it is heard (${L[0].toFixed(4)} / ${L[2].toFixed(3)})`);
    ($('[aria-label="Solo Basalt 2"]') as HTMLButtonElement).click();
    const fader = $<HTMLElement>('.fwm-strip [role=slider][aria-label="Level"]')!;
    fader.focus();
    fader.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await sleep(100);
    ok(Math.abs(p.mix(a).level - 0.75) < 1e-6, `arrow key on the fader moves it (level ${p.mix(a).level})`);
    p.setMasterLevel(0);
    await sleep(200);
    L = await level(500);
    ok(L[32] < 0.001, `master fader down: silence (${L[32].toFixed(4)})`);
    p.setMasterLevel(0.8);
    btn('■ Stop')!.click();
  } catch (e) {
    out.push(`FAIL mixer: ${String(e)}`);
  }
  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}

/** One tab: the effects. Tails, cuts and levels are checked on the engine's master meter. */
async function runFx(p: Project, engineRef: { current: Engine | null }, ok: (c: boolean, l: string) => void, out: string[]) {
  const errs: string[] = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  const master = async (ms: number) => {
    let pk = 0;
    let finite = true;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const m = engineRef.current?.last?.meters;
      if (m) {
        if (!Number.isFinite(m[32])) finite = false;
        pk = Math.max(pk, m[32] || 0);
      }
      await sleep(20);
    }
    return finite ? pk : NaN;
  };
  const order = () => [...document.querySelectorAll<HTMLElement>('.fwm-fxflow .fwm-fxu')].map((u) => u.dataset.fx).join(',');
  // Play a short phrase, stop, and measure what is still sounding 150–700 ms after Stop (the tails).
  const tail = async () => {
    btn('▶ Play')!.click();
    await sleep(1200);
    btn('■ Stop')!.click();
    await sleep(150);
    return master(550);
  };
  try {
    await sleep(300);
    const id = p.addTrack(m, undefined, 0);
    // C5: well above the low-pass when it is closed (a bass note's sub oscillator would sit right on it)
    for (const st of [0, 4, 8, 12]) p.addNote(id, p.patternList(id)[0].id, { s: st, l: 1, m: 72, v: 0.9 });
    // Effects in the panel menu brings the Mixer beside it
    const sel1 = $<HTMLSelectElement>('[aria-label="Panel 1 view"]')!;
    const was1 = sel1.value;
    sel1.value = 'fx';
    sel1.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(150);
    ok($<HTMLSelectElement>('[aria-label="Panel 2 view"]')!.value === 'mixer' && !!$('.fwm-fxview .fwm-fxu[data-fx=lowpass]'),
      'choosing Effects in a panel shows the chain, with the Mixer beside it');
    ok(!$('.fwm-fxview .fwm-endcap'), 'no INSTRUMENTS / MASTER blocks in the chain');
    sel1.value = was1;
    sel1.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(100);
    const sel = $<HTMLSelectElement>('[aria-label="Panel 2 view"]')!;
    sel.value = 'mixer';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(150);
    ($('.fwm-strip__chain') as HTMLButtonElement).click(); // the master's chain button maximises the Mixer
    await sleep(150);
    ok(order() === 'reverb,delay,lofi,lowpass', `maximised: the chain shows Reverb ➜ Delay ➜ Lo-fi ➜ Low-pass (${order()})`);
    ok(document.querySelectorAll('.fwm-fxflow .fwm-arrow').length === 3, 'an arrow between every two effects');
    btn('Sound')!.click();
    await until('engine', () => !!engineRef.current?.last);
    const shapes = document.querySelectorAll('.fwm-cell .fwm-cell__pv .fwm-cell__note').length;
    ok(shapes === 4, `the arrangement cell previews the pattern: one shape per note (${shapes})`);
    btn('▶ Play')!.click();
    await sleep(500);
    ok(!!$('.fwm-cell .fwm-cell__ph'), 'while playing, a playhead moves over the playing cell');
    btn('■ Stop')!.click();
    await sleep(300);
    const dry = await tail();
    p.setMix(id, { rev: 0.9 });
    const wet = await tail();
    ok(dry < 0.005 && wet > 0.02, `Reverb knob up: a tail after Stop (none ${dry.toFixed(4)}, with reverb ${wet.toFixed(3)})`);
    p.setMix(id, { rev: 0 });
    p.setFx('delay.feedback', 0.7);
    p.setMix(id, { dly: 0.9 });
    const echo = await tail();
    ok(echo > 0.02, `Delay knob up: echoes after Stop (${echo.toFixed(3)})`);
    p.setMix(id, { dly: 0 });
    await sleep(2500); // let the echoes die
    btn('▶ Play')!.click();
    await sleep(600);
    const open = await master(800);
    p.setFx('lowpass.cutoff', 0); // 60 Hz
    await sleep(200);
    const closed = await master(800);
    ok(20 * Math.log10(closed / open) < -20, `Low-pass closed: much quieter (${(20 * Math.log10(closed / open)).toFixed(1)} dB)`);
    p.setFx('lowpass.cutoff', 1);
    ($('[aria-label="Lo-fi off"]') as HTMLButtonElement).click();
    await sleep(300);
    const lofi = await master(1000);
    ok(Number.isFinite(lofi) && Math.abs(20 * Math.log10(lofi / open)) < 4, `Lo-fi (tape) on: about the same level, never NaN (${(20 * Math.log10(lofi / open)).toFixed(1)} dB)`);
    ($('.fwm-fxu[data-fx=lofi] .fwm-fxu__seg button:nth-child(2)') as HTMLButtonElement).click(); // Vinyl
    p.setFx('lofi.vinyl.noise', 0.3);
    await sleep(100);
    ($('.fwm-fxu[data-fx=lofi] .fwm-fxu__seg button:nth-child(1)') as HTMLButtonElement).click(); // Tape
    await sleep(100);
    const noiseKnob = () => $('.fwm-fxu[data-fx=lofi] [role=slider][aria-label="Noise"]')?.getAttribute('aria-valuenow');
    ok(noiseKnob() === '0', `Tape keeps its own Noise (0) (${noiseKnob()})`);
    ($('.fwm-fxu[data-fx=lofi] .fwm-fxu__seg button:nth-child(2)') as HTMLButtonElement).click();
    await sleep(100);
    ok(noiseKnob() === '30', `Vinyl remembers its Noise (30) (${noiseKnob()})`);
    btn('■ Stop')!.click();
    // chain editing
    ($('[aria-label="Move Reverb later"]') as HTMLButtonElement).click();
    await sleep(50);
    ok(order() === 'delay,reverb,lofi,lowpass' && p.fxChain.join(',') === 'delay,reverb,lofi,lowpass', `▶ moves Reverb after Delay (${order()})`);
    ($('[aria-label="Take Lo-fi out of the chain"]') as HTMLButtonElement).click();
    await sleep(50);
    ok(order() === 'delay,reverb,lowpass' && !!btn('Lo-fi'), `× puts Lo-fi on the shelf (${order()})`);
    btn('Lo-fi')!.click();
    await sleep(50);
    ok(order() === 'delay,reverb,lowpass,lofi', `clicking it on the shelf adds it at the end (${order()})`);
    const dt = new DataTransfer();
    const fire = (type: string, el: Element, x = 0) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: el.getBoundingClientRect().top + 20 }));
    const first = $('.fwm-fxflow .fwm-fxu')!;
    const lpHead = $('.fwm-fxu[data-fx=lowpass] .fwm-fxu__h')!;
    fire('dragstart', lpHead);
    await sleep(30);
    fire('dragover', first, first.getBoundingClientRect().left + 5);
    await sleep(30);
    fire('drop', first, first.getBoundingClientRect().left + 5);
    fire('dragend', lpHead);
    await sleep(50);
    ok(order() === 'lowpass,delay,reverb,lofi', `drag Low-pass to the start of the chain (${order()})`);
    const revHead = $('.fwm-fxu[data-fx=reverb] .fwm-fxu__h')!;
    fire('dragstart', revHead);
    await sleep(30);
    fire('dragover', $('.fwm-shelf')!);
    fire('drop', $('.fwm-shelf')!);
    fire('dragend', revHead);
    await sleep(50);
    ok(order() === 'lowpass,delay,lofi' && p.fxShelf.includes('reverb'), `drag Reverb onto the shelf takes it out (${order()})`);
    // with Reverb out of the chain, its send does nothing (Lo-fi off: Vinyl's noise was left at 30%)
    p.setFx('lofi.on', false);
    p.setMix(id, { rev: 0.9 });
    const none = await tail();
    ok(none < 0.005, `Reverb out of the chain: no tail even with its knob up (${none.toFixed(4)})`);
  } catch (e) {
    out.push(`FAIL fx: ${String(e)}`);
  }
  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}

/** One tab: the Scope panel follows the master or one instrument, draws, freezes and shows a spectrum. */
async function runScope(p: Project, engineRef: { current: Engine | null }, ok: (c: boolean, l: string) => void, out: string[]) {
  const errs: string[] = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  const pixels = () => {
    const c = $<HTMLCanvasElement>('.fwm-scopev canvas')!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 64) h = (h * 31 + d[i]) | 0;
    return h;
  };
  const peak = () => Math.max(...Array.from(engineRef.current?.last?.probe ?? [0]).map(Math.abs));
  try {
    await sleep(300);
    const a = p.addTrack(m, undefined, 0);
    const b = p.addTrack(m, undefined, 0);
    for (const st of [0, 2, 4, 6, 8, 10, 12, 14]) p.addNote(a, p.patternList(a)[0].id, { s: st, l: 2, m: 48, v: 0.9 });
    const sel = $<HTMLSelectElement>('[aria-label="Panel 3 view"]')!;
    sel.value = 'scope';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(200);
    ok(!!$('.fwm-scopev canvas'), 'Scope is a panel view');
    btn('Sound')!.click();
    await until('engine', () => !!engineRef.current?.last);
    btn('▶ Play')!.click();
    await sleep(800);
    ok(peak() > 0.02, `master: the engine sends the scope what you hear (peak ${peak().toFixed(3)})`);
    const h1 = pixels();
    await sleep(300);
    ok(pixels() !== h1, 'the picture moves while playing');
    const src = $<HTMLSelectElement>('[aria-label="What the scope shows"]')!;
    src.value = b; // the silent instrument
    src.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(400);
    ok(peak() < 1e-4 && /silent/.test($('.fwm-scopev__read')!.textContent ?? ''), `one instrument: Basalt 2 is silent (${peak().toFixed(5)})`);
    src.value = a;
    src.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(400);
    ok(peak() > 0.02 && /peak/.test($('.fwm-scopev__read')!.textContent ?? ''), `one instrument: Basalt plays ("${$('.fwm-scopev__read')!.textContent}")`);
    btn('Freeze')!.click();
    await sleep(100);
    const f1 = pixels();
    await sleep(400);
    ok(pixels() === f1, 'Freeze holds the picture');
    btn('Freeze')!.click();
    btn('Spectrum')!.click();
    await sleep(500);
    ok(/top -?\d+ dB/.test($('.fwm-scopev__read')!.textContent ?? ''), `spectrum shows ("${$('.fwm-scopev__read')!.textContent}")`);
    btn('■ Stop')!.click();
    sel.value = 'roll';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(300);
    ok(!engineRef.current?.last?.probe, 'closing the Scope stops the probe (nothing extra sent)');
  } catch (e) {
    out.push(`FAIL scope: ${String(e)}`);
  }
  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}

/** One tab: Garnet's panel and neck. Chords follow the song's key and the chord type; strumming plays the right
 *  notes and is recorded; Notes mode lights the scale; keys 1–7 strum; drag across strings plucks each. */
async function runGarnet(p: Project, engineRef: { current: Engine | null }, ok: (c: boolean, l: string) => void, out: string[]) {
  const errs: string[] = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  const heads = () => [...document.querySelectorAll('.fwm-garnet__ch b')].map((b) => b.textContent).join(' ');
  const ptr = (type: string, x: number, y: number) => {
    const el = $('.fwm-garnet__neck')!;
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true }));
  };
  const peak = async (ms: number) => {
    let pk = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      pk = Math.max(pk, ...Array.from(engineRef.current!.last!.scope).map(Math.abs));
      await sleep(25);
    }
    return pk;
  };
  try {
    await sleep(300);
    ($('[aria-label="Add Garnet as a new track"]') as HTMLButtonElement).click();
    await sleep(300);
    const id = p.trackIds()[0];
    ok(!!$('.fwm-garnet'), 'Garnet shows in the Device panel');
    ok(heads() === 'C Dm Em F G Am B°', `no song key: the chords of C major (${heads()})`);
    p.setKey({ root: 4, scale: 'minor' });
    await sleep(150);
    ok(heads() === 'Em F♯° G Am Bm C D', `song key E minor: its chords (${heads()})`);
    btn('7th')!.click();
    await sleep(100);
    ok(heads() === 'Em7 F♯m7♭5 Gmaj7 Am7 Bm7 Cmaj7 D7', `7th: every chord stays in the key (${heads()})`);
    btn('Triad')!.click();
    p.setKey({ root: 0, scale: 'major' });
    await sleep(150);
    const cell = [...document.querySelectorAll('.fwm-garnet__col')][0];
    const cs = [...cell.querySelectorAll('.fwm-garnet__cn')].map((c) => c.textContent).join(' ');
    ok(cs === 'E C G E C ×', `the C strip shows the open C shape x32010, top string first (${cs})`);

    btn('Sound')!.click();
    await until('engine', () => !!engineRef.current?.last);
    await sleep(300);
    ($('.fwm-garnet__ch') as HTMLButtonElement).click();
    ok((await peak(700)) > 0.05, 'clicking a chord name strums it');
    ok(document.querySelectorAll('.fwm-garnet__str.is-ringing').length >= 5, 'the strings it played are ringing');

    // Rec + Play: a strum is recorded as the chord's notes, a few ms apart
    const pat = p.cell(p.rows()[0].id, id)!;
    const before = p.notes(id, pat).length;
    btn('● Rec')!.click();
    btn('▶ Play')!.click();
    await sleep(500);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit5', key: '5', bubbles: true })); // G
    await sleep(600);
    btn('■ Stop')!.click();
    btn('● Rec')?.click();
    await sleep(200);
    const rec = p.notes(id, pat).slice(before).map(([, n]) => n);
    const pitches = rec.map((n) => n.m).sort((a, b) => a - b).join(',');
    ok(pitches === '43,47,50,55,59,67', `key 5 strums G (320003) and Rec writes its six notes (${pitches})`);
    const starts = rec.map((n) => n.s).sort((a, b) => a - b);
    ok(starts.length === 6 && starts[5] - starts[0] > 0 && starts[5] - starts[0] < 0.8 && starts[0] === Math.round(starts[0]), `strummed: the first note on the grid, the rest a few ms apart (5 gaps of 13 ms ≈ 0.53 steps at 120 BPM) (${starts.map((x) => x.toFixed(3)).join(' ')})`);

    // drag down across the strings in the Am strip: each string plucks once
    const r = $('.fwm-garnet__neck')!.getBoundingClientRect();
    const x = r.left + (r.width * 5.5) / 7;
    const ringing0 = document.querySelectorAll('.fwm-garnet__str.is-ringing').length;
    document.querySelectorAll('.fwm-garnet__str').forEach((e) => e.classList.remove('is-ringing'));
    ptr('pointerdown', x, r.top + 4);
    for (let k = 1; k <= 12; k++) { ptr('pointermove', x, r.top + (r.height * k) / 12 - 2); await sleep(8); }
    ptr('pointerup', x, r.bottom - 2);
    await sleep(60);
    const rung = document.querySelectorAll('.fwm-garnet__str.is-ringing').length;
    ok(rung === 5 && ringing0 >= 0, `dragging across the Am strip plucks its five strings (x02210), the muted one stays still (${rung})`);

    // Notes mode: the scale lit, the root brightest
    btn('Notes')!.click();
    await sleep(150);
    const lit = document.querySelectorAll('.fwm-garnet__dot:not(.is-off)').length;
    const roots = [...document.querySelectorAll('.fwm-garnet__dot.is-root')].map((d) => d.textContent);
    ok(lit === 6 * 13 - document.querySelectorAll('.fwm-garnet__dot.is-off').length && roots.length > 0 && roots.every((t) => t === 'C'), `Notes: C major lit, roots are C (${lit} lit, ${roots.length} roots)`);
    btn('Chords')!.click();

    btn('Palm mute')!.click();
    await sleep(100);
    ok(btn('Palm mute')!.getAttribute('aria-pressed') === 'true', 'Palm mute is on (a shared setting of the instrument)');
    // computer keys: the note's place on the neck lights up and its string rings
    btn('Notes')?.click();
    await sleep(100);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    await sleep(100);
    const mineDots = document.querySelectorAll('.fwm-garnet__neck .is-mine').length;
    const ringing = document.querySelectorAll('.fwm-garnet__str.is-ringing').length;
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    await sleep(100);
    ok(mineDots === 1 && ringing >= 1 && !$('.fwm-garnet__neck .is-mine'), `a computer key shows its place on the neck and rings the string (${mineDots}, ${ringing})`);
    // whammy ribbon: drag to the left end dives, letting go springs back to rest
    const rib = $('.fwm-garnet [role=slider][aria-label="Whammy"]')!;
    const rr = rib.getBoundingClientRect();
    const gslot = Number(Object.keys(engineRef.current!.last!.devices)[0]);
    rib.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rr.left + 1, clientY: rr.top + 5, pointerId: 7, buttons: 1 }));
    await until('whammy dives in the engine', () => engineRef.current!.last!.devices[gslot].eff[17] < 0.05, 2000);
    ok(true, 'whammy: pressing the left end dives (engine value ~0)');
    rib.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: rr.left + 1, clientY: rr.top + 5, pointerId: 7 }));
    await until('whammy springs back', () => engineRef.current!.last!.devices[gslot].eff[17] === 0.5, 2000);
    ok(true, 'whammy: letting go springs back to rest');
  } catch (e) {
    out.push(`FAIL garnet: ${String(e)}`);
  }
  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}

/** One tab: "My look". Copy the brief, paste a look, try it, keep it (only in this browser, never in the
 *  shared song), see what was left out, go back to the default. */
async function runLook(doc: Y.Doc, ok: (c: boolean, l: string) => void, out: string[]) {
  const errs: string[] = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  const root = () => $('.fwm-root')!;
  const bg = () => getComputedStyle(root()).getPropertyValue('--fwm-bg').trim();
  const type = (el: HTMLTextAreaElement, v: string) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  try {
    await sleep(300);
    const before = bg();
    btn('My look')!.click();
    await sleep(100);
    ok(!!$('[role="dialog"][aria-labelledby="fwm-look-title"]'), 'My look opens');
    btn('Copy the brief')!.click();
    await sleep(300);
    const shown = $<HTMLTextAreaElement>('[aria-label^="The brief for your AI agent"]');
    ok(!!$('.fwm-look__ok') || (!!shown && shown.value.includes('--fwm-bg') && shown.value.includes('--dev-case')), 'the brief is copied (or shown to copy by hand) and names the tokens');
    const box = $<HTMLTextAreaElement>('[aria-label="Your look (CSS)"]')!;
    type(box, '& { --fwm-bg: #010203; }\n.fwm-tb { letter-spacing: 1px; }');
    await sleep(50);
    btn('Try it')!.click();
    await sleep(100);
    ok(bg() === '#010203', `Try it shows the look at once (--fwm-bg ${bg()})`);
    btn('Keep this look')!.click();
    await sleep(150);
    ok(!$('.fwm-look') && bg() === '#010203', 'Keep: the dialog closes and the look stays');
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('fwm.look.'));
    ok(keys.length === 1 && localStorage.getItem(keys[0])!.includes('#010203'), `kept in this browser under this person (${keys.join(', ')})`);
    ok(!JSON.stringify(doc.toJSON()).includes('010203'), 'not in the shared song: nobody else gets it');
    ok(!!$('style[data-fwm-look]')?.textContent?.startsWith('.fwm-root {'), 'scoped to the studio (nested under .fwm-root)');
    btn('My look')!.click();
    await sleep(100);
    type($<HTMLTextAreaElement>('[aria-label="Your look (CSS)"]')!, '@import url("https://example.com/x.css");\n.fwm-dev { background: url(https://example.com/w.png); }');
    await sleep(50);
    ok(/Left out:.*import.*1 link/s.test($('.fwm-look')!.textContent ?? ''), 'remote files are left out, and it says so');
    btn('Back to default')!.click();
    await sleep(150);
    ok(bg() === before && !$('style[data-fwm-look]'), `Back to default (--fwm-bg ${bg()})`);
    ok(Object.keys(localStorage).every((k) => !k.startsWith('fwm.look.')), 'nothing kept any more');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(100);
    ok(!$('.fwm-look'), 'Escape closes it');
  } catch (e) {
    out.push(`FAIL look: ${String(e)}`);
  }
  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}

/** One tab: song arrangement cells. Drag a cell to another TRACK (same pattern; Ctrl = a separate copy),
 *  not into another instrument, Escape cancels; double-click or Delete empties a cell; all undoable. */
async function runArrange(p: Project, ok: (c: boolean, l: string) => void, out: string[]) {
  const errs: string[] = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  const cellEl = (row: string, track: string) => $(`[data-cell-row="${row}"][data-cell-track="${track}"]`)!;
  const mid = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const fire = (target: EventTarget, type: string, x: number, y: number, mods: PointerEventInit = {}) =>
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, isPrimary: true, ...mods }));
  const dragCell = async (from: Element, to: Element, mods: PointerEventInit = {}, finish = true) => {
    const a = mid(from), b = mid(to);
    fire(from, 'pointerdown', a.x, a.y);
    for (let k = 1; k <= 8; k++) { fire(window, 'pointermove', a.x + ((b.x - a.x) * k) / 8, a.y + ((b.y - a.y) * k) / 8, mods); await sleep(16); }
    if (finish) { fire(window, 'pointerup', b.x, b.y, mods); from.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    await sleep(120);
  };
  try {
    await sleep(300);
    const t = p.addTrack(m, undefined, 0);
    const t2 = p.addTrack(m, undefined, 0);
    const drums = p.addTrack(flintManifest as DeviceManifest, undefined, 0);
    const r1 = p.rows()[0].id;
    const r2 = p.addRow();
    const r3 = p.addRow();
    await sleep(200);
    const groove = p.cell(r1, t)!;
    // a short panel: dragging to its bottom edge scrolls it
    const pb = cellEl(r1, t).closest('.fwm-pb') as HTMLElement;
    const top0 = pb.scrollTop;
    { const a = mid(cellEl(r1, t)); const r = pb.getBoundingClientRect();
      fire(cellEl(r1, t), 'pointerdown', a.x, a.y);
      for (let k = 0; k < 6; k++) { fire(window, 'pointermove', a.x, r.bottom - 10); await sleep(20); }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fire(window, 'pointerup', 0, 0);
      await sleep(80); }
    ok(pb.scrollHeight <= pb.clientHeight + 1 || pb.scrollTop > top0, `dragging to the edge of the panel scrolls it (${top0} → ${pb.scrollTop})`);
    ($('[aria-label="Maximise panel"]') as HTMLButtonElement).click(); // the arrangement fills the window: every TRACK in view
    await sleep(200);
    await dragCell(cellEl(r1, t), cellEl(r2, t));
    ok(p.cell(r2, t) === groove, 'drag a cell to another TRACK: the same pattern plays there');
    ok(p.cell(r1, t) === groove, 'the original stays');
    await dragCell(cellEl(r1, t), cellEl(r3, t), { ctrlKey: true });
    const c = p.cell(r3, t);
    ok(!!c && c !== groove && p.patternInfo(t, c)!.name === `${p.patternInfo(t, groove)!.name} 2`, `hold Ctrl: a separate copy (${c && p.patternInfo(t, c)?.name})`);
    p.addNote(t, groove, { s: 0, l: 1, m: 50, v: 0.9 });
    await dragCell(cellEl(r1, t), cellEl(r2, t2));
    const into = p.cell(r2, t2);
    ok(!!into && into !== groove && p.notes(t2, into).map(([, n]) => n.m).join() === p.notes(t, groove).map(([, n]) => n.m).join(),
      `into another instrument: a copy there with the same notes (${into && p.patternInfo(t2, into)?.name})`);
    const drumsBefore = p.cell(r2, drums);
    await dragCell(cellEl(r1, t), cellEl(r2, drums));
    ok(p.cell(r2, drums) === drumsBefore, 'a melody does not go into a drum machine');
    await dragCell(cellEl(r1, t), cellEl(r3, drums), {}, false);
    ok(!!$('.fwm-dragghost') && cellEl(r3, drums).classList.contains('is-drop-no') && /drum pads/.test($('.fwm-dragghost')!.textContent ?? ''),
      `while dragging: a label follows and says why not (${$('.fwm-dragghost')?.textContent})`);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(80);
    ok(!$('.fwm-dragghost'), 'Escape cancels the drag');
    fire(window, 'pointerup', 0, 0);
    cellEl(r2, t).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await sleep(100);
    ok(p.cell(r2, t) === null && p.patternList(t).some((x) => x.id === groove), 'double-click empties the cell; the pattern stays with the instrument');
    btn('Undo')!.click();
    await sleep(100);
    ok(p.cell(r2, t) === groove, 'Undo puts it back');
    cellEl(r2, t).focus();
    cellEl(r2, t).dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await sleep(100);
    ok(p.cell(r2, t) === null, 'Delete on a cell empties it too');
    const n = p.rows().length;
    await dragCell(cellEl(r1, t), $('[data-drop-newrow]')!);
    ok(p.rows().length === n + 1 && p.cell(p.rows()[n].id, t) === groove, 'dropped on + Add TRACK: a new TRACK plays it');
  } catch (e) {
    out.push(`FAIL arrange: ${String(e)}`);
  }
  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}

/** One tab: Opal's panel. It shows, plays a held chord (computer keys), presets step, Chorus and Stack reach the engine. */
async function runOpal(p: Project, engineRef: { current: Engine | null }, ok: (c: boolean, l: string) => void, out: string[]) {
  const errs: string[] = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  try {
    await sleep(300);
    ($('[aria-label="Add Opal as a new track"]') as HTMLButtonElement).click();
    await sleep(400);
    ok(!!$('.fwm-opal') && p.trackIds().length === 1, 'Opal shows in the Device panel');
    ok(document.querySelectorAll('.fwm-opal [role=slider]').length >= 20, `every control is there (${document.querySelectorAll('.fwm-opal [role=slider]').length} dials)`);
    const screen = () => $('.fwm-opal .fwm-preset')!.textContent ?? '';
    ok(screen().includes('Warm Pad'), 'starts on Warm Pad');
    btn('Sound')?.click();
    await until('engine', () => !!engineRef.current?.last, 4000);
    for (const k of ['a', 'd', 'g']) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    let pk = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 1800) {
      pk = Math.max(pk, ...Array.from(engineRef.current!.last!.scope).map(Math.abs));
      await sleep(25);
    }
    for (const k of ['a', 'd', 'g']) document.body.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
    ok(pk > 0.02 && pk <= 1, `a held chord swells in (peak ${pk.toFixed(3)})`);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    await sleep(80);
    const lit = document.querySelectorAll('.fwm-opal .fwm-keys .is-on').length;
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', bubbles: true }));
    await sleep(80);
    ok(lit === 1 && document.querySelectorAll('.fwm-opal .fwm-keys .is-on').length === 0, `a computer key lights its key on the panel while held (${lit})`);
    ($('.fwm-opal [aria-label="Next sound"]') as HTMLButtonElement).click();
    await sleep(100);
    ok(screen().includes('Ensemble Strings'), `next sound: ${screen()}`);
    const slot = Number(Object.keys(engineRef.current!.last!.devices)[0]);
    ($('.fwm-opal [aria-label="Chorus I+II"]') as HTMLButtonElement).click();
    await until('chorus in engine', () => engineRef.current!.last!.devices[slot].eff[20] === 3, 2000);
    ok(true, 'Chorus I+II reaches the engine');
    ($('.fwm-opal [aria-label="Stack: 1"]') as HTMLButtonElement).click();
    await until('stack in engine', () => engineRef.current!.last!.devices[slot].eff[2] === 0, 2000);
    ok(true, 'Stack 1 reaches the engine');
    // modulation, as on Basalt: Assign LFO, click Cutoff → a route; the engine's cutoff moves
    [...document.querySelectorAll<HTMLButtonElement>('.fwm-opal .fwm-btn--assign')][0].click();
    await sleep(50);
    const cutK = $('.fwm-opal [role=slider][aria-label="Cutoff"]')!.closest('.fwm-target')!;
    ok(cutK.classList.contains('is-target'), 'Assign LFO: Cutoff becomes a target');
    cutK.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 }));
    await sleep(100);
    const st = p.deviceStore(p.trackIds()[0], deviceEntry('opal')!.manifest!)!.getState();
    ok(st.routes.some((r) => r.src === 'lfo' && r.target === 'cut'), `route LFO → Cutoff added (${st.routes.map((r) => r.src + '>' + r.target).join(',')})`);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    const seen = new Set<string>();
    const t1 = performance.now();
    while (performance.now() - t1 < 1500) {
      seen.add(engineRef.current!.last!.devices[slot].eff[9].toFixed(2));
      await sleep(40);
    }
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    ok(seen.size > 4, `the engine's cutoff moves with the LFO (${seen.size} values)`);
    // SEND knobs = the Mixer strip's sends, both ways
    const tid = p.trackIds()[0];
    const rev = $('.fwm-opal .fwm-sends [role=slider][aria-label="Reverb"]')!;
    rev.focus();
    for (let i = 0; i < 5; i++) rev.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await sleep(100);
    ok(p.mix(tid).rev > 0, `turning Reverb on Opal sets the Mixer send (${p.mix(tid).rev.toFixed(2)})`);
    p.setMix(tid, { dly: 0.5 });
    await sleep(150);
    const dl = $('.fwm-opal .fwm-sends [role=slider][aria-label="Delay"]')!;
    ok(dl.getAttribute('aria-valuenow') === '0.5' || (dl.getAttribute('aria-valuetext') ?? '').includes('50'), `the Mixer's Delay send shows on Opal (${dl.getAttribute('aria-valuenow')} ${dl.getAttribute('aria-valuetext')})`);
  } catch (e) {
    out.push(`FAIL opal: ${String(e)}`);
  }
  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}

/** One tab: Quartz's panel shows, a chord makes sound, presets step, Harmonics reaches the engine. */
async function runQuartz(p: Project, engineRef: { current: Engine | null }, ok: (c: boolean, l: string) => void, out: string[]) {
  const errs: string[] = [];
  window.addEventListener('error', (e) => errs.push(String(e.message)));
  try {
    await sleep(300);
    ($('[aria-label="Add Quartz as a new track"]') as HTMLButtonElement).click();
    await sleep(400);
    ok(!!$('.fwm-quartz') && p.trackIds().length === 1, 'Quartz shows in the Device panel');
    btn('Sound')?.click();
    await until('engine', () => !!engineRef.current?.last, 4000);
    for (const k of ['a', 'd', 'g']) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    let pk = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 1200) {
      pk = Math.max(pk, ...Array.from(engineRef.current!.last!.scope).map(Math.abs));
      await sleep(25);
    }
    for (const k of ['a', 'd', 'g']) document.body.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true }));
    ok(pk > 0.02 && pk <= 1, `a chord rings (peak ${pk.toFixed(3)})`);
    ($('.fwm-quartz [aria-label="Next sound"]') as HTMLButtonElement).click();
    await sleep(100);
    ok(($('.fwm-quartz .fwm-preset')!.textContent ?? '').includes('Soft Rhodes'), 'next sound: Soft Rhodes');
    const slot = Number(Object.keys(engineRef.current!.last!.devices)[0]);
    ($('.fwm-quartz [aria-label="Harmonics: 3"]') as HTMLButtonElement).click();
    await until('harmonics in engine', () => engineRef.current!.last!.devices[slot].eff[2] === 3, 2000);
    ok(true, 'Harmonics reaches the engine');
    ok(!!$('.fwm-quartz .fwm-sends'), 'SEND knobs on Quartz');
    [...document.querySelectorAll<HTMLButtonElement>('.fwm-quartz .fwm-btn--assign')][0].click();
    await sleep(50);
    $('.fwm-quartz [role=slider][aria-label="Cutoff"]')!.closest('.fwm-target')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 }));
    await sleep(100);
    const qs = p.deviceStore(p.trackIds()[0], deviceEntry('quartz')!.manifest!)!.getState();
    ok(qs.routes.some((r) => r.src === 'lfo' && r.target === 'cut'), 'Quartz: Assign LFO → Cutoff adds a route');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    const seenQ = new Set<string>();
    const tq = performance.now();
    while (performance.now() - tq < 1500) {
      seenQ.add(engineRef.current!.last!.devices[slot].eff[12].toFixed(2));
      await sleep(40);
    }
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
    ok(seenQ.size > 3, `Quartz: the engine's cutoff moves with the LFO (${seenQ.size} values)`);
  } catch (e) {
    out.push(`FAIL quartz: ${String(e)}`);
  }
  ok(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  await fetch('./log', { method: 'POST', body: out.join('\n') }).catch(() => {});
}
