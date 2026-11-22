import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import manifestJson from '@fwm/engine/devices/basalt.json';
import type { DeviceManifest } from '@fwm/engine';
import { Basalt, EngineProvider, ThemeRoot, createDeviceStore, type KnobProps } from '../src';

const m = manifestJson as DeviceManifest;
afterEach(cleanup);

function mount(components?: { Knob?: (p: KnobProps) => React.ReactElement }) {
  const store = createDeviceStore(m);
  render(
    <EngineProvider>
      <ThemeRoot theme={{ loadFonts: false, components }}>
        <Basalt store={store} slot={0} computerKeys={false} />
      </ThemeRoot>
    </EngineProvider>,
  );
  return store;
}

describe('<Basalt>', () => {
  it('renders every continuous control', () => {
    mount();
    for (const label of ['Tune', 'Shape', 'Sub', 'Cutoff', 'Reso', 'Env amt', 'Drive', 'Glide', 'Level', 'Rate', 'Amount'])
      expect(screen.getByRole('slider', { name: label })).toBeTruthy();
    for (const n of ['A', 'D', 'S', 'R']) expect(screen.getByRole('slider', { name: n })).toBeTruthy();
  });

  it('keyboard arrows change a param in the store', () => {
    const store = mount();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Cutoff' }), { key: 'ArrowUp' });
    expect(store.getState().params.cut).toBeCloseTo(0.47);
  });

  it('assigns LFO 1 to a knob by clicking it', () => {
    const store = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Assign LFO 1' }));
    fireEvent.pointerDown(screen.getByRole('slider', { name: 'Reso' }));
    expect(store.getState().routes).toEqual([{ src: 'lfo', target: 'res', depth: 0.35 }]);
    expect(screen.getByRole('slider', { name: 'Depth of LFO 1 → Reso' })).toBeTruthy();
  });

  it('wave buttons and presets update the store', () => {
    const store = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Square' }));
    expect(store.getState().params.wave).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Next preset' }));
    expect(screen.getByText(/02 Rubber Sub/)).toBeTruthy();
    expect(store.getState().params.wave).toBe(3);
  });

  it('uses host-provided primitives (level 3 theming)', () => {
    mount({ Knob: (p) => <output data-testid="host-knob">{p.label}</output> });
    expect(screen.getAllByTestId('host-knob').length).toBe(11);
  });
});
