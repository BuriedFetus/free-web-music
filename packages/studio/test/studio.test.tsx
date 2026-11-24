import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  it('adds a track from the library, steps notes in the main sequencer, removes it with undo', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add Basalt as a new track' }));
    expect(p.tracks().map((t) => t.name)).toEqual(['Basalt']);
    const id = p.trackIds()[0];
    fireEvent.click(screen.getByRole('button', { name: 'Basalt step 5' }));
    expect(p.notes(id, 0).map(([, n]) => n.s)).toEqual([4]);
    fireEvent.click(screen.getByRole('button', { name: 'Basalt step 5' }));
    expect(p.notes(id, 0)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Ping-pong' }));
    expect(p.track(id)!.seq.dir).toBe('pp');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Basalt' }));
    expect(p.tracks()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(p.tracks()).toHaveLength(1);
  });

  it('scenes keep separate patterns and the device shows the selected track', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add Basalt as a new track' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Basalt as a new track' }));
    expect(p.tracks().map((t) => t.name)).toEqual(['Basalt', 'Basalt 2']);
    fireEvent.click(screen.getByRole('button', { name: 'Scene B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Basalt 2 step 1' }));
    const id2 = p.trackIds()[1];
    expect(p.notes(id2, 1)).toHaveLength(1);
    expect(p.notes(id2, 0)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Select Basalt 2' }));
    expect(screen.getByText(/Mono bass synth · Basalt 2/)).toBeTruthy();
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

  it('a long note lights the steps it holds; clicking a held step ends it there instead of stacking a note', () => {
    const p = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add Basalt as a new track' }));
    const id = p.trackIds()[0];
    act(() => { p.addNote(id, 0, { s: 0, l: 16, m: 36, v: 0.8 }); });
    expect(screen.getByRole('button', { name: 'Basalt step 6' }).className).toContain('is-held');
    fireEvent.click(screen.getByRole('button', { name: 'Basalt step 6' }));
    expect(p.notes(id, 0).map(([, n]) => [n.s, n.l])).toEqual([[0, 5]]);
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
    fireEvent.change(within(roll).getByRole('combobox', { name: 'Scale' }), { target: { value: 'minor' } });
    fireEvent.change(within(roll).getByRole('combobox', { name: 'Key root note' }), { target: { value: '2' } });
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

