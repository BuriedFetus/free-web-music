# Plan: Collaborative device-based music studio (core for a React host app)

## Context
Empty project `free-web-music`. We build the **core** of a collaborative music studio that will be embedded in a friend's **React** web app. The friend provides collab (live sync + persistence) via their Git repo, based on **Yjs**.

What the user wants:
- A big **library of instruments**; bringing one into the project creates a **track**; multiple copies of the same instrument allowed.
- A **main sequencer / clock** external to instruments; an instrument's window shows and edits the sequencer track that feeds it. Some instruments may also have their **own built-in sequencer**, synced to the main clock.
- **Multiple windows** in the app; each person's layout is private, but two people on the same window **see each other's interactions**.
- People **jam together with their computer keyboard** and **hear each other's playing** live.
- **Scalability first**: effects, tape/recording output, global and per-track time/pitch come later and must plug in without rework. Not built now.
- High-quality instruments and a polished UI. Visual reference: **KORG Gadget's feel** (bright, hardware-like mini-device panels, big touchable controls). We take inspiration only and use our own device designs, names and art, not copies.
- Built iteratively in vertical slices, with the UI designed and approved before each feature is built.

## Core architecture: everything is a Device
- **Device** = manifest (id, version, kind: instrument | sequencer | effect | recorder), typed **ports** (notes in/out, audio in/out, clock in, modulation), **parameter schema**, DSP factory, React UI component, state migration for version upgrades.
- **Device registry / library**: the core only loads, wires, persists devices. New devices need no core change.
- **Track** = note source(s) → instrument → effect slots (empty in v1) → mixer channel → master. Tape/recorder later inserts on a track or on the master.
- **Clock**: one global transport (tempo, rate, position) with a **per-track time/pitch offset** in the model from day one (inactive until later).

## State: three layers
| Layer | Contents | Sync |
|---|---|---|
| Project | devices, tracks, wiring, patterns/notes, params | Yjs doc (friend's provider) |
| Workspace | my open windows, positions, sizes, zoom, scroll | local per user, never shared |
| Presence / live | what I'm viewing and touching (control id, step id, drag), held keys, live notes | ephemeral channel |

- Presence is **semantic** (e.g. "user X turning `cutoff` on device `synth-2`"), not screen pixels, so each viewer's window renders it in place: colored ring on the knob, highlighted step, avatars on the window title bar.
- **Per-user undo** (Y.UndoManager scoped to the local origin).

## Live jamming
- Computer keyboard (MIDI later) plays the focused instrument window, with optional record into its sequencer track.
- Live notes are sent as tiny timestamped events; every client plays them on **its own copy** of that instrument (no audio streamed).
- Shared transport: clock-offset estimation between peers, so play/stop and position agree; remote live notes go through a small **jitter buffer** for even timing. Network delay is unavoidable for live notes; recorded notes are exact.
- **Contract needed from friend's collab**: Yjs doc + awareness + a low-latency **ephemeral message channel** (Yjs awareness alone is too coarse for note streams). Asset/file storage is needed later for tape audio.

## Windows
- v1: floating windows inside one browser tab (desktop-style).
- The workspace layer is abstract, so **pop-out to a separate browser window / second monitor** can be added later without touching devices.

## Audio engine
- **AudioWorklet** audio thread; DSP in **Rust → WebAssembly**; sample-accurate scheduling inside the worklet.
- Quality bar: alias-free oscillators, analog-modelled filters, parameter smoothing, proper voice allocation, oversampling where needed.
- SharedArrayBuffer ring buffers need **COOP/COEP headers** in the host app; fall back to postMessage if unavailable.

## Modulation (LFOs etc.)
- Every device parameter is **modulatable** by design: the param schema carries range + modulation slots.
- **Sources**: per-device LFOs and envelopes, velocity, mod wheel/aftertouch, macros; later **track-level / global modulator devices** (an LFO device that can target any param on any track).
- **Routes** = `{ source, target param, depth (bipolar) }`, stored in the project doc, so collaborators see and hear them.
- UI: "assign" mode (pick a source, click a knob), purple depth arc + live position dot on modulated knobs, route list per device. Modulation is computed in the audio thread; the UI only mirrors it.

## Scopes & meters
- Every device header can show a **live scope** (waveform) of its own output; mixer strips get level meters.
- Data comes from the audio thread via a cheap snapshot buffer, drawn at screen refresh.

## Effects & routing
- Effects (**reverb, delay**, chorus, EQ, compressor, distortion…) are devices of kind `effect`, in the same library.
- Each track: **insert chain** (ordered effect slots) → fader/pan → **sends** to **return buses** (shared reverb/delay) → master.
- **Routing graph** in the project model: any audio out → any audio in (buses, group tracks, sidechain inputs), with cycle prevention. A routing view shows and edits it.
- Tape/recorder devices later sit anywhere in that graph (one track or master).

## Public API (to the host app)
```tsx
<Studio doc={ydoc} awareness={awareness} channel={ephemeralChannel} user={{ id, name, color }} />
```
The core does no networking. The host owns providers, persistence and storage.

## Step 0a: Public GitHub repo (first action after approval)
- `git init`, branch `main`.
- Files: `README.md` (project summary, device concept, status "planning"), `docs/PLAN.md` (this plan), `LICENSE` (MIT, copyright holder: GitHub user BuriedFetus — no email/real name), `.gitignore` (Node, Rust/target, OS files).
- Commit with the Co-Authored-By attribution line.
- `gh repo create BuriedFetus/free-web-music --public --source . --push --description "Collaborative device-based music studio core (WIP)"`.
- Verify: `gh repo view BuriedFetus/free-web-music` and `git status` clean.
- No code until Phase 0 design is approved.

## Phases (each = design screen → you approve → build → review)
| # | Goal | You see / approve |
|---|---|---|
| 0 | Visual direction + clickable prototype (no sound): library + drag-to-track, window workspace, instrument window with its sequencer lane, main sequencer, two-user presence. Plus tech tests: WASM worklet latency, COOP/COEP in friend's app, peer clock sync. | Prototype + test results |
| 1 | Engine core: device registry, worklet + WASM, transport/clock, **one flagship instrument** (Basalt) at full quality with its LFO/modulation and live scope, keyboard playing | That instrument, playable, final UI |
| 2 | Project model on Yjs + collab stand-in (two tabs/windows), presence, per-user undo | Two people tweaking the same instrument, seeing each other |
| 3 | Main sequencer device + instrument-window lens on its track; built-in-sequencer support | Programming patterns from both places |
| 4 | Live jamming: shared transport, note events, jitter buffer | Two people playing together and hearing each other |
| 5 | More instruments, one per slice, each with designed UI | Each signed off |
| 6 | Mixer with meters, scenes/song arrangement | Building a full track |
| 7 | Effects + routing: reverb and delay devices, insert chains, sends/returns, routing view, global modulators | A mix with shared reverb/delay and custom routing |
| 8 | Hand-off package + integration guide for friend | Running inside their app |
| Later | Tape/recorder output, global + per-track time/pitch, 3D/immersive view | Fits on the existing device/track chain |

### Phase 0 progress
- [x] Device kit design sheet: Basalt, template anatomy, materials, presence states, editor colours (`design/phase0/design-sheet.html`)
- [x] Live scope + LFO/modulation assignment on Basalt
- [ ] Clickable 4-panel workspace (scene grid, piano roll, mixer, device) + library drag-to-track + presence
- [ ] Main sequencer window
- [ ] Tech tests: WASM worklet latency, COOP/COEP in friend's app, peer clock sync

## Verification
- Unit tests (Vitest; Rust tests for DSP): model ops, concurrent-edit merging across two Y.Docs, scheduler timing, DSP output checks (aliasing, clicks).
- Dev harness: two browser windows on one project → presence, edits, live jamming audible both sides; reload restores the project.
- Library build mounted in a plain React test page with a Yjs doc passed in.
