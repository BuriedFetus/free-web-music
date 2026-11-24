import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as Y from 'yjs';
import { deviceEntry, Project, Studio, type SongFile, type SongLibrary } from '../src';

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
  it('adds an instrument from the library: it plays P1 in TRACK 1; remove it with undo', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add Basalt as a new track' }));
    expect(p.tracks().map((t) => t.name)).toEqual(['Basalt']);
    const id = p.trackIds()[0];
    expect(screen.getByRole('button', { name: 'TRACK 1, Basalt: P1' })).toBeTruthy();
    expect(p.cell(p.rows()[0].id, id)).toBe(p.patternList(id)[0].id);
    fireEvent.click(screen.getByRole('button', { name: 'Ping-pong' }));
    expect(p.track(id)!.seq.dir).toBe('pp');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Basalt' }));
    expect(p.tracks()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(p.tracks()).toHaveLength(1);
  });

  it('arrangement: add a TRACK, give an instrument a new pattern there, name and size it in the Piano roll', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add Basalt as a new track' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Basalt as a new track' }));
    const [a, b] = p.trackIds();
    fireEvent.click(screen.getByRole('button', { name: '+ Add TRACK' }));
    const r2 = p.rows()[1].id;
    fireEvent.click(screen.getByRole('button', { name: 'TRACK 2, Basalt: silent' }));
    const roll = screen.getByRole('region', { name: 'Piano roll' });
    expect(within(roll).getByText(/Basalt is silent in TRACK 2/)).toBeTruthy();
    fireEvent.click(within(roll).getByRole('button', { name: '+ New' }));
    expect(p.patternInfo(a, p.cell(r2, a))!.name).toBe('P2');
    const name = within(roll).getByRole('textbox', { name: 'Rename pattern P2' });
    fireEvent.focus(name);
    fireEvent.change(name, { target: { value: 'Drop' } });
    fireEvent.blur(name);
    fireEvent.click(within(roll).getByRole('button', { name: '2 bars' }));
    expect(p.patternInfo(a, p.cell(r2, a))).toMatchObject({ name: 'Drop', len: 32 });
    expect(screen.getByRole('button', { name: 'TRACK 2, Basalt: Drop' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'TRACK 2, 2 bars' })).toBeTruthy();
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
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: 'Add Basalt as a new track' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Add Basalt as a new track' }));
    const id = p.trackIds()[0];
    const seq = screen.getByRole('region', { name: 'Main sequencer' });
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
    fireEvent.click(screen.getByRole('button', { name: 'Add Basalt as a new track' }));
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

  it('songs: save, new from INIT (asks first when not saved), open a saved song, undo', async () => {
    const { lib, files } = memorySongs();
    const p = mount(lib);
    fireEvent.click(screen.getByRole('button', { name: 'Add Basalt as a new track' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Add Flint as a new track' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Add Flint as a new track' }));
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
    fireEvent.click(A.getByRole('button', { name: 'Add Basalt as a new track' }));
    fireEvent.click(A.getByRole('button', { name: 'Add Flint as a new track' }));
    const tab = (W: typeof A, name: string) => within(W.getByRole('region', { name: 'Device' })).getByRole('tab', { name: new RegExp(name) });
    // Bob picks Basalt; Ann then clicks Flint in her sequencer.
    fireEvent.click(tab(B, 'Basalt'));
    fireEvent.click(A.getByRole('button', { name: 'Select Flint' }));
    expect(tab(A, 'Flint').getAttribute('aria-selected')).toBe('true'); // Ann's own panels follow her click
    expect(tab(B, 'Basalt').getAttribute('aria-selected')).toBe('true'); // Bob's stay where he left them
    expect(within(B.getByRole('region', { name: 'Device' })).getByText(/Mono bass synth/)).toBeTruthy();
  });
});

