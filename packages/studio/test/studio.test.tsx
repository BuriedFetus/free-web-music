import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as Y from 'yjs';
import { deviceEntry, Project, Studio, type PresetLibrary, type SongFile, type SongLibrary, type UserPreset } from '../src';

/** + Add instrument (Device panel) → pick one. */
function addInst(q: { getByRole: typeof screen.getByRole }, name: string) {
  fireEvent.click(q.getByRole('button', { name: '+ Add instrument' }));
  fireEvent.click(q.getByRole('menuitem', { name: `Add ${name}` }));
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function mount(songs?: SongLibrary) {
  const doc = new Y.Doc();
  render(<Studio doc={doc} user={{ id: 'u1', name: 'Tester', color: '#4fc3ff' }} theme={{ loadFonts: false }} songs={songs} />);
  return new Project(doc, { test: true });
}

/** An in-memory song library, standing in for the host's. */
function memorySongs() {
  const files = new Map<string, SongFile>();
  let n = 0;
  const lib: SongLibrary = {
    list: async () => [...files].map(([id, f]) => ({ id, name: f.name, updated: 0 })),
    load: async (id) => structuredClone(files.get(id)!),
    save: async (f, id) => {
      const sid = id || 'song' + ++n;
      files.set(sid, structuredClone(f));
      return sid;
    },
  };
  return { lib, files };
}

describe('<Studio>', () => {
  it("one octave: the panel's keys start where the computer keyboard's A key plays, and both move together", () => {
    mount();
    addInst(screen, 'Geode');
    const dev = () => within(document.querySelector<HTMLElement>('.fwm-devwrap')!);
    const readout = () => dev().getByRole('button', { name: 'Octave up' }).parentElement!.textContent!;
    expect(readout()).toContain('C4'); // A plays C4 (the tape's own pitch): the keys on screen start at C4
    fireEvent.keyDown(document.body, { key: 'z' });
    expect(readout()).toContain('C3');
    fireEvent.click(dev().getByRole('button', { name: 'Octave up' }));
    fireEvent.click(dev().getByRole('button', { name: 'Octave up' }));
    expect(readout()).toContain('C5');
    expect(screen.getByText(/Z\/X octave \+1/)).toBeTruthy();
  });

  it('the Library is a manual: open an instrument, turn its pages, add it from there', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: 'How Geode works' }));
    expect(screen.getByRole('tab', { name: /1\. Meet Geode/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next ›' }));
    expect(screen.getByRole('heading', { name: 'Recording into her memory' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Add Geode to the song' }));
    expect(p.tracks().map((t) => t.device)).toEqual(['geode']);
    fireEvent.click(screen.getByRole('button', { name: '‹ All instruments' }));
    expect(screen.getByRole('button', { name: 'How Opal works' })).toBeTruthy();
  });

  it('adds an instrument from the library: it plays P1 in TRACK 1; remove it with undo', () => {
    const p = mount();
    addInst(screen, 'Basalt');
    expect(p.tracks().map((t) => t.name)).toEqual(['Basalt']);
    const id = p.trackIds()[0];
    expect(screen.getByRole('button', { name: 'TRACK 1, Basalt: P1' })).toBeTruthy();
    expect(p.cell(p.rows()[0].id, id)).toBe(p.patternList(id)[0].id);
    fireEvent.click(screen.getByRole('button', { name: /^Pattern ▾/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ping-pong' }));
    expect(p.track(id)!.seq.dir).toBe('pp');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Basalt' }));
    expect(p.tracks()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(p.tracks()).toHaveLength(1);
  });

  it('song arrangement: + Add instrument opens the Device panel\'s menu, the pick plays P1 in the selected TRACK', () => {
    const p = mount();
    addInst(screen, 'Basalt');
    fireEvent.click(screen.getByRole('button', { name: '+ Add TRACK' }));
    const r2 = p.rows()[1].id;
    expect(screen.queryByRole('menu', { name: 'Add an instrument' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add an instrument to this TRACK' }));
    const menu = screen.getByRole('menu', { name: 'Add an instrument' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Add Opal' }));
    const opal = p.tracks().find((t) => t.device === 'opal')!;
    expect(p.cell(r2, opal.id)).toBe(p.patternList(opal.id)[0].id);
    expect(p.cell(p.rows()[0].id, opal.id)).toBeFalsy();
    expect(screen.queryByRole('menu', { name: 'Add an instrument' })).toBeNull();
    // the Device panel's own button still adds to TRACK 1 by default
    addInst(screen, 'Quartz');
    const quartz = p.tracks().find((t) => t.device === 'quartz')!;
    expect(p.cell(p.rows()[0].id, quartz.id)).toBe(p.patternList(quartz.id)[0].id);
  });

  it('arrangement: add a TRACK, give an instrument a new pattern there, name and size it in the Piano roll', () => {
    const p = mount();
    addInst(screen, 'Basalt');
    addInst(screen, 'Basalt');
    const [a, b] = p.trackIds();
    fireEvent.click(screen.getByRole('button', { name: '+ Add TRACK' }));
    const r2 = p.rows()[1].id;
    fireEvent.click(screen.getByRole('button', { name: 'TRACK 2, Basalt: silent' }));
    const roll = screen.getByRole('region', { name: 'Piano roll' });
    expect(within(roll).getByText(/Basalt is silent in TRACK 2/)).toBeTruthy();
    fireEvent.click(within(roll).getByRole('button', { name: '+ New' }));
    expect(p.patternInfo(a, p.cell(r2, a))!.name).toBe('P2');
    fireEvent.click(within(roll).getByRole('button', { name: /^Pattern ▾/ })); // name, length… fold away
    const name = within(roll).getByRole('textbox', { name: 'Rename pattern P2' });
    fireEvent.focus(name);
    fireEvent.change(name, { target: { value: 'Drop' } });
    fireEvent.blur(name);
    fireEvent.change(within(roll).getByRole('combobox', { name: 'Length presets (bars)' }), { target: { value: '2' } });
    expect(p.patternInfo(a, p.cell(r2, a))).toMatchObject({ name: 'Drop', len: 32 });
    expect(screen.getByRole('button', { name: 'TRACK 2, Basalt: Drop' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'TRACK 2, 2 bars' })).toBeTruthy();
    // the length can be typed, in bars
    const lenIn = within(roll).getByRole('textbox', { name: 'Pattern length in bars' });
    fireEvent.change(lenIn, { target: { value: '1.5' } });
    fireEvent.blur(lenIn);
    expect(screen.getByRole('button', { name: /TRACK 2, 1\.5 bars|TRACK 2, 24 steps|TRACK 2, 1 bar 8/ })).toBeTruthy();
    // Basalt 2 is silent in TRACK 2 until a pattern is picked for it; patterns are per instrument.
    expect(p.cell(r2, b)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'TRACK 2, Basalt 2: silent' }));
    expect(within(roll).queryByRole('button', { name: 'Drop' })).toBeNull();
    fireEvent.click(within(roll).getByRole('button', { name: 'P1' }));
    expect(p.cell(r2, b)).toBe(p.patternList(b)[0].id);
    // Duplicate TRACK 2 → TRACK 3 plays the same patterns.
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate TRACK 2' }));
    expect(p.rows()[2].cells).toEqual(p.rows()[1].cells);
  });

  it('BPM: click and type', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: /Tempo 120 BPM/ }));
    const input = screen.getByRole('textbox', { name: 'Tempo in BPM' });
    fireEvent.change(input, { target: { value: '96' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.bpm).toBe(96);
    fireEvent.click(screen.getByRole('button', { name: /Tempo 96 BPM/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Tempo in BPM' }), { target: { value: '999' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Tempo in BPM' }), { key: 'Enter' });
    expect(p.bpm).toBe(96); // out of range: ignored
  });

  it('the Device panel has a tab per track to switch which one you edit', () => {
    mount();
    for (let i = 0; i < 3; i++) addInst(screen, 'Basalt');
    const device = screen.getByRole('region', { name: 'Device' });
    const tabs = within(device).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Basalt', 'Basalt 2', 'Basalt 3']);
    expect(tabs[2].getAttribute('aria-selected')).toBe('true'); // the newest one is selected
    fireEvent.click(tabs[0]);
    expect(within(device).getByText(/Mono bass synth · Basalt$/)).toBeTruthy();
    expect(within(device).getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
  });

  it('your panel layout is private (stored per user, not in the shared doc)', () => {
    const p = mount();
    const sel = screen.getByRole('combobox', { name: 'Panel 4 view' });
    fireEvent.change(sel, { target: { value: 'seq' } });
    expect(JSON.parse(localStorage.getItem('fwm.layout.u1')!).views[3]).toBe('seq');
    expect(JSON.stringify(p.doc.toJSON())).not.toContain('layout');
  });

  it('rename a track from the sequencer (✎) or the Device panel', () => {
    const p = mount();
    addInst(screen, 'Basalt');
    const id = p.trackIds()[0];
    const seq = screen.getByRole('region', { name: 'Song arrangement' });
    fireEvent.click(within(seq).getByRole('button', { name: 'Rename Basalt' }));
    const input = within(seq).getByRole('textbox', { name: 'Rename Basalt' });
    fireEvent.change(input, { target: { value: 'Bass' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(p.track(id)!.name).toBe('Bass');
    const dev = within(screen.getByRole('region', { name: 'Device' })).getByRole('textbox', { name: 'Rename Bass' });
    fireEvent.focus(dev);
    fireEvent.change(dev, { target: { value: 'Sub bass' } });
    fireEvent.blur(dev);
    expect(p.track(id)!.name).toBe('Sub bass');
    expect(within(screen.getByRole('region', { name: 'Device' })).getByText(/Mono bass synth · Sub bass$/)).toBeTruthy();
  });

  it('piano roll: pick a key, fold to it', () => {
    const p = mount();
    addInst(screen, 'Basalt');
    const roll = screen.getByRole('region', { name: 'Piano roll' });
    const rows = () => roll.querySelectorAll('.fwm-gr').length;
    const all = rows();
    expect((within(roll).getByRole('button', { name: 'Fold to key' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: 'Scale' }), { target: { value: 'minor' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Key root note' }), { target: { value: '2' } });
    expect(p.key).toEqual({ root: 2, scale: 'minor' });
    expect(roll.querySelectorAll('.fwm-gr.is-out').length).toBeGreaterThan(0);
    fireEvent.click(within(roll).getByRole('button', { name: 'Fold to key' }));
    expect(rows()).toBeLessThan(all);
    expect(roll.querySelectorAll('.fwm-gr.is-out').length).toBe(0);
    // D minor has no C♯ (37 = C♯2) but has D (38).
    expect(roll.querySelector('.fwm-gr[data-m="37"]')).toBeNull();
    expect(roll.querySelector('.fwm-gr[data-m="38"]')).not.toBeNull();
  });

  it('piano roll automation: only lanes that hold something show; clear one, clear all of the instrument (asks once, undo brings it back)', () => {
    const p = mount();
    addInst(screen, 'Basalt');
    const roll = within(screen.getByRole('region', { name: 'Piano roll' }));
    const lanes = () => roll.queryAllByLabelText(/^Automation lane for/).map((el) => el.getAttribute('aria-label'));
    expect(roll.queryByLabelText('Velocity lane')).toBeNull(); // lanes start hidden: the roll gets the room
    fireEvent.change(roll.getByRole('combobox', { name: 'Lanes under the Piano roll' }), { target: { value: 'vel' } });
    expect(roll.getByLabelText('Velocity lane')).toBeTruthy();
    fireEvent.change(roll.getByRole('combobox', { name: 'Lanes under the Piano roll' }), { target: { value: 'auto' } });
    expect(lanes()).toEqual([]);
    expect(roll.getByText(/No automation yet/)).toBeTruthy();
    const tr = p.trackIds()[0];
    const pat = p.patternList(tr)[0].id;
    act(() => {
      p.setAutomation(tr, pat, 'cut', 0, 0.5);
      p.setAutomation(tr, pat, 'res', 3, 0.2);
    });
    expect(lanes()).toHaveLength(2);
    // + Automate a knob opens an empty lane for it
    fireEvent.change(roll.getByRole('combobox', { name: 'Automate a knob' }), { target: { value: 'drive' } });
    expect(lanes()).toHaveLength(3);
    fireEvent.click(roll.getByRole('button', { name: /^Clear .*Cutoff.* automation$/i }));
    expect(p.automation(tr, pat, 'cut').every((v) => v == null)).toBe(true);
    expect(lanes()).toHaveLength(2);
    const all = () => roll.getByRole('button', { name: /Clear all automation|Sure\?/ });
    fireEvent.click(all());
    expect(p.automationCount(tr)).toBe(1); // asks first
    fireEvent.click(all());
    expect(p.automationCount(tr)).toBe(0);
    expect(lanes()).toEqual([]);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true }); // the studio's own undo
    expect(p.automationCount(tr)).toBeGreaterThan(0);
  });

  it('piano roll: Shift+drag a note leaves it and drags a copy; the automation under it comes along', () => {
    const p = mount();
    addInst(screen, 'Basalt');
    const tr = p.trackIds()[0];
    const pat = p.patternList(tr)[0].id;
    act(() => {
      for (const [id] of p.notes(tr, pat)) p.deleteNote(tr, pat, id);
      p.addNote(tr, pat, { s: 0, l: 2, m: 48, v: 0.8 });
      p.setAutomation(tr, pat, 'cut', 0, 0.3);
      p.setAutomation(tr, pat, 'cut', 1, 0.6);
      p.setAutomation(tr, pat, 'cut', 2, 0.9); // after the note: stays behind
    });
    const g = screen.getByLabelText(/^Piano roll, /);
    const L = p.patternInfo(tr, pat)!.len;
    g.getBoundingClientRect = () => ({ left: 0, top: 0, right: L * 10, bottom: 2000, width: L * 10, height: 2000, x: 0, y: 0, toJSON() {} });
    const note = g.querySelector<HTMLElement>('[data-note]')!;
    note.getBoundingClientRect = () => ({ left: 0, top: 0, right: 20, bottom: 14, width: 20, height: 14, x: 0, y: 0, toJSON() {} });
    const y = Number.parseFloat(note.style.top) + 5 || 5;
    fireEvent.pointerDown(note, { button: 0, shiftKey: true, clientX: 5, clientY: y, pointerId: 1 });
    fireEvent.pointerMove(g, { clientX: 45, clientY: y, pointerId: 1 }); // 4 steps later
    fireEvent.pointerUp(g, { clientX: 45, clientY: y, pointerId: 1 });
    expect(g.querySelectorAll('.fwm-barl').length).toBe(Math.ceil(L / 16) - 1); // a crisp line at every X.1 after the first
    const ns = p.notes(tr, pat).map(([, n]) => n.s).sort((a, b) => a - b);
    expect(ns).toEqual([0, 4]);
    const cut = p.automation(tr, pat, 'cut');
    expect(cut.slice(0, 7)).toEqual([0.3, 0.6, 0.9, null, 0.3, 0.6, null]);
  });

  it('presets: save the sound as mine, it joins the list after the factory ones, replace it, delete it; the host keeps them', async () => {
    const kept = new Map<string, UserPreset>();
    const lib: PresetLibrary = {
      list: async () => [...kept.values()],
      save: async (_d, pr) => void kept.set(pr.id, structuredClone(pr)),
      remove: async (_d, id) => void kept.delete(id),
    };
    const doc = new Y.Doc();
    render(<Studio doc={doc} user={{ id: 'u1', name: 'Tester', color: '#4fc3ff' }} theme={{ loadFonts: false }} presets={lib} />);
    const p = new Project(doc, { test: true });
    addInst(screen, 'Basalt');
    const dev = () => within(document.querySelector<HTMLElement>('.fwm-devwrap')!);
    const tr = p.trackIds()[0];
    const params = () => p.deviceStore(tr, deviceEntry('basalt')!.manifest!)!.getState().params;
    act(() => p.deviceStore(tr, deviceEntry('basalt')!.manifest!)!.setParam('cut', 0.123));
    expect(dev().getAllByText(/edited/).length).toBeGreaterThan(0);
    fireEvent.click(dev().getByRole('button', { name: 'Save this preset' }));
    fireEvent.change(dev().getByRole('textbox', { name: 'Preset name' }), { target: { value: 'Night Bass' } });
    await act(async () => fireEvent.click(dev().getByRole('button', { name: 'Save as new' })));
    expect([...kept.values()].map((x) => x.name)).toEqual(['Night Bass']); // the host keeps it
    expect(dev().getByText('★ Night Bass')).toBeTruthy();
    // step away to a factory preset and back with ‹ (mine come after the factory ones)
    fireEvent.click(dev().getByRole('button', { name: 'Next preset' }));
    expect(dev().queryByText('★ Night Bass')).toBeNull();
    expect(params().cut).not.toBeCloseTo(0.123);
    fireEvent.click(dev().getByRole('button', { name: 'Previous preset' }));
    expect(dev().getByText('★ Night Bass')).toBeTruthy();
    expect(params().cut).toBeCloseTo(0.123);
    // change it and replace it
    act(() => p.deviceStore(tr, deviceEntry('basalt')!.manifest!)!.setParam('cut', 0.5));
    fireEvent.click(dev().getByRole('button', { name: 'Save this preset' }));
    await act(async () => fireEvent.click(dev().getByRole('button', { name: 'Replace “Night Bass”' })));
    expect(kept.size).toBe(1);
    expect([...kept.values()][0].params.cut).toBeCloseTo(0.5);
    // delete it
    fireEvent.click(dev().getByRole('button', { name: 'Save this preset' }));
    await act(async () => fireEvent.click(dev().getByRole('button', { name: 'Delete Night Bass' })));
    expect(kept.size).toBe(0);
  });

  it('presets without a host library are kept in this browser', async () => {
    mount();
    addInst(screen, 'Opal');
    const dev = () => within(document.querySelector<HTMLElement>('.fwm-devwrap')!);
    fireEvent.click(dev().getByRole('button', { name: 'Save this sound' }));
    expect(dev().getByText(/Kept in this browser/)).toBeTruthy();
    fireEvent.change(dev().getByRole('textbox', { name: 'Preset name' }), { target: { value: 'Pad of mine' } });
    await act(async () => fireEvent.click(dev().getByRole('button', { name: 'Save as new' })));
    expect(JSON.parse(localStorage.getItem('fwm.presets.u1.opal')!)[0].name).toBe('Pad of mine');
  });

  it('song arrangement: double-click opens a pattern (an empty cell gets a new one), right-click or ✕ empties it', () => {
    const p = mount();
    addInst(screen, 'Basalt');
    const tr = p.trackIds()[0];
    const r1 = p.rows()[0].id;
    const cell = () => screen.getByRole('button', { name: new RegExp(`^TRACK 1, Basalt`) });
    const first = p.cell(r1, tr)!;
    fireEvent.contextMenu(cell());
    expect(p.cell(r1, tr)).toBeNull(); // right-click empties it (the pattern stays with Basalt)
    expect(p.patternList(tr).some((x) => x.id === first)).toBe(true);
    const n = p.patternList(tr).length;
    fireEvent.doubleClick(cell());
    expect(p.patternList(tr).length).toBe(n + 1); // an empty cell: a new pattern, in the Piano roll
    const made = p.cell(r1, tr)!;
    expect(made).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Piano roll' })).getByRole('button', { name: p.patternInfo(tr, made)!.name, pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Empty TRACK 1, Basalt/ }));
    expect(p.cell(r1, tr)).toBeNull(); // the ✕ on hover
  });

  it('songs: save, new from INIT (asks first when not saved), open a saved song, undo', async () => {
    const { lib, files } = memorySongs();
    const p = mount(lib);
    addInst(screen, 'Basalt');
    const id = p.trackIds()[0];
    act(() => { p.addNote(id, p.patternList(id)[0].id, { s: 0, l: 1, m: 36, v: 1 }); });
    const songBtn = () => screen.getByRole('button', { name: /^Song/ });
    expect(songBtn().textContent).toContain('not saved');
    // Name it, save it.
    fireEvent.click(songBtn());
    const name = screen.getByRole('textbox', { name: 'Song name' });
    fireEvent.focus(name);
    fireEvent.change(name, { target: { value: 'Night Drive' } });
    fireEvent.blur(name);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect([...files.values()].map((f) => f.name)).toEqual(['Night Drive']);
    expect(songBtn().textContent).not.toContain('not saved');
    // Change something, then INIT: it asks first.
    act(() => { p.setBpm(99); });
    expect(songBtn().textContent).toContain('not saved');
    if (!screen.queryByRole('dialog', { name: 'Song' })) fireEvent.click(songBtn());
    fireEvent.click(screen.getByRole('button', { name: /New song from INIT/ }));
    expect(screen.getByRole('alertdialog', { name: 'Replace the song?' })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'New song' })); });
    expect([p.songName, p.bpm, p.tracks().length, p.notes(p.trackIds()[0], p.patternList(p.trackIds()[0])[0].id).length]).toEqual(['Untitled', 120, 1, 0]);
    // Open the saved song (INIT is not modified, so no question).
    fireEvent.click(songBtn());
    await act(async () => {});
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open Night Drive' })); });
    expect([p.songName, p.bpm, p.unsaved]).toEqual(['Night Drive', 120, false]);
    expect(p.notes(id, p.patternList(id)[0].id)).toHaveLength(1);
    // The toast takes you back to the INIT song (undo).
    fireEvent.click(screen.getByRole('button', { name: 'Back to "Untitled"' }));
    expect(p.songName).toBe('Untitled');
  });

  it('Flint: add it, hit pads, change a pad drum and character, switch kits ("edited" when changed)', () => {
    const p = mount();
    addInst(screen, 'Flint');
    const id = p.trackIds()[0];
    const dev = screen.getByRole('region', { name: 'Device' });
    expect(within(dev).getByText(/Drum machine · Flint/)).toBeTruthy();
    const store = () => p.deviceStore(id, deviceEntry('flint')!.manifest!)!;
    fireEvent.pointerDown(within(dev).getByRole('button', { name: /^Pad 4: Closed hat, Analog/ }), { button: 0 });
    expect(within(dev).getByText('Pad 4 sound')).toBeTruthy();
    fireEvent.click(within(dev).getByRole('button', { name: 'Noise' }));
    fireEvent.click(within(dev).getByRole('button', { name: 'Kick' }));
    expect(store().getState().params).toMatchObject({ 'p4.type': 0, 'p4.model': 2 });
    expect(within(dev).getByRole('button', { name: /^Pad 4: Kick, Noise/ })).toBeTruthy();
    expect(dev.querySelector('.fwm-flint__edited')).not.toBeNull();
    fireEvent.click(within(dev).getByRole('button', { name: 'Next kit' }));
    expect(within(dev).getByText(/02 Chrome/)).toBeTruthy();
    expect(dev.querySelector('.fwm-flint__edited')).toBeNull();
    expect(store().getState().params['p1.model']).toBe(1); // Chrome = all Digital
  });

  it('Flint drum grid: draw, accent, roll, row length, mute and solo', () => {
    const p = mount();
    addInst(screen, 'Flint');
    const id = p.trackIds()[0];
    const pat = () => p.cell(p.rows()[0].id, id)!;
    const roll = screen.getByRole('region', { name: 'Piano roll' });
    const step = (pad: number, n: number) => within(roll).getByRole('button', { name: new RegExp(`^Pad ${pad} step ${n}(,|$)`) });
    fireEvent.click(step(1, 1));
    fireEvent.click(step(1, 5));
    expect(p.notes(id, pat()).map(([, n]) => [n.m, n.s])).toEqual([[36, 0], [36, 4]]);
    fireEvent.click(within(roll).getByRole('button', { name: 'Accent' }));
    fireEvent.click(step(1, 5));
    fireEvent.click(within(roll).getByRole('button', { name: 'Roll ×2 ×3 ×4' }));
    fireEvent.click(step(2, 9)); // new note with a ×2 roll
    fireEvent.click(step(2, 9)); // ×3
    const n = Object.fromEntries(p.notes(id, pat()).map(([, x]) => [`${x.m}@${x.s}`, x]));
    expect(n['36@4'].a).toBe(1);
    expect(n['37@8'].r).toBe(3);
    expect(step(2, 9).getAttribute('aria-label')).toContain('roll ×3');
    // Row length: pad 8 to 17 steps makes the pattern 17 steps; the other rows stay at 16.
    fireEvent.click(within(roll).getByRole('button', { name: 'Pad 8 row longer' }));
    expect(p.rowLens(id, pat())).toEqual([16, 16, 16, 16, 16, 16, 16, 17]);
    expect(p.patternInfo(id, pat())!.len).toBe(17);
    fireEvent.click(within(roll).getByRole('button', { name: 'Pad 3 row shorter' }));
    expect(p.rowLens(id, pat())[2]).toBe(15);
    // Mute pad 1, solo pad 2: shared settings on the instrument.
    fireEvent.click(within(roll).getByRole('button', { name: 'Mute pad 1' }));
    fireEvent.click(within(roll).getByRole('button', { name: 'Solo pad 2' }));
    expect(p.track(id)!.seq).toMatchObject({ pmute: 1, psolo: 2 });
  });

  it('choosing an instrument is per person: it never changes what another person has selected', () => {
    // Two people on one shared song (two Y.Docs kept in sync), each with their own studio.
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.on('update', (u: Uint8Array, o: unknown) => o !== 'remote' && Y.applyUpdate(b, u, 'remote'));
    b.on('update', (u: Uint8Array, o: unknown) => o !== 'remote' && Y.applyUpdate(a, u, 'remote'));
    const ra = render(<Studio doc={a} user={{ id: 'ann', name: 'Ann', color: '#f80' }} theme={{ loadFonts: false }} />);
    const rb = render(<Studio doc={b} user={{ id: 'bob', name: 'Bob', color: '#08f' }} theme={{ loadFonts: false }} />);
    const A = within(ra.container);
    const B = within(rb.container);
    addInst(A, 'Basalt');
    addInst(A, 'Flint');
    const tab = (W: typeof A, name: string) => within(W.getByRole('region', { name: 'Device' })).getByRole('tab', { name: new RegExp(name) });
    // Bob picks Basalt; Ann then clicks Flint in her sequencer.
    fireEvent.click(tab(B, 'Basalt'));
    fireEvent.click(A.getByRole('button', { name: 'Select Flint' }));
    expect(tab(A, 'Flint').getAttribute('aria-selected')).toBe('true'); // Ann's own panels follow her click
    expect(tab(B, 'Basalt').getAttribute('aria-selected')).toBe('true'); // Bob's stay where he left them
    expect(within(B.getByRole('region', { name: 'Device' })).getByText(/Mono bass synth/)).toBeTruthy();
  });
  it('a panel can take its whole row (the other one in that row hides), and go back', () => {
    mount();
    const pane = (n: string) => screen.getByRole('region', { name: n });
    fireEvent.click(within(pane('Piano roll')).getByRole('button', { name: 'Whole row' }));
    expect(pane('Piano roll').classList.contains('is-wide')).toBe(true);
    expect(pane('Library').classList.contains('is-hid')).toBe(true);
    fireEvent.click(within(pane('Piano roll')).getByRole('button', { name: 'Half width' }));
    expect(pane('Library').classList.contains('is-hid')).toBe(false);
  });

  it('Tab zooms: the panel under the mouse goes full size, Tab shows all panels, Tab goes back into the same one', () => {
    mount();
    const pane = (n: string) => screen.getByRole('region', { name: n });
    const ws = () => pane('Device').parentElement!;
    const tab = (shift = false) => fireEvent.keyDown(window, { key: 'Tab', shiftKey: shift });
    tab();
    expect(ws().classList.contains('is-max')).toBe(false); // mouse not over the panels: Tab is left alone
    fireEvent.pointerEnter(pane('Device'));
    tab();
    expect(pane('Device').classList.contains('is-maxed')).toBe(true);
    tab();
    expect(ws().classList.contains('is-max')).toBe(false); // zoomed out: all four
    fireEvent.pointerMove(pane('Piano roll')); // the mouse wandered, Tab still goes back where you were
    tab();
    expect(pane('Device').classList.contains('is-maxed')).toBe(true);
    tab(true);
    expect(pane('Device').classList.contains('is-maxed')).toBe(true); // Shift+Tab is focus, as usual
  });
});

