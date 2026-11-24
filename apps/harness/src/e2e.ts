// In-page end-to-end test for two tabs (no browser automation needed). Results are POSTed to ./log.
//   tab A: ?e2e=a&room=R   plays, turns Cutoff, adds a note, plays a key
//   tab B: ?e2e=b&room=R   checks it sees and hears all of that, and that its undo is its own
import basaltManifest from '@fwm/engine/devices/basalt.json';
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
    // Loop TRACK: click TRACK 2 while playing → it plays at once and keeps repeating.
    btn('⟲ Loop TRACK')!.click();
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
