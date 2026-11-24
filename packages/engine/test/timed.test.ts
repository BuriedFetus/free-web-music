// Other people's live keys are played at their time, to the sample, by the real engine (WASM).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SR = 48000;
const g = globalThis as Record<string, unknown>;

async function engine() {
  g.sampleRate = SR;
  g.currentFrame = 0;
  g.currentTime = 0;
  g.AudioWorkletProcessor = class {
    port = { postMessage() {}, onmessage: null };
  };
  const { FwmEngine } = await import('../web/worklet.js');
  const wasm = readFileSync('packages/engine/web/fwm_engine.wasm'); // tests run from the repo root
  const e = new FwmEngine({ processorOptions: { wasm } });
  e.msg({ t: 'add', slot: 0, kind: 1 });
  let frame = 0;
  const render = (blocks: number) => {
    const out: number[] = [];
    for (let b = 0; b < blocks; b++) {
      g.currentFrame = frame;
      g.currentTime = frame / SR;
      const L = new Float32Array(128), R = new Float32Array(128);
      e.process([], [[L, R]]);
      out.push(...L);
      frame += 128;
    }
    return out;
  };
  return { e, render };
}

describe('timed events (worklet)', () => {
  it('a note sent for a later time starts on that sample, not when it arrived', async () => {
    const onset = (out: number[]) => out.findIndex((v) => Math.abs(v) > 1e-6);
    // The instrument's own rise time: a note played at once, at the start of a block.
    const ref = await engine();
    ref.e.msg({ t: 'on', slot: 0, note: 48, vel: 1 });
    const rise = onset(ref.render(4));
    const { e, render } = await engine();
    render(2); // 256 frames of silence
    e.msg({ t: 'at', at: 1000 / SR, m: { t: 'on', slot: 0, note: 48, vel: 1 } });
    expect(Math.abs(onset(render(12)) + 256 - rise - 1000)).toBeLessThanOrEqual(4); // ±4 samples: where the wave first crosses the threshold
  });
});
