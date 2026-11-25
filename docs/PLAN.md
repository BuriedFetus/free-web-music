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
- The channel carries small JSON messages (`LiveMessage` in `packages/studio/src/collab/types.ts`) to everyone else in the session: live notes, plus the shared transport's `ping` / `pong` (about one per second per person), `hello` and `tp`. The host relays them as they are. In-order delivery is best but not required.

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

## Sequencer capabilities (required)
- Note editing: pitch, start, **length**, velocity; draw/move/resize/delete; keyboard nudging.
- **Live recording** from keys (quantised to steps), overdub while **looping**.
- **Automation**: per-step parameter lanes, drawn by hand or recorded from knob moves during Rec.
- LFO modes per modulator: **Free** (runs freely), **Retrig** (restarts per note), **Poly** (one per voice).

## Effects & routing
- Effects (**reverb, delay**, chorus, EQ, compressor, distortion…) are devices of kind `effect`, in the same library.
- Each track: **insert chain** (ordered effect slots) → fader/pan → **sends** to **return buses** (shared reverb/delay) → master.
- **Routing graph** in the project model: any audio out → any audio in (buses, group tracks, sidechain inputs), with cycle prevention. A routing view shows and edits it.
- Tape/recorder devices later sit anywhere in that graph (one track or master).

## Theming (host can restyle everything)
- Full contract in [THEMING.md](THEMING.md). Three levels: app tokens (`--fwm-*`, incl. depth / glow / round dials), device skin tokens (`--dev-*`, declared at zero specificity), and replaceable React primitives (Knob, Fader, Button, Screen, Keys).
- Devices only use those primitives and tokens, never hard-coded colours, fonts or shadows. Package styles are scoped (prefix / optional Shadow DOM), and font loading is optional.

## Public API (to the host app)
```tsx
<Studio doc={ydoc} awareness={awareness} channel={ephemeralChannel} user={{ id, name, color }} theme={{ tokens, devices, components, loadFonts }} />
```
The core does no networking. The host owns providers, persistence and storage.

## Step 0a: Public GitHub repo (first action after approval)
- `git init`, branch `main`.
- Files: `README.md` (project summary, device concept, status "planning"), `docs/PLAN.md` (this plan), `LICENSE` (MIT, copyright holder: GitHub user BuriedFetus — no email/real name), `.gitignore` (Node, Rust/target, OS files).
- Commit with the Co-Authored-By attribution line.
- `gh repo create BuriedFetus/free-web-music --public --source . --push --description "Collaborative device-based music studio core (WIP)"`.
- Verify: `gh repo view BuriedFetus/free-web-music` and `git status` clean.
- No code until Phase 0 design is approved.

## Milestones (updated 2026-11-25)
| Phase | Status |
|---|---|
| 0 Design + tech tests | ✅ done, approved |
| 1 Engine + Basalt | ✅ done |
| 2 Shared project, presence, undo | ✅ done |
| 3 Sequencer → Song arrangement, songs, Flint (drums) | ✅ done, reviewed ("drums and tracks are good") |
| 4 Playing together (shared Play, clock sync, live keys Even/Tight, people chips) | ✅ done, signed off ("amazing") |
| 6 Mixer (strips, meters, master) — pulled forward | ✅ built, waiting for review |
| 7 (part) Effects: Reverb, Delay, sends, draggable chain, tape/vinyl Lo-fi, main Low-pass — pulled forward | ✅ built, waiting for review |
| Extra: Scope panel, pattern previews in the arrangement | ✅ built, waiting for review |
| **5 More instruments**: **Garnet** (string synth, mock-up `design/kit/garnet.html` approved 2026-11-25) first, then Opal (pads), then Quartz (FM keys, two oscillator rows + filter block on the right). Cobalt parked | ✅ Garnet built (3 slices), waiting for review; next Opal mock-up |
| Later in 7: insert effects per instrument, routing view, global modulators | open |
| 8 Hand-off package for the friend's app | open |
| Later | Tape/recorder, time/pitch, 3D view, sample pads for Flint | open |

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
- [x] Device kit design sheet: Basalt, template anatomy, materials, presence states, editor colours (`design/kit/index.html`)
- [x] Live scope + LFO/modulation assignment on Basalt
- [x] Filter envelope (Amp/Filter tabs), LFO modes Free / Retrig / Poly
- [x] Sequencer lens as piano roll: pitch, length, velocity editing; play, live record, loop, 1–2 bar length, automation lanes (Cutoff, Reso)
- [x] Theming contract: tokens + skin examples (Default / Flat / Host brand), docs/THEMING.md
- [x] Modulation matrix on Basalt: sources LFO 1 / Amp env / Filter env → any knob or envelope fader, per-route depth, no self-modulation loops
- [x] Skins split into one file per device (`design/kit/skins/`), `design/check-skin.sh`, `CLAUDE.md` with reskin recipe
- [x] Clickable 4-panel workspace (`design/kit/workspace.html`): scene grid, piano roll, mixer, device; any panel can show any view; resizable/maximisable panels and floating device windows (private layout); library drawer with drag-to-track (multiple copies); transport (scene loop / song, rec); simulated collaborator presence
- [x] Two more device skins via the recipe: Flint (drums), Opal (pads)
- [x] Main sequencer view in the workspace: clock, swing, per-track length / direction / rate, Own seq, clear
- [x] Sequencer editing: micro-timing (float step positions, Snap 1/4–1/64 or Off), record quantize options, clear + undo clear
- [x] Tech tests (`spikes/`, results in `spikes/RESULTS.md`): isolation detection + fallback, Rust/WASM DSP ≈2.2× JS, clock sync <1 ms after 10 exchanges, jitter-buffer sizing
- [ ] Still needs people: live audio latency on real speakers; COOP/COEP inside the friend's app

### Phase 1 progress
- [x] Rust engine (`packages/engine`): rack of device slots, sample-accurate event queue, smoothing, no allocation, 14 quality tests
- [x] Basalt DSP: 4-point BLEP/BLAMP oscillators at 2× with half-band decimation (aliasing ≤ -79 dB), TPT filter + drive, analog-style ADSRs, LFO (Free/Retrig/Poly), mod matrix, glide, ~1.2% CPU
- [x] AudioWorklet host (`packages/engine/web`), browser smoke test
- [x] `@fwm/studio` React library: primitives (Knob, Fader, Button, Screen, Keys) with the THEMING contracts, Basalt front panel, 5 presets, theming levels 1–3
- [x] Vite harness with COOP/COEP; Basalt alone at `?basalt`
- [ ] SharedArrayBuffer ring (MessagePort only so far)
- [ ] Skin check of the React Basalt in Flat / Brand (renders, not yet reviewed side by side)

### Phase 2 progress
- [x] Project model on Yjs (`packages/studio/src/model/project.ts`): tracks, device params/routes/preset, patterns per scene, automation, tempo, swing. Top-level types only, nested maps created with their track (no creation races)
- [x] Per-user undo/redo (Y.UndoManager by origin). Discrete actions are always separate undo steps; drags merge
- [x] Semantic presence over awareness: who is on which track/scene, which control or note they are touching; rings and name tags on knobs/faders, outlined notes, avatars on tracks and devices, people chips
- [x] Private workspace: 2×2 resizable/maximisable panels, any view in any panel, saved per user in the browser
- [x] `<Studio doc awareness channel user theme onEngine />`; collaboration stand-in in the harness (`tabSync.ts`: BroadcastChannel between tabs + localStorage)
- [x] Live keys reach everyone through the host channel and play on each client's own copy of the instrument (immediate; Phase 4 adds the shared clock and jitter buffer)
- [x] Two-tab end-to-end test in real Firefox (`?e2e=a` / `?e2e=b`): 9 checks pass
- [ ] Floating device windows (prototype has them; panels cover the need for now)

### Phase 3 progress
- [x] Main sequencer on the audio thread (`Sequencer` in `worklet.js`): sample-accurate, per-track length / direction / rate, swing, micro-timing, same-pitch retrigger, automation per step, mute; 9 timing tests
- [x] Main sequencer view: step lanes, playhead, length, direction, rate, mute, clear (undoable), remove track (undoable)
- [x] Piano roll: add / move / resize / delete, Snap 1/4…1/64/Off, keyboard nudging, quantize, velocity lane, automation lanes for every continuous param, peer edits outlined
- [x] Live recording: notes (Rec quantize, latency-compensated) and knob moves (as automation) while Rec + Play
- [x] ~~Scenes A–D~~ replaced after user testing (2026-11-23) by the redesign below
- [x] Redesign, approved as a mock-up (`design/kit/arrange.html`): patterns belong to each instrument (named, 1 step–8 bars); the main sequencer is the **song arrangement** (instruments × TRACK rows; a TRACK lasts as long as its longest pattern); the audio thread plays the song (Loop TRACK / Loop SONG, jump to a TRACK on the beat); typed BPM; song-wide key
- [x] Songs: Save, Save as copy, saved-song list, New from INIT, "not saved" shared by everyone; storage through the host's `SongLibrary` (the harness uses localStorage)
- [x] Flint (drum machine), pulled forward from Phase 5 at the user's request: synthesized 8-pad kits (8 drum types × 4 characters), kit presets, drum grid in the Piano roll panel with a length per pad row, accent, rolls, velocity, pad mute / solo
- [ ] Flint: sample pads (later; goal: no download from a server for everyone)
- [ ] "Own seq": plumbing done (flag reaches the engine), waits for a device with a built-in sequencer (Cobalt, Phase 5)
- [x] ~~Play/stop is local per person~~ shared since Phase 4

### Phase 5 progress: Garnet (string synth)
User's asks (2026-11-25): fake strings you can strum; the scale's notes lit; Chord mode with chord types, each chord built in the song's key; a guitar-like analog sound. Family layout for the synths: two rows with the filter (Garnet: amp) block on the right.
- [x] Mock-up with real sound (`design/kit/garnet.html`): Chords mode (strips = chords of the key; Triad / 7th / sus2 / sus4 / add9 / Power; guitar voicings found by a search over shapes), Notes mode (frets 0–12, scale lit, root brightest, slide by dragging), Pick / Body / Amp / Play controls, 7 presets. `?selftest` checks tuning and levels offline at 44.1 / 48 kHz, `?livetest` a live strum
- [x] Slice 1, engine: `src/devices/garnet.rs` (device kind 3): six Karplus–Strong strings with pick position and hardness, tuning-compensated loop (tests: within 0.2 cents on every string at 44.1 and 48 kHz), notes given to strings like a guitarist's hand (strums land on the right strings), Ring (how long a string sounds after note-off), palm mute, vibrato, Slide (off by default: legato glides one string), body (Nylon / Steel / Hollow / Electric) and amp (Drive 2× oversampled and level-matched, Cab, Presence) with RBJ biquads (`dsp/biquad.rs`). String loops come from the static pool (now 4 MiB), one block per slot, reused. Manifest `devices/garnet.json`. Tests `tests/garnet.rs` (10). ~1.7% of a core for six strings
- [x] Slice 2, device in the studio: `devices/garnet/Garnet.tsx` (Pick / Body rows with a stepped Body dial, Amp block with a stepped Cab dial, Play row, 7 presets, shared knobs with presence), skin `skins/garnet.css` (the panel draws the sunburst glow; the token texture is a grain that tiles), Library category Strings, `engine.js` kind 3, manifest maps `sq` / `sq0`
- [x] Slice 3, the neck: Chords (strips = chords of the song's Key, no key = C major; types Triad / 7th / sus2 / sus4 / add9 / Power; shapes from `devices/garnet/music.ts`) and Notes (frets 0–12, scale lit, root brightest, Only scale notes). Drag across strings to strum (speed = velocity), click a chord name or keys 1–7 (Shift = up). A string rings until plucked again, a chord without it is strummed, or 4 s. Rec: notes recorded, and a strum stays a strum under quantize (Garnet notes within 75 ms keep their distance from the first). Mode / type are per person (localStorage). Tests: `test/garnet.test.ts` (5), browser `?e2e=garnet` (13)
- [x] Distortion knob (user, 2026-11-25: "distortion/fuzz warmth … electric metal guitar feel"): a pedal before the amp. It tightens as it gains (low cut, mid push, fizz cut), then an asymmetric stage (even harmonics: warm fuzz) and a second stage (high-gain metal); level-matched (+5 dB at full), sustain 0.07 → 0.75 a second in. The amp now runs 4× oversampled with a fast tanh (`sat`): 3% of a core for six strings. Presets Warm Fuzz and Metal; Crunch and Lead Drive use it. Tests in `tests/garnet.rs` (12)

### Song arrangement cells (user, 2026-11-25: "double-click to remove a pattern … drag and drop (copy to this track)")
- [x] Double-click a cell (or Delete) empties it; the pattern stays with its instrument; toast with Undo
- [x] Drag a cell onto another TRACK of the same instrument: the same pattern plays there (edits change both); hold Ctrl / Alt when dropping for a separate copy ("Groove 2"). `Project.placePattern` (one undo step). Pointer-based (Firefox can't drag buttons natively; works with touch), a label follows the pointer and says what will happen, other instruments' cells refuse, Escape cancels, the panel scrolls at its edges. Tests: project test, browser `?e2e=arrange` (11)

### My look (user, 2026-11-25: "my friends … send them to their claude-agent to revamp the UI to their liking without impacting the UI of other users")
- [x] Each person keeps their own stylesheet (`model/look.ts`, `studio/LookPanel.tsx`, top bar **My look**): copy a brief for their AI agent (rules, every token, the main classes, their current look), paste or load the CSS, Try / Keep / Back to default. Kept in this browser (`fwm.look.<user>`) or by the host (`look` / `onLookChange` props); never in the Yjs doc. Nested under `.fwm-root`, `@import` and remote `url()` removed, @font-face / @keyframes lifted out; `?nolook` switches looks off. Docs `docs/LOOKS.md`, THEMING.md level 4. Tests `test/look.test.ts` (8, incl. "the brief names every token"), browser `?e2e=look` (12)

### Mixer and effects (pulled forward from Phases 6–7 at the user's request; mock-up `design/kit/mixer.html`, approved 2026-11-25)
- [x] Slice 1, mixer: engine strips per slot (level with a cubic fader curve, 0.8 = 0 dB; balance pan; mute; ~10 ms gain glide) and master, peak meters (`src/mixer.rs`, `fwm_mix / fwm_master / fwm_meters`, `engine.setMix / setMaster`, `tick.meters`); shared mixer settings in the song (`Project.mix / setMix / masterLevel`, flat `mix.*` keys on each track, saved in song files); **Mixer** panel (`views/MixerView.tsx`, skin `skins/mixer.css`): strips with M / S (M is the instrument's one Mute), Pan, large fader with L/R meters, dB, master. Solo is resolved by the studio. Tests: `tests/mixer.rs`, project tests, browser `?e2e=mixer`
- [x] Slice 2, Reverb (Dattorro plate: size = decay 0.4–6 s, measured; pre-delay; tone) + Delay (tempo divisions, ping-pong, feedback through low cut + tone + soft saturation, bounded at max) with Reverb / Delay send knobs per strip (post-fader), and the effects chain: each effect a stage in chain order (`src/fx/`), Reverb / Delay add their return where they sit; unused Reverb / Delay sleep at zero cost. Shared in the song (`fwm.fx`, `model/fx.ts`), saved in files. UI `views/FxRack.tsx`: shown when the Mixer panel is maximised (or the master's chain button), arrows, drag by title / ◀ ▶ / × / shelf, a picture per effect
- [x] Slice 3, Lo-fi (tape / vinyl in Rust: wow, flutter, saturation level-matched at a typical level, age, noise, crackle, mix; off = untouched, no delay; each style keeps its own settings) and the main Low-pass (resonant SVF, cutoff glides in pitch; fully open = exact bypass, the default). Effect memory: one static pool in WebAssembly (`fx/line.rs`). Tests: `tests/fx.rs` (10), project tests, browser `?e2e=fx` (17)
- [x] Song arrangement cells preview their pattern (mini roll / pad grid, bars and beats) with a playhead while playing (user request)
- [x] Slice 4, Scope panel (`views/ScopeView.tsx`): the master (after effects) or one instrument (after its fader) through an engine probe (`fwm_probe`, `engine.setProbe`, `tick.probe`, 4096 samples, only while a Scope is open); Wave with a rising-zero-crossing trigger, 5–40 ms, height following the level (peak dB readout); Spectrum (Hann + FFT in the browser, log frequency, smooth fall); Freeze. View settings are per person. One probe per engine: two Scope panels show the same source (the last one picked). Tests: `tests/mixer.rs` probe test, browser `?e2e=scope` (9)

### Phase 4 progress (mock-up `design/kit/together.html`, approved 2026-11-24)
- [x] Slice 1, shared transport (`packages/studio/src/collab/transport.ts`): clock difference per peer from ping / pong (lowest-delay quarter, median); Play starts everyone on the same sample after a short lead (worst recent delay + 30 ms, 60–400 ms, 0 when alone); TRACK clicks and Loop TRACK / SONG reach everyone; the driver (last to press Play / click a TRACK) says where the song is once a second and anyone > 4 ms off seeks (drift, tempo changes, song edits); newcomers ask ("hello") and drop in; **Play alone**. Engine: `playAt / seek / where`, page time ↔ audio time via `getOutputTimestamp`. Tests: `packages/studio/test/transport.test.ts` (simulated network), sequencer start / seek to the sample, browser `?e2e=ta` + `?e2e=tb` (two tabs measured 0.2–2.7 ms apart)
- [x] Slice 2, live keys and knob turns in time (`collab/liveTiming.ts`): keys and knob turns carry the moment they were heard by their player; **Even** plays them at that moment + a lag (p95 of recent arrivals + 3 ms, measured as arrival − sent so clock estimates can't move it; glides up 2 ms / down 0.5 ms per key), **Tight** on arrival; a release keeps its press's lag; per person (`ws.liveMode`, top bar "Live keys Even / Tight"). The worklet plays timed events to the sample (`{t:'at'}`, `noteOnAt / noteOffAt / setParamAt`). A knob someone turns live is held from the doc's updates until 250 ms after their last turn (`HeldParams`), then set to the doc's value. Play starts no sooner than everyone's sound cards can play it (pings carry each output delay)
- [x] Slice 3, people chips: "● in time · 45 ms" (network delay from the pings; red "far" above 150 ms), "joining…", "playing alone"; tooltip says the Even lag and the share of late keys

**Phase 0 complete.** Handoff notes for Phase 1: `docs/HANDOFF.md`.

## Verification
- Unit tests (Vitest; Rust tests for DSP): model ops, concurrent-edit merging across two Y.Docs, scheduler timing, DSP output checks (aliasing, clicks).
- Dev harness: two browser windows on one project → presence, edits, live jamming audible both sides; reload restores the project.
- Library build mounted in a plain React test page with a Yjs doc passed in.
