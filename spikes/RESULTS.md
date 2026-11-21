# Phase 0 tech tests: results

Run with `python3 spikes/serve.py`, then open http://localhost:8765/spikes/ (or open `spikes/index.html` as a plain file to see the non-isolated fallback). To rebuild the WASM: `spikes/build.sh` (needs `rustup target add wasm32-unknown-unknown`).

Measured on 2026-11-21, Firefox 158 (headless), Linux x86_64.

## 1. Cross-origin isolation: works, with one test still to do in the host app
- With the `COOP: same-origin` + `COEP: require-corp` headers (`serve.py`), the page is `crossOriginIsolated` and `SharedArrayBuffer` is available.
- Without them (plain file), the page correctly detects that and the engine falls back to `MessagePort`.
- **Decision:** the engine supports both paths. It uses the SharedArrayBuffer ring when isolated, and MessagePort otherwise (slightly more, and less even, latency).
- **Still to test inside the friend's app** (needs the friend):
  - [ ] Their server can send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`) on the page that hosts the studio.
  - [ ] Nothing in their app breaks. `require-corp` blocks cross-origin images, fonts, scripts and iframes that don't send CORS/CORP headers (`credentialless` is more forgiving; check Safari support). `COOP: same-origin` cuts `window.opener` for popup-based logins (OAuth popups).
  - [ ] If they can't isolate, the studio still works on the MessagePort path.

## 2. DSP cost: Rust/WASM is about 2.2× faster than JS
The same voice runs in both: PolyBLEP saw → TPT/ZDF state-variable low-pass → envelope, in 128-sample blocks at 48 kHz.

| Voices | JS, % of real time | WASM, % of real time | Speed-up |
|---|---|---|---|
| 1 | 0.08% | 0.04% | 2.0× |
| 8 | 0.53% | 0.22% | 2.4× |
| 16 | 0.94% | 0.44% | 2.2× |
| 32 | 2.01% | 0.88% | 2.3× |
| 64 | 3.95% | 1.77% | 2.2× |

- The WASM module is 1.1 KB, with no allocation and no std.
- JS and WASM output differ by at most 1.9e-3 (f64 vs f32 maths), so the algorithm matches.
- **Caveat:** this is a deliberately small voice. A full Basalt voice (two oscillators, sub, drive with oversampling, two envelopes, LFO, modulation) will cost roughly 10–20× more. That still leaves headroom for dozens of instruments.
- **Decision:** keep Rust → WASM for all DSP. The hard deadline per 128-sample block at 48 kHz is 2.67 ms on the audio thread.

## 3. Clock sync and jitter buffer: the plan works (simulated)
Simulated network: a true clock offset of 1234.567 ms, one-way delay of 35 ms + random jitter (mean 12 ms), and 5% spikes of +80 ms. It's seeded, so results repeat.

| Exchanges | Naive average error | Min-RTT filter error |
|---|---|---|
| 5 | 3.48 ms | 3.09 ms |
| 10 | 2.40 ms | 0.76 ms |
| 20 | 3.91 ms | 0.28 ms |
| 40 | 1.63 ms | 0.20 ms |

| Jitter buffer | Live notes arriving too late |
|---|---|
| 50 ms | 31.1% |
| 70 ms | 10.6% |
| 90 ms | 6.2% |
| 120 ms | 3.4% |
| 150 ms | 0.3% |

One-way delay was p50 43.9 ms, p95 115.7 ms and p99 135.5 ms.

- **Decision, clock offset:** NTP-style exchanges, keeping the quarter of samples with the lowest round-trip time and taking their median. Do about 10 exchanges when someone joins, then one every few seconds. That gives sub-millisecond agreement on transport position.
- **Decision, live notes:** they carry a shared-clock timestamp and play at `sent + buffer`. The buffer adapts to roughly the measured p95 one-way delay. A note that arrives late plays immediately instead of being dropped.
- **Still to test:** the same measurements over the friend's real channel.

## 4. Live audio latency: needs a person with speakers
The test page's "Start audio test" button runs the WASM voice inside an AudioWorklet. It reports base and output latency, the round trip to the audio thread, the event path used, and an estimated key-to-sound time. Headless runs have no audio device, so this one is not measured yet.

- [ ] Run it on the user's machine (and the friend's) and paste the numbers here. Target: under ~20 ms key-to-sound on wired output.
