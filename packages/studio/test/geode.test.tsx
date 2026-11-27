import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import manifestJson from '@fwm/engine/devices/geode.json';
import type { DeviceManifest } from '@fwm/engine';
import { EngineProvider, Geode, GEODE_PRESETS, ThemeRoot, createDeviceStore } from '../src';

const m = manifestJson as unknown as DeviceManifest;
afterEach(cleanup);

function mount() {
  const store = createDeviceStore(m, GEODE_PRESETS[0]);
  render(
    <EngineProvider>
      <ThemeRoot theme={{ loadFonts: false }}>
        <Geode store={store} slot={0} />
      </ThemeRoot>
    </EngineProvider>,
  );
  return store;
}

describe('<Geode>', () => {
  it('shows the room and the dock with its ten icons', () => {
    mount();
    expect(screen.getByLabelText("Mica's room")).toBeTruthy();
    const dock = screen.getByRole('toolbar', { name: 'Geode controls' });
    expect(dock.querySelectorAll('button')).toHaveLength(10);
  });

  it('the thermometer sets the temperature (arrow keys)', () => {
    const store = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Temp' }));
    const th = screen.getByRole('slider', { name: 'Temperature' });
    fireEvent.keyDown(th, { key: 'ArrowUp' });
    expect(store.getState().params.temp).toBeCloseTo(0.67);
  });

  it("Mica's memory opens from her face, and Escape closes it", () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Mica' }));
    expect(screen.getByRole('dialog', { name: "Mica's memory" })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Load the demo tape' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: "Mica's memory" })).toBeNull();
  });

  it('Motion targets are bits of one param', () => {
    const store = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Motion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Motion moves Pan' }));
    expect(store.getState().params.mto).toBe(1 + 4);
    expect(store.getState().params.mdepth).toBeCloseTo(0.5); // switching a target on gives Motion some depth
  });

  it('a preset never moves Mica or the trim', () => {
    const store = mount();
    store.setParam('px', 0.2);
    store.setParam('end', 0.6);
    fireEvent.click(screen.getByRole('button', { name: 'Next sound' }));
    expect(store.getState().params.temp).toBeCloseTo(GEODE_PRESETS[1].params.temp);
    expect(store.getState().params.px).toBeCloseTo(0.2);
    expect(store.getState().params.end).toBeCloseTo(0.6);
  });
});

describe('<Geode> back (debug)', () => {
  it('flips to the back with every knob behind the macros', () => {
    window.history.pushState({}, '', '/?geodeback');
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'BACK' }));
    expect(screen.getByLabelText('The back of Geode (debug)')).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Window filter' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Drive pull' })).toBeTruthy();
    window.history.pushState({}, '', '/');
  });
});

describe('<Geode> dock icons', () => {
  it('drag up sets the amount (scaled: 100 px ≈ 40%), drag does not open the pop-up, a click does', () => {
    const store = mount();
    const room = screen.getByRole('button', { name: 'Room' });
    const wet0 = store.getState().params.wet;
    fireEvent.pointerDown(room, { clientY: 400, button: 0 });
    fireEvent.pointerMove(window, { clientY: 300 });
    fireEvent.pointerUp(window, { clientY: 300 });
    fireEvent.click(room);
    expect(store.getState().params.wet).toBeCloseTo(wet0 + 0.4, 2);
    expect(screen.queryByRole('dialog', { name: 'room' })).toBeNull();
    fireEvent.click(room);
    expect(screen.getByRole('dialog', { name: 'room' })).toBeTruthy();
  });

  it('the thermometer pop-up is just the thermometer', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Temp' }));
    const d = screen.getByRole('dialog', { name: 'temp' });
    expect(d.querySelector('h3, p')).toBeNull();
    expect(d.className).toContain('is-bare');
  });
});
