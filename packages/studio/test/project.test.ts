// Two people, two Y.Docs, synced both ways: concurrent edits merge, and undo only undoes your own work.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import manifestJson from '@fwm/engine/devices/basalt.json';
import type { DeviceManifest } from '@fwm/engine';
import { Project } from '../src/model/project';

const m = manifestJson as DeviceManifest;

function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(b, u, 'remote'));
  b.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(a, u, 'remote'));
  return [new Project(a, { user: 'you' }), new Project(b, { user: 'mira' })] as const;
}

describe('Project (shared)', () => {
  it('a track added by one person shows up for the other, with its device state', () => {
    const [you, mira] = pair();
    const id = you.addTrack(m);
    expect(mira.tracks().map((t) => t.name)).toEqual(['Basalt']);
    you.addTrack(m);
    expect(mira.tracks().map((t) => t.name)).toEqual(['Basalt', 'Basalt 2']);
    mira.deviceStore(id, m)!.setParam('cut', 0.9);
    expect(you.deviceStore(id, m)!.getState().params.cut).toBe(0.9);
  });

  it('concurrent edits to different things both survive', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const you = new Project(a, {});
    const id = you.addTrack(m);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const mira = new Project(b, {});
    // offline at the same time
    you.addNote(id, 0, { s: 0, l: 1, m: 36, v: 1 });
    mira.addNote(id, 0, { s: 4, l: 1, m: 38, v: 1 });
    you.deviceStore(id, m)!.setParam('res', 0.1);
    mira.deviceStore(id, m)!.setParam('cut', 0.2);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    for (const p of [you, mira]) {
      expect(p.notes(id, 0).map(([, n]) => n.m)).toEqual([36, 38]);
      expect(p.deviceStore(id, m)!.getState().params).toMatchObject({ res: 0.1, cut: 0.2 });
    }
  });

  it('undo only undoes your own changes', () => {
    const [you, mira] = pair();
    const id = you.addTrack(m);
    you.undoManager.clear();
    you.deviceStore(id, m)!.setParam('cut', 0.8);
    you.undoManager.stopCapturing();
    mira.deviceStore(id, m)!.setParam('res', 0.2);
    mira.addNote(id, 0, { s: 0, l: 1, m: 40, v: 1 });
    you.undo();
    const st = you.deviceStore(id, m)!.getState().params;
    expect(st.cut).toBe(m.params.find((p) => p.id === 'cut')!.default); // yours: undone
    expect(st.res).toBe(0.2); // Mira's: kept
    expect(mira.notes(id, 0)).toHaveLength(1);
    you.redo();
    expect(mira.deviceStore(id, m)!.getState().params.cut).toBe(0.8);
  });

  it('clear pattern is undoable', () => {
    const [you] = pair();
    const id = you.addTrack(m);
    you.addNote(id, 1, { s: 0, l: 1, m: 36, v: 1 });
    you.setAutomation(id, 1, 'cut', 3, 0.7);
    you.undoManager.stopCapturing();
    you.clearPattern(id, 1);
    expect(you.notes(id, 1)).toHaveLength(0);
    you.undo();
    expect(you.notes(id, 1)).toHaveLength(1);
    expect(you.automation(id, 1, 'cut')[3]).toBe(0.7);
  });

  it('notes keep micro-timing and are clamped to the pattern', () => {
    const [you] = pair();
    const id = you.addTrack(m);
    const n = you.addNote(id, 0, { s: 3.37, l: 40, m: 200, v: 2 })!;
    expect(you.notes(id, 0)[0][1]).toEqual({ s: 3.37, l: 12.63, m: 127, v: 1 });
    you.quantize(id, 0, 0.25);
    expect(you.notes(id, 0)[0][1].s).toBe(3.25);
    you.deleteNote(id, 0, n);
    expect(you.notes(id, 0)).toHaveLength(0);
  });

  it('removing a track removes its patterns everywhere', () => {
    const [you, mira] = pair();
    const id = you.addTrack(m);
    mira.addNote(id, 2, { s: 0, l: 1, m: 36, v: 1 });
    mira.removeTrack(id);
    expect(you.tracks()).toEqual([]);
    expect(you.notes(id, 2)).toEqual([]);
  });

  it('per-track sequencer settings and transport are shared', () => {
    const [you, mira] = pair();
    const id = you.addTrack(m);
    mira.setSeq(id, { len: 99, dir: 'pp', rate: 2 });
    expect(you.track(id)!.seq).toMatchObject({ len: 16, dir: 'pp', rate: 2 });
    you.setBpm(132);
    mira.setSwing(0.9);
    expect([mira.bpm, you.swing]).toEqual([132, 0.6]);
  });
});

describe('Project (undo of structure)', () => {
  it('undoing a track removal brings back a working track and device store', () => {
    const [you, mira] = pair();
    const id = you.addTrack(m);
    you.deviceStore(id, m)!.setParam('cut', 0.77);
    you.addNote(id, 0, { s: 2, l: 1, m: 40, v: 1 });
    you.undoManager.stopCapturing();
    mira.deviceStore(id, m); // Mira has it cached
    you.removeTrack(id);
    you.undo();
    expect(mira.tracks().map((t) => t.id)).toEqual([id]);
    expect(mira.deviceStore(id, m)!.getState().params.cut).toBe(0.77);
    expect(mira.notes(id, 0)).toHaveLength(1);
    mira.deviceStore(id, m)!.setParam('res', 0.3);
    expect(you.deviceStore(id, m)!.getState().params.res).toBe(0.3);
  });
});
