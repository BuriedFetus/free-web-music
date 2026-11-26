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
    const P = you.patternList(id)[0].id;
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const mira = new Project(b, {});
    // offline at the same time
    you.addNote(id, P, { s: 0, l: 1, m: 36, v: 1 });
    mira.addNote(id, P, { s: 4, l: 1, m: 38, v: 1 });
    you.deviceStore(id, m)!.setParam('res', 0.1);
    mira.deviceStore(id, m)!.setParam('cut', 0.2);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    for (const p of [you, mira]) {
      expect(p.notes(id, P).map(([, n]) => n.m)).toEqual([36, 38]);
      expect(p.deviceStore(id, m)!.getState().params).toMatchObject({ res: 0.1, cut: 0.2 });
    }
  });

  it('undo only undoes your own changes', () => {
    const [you, mira] = pair();
    const id = you.addTrack(m);
    const P = you.patternList(id)[0].id;
    you.undoManager.clear();
    you.deviceStore(id, m)!.setParam('cut', 0.8);
    you.undoManager.stopCapturing();
    mira.deviceStore(id, m)!.setParam('res', 0.2);
    mira.addNote(id, P, { s: 0, l: 1, m: 40, v: 1 });
    you.undo();
    const st = you.deviceStore(id, m)!.getState().params;
    expect(st.cut).toBe(m.params.find((p) => p.id === 'cut')!.default); // yours: undone
    expect(st.res).toBe(0.2); // Mira's: kept
    expect(mira.notes(id, P)).toHaveLength(1);
    you.redo();
    expect(mira.deviceStore(id, m)!.getState().params.cut).toBe(0.8);
  });

  it('song arrangement: place a pattern in another TRACK (same or a copy), empty a cell; each one undo step', () => {
    const [you, mira] = pair();
    const t = you.addTrack(m, undefined, 0);
    const r1 = you.rows()[0].id;
    const r2 = you.addRow();
    const groove = you.cell(r1, t)!;
    // same pattern: both cells play it, edits change both
    expect(you.placePattern(r2, t, groove)?.pat).toBe(groove);
    expect(mira.cell(r2, t)).toBe(groove);
    you.undo();
    expect(you.cell(r2, t)).toBeNull();
    // a separate copy: a new pattern with the same notes and length, named after it
    you.addNote(t, groove, { s: 0, l: 1, m: 48, v: 0.8 });
    const copy = you.placePattern(r2, t, groove, true)!.pat;
    expect(copy).not.toBe(groove);
    expect(you.notes(t, copy).map(([, n]) => n.m)).toEqual(you.notes(t, groove).map(([, n]) => n.m));
    expect(you.patternInfo(t, copy)!.name).toBe(`${you.patternInfo(t, groove)!.name} 2`);
    expect(mira.cell(r2, t)).toBe(copy);
    you.undo(); // one step: the copy and the cell both go
    expect(you.cell(r2, t)).toBeNull();
    expect(you.patternList(t).map((p) => p.id)).toEqual([groove]);
    // empty a cell (double-click): the pattern stays with the instrument
    you.setCell(r1, t, null);
    expect(you.cell(r1, t)).toBeNull();
    expect(you.patternList(t).map((p) => p.id)).toEqual([groove]);
    you.undo();
    expect(you.cell(r1, t)).toBe(groove);
    // into another instrument: a copy there, with the same notes, one undo step
    const t2 = you.addTrack(m, undefined, 0);
    const before = you.patternList(t2).length;
    const moved = you.placePattern(r2, t2, groove, false, t)!;
    expect(moved.pat).not.toBe(groove);
    expect(you.cell(r2, t2)).toBe(moved.pat);
    expect(you.notes(t2, moved.pat).map(([, n]) => n.m)).toEqual(you.notes(t, groove).map(([, n]) => n.m));
    expect(you.patternList(t2).length).toBe(before + 1);
    you.undo();
    expect(you.patternList(t2).length).toBe(before);
    // onto "+ Add TRACK": a new TRACK at the end plays it
    const rows = you.rows().length;
    const nr = you.placePattern(null, t, groove)!;
    expect(you.rows().length).toBe(rows + 1);
    expect(you.rows()[rows].id).toBe(nr.row);
    expect(you.cell(nr.row, t)).toBe(groove);
    you.undo();
    expect(you.rows().length).toBe(rows);
  });

  it('clear pattern is undoable', () => {
    const [you] = pair();
    const id = you.addTrack(m);
    const P = you.patternList(id)[0].id;
    you.addNote(id, P, { s: 0, l: 1, m: 36, v: 1 });
    you.setAutomation(id, P, 'cut', 3, 0.7);
    you.undoManager.stopCapturing();
    you.clearPattern(id, P);
    expect(you.notes(id, P)).toHaveLength(0);
    you.undo();
    expect(you.notes(id, P)).toHaveLength(1);
    expect(you.automation(id, P, 'cut')[3]).toBe(0.7);
  });

  it('notes keep micro-timing and are clamped to the pattern', () => {
    const [you] = pair();
    const id = you.addTrack(m);
    const P = you.patternList(id)[0].id;
    const n = you.addNote(id, P, { s: 3.37, l: 600, m: 200, v: 2 })!;
    expect(you.notes(id, P)[0][1]).toEqual({ s: 3.37, l: 508.63, m: 127, v: 1 }); // 32 bars (128 beats) max
    you.quantize(id, P, 0.25);
    expect(you.notes(id, P)[0][1].s).toBe(3.25);
    you.deleteNote(id, P, n);
    expect(you.notes(id, P)).toHaveLength(0);
  });

  it('removing a track removes its patterns everywhere', () => {
    const [you, mira] = pair();
    const id = you.addTrack(m);
    const P = you.patternList(id)[0].id;
    mira.addNote(id, P, { s: 0, l: 1, m: 36, v: 1 });
    mira.removeTrack(id);
    expect(you.tracks()).toEqual([]);
    expect(you.notes(id, P)).toEqual([]);
  });

  it('per-track sequencer settings and transport are shared', () => {
    const [you, mira] = pair();
    const id = you.addTrack(m);
    const P = you.patternList(id)[0].id;
    mira.setSeq(id, { dir: 'pp', rate: 2 });
    expect(you.track(id)!.seq).toMatchObject({ dir: 'pp', rate: 2 });
    mira.setPatternLen(id, P, 900);
    expect(you.patternInfo(id, P)!.len).toBe(512);
    you.setBpm(132);
    mira.setSwing(0.9);
    expect([mira.bpm, you.swing]).toEqual([132, 0.6]);
  });
});

describe('Project (undo of structure)', () => {
  it('undoing a track removal brings back a working track and device store', () => {
    const [you, mira] = pair();
    const id = you.addTrack(m);
    const P = you.patternList(id)[0].id;
    you.deviceStore(id, m)!.setParam('cut', 0.77);
    you.addNote(id, P, { s: 2, l: 1, m: 40, v: 1 });
    you.undoManager.stopCapturing();
    mira.deviceStore(id, m); // Mira has it cached
    you.removeTrack(id);
    you.undo();
    expect(mira.tracks().map((t) => t.id)).toEqual([id]);
    expect(mira.deviceStore(id, m)!.getState().params.cut).toBe(0.77);
    expect(mira.notes(id, P)).toHaveLength(1);
    mira.deviceStore(id, m)!.setParam('res', 0.3);
    expect(you.deviceStore(id, m)!.getState().params.res).toBe(0.3);
  });

  it('notes on the same pitch never overlap: the note you edit wins', () => {
    const [you] = pair();
    const id = you.addTrack(m);
    const P = you.patternList(id)[0].id;
    const long = you.addNote(id, P, { s: 0, l: 16, m: 36, v: 0.8 })!;
    const mid = you.addNote(id, P, { s: 8, l: 2, m: 36, v: 0.8 })!;
    you.addNote(id, P, { s: 9, l: 1, m: 40, v: 0.8 }); // other pitch: untouched
    you.resolveOverlaps(id, P, mid);
    const get = (k: string) => you.notes(id, P).find(([n]) => n === k)?.[1];
    expect(get(long)?.l).toBe(8); // cut short where the new note starts
    expect(you.notes(id, P)).toHaveLength(3);
    // Drag the long one over the middle one: the middle one goes.
    you.updateNote(id, P, long, { l: 16 });
    you.resolveOverlaps(id, P, long);
    expect(get(mid)).toBeUndefined();
    expect(you.notes(id, P).map(([, n]) => n.m)).toEqual([36, 40]);
  });

  it('quantize never leaves stacked notes', () => {
    const [you] = pair();
    const id = you.addTrack(m);
    const P = you.patternList(id)[0].id;
    you.addNote(id, P, { s: 3.8, l: 1, m: 36, v: 0.8 });
    you.addNote(id, P, { s: 4.1, l: 1, m: 36, v: 0.8 });
    you.quantize(id, P, 1);
    expect(you.notes(id, P)).toHaveLength(1);
  });

  it('the song key and track names are shared; blank names are ignored', () => {
    const [you, mira] = pair();
    const id = you.addTrack(m);
    expect(mira.key).toEqual({ root: 0, scale: 'chromatic' });
    you.setKey({ root: 2, scale: 'minor' });
    expect(mira.key).toEqual({ root: 2, scale: 'minor' });
    mira.renameTrack(id, '  Bassline  ');
    expect(you.track(id)!.name).toBe('Bassline');
    you.renameTrack(id, '   ');
    expect(mira.track(id)!.name).toBe('Bassline');
  });

  it('patterns belong to an instrument: new, copy, rename, length', () => {
    const [you, mira] = pair();
    const a = you.addTrack(m);
    const b = you.addTrack(m);
    expect(you.patternList(a).map((p) => p.name)).toEqual(['P1']);
    const a1 = you.patternList(a)[0].id;
    you.addNote(a, a1, { s: 0, l: 2, m: 36, v: 1 });
    you.renamePattern(a, a1, '  Verse ');
    const copy = mira.addPattern(a, a1)!;
    const p2 = mira.addPattern(a)!;
    expect(you.patternList(a).map((p) => p.name)).toEqual(['Verse', 'Verse 2', 'P3']);
    expect(you.notes(a, copy)).toHaveLength(1); // a copy has the notes…
    you.addNote(a, copy, { s: 4, l: 1, m: 38, v: 1 });
    expect(you.notes(a, a1)).toHaveLength(1); // …but is its own pattern
    expect(you.notes(a, p2)).toHaveLength(0);
    expect(you.patternList(b).map((p) => p.name)).toEqual(['P1']); // b has its own P1
    you.renamePattern(a, a1, '   ');
    expect(mira.patternInfo(a, a1)!.name).toBe('Verse');
  });

  it('song rows: each cell picks a pattern; a row lasts as long as its longest pattern', () => {
    const [you, mira] = pair();
    const bass = you.addTrack(m);
    const lead = you.addTrack(m);
    const [r1] = you.rows().map((r) => r.id);
    expect(you.rows()).toHaveLength(1); // the first instrument made TRACK 1
    expect(you.cell(r1, bass)).toBe(you.patternList(bass)[0].id);
    expect(you.cell(r1, lead)).toBe(you.patternList(lead)[0].id);
    expect(you.rowLen(r1)).toBe(16);
    you.setPatternLen(lead, you.cell(r1, lead)!, 12);
    expect(you.rowLen(r1)).toBe(16);
    you.setPatternLen(bass, you.cell(r1, bass)!, 32);
    expect(mira.rowLen(r1)).toBe(32);
    const r2 = mira.addRow(r1, true); // duplicate
    expect(you.rows().map((r) => r.id)).toEqual([r1, r2]);
    expect(you.cell(r2, bass)).toBe(you.cell(r1, bass));
    you.setCell(r2, bass, null);
    expect(you.cell(r2, bass)).toBeNull();
    expect(you.rowLen(r2)).toBe(12); // only the 12-step lead left
    const r3 = you.addRow();
    expect(you.rowLen(r3)).toBe(16); // empty row: one bar
    // A new instrument goes into the row you are on.
    const third = you.addTrack(m, undefined, 0, r3);
    expect(you.cell(r3, third)).not.toBeNull();
    expect(you.cell(r1, third)).toBeNull();
    // Removing an instrument clears its cells; the last row can't be deleted.
    you.removeTrack(bass);
    expect(Object.keys(you.rows()[0].cells)).toEqual([lead]);
    you.removeRow(r2);
    you.removeRow(r3);
    you.removeRow(r1);
    expect(you.rows().map((r) => r.id)).toEqual([r1]);
  });

  it('songs: save state is shared, a saved file loads back exactly, INIT starts from scratch, both undo', () => {
    const [you, mira] = pair();
    const a = you.addTrack(m);
    const p1 = you.patternList(a)[0].id;
    you.addNote(a, p1, { s: 2, l: 1.5, m: 40, v: 0.7 });
    you.setAutomation(a, p1, 'cut', 3, 0.4);
    you.deviceStore(a, m)!.setParam('cut', 0.66);
    you.setSeq(a, { dir: 'pp' });
    you.setKey({ root: 2, scale: 'minor' });
    you.renameSong('Night Drive');
    const r2 = you.addRow();
    const p2 = you.addPattern(a)!;
    you.setCell(r2, a, p2);
    expect(mira.unsaved).toBe(true);
    you.markSaved('song-1');
    expect(mira.unsaved).toBe(false); // everyone sees it saved
    expect(mira.songId).toBe('song-1');
    const file = JSON.parse(JSON.stringify(mira.toFile()));
    mira.setBpm(90);
    expect(you.unsaved).toBe(true);

    // INIT: one Basalt with P1 in TRACK 1, 120 BPM, no key, nothing to save.
    you.undoManager.stopCapturing();
    you.initSong(m);
    expect(mira.songName).toBe('Untitled');
    expect(mira.tracks().map((t) => t.name)).toEqual(['Basalt']);
    expect(mira.rows()).toHaveLength(1);
    expect(mira.patternList(mira.trackIds()[0]).map((p) => p.name)).toEqual(['P1']);
    expect([mira.bpm, mira.key.scale, mira.songId, mira.unsaved]).toEqual([120, 'chromatic', null, false]);
    you.undo(); // INIT undone in one step
    expect(mira.songName).toBe('Night Drive');
    expect(mira.bpm).toBe(90);

    // Open the saved file: everything comes back, ids and all.
    you.undoManager.stopCapturing();
    mira.loadFile(file, { basalt: m }, 'song-1');
    expect(you.songName).toBe('Night Drive');
    expect(you.bpm).toBe(120);
    expect(you.key).toEqual({ root: 2, scale: 'minor' });
    expect(you.unsaved).toBe(false);
    expect(you.track(a)!.seq.dir).toBe('pp');
    expect(you.deviceStore(a, m)!.getState().params.cut).toBe(0.66);
    expect(you.notes(a, p1).map(([, n]) => n)).toEqual([{ s: 2, l: 1.5, m: 40, v: 0.7 }]);
    expect(you.automation(a, p1, 'cut')[3]).toBe(0.4);
    expect(you.cell(you.rows()[1].id, a)).toBe(p2);
    expect(JSON.stringify(you.toFile())).toBe(JSON.stringify(file));
  });
});


describe('Project (mixer)', () => {
  it('strips start at 0 dB, centre, no sends; changes reach everyone; files keep them', () => {
    const [you, mira] = pair();
    const id = you.addTrack(m, undefined, 0);
    expect(mira.mix(id)).toEqual({ level: 0.8, pan: 0, solo: false, rev: 0, dly: 0 });
    you.setMix(id, { level: 0.5, pan: -0.4, rev: 0.3 });
    mira.setMix(id, { dly: 0.6, solo: true }); // at the same time, different settings: both kept
    expect(you.mix(id)).toEqual({ level: 0.5, pan: -0.4, solo: true, rev: 0.3, dly: 0.6 });
    expect(mira.mix(id)).toEqual(you.mix(id));
    you.setMix(id, { level: 7, pan: -9 });
    expect(you.mix(id)).toMatchObject({ level: 1, pan: -1 });
    you.setMasterLevel(0.6);
    expect(mira.masterLevel).toBe(0.6);
    const file = you.toFile();
    expect(file.master).toEqual({ level: 0.6 });
    mira.initSong(m);
    expect(you.masterLevel).toBe(0.8);
    you.loadFile(file, { basalt: m }, null);
    expect(mira.mix(id)).toMatchObject({ level: 1, pan: -1, rev: 0.3, dly: 0.6, solo: true });
    expect(mira.masterLevel).toBe(0.6);
  });

  it('a mixer change counts as unsaved, and undo is per person', () => {
    const [you, mira] = pair();
    const id = you.addTrack(m, undefined, 0);
    you.markSaved('s1');
    expect(you.unsaved).toBe(false);
    mira.setMix(id, { level: 0.3 });
    expect(you.unsaved).toBe(true);
    you.setMix(id, { pan: 0.5 });
    you.undo();
    expect(you.mix(id)).toMatchObject({ level: 0.3, pan: 0 });
  });

  it('older song files without a mixer load at 0 dB', () => {
    const [you] = pair();
    you.addTrack(m, undefined, 0);
    const file = you.toFile();
    delete file.master;
    for (const t of file.tracks) delete t.mix;
    you.setMasterLevel(0.2);
    you.loadFile(file, { basalt: m }, null);
    expect(you.masterLevel).toBe(0.8);
    expect(you.mix(you.trackIds()[0])).toEqual({ level: 0.8, pan: 0, solo: false, rev: 0, dly: 0 });
  });
});

describe('Project (master effects)', () => {
  it('defaults, shared changes, the chain, per-style Lo-fi, files', async () => {
    const { engineFx } = await import('../src/model/fx');
    const [you, mira] = pair();
    expect(you.fxChain).toEqual(['reverb', 'delay', 'lofi', 'lowpass']);
    expect(you.fx('lowpass.cutoff')).toBe(1);
    expect(you.fx('lofi.on')).toBe(false);
    you.setFx('reverb.size', 0.8);
    mira.setFxChain(['lowpass', 'reverb']);
    expect(mira.fx('reverb.size')).toBe(0.8);
    expect(you.fxChain).toEqual(['lowpass', 'reverb']);
    expect(you.fxShelf).toEqual(['delay', 'lofi']);
    you.setFxChain(['reverb', 'reverb', 'nope' as never, 'delay']);
    expect(mira.fxChain).toEqual(['reverb', 'delay']);
    // each Lo-fi style keeps its own settings; the engine gets the active style's
    you.setFx('lofi.vinyl.noise', 0.2);
    you.setFx('lofi.style', 'vinyl');
    expect(engineFx((k) => you.fx(k), 120)['lofi.noise']).toBe(0.2);
    you.setFx('lofi.style', 'tape');
    expect(engineFx((k) => you.fx(k), 120)['lofi.noise']).toBe(0);
    // delay follows the tempo: 1/8. at 120 BPM = 0.375 s
    expect(engineFx((k) => you.fx(k), 120)['delay.time']).toBeCloseTo(0.375);
    you.setFx('delay.div', 3);
    expect(engineFx((k) => you.fx(k), 90)['delay.time']).toBeCloseTo(60 / 90);
    you.setFx('reverb.size', 7);
    expect(you.fx('reverb.size')).toBe(1);
    const file = you.toFile();
    mira.initSong(m);
    expect(you.fxChain).toEqual(['reverb', 'delay', 'lofi', 'lowpass']);
    you.loadFile(file, { basalt: m }, null);
    expect(mira.fxChain).toEqual(['reverb', 'delay']);
    expect(mira.fx('lofi.vinyl.noise')).toBe(0.2);
    expect(mira.fx('delay.div')).toBe(3);
  });

  it('undo of an effect change is per person', () => {
    const [you, mira] = pair();
    mira.setFx('delay.feedback', 0.9);
    you.setFx('reverb.tone', 0.1);
    you.undo();
    expect(you.fx('reverb.tone')).toBe(0.6);
    expect(you.fx('delay.feedback')).toBe(0.9);
  });
});
