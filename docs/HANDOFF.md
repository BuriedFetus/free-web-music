# Handoff: end of Phase 0 → start of Phase 1

Notes for the next session (written 2026-11-21, before a context compaction). Read this, `CLAUDE.md`, `docs/PLAN.md` and `docs/THEMING.md` before writing code.

## Where we are
**Phase 0 (design + tech tests) is complete.** The user approved the look and feel ("The look and feel is good!") and wants to keep momentum.

| Deliverable | Where |
|---|---|
| Device kit: Basalt mono synth (scope, Amp+Filter envelopes, LFO with Free/Retrig/Poly, mod matrix), piano-roll lane with live rec/loop/automation, materials, knob states, skin switcher | `design/kit/index.html` |
| 4-panel workspace: Scenes, **Main sequencer**, Piano roll, Mixer, Device, Library; resizable/maximisable panels, floating device windows, simulated collaborator "Mira" | `design/kit/workspace.html` |
| Skins: app tokens, device template defaults, one file per device (basalt, quartz, cobalt, flint, opal), host examples | `design/kit/skins/` |
| Skin preview script | `design/check-skin.sh <device>` |
| Theming contract for the host app | `docs/THEMING.md` |
| Tech tests (isolation, WASM vs JS DSP, clock sync, live latency) + results | `spikes/`, `spikes/RESULTS.md` |

Both prototypes are silent. Sound starts in Phase 1.

## How the user likes to work
- Plain language, no jargon walls. Explain goals and priorities **before** acting; they asked to "see your thought process first".
- **Show the UI first.** Every feature starts with something visible they can click (published as a private artifact), then gets built.
- **High quality bar.** "I don't want cheap crappy instrument with bad trash UI." Pro DSP, polished hardware-style UI.
- **Scalability.** Build so later features plug in (tape, FX, routing, time-stretch), but don't build them before they're asked for.
- Iterate in small slices. They push back on "one-shot" building.
- Standing OK to **commit and push** each finished step to `main` ("Commit and keep moving"). Commits end with the Co-Authored-By line.
- They prefer answering in their own words over picking from guessed multiple-choice options when an idea is still open.
- Friendly and enthusiastic ("brother"). Match the warmth briefly, stay focused.

## Decisions that are locked
- **Embedding:** a React component `<Studio doc awareness channel user theme />` inside the friend's React app. The core does **no networking**. The host gives a Yjs doc, awareness, a low-latency ephemeral message channel, and later asset storage (for tape audio).
- **Everything is a device** (instrument / sequencer / effect / recorder) with typed ports, a parameter schema, a DSP factory, a React UI and a state migration. Tracks: note source → instrument → effect slots → mixer → master.
- **State layers:** project (Yjs, shared) / workspace (per user, private: panels, sizes, floating windows, snap setting) / presence (ephemeral, **semantic**: "turning cutoff on synth-2", never screen pixels).
- **Audio:** AudioWorklet + Rust → WASM. SharedArrayBuffer ring when cross-origin isolated, MessagePort fallback. Hard budget 2.67 ms per 128-sample block.
- **Modulation:** every parameter can be modulated. Routes `{src, target, depth}` live in the project doc. Sources so far: LFO (Free/Retrig/Poly), Amp env, Filter env; later velocity, mod wheel, macros, global modulator devices. No self-modulation loops.
- **Sequencer:**
  - Notes `{s, l, m, v}` with **float** `s`/`l` in 16th-steps (micro-timing).
  - Snap: 1/4…1/64 or Off.
  - Record quantize: the same options.
  - Clear and undo clear.
  - Per-track length (1–16), direction (fwd/rev/ping-pong/random), rate (½×/1×/2×), global swing.
  - "Own seq": a device runs its built-in sequencer, synced to the main clock.
  - Automation lanes per step, recordable from knob moves.
- **Theming:** `--fwm-*` app tokens, depth/glow/round dials, `--dev-*` device tokens in `:where()` (zero specificity), replaceable primitives (Knob, Fader, Button, Screen, Keys). No hard-coded styles in devices.
- **Live jamming:** remote notes play on each client's own instrument copy, scheduled at shared-clock timestamp + adaptive jitter buffer (≈ p95 one-way delay). Clock offset via a min-RTT filter (see RESULTS.md).
- **Legal/design:** KORG Gadget's *feel* only. Our own mineral device names. `design/refs/` (copyrighted screenshots) is git-ignored and never published. Repo is public, MIT.

## Open items
- [ ] **Node.js is not installed on this machine** (no `node`/`npm`). Phase 1 needs it for Vite + React + TypeScript. Ask the user to install Node LTS (or get their OK to install it via nvm) before scaffolding.
- [x] Rust is installed, plus the `wasm32-unknown-unknown` target (added in Phase 0). `wasm-pack` is not installed; plain `cargo build --target wasm32-unknown-unknown` works (see `spikes/build.sh`).
- [ ] Live audio latency numbers: the user runs `python3 spikes/serve.py` → "Start audio test" and pastes the numbers into `spikes/RESULTS.md`.
- [ ] Friend's app: COOP/COEP header test, their Yjs setup, and the ephemeral channel API (checklist in `spikes/RESULTS.md`).
- [ ] Undo is only "undo clear" in the prototype. Real per-user undo (Y.UndoManager by origin) comes in Phase 2.
- [ ] The design kit's lane (`index.html`) predates micro-timing. The workspace (`workspace.html`) is the reference for sequencer behaviour.

## Phase 1 plan (engine core + Basalt for real)
Goal: **Basalt plays real sound** at full quality from the computer keyboard, in its final UI, inside a dev harness. No collaboration yet (that's Phase 2).

1. **Scaffold** (after Node is installed). npm workspaces:
   - `packages/engine` (Rust crate → WASM, plus the TS worklet host)
   - `packages/studio` (React library: primitives, device UIs, theming)
   - `apps/harness` (Vite dev app)
   - Vitest for TS, `cargo test` for Rust.
   - Dev server sends COOP/COEP (as `spikes/serve.py` does).
2. **Engine (Rust):**
   - device trait
   - voice allocator (mono with legato/glide for Basalt)
   - sample-accurate event queue (note on/off, param change with timestamp)
   - parameter smoothing
   - no allocation on the audio thread
3. **Basalt DSP:**
   - oscillators (saw/square/tri/sine) with PolyBLEP/BLAMP, plus sub and shape
   - TPT SVF low-pass with resonance, and drive with 2× oversampling
   - amp and filter ADSR
   - LFO with Free/Retrig/Poly modes
   - mod matrix (LFO/Amp env/Filter env → any param)
   - glide, level
   - Tests: no aliasing above threshold, no clicks on param jumps, no denormals, CPU budget.
4. **Worklet host (TS):**
   - load WASM, SAB ring (with MessagePort fallback)
   - param and event API
   - scope snapshot buffer for the UI (a real waveform this time)
5. **React side:**
   - port the primitives from `design/kit` (Knob, Fader, Button, Screen, Keys) and the Basalt layout
   - use the skins CSS as is
   - presence/modulation as props, following the THEMING.md contracts
6. **Harness:** Basalt on screen, computer-keyboard play, scope showing real audio, skin switcher.
7. Show the user, iterate on sound and feel, then move to Phase 2 (Yjs model + collab stand-in).

## Private links (not in the repo)
The published artifact URLs (design kit, workspace) are in the session memory (`reference-artifacts`), not here, because this repo is public.
