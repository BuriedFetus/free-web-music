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
  try {
    await until('a peer', () => s.awareness.getStates().size >= 2, 10000);
    if (role === 'a') {
      if (!p.trackIds().length) {
        const id = p.addTrack(m, undefined, 0);
        for (const st of [0, 4, 8, 12]) p.addNote(id, 0, { s: st, l: 1, m: 36, v: 0.9 });
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
      p.addNote(id, 0, { s: 5.5, l: 0.5, m: 43, v: 0.7 });
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
      await until("A's note", () => p.notes(id, 0).some(([, n]) => n.m === 43 && n.s === 5.5));
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
