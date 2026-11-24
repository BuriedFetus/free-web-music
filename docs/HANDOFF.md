# Handoff: Phases 1–3 (engine, collaboration, sequencer)

## START HERE (2026-11-24, later): Phase 4 slice 1 (shared transport) built; slices 2–3 next
The user approved the Playing Together mock-up (`design/kit/together.html`): "its all good" (after asking whether
latency only affects live playing: yes; the song itself, your own keys and recordings have no network delay).
Slice 1 built (see PLAN.md "Phase 4 progress"): `collab/transport.ts` (TransportSync) owns Play / Stop / TRACK clicks /
loop for the group; Studio passes it the engine as a `TransportTarget` (row ids ↔ indices). Toasts say who pressed
Play / Stop. **Play alone** button in the top bar (shown when someone else is here). Message types: `TransportMessage`.
Browser test: `?e2e=ta&room=R` + `?e2e=tb&room=R` in one Firefox (15 checks).
Next: slice 2 (live keys + knob turns stamped with the sender's time, played at sent + buffer: Even = adaptive
~p95 of measured delay, Tight = on arrival; per person, in the workspace), then slice 3 (people chips with ms).
Known limits: a long note that started before someone joins mid-row is not played for them (they hear from the next
note on); opening a song while others play is only coordinated through the doc sync.

## Earlier (2026-11-24): Flint (drum machine) built in 3 slices, waiting for the user's review
The user approved the Flint mock-up (`design/kit/flint.html`) and asked to build all three slices and commit;
they test and review next. Built:
1. **Sound** (`packages/engine/src/devices/flint.rs`, `devices/flint.json`, tests `tests/flint.rs`): device kind 2,
   8 pads × (8 drum types × 4 characters: Analog / Digital / Noise / Vintage), Tune / Decay / Tone / Level per
   pad, Accent and Level. Pad i = note 36 + i, accented = 48 + i. Closed hat chokes open hats. No samples
   (user: a later goal is samples "without people needing to download from a server").
2. **Device** (`packages/studio/src/devices/flint/`): kits (8 presets, "edited" when changed), pads, sound editor;
   keys A S D F G H J K play the pads (`useComputerKeys` layout 'pads', registry `layout: 'pads'`).
3. **Drum grid** (`studio/views/DrumGrid.tsx`): the Piano roll panel shows it for pad devices. Per-row lengths
   (`Project.rowLens/setRowLen`, pattern `lens` map; pattern len = longest row), tools Draw / Accent (`note.a`) /
   Roll (`note.r` 2–4), velocity lane, playhead per row, pad mute / solo (`seq.pmute/psolo` bit masks, shared).
   The worklet loops each pad row on its own length, sends accents as note + 12 and splits rolls.
Demo song (`?seednow`) now has Drums ("Beat" with a 12-step rim row, "Fill" with snare rolls). Browser tests
`?e2e=flint`, `?e2e=drums`. Screenshot with Drums selected: `?seednow&drumsfirst`.
Also (user request): **Wait** toggle in the top bar (`ws.cueWait`, on by default). Clicking a TRACK while playing
queues it (`cue(row, wait)`, shown as "next") and it starts when the playing TRACK ends; with Wait off it switches at once.
Open: the user's review of how the 32 sounds feel (they were tuned by tests and measurements, not by ear).

## Earlier (2026-11-24): sequencer redesign done (3 slices)
The user approved the Song Arrangement mock-up (`design/kit/arrange.html`, published privately). Build plan:
1. **Done:** scenes A–D are gone. Patterns belong to each instrument (`fwm.tracks[id].pats`, each pattern has a
   name and a length of 1–128 steps). The song is `fwm.song`: rows the UI calls TRACK 1, 2… In code a "track" is
   still an instrument lane, and song rows are "rows". The main sequencer is the arrangement grid (`SeqView`). The
   Piano roll edits the pattern in cell (ws.row, ws.track) and has the pattern picker, Name, Length, direction and
   rate. The song key and a typed BPM are in the top bar. For now the **selected TRACK loops** (TrackEngine sends
   that row's pattern per instrument). Schema 2; the harness saves under a new key (old saves are not migrated).
2. **Done:** the worklet plays the song (`Sequencer.setSong/setPat/cue`, see the message list at the top of
   `worklet.js`). A row lasts as long as its longest pattern (length ÷ rate), shorter ones restart with each row.
   Loop TRACK repeats the playing row, Loop SONG goes on to the next (per user, `ws.loop`). Play starts from the
   selected TRACK; clicking a TRACK name while playing jumps there at once, at the same place in the bar.
   Clicking a cell only selects it for editing. Recording and knob automation go into the playing row's pattern.
   Tests: `packages/engine/test/sequencer.test.ts` (song timing to the sample), browser `?e2e=song`.
3. **Done:** songs. `Project.toFile()/loadFile()/initSong()`, `unsaved` (hash in `fwm.meta.savedHash`, the same
   for everyone), `markSaved(id, file)`. Host contract: `SongLibrary` (`list/load/save/remove`) passed to
   `<Studio songs>`; the harness's is `apps/harness/src/songStore.ts` (localStorage). Song menu: `SongMenu.tsx`.
   Opening a song or INIT replaces it for everyone (asks first when unsaved; one undo step). Test `?e2e=songs`.
   Was planned as: songs (Save, song list, New from INIT) through a host-provided storage API (the core does no storage).
Also planned: Flint (drums) reuses the old step grid with a length per row.

## Earlier (2026-11-22): user testing feedback
The user played with Phases 2–3 and said: "quite buggy", "Not satisfied with the sequencer".
Fixed and pushed this session (each has a browser test):
- `82adcec` Adding a 2nd device silenced the 1st: the Basalt panel also called `useDeviceSync`, so switching the
  Device panel's track removed the old track's engine slot. Now only `TrackEngine` owns slots (panel syncs only
  when it has no `host`). Test: `?e2e=multi`.
- `51b719c` No way to pick which Basalt the Device panel edits ("I go on Device and only see 1 BASALT"). Added
  track tabs in the Device and Piano roll panel headers. Lesson: the user won't find hidden affordances; make
  every choice visible where it's needed.
- Next commit: "changing track in the sequencer makes everything break". Two causes: (1) a computer key held
  across a track switch was released on the NEW track, so the old mono Basalt droned forever; now released on
  the track it started on. (2) Space "clicked" the last-clicked button (step, Clear, Mute, ×) instead of
  play/stop; Space is now always play/stop outside text fields (capture phase, keyup default prevented).
  Test: `?e2e=switch`.

- 2026-11-23, second round of user feedback, done: piano keys play when pressed (slide = glissando); song key
  (root + scale, shared in `fwm.meta`) highlights in-key rows, "Fold to key" (per user, `ws.fold`) hides the rest;
  piano-roll grid lines follow Snap; notes on the same pitch never overlap (`Project.resolveOverlaps`, the edited
  note wins; quantize too); main sequencer lights steps held by long notes and clicking a held step ends the note
  there; rename a track with ✎ / double-click in the sequencer or the "Track name" field in the Device panel.
  Test: `?e2e=roll`. Screenshot with a key: `?seednow=3&key=0,minor`.
  Open question: "Snap should change the Sequencer limiter" was read as "grid lines follow Snap" (piano roll).
  If they meant the main step sequencer's cells, ask.

**Still open, waiting on the user's answers** (asked, not answered yet):
1. Any other bugs they hit (they say "sometimes": if switching still breaks, get exact steps; it could be
   two-tab specific, which `?e2e=switch` doesn't cover).
2. What feels wrong in the sequencer. My own critique, given to the user: steps show only on/off (no pitch,
   no length, long notes look like blips); no beat grouping by 4; a wall of tiny per-row buttons; lots of empty
   space; step grid and piano roll feel like two separate tools. Plan: MOCK UP a new sequencer (show UI first,
   publish as artifact) before building it.
Then Phase 4 (shared transport). The Studio artifact (HEVoA3TExTjSF2bRmVUUei) has NOT been republished with these fixes.

Single-tab e2e runs: `dist/index.html?e2e=multi`, `?e2e=switch`, `?e2e=roll`, `?e2e=song`, `?e2e=songs`, `?e2e=flint` and `?e2e=drums` (one firefox tab, POST to ./log).
`?seednow=3` seeds three Basalts for screenshots.

---

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
- **Remote activity never interrupts the local user.** Other people's edits and presence must not close an open menu, steal focus, or break a drag or typing. Apply them to the model straight away, but update the UI in place (or defer a full re-render until the user is done), and restore focus after re-renders. The workspace prototype does this with `uiOpen()` / deferred `renderAll()`. In React this means stable keys and no remounting of controls on remote updates.
- **Live jamming:** remote notes play on each client's own instrument copy, scheduled at shared-clock timestamp + adaptive jitter buffer (≈ p95 one-way delay). Clock offset via a min-RTT filter (see RESULTS.md).
- **Legal/design:** KORG Gadget's *feel* only. Our own mineral device names. `design/refs/` (copyrighted screenshots) is git-ignored and never published. Repo is public, MIT.

## Open items
- **Progress checklists for Phases 0–3 are in `docs/PLAN.md`.** Phases 1–3 are built and tested. Still open there: the SharedArrayBuffer ring, a side-by-side Flat/Brand review of the React Basalt, floating device windows, "Own seq" (waits for Cobalt), shared play/stop (Phase 4).
- How to check everything: `npm test` (Rust + Vitest), `npm run typecheck`, `npm run build -w apps/harness`, then the browser checks in `CLAUDE.md` (two-tab e2e, Basalt self-test).
- [x] Node.js installed with nvm (user approved). A fresh shell needs `. ~/.nvm/nvm.sh` first.
- [x] Rust + `wasm32-unknown-unknown`. Rebuild the WASM with `packages/engine/build.sh`.
- [ ] Live audio latency numbers on real speakers (user): harness Sound button shows output latency; or `python3 spikes/serve.py` → "Start audio test".
- [ ] Friend's app: COOP/COEP header test, their Yjs provider, their live channel (checklist in `spikes/RESULTS.md`). With COEP, cross-origin fonts/images must be requested with CORS.
- [ ] The design kit's lane (`index.html`) predates micro-timing; the real sequencer is in `packages/studio`.

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
