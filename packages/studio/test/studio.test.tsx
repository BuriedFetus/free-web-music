import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import * as Y from 'yjs';
import { Project, Studio } from '../src';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function mount() {
  const doc = new Y.Doc();
  render(<Studio doc={doc} user={{ id: 'u1', name: 'Tester', color: '#4fc3ff' }} theme={{ loadFonts: false }} />);
  return new Project(doc, { test: true });
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
});

