# Handoff: Phases 1–3 (engine, collaboration, sequencer)

## START HERE (2026-11-27, night): the big QoL session. Everything below is pushed.
**Waiting on the user** (ask first, build after):
- Their listening test of Geode's rug / door / mirror (built from the approved mock-up `design/kit/geode-objects.html`).
- Next wall objects, all approved in principle: plant (grain density + spread), hourglass (freeze), shelf of jars (shimmer / sub / chorus; jars also show shimmer that comes from TEMP or anything else, as glowing bubbles above the set level). Wall clock and metronome are benched. Do a mock-up first; next time inside the real app behind a preview switch, so it looks like Geode.
- Rings vs grains (proposed, no answer yet): rings only for Mica's voice (real tape level), grains shown on the memory wall + sparks faded by the grains' real level.
- Their ideas for Geode's other pop-ups.
- `plz_fix_key` (a user screenshot) is in git history (commit 6f2cf71); deleted since. Rewriting history needs the user's OK. **Never `git add -A`**: the user drops screenshots in the repo root (`guitar-chord` is there now, untracked).

**Done this session:**
- Workspace: Tab zooms (mouse over the panels: full size ↔ all four, back into the same one); ⟷ makes a panel take its whole row; `fwm:open-view` window event brings a view forward (used by the arrangement).
- Song arrangement cells: double-click opens the pattern in the Piano roll (an empty cell gets a new pattern), right-click or the ✕ on hover empties it.
- Piano roll: a table (each grid line an element placed like the notes, bold bars, the ruler is the sticky first row); fat keys (Zoom = how many keys in view: 100% two octaves, 150% default ≈ 16 keys, 300% eight; the whole pattern always fits across); a real-looking keyboard with every name; note names inside notes; one toolbar row with Pattern ▾ for the rest; Lanes dropdown (Hidden / Velocity / Automation (n)), automation shows only lanes with points, + Automate a knob, Clear / Clear all automation (asks once); Shift+drag copies a note with its automation.
- Recording keeps a length you set (the take loops inside it); only a new empty 1-bar pattern grows.
- Knobs follow automation (Garnet GKnob, every ParamKnob without modulation).
- Saved presets on every instrument (shared `devices/PresetBar.tsx`, `model/myPresets.ts`). **Host API, new:** `presets?: PresetLibrary` on `<Studio>` (list(device) / save(device, preset) / remove(device, id); presets are plain JSON: id, name, params, routes, updated). The friend's app should keep them with the person's account; without it they stay in the browser.
- Garnet: no Chords / Notes switch (the neck shows notes); the chords of the key are a button row in PLAY (click / keys 1–7; with the chord guide on they guide like pressing the chord's root, applied after the strum); round notes unless the guide is on.
- Geode: Motion 0 = nothing moves (the walk scales with depth); drag the lamp (Light) and the window (Air; the sash follows the finger); room size + / − in the dock beside Room; rug (param 61, a macro: darker shorter tail, softer slap-backs, duller echo), door (= the SEND knobs), mirror (param 62 width; click flips Classic / Reverse). Browser test `?e2e=gobj`.
- Known: `?e2e=arrange` has 2 old drag failures (from before this session); the CPU budget test can fail when every engine test runs at once (16% alone).

## Earlier (2026-11-27, evening): Geode feedback round
- Every note sends its ring at once (short notes were missed); the Light dims only the lamp.
- Sliders in Geode's pop-ups: the handle = your setting, a bar behind it = what you hear now, and the number too, updated every frame from the engine (macros like Breath / Temperature and Motion move them). Element hook: `data-eff="<param>"` + `--eff`.
- Drag the room's back wall: up = bigger room, down = smaller.
- Dock icons: drag up / down sets their main amount (Room wet, Echo wet, Grains, Crunch, Light, Temperature, Air, Breath, Motion depth; 250 px = 0–100%), they fill up from the bottom with it; a click still opens the pop-up; arrow keys too. Map `DRAG` in Geode.tsx.
- Thermometer pop-up: only the thermometer (no title, no text, no window).
- Mica's walk and Motion no longer restart when a TRACK loops: devices get `Sequencer.clock` (steps since Play; a joiner starts at the row position), not the row position.
- Breath: Pluck now really plucks (Sustain pulled to 0, shorter decay; the pull is near full in the Pluck / Swell zones, gentle in the middle). Test `pluck_dies_away_while_the_key_is_held`.
- The user is thinking about ideas for the other pop-up menus: wait for them.
- Piano roll automation: one lane per automated knob, only those with points; + Automate a knob; Clear / Clear all automation (Project.clearAllAutomation, automationCount).
- **Host API, new:** `presets?: PresetLibrary` on `<Studio>` (list(device) / save(device, preset) / remove(device, id); presets are plain JSON: id, name, params, routes, updated). The friend's app should keep them with the person's account; without it they stay in the browser.
- Tab zooms the panels (Workspace.tsx): only while the mouse is over them. Proposed and awaiting the user: rings for the voice only, grains on the memory wall + sparks (see PLAN).

## Earlier (2026-11-27, later): Geode lighter, darker, plays once
User: "performance … a bit lacking", the room "full of dust due to the constant reflection", wants a darker background, the light as a dimmer neon, and no auto-looping ("the looping needs a solid fade in for the next loop, not fade out"). Done, pushed:
- Room drawing: no canvas blur anywhere (it was the costly part and the haze); a cheap neon only on the room's edges (a wide faint stroke under the thin one); a quiet grid; no back-wall gradient, no wind streaks; the lamp is a neon tube that dims (no light cone); `--dev-geode-bg` #010103.
- Speed: the manual's pictures are memoised (they re-rendered on every knob turn in the studio); dragging Mica writes to the song ~25×/s (she still follows the pointer at once).
- Tape: new params `loop` (Once / Loop, default Once) and `lfade` (5–250 ms, default ~49 ms). Once: Classic / Reverse play the trimmed part once and the note ends (grains go on while held). Loop: each new pass fades in; only a 1.5 ms de-click at a pass's very end. Tests `the_tape_plays_once_unless_looped`, `a_loop_fades_each_new_pass_in_and_never_clicks`. Mica's memory: one box for Plays / Tape / Fade in / Speed / Position, smaller round buttons, it scrolls if the room is short.

## Earlier (2026-11-27): Add instrument, the manual, one octave
User asked (after Geode): add instruments from the Device panel, not the Library; the Library should be a clickable manual of the instruments (many pages); and the keyboard's octave must match the panel's ("explains why the grains felt too high"). Done, pushed:
- **+ Add instrument** in the Device panel's header (`studio/AddInstrument.tsx`, `addInstrument()` shared).
- **Library = the manual** (`studio/views/LibraryView.tsx`, content in `studio/manual.ts`):
  - an index of instrument pictures (the real panels, inert, `DeviceHost.preview`)
  - per instrument 2–5 pages with numbered spots on the real panel (spot language: `k:Knob`, `h:Section`, CSS, `@x,y`), plus "+ Add … to the song"
  - `?e2e=manual` checks every spot finds its control
- **One octave**: `DeviceHost.octave` (`low` = the C of the computer keyboard's A key, `shift`). PanelKeys and Basalt's keys follow Z / X and move it; Geode's keys start at C4 (the tape's pitch).
- Pictures are cheap: no Scope, Geode's room draws twice a second, Garnet's picture never takes the number keys. Browser tests now scope their queries to `.fwm-devwrap`, because the pictures share class names.
- Known: `?e2e=arrange` has two drag failures that were already there before today (checked on a05227a); Garnet's strum-timing check fails about 1 in 3 headless runs (timing-sensitive).
- Waiting for: the user's review of the manual's look and wording, and of Geode.

## Earlier (2026-11-26, night): Geode built in the studio (all three slices); waiting for the user to play it
The user asked me to build the rest of the Geode milestone while they work, and to put suggestions in the plan. Done and pushed:
- slice 1 engine `31ed80a`, slice 2 tapes `3d53884`, slice 3 panel `7b788a7` (details and my suggestions: PLAN.md "Geode").
- Try it: `npm run dev`, Library → Samplers → Geode, add an Opal too, click Mica (dock, left), REC, play the keys (they play the Opal while armed), REC again. Or DEMO when there is nothing to record. `?geode` = Geode alone (demo tape only); `?geodeback` shows the hidden back.
- Tests: `cargo test --release --test geode` (15), `test/sampleStore.test.ts` (8), browser `?e2e=ga` + `?e2e=gb` in one room (two tabs, 16 checks), and the older roles still pass (opal, a/b, ta/tb).
- QA pass after the slices (all pushed):
  - no click at the Classic loop seam
  - the input meter moves while REC waits; a warning when the input is muted
  - Escape closes things
  - FILE button / drop an audio file on the room
  - grain events now really reach the panel (`Device::viz_len`)
  - the room fills the panel's width
  - clicking Mica opens her memory
  - presets keep Mica's place and the trim
  - the hidden back works (`ModRow` fixed for devices without `lwave`)
  - Motion pop-up wraps
  - `?e2e=gp`: a tape comes back after a reload
  - the browser tests also run at 44.1 kHz (Firefox pref `media.cubeb.force_sample_rate`)
- Not checked by ear: the sound itself, the feel of the springs and of dragging Mica. That is the user's review.
- The mock-up artifact is now older than the studio version; republish only if asked.

## Earlier (2026-11-26, evening): Geode mock-up round 2 waiting for the user's review
Geode = a sampler in a little room with Mica (plan approved, 5 rounds; see PLAN.md "Geode"). The mock-up `design/kit/geode.html` (artifact "Geode: Mica's room") has had three rounds (latest: tape PLAY, drag Mica to pan, walks); the user reviews later and said the goal now is **look / utility / feel**. They may bring images made from the prompts in `design/refs/prompt/` (git-ignored: never commit or publish anything from design/refs). Next: their feedback, then slice 1 (the Rust engine, kind 6).
Mock-up test: serve design/kit, `geode.html?selftest` (offline render 44.1 / 48 kHz); preview options `?temp=&air=&room=&light=&crunch=&grains=&echo=&play&rec&motion&walk=<lr|boom|circle|random>&pop=<icon>`.

## START HERE (2026-11-26): instruments polished, recording takes, piano roll length
Done today (all tested, pushed):
- **Play in key**: with a song Key, computer keys play only scale notes (A = root, home row walks the scale, Q row an octave up); on-screen keys dim off-key notes and snap them. Computer keys light the panel's keys while held (`DeviceHost.myHeld`).
- **On-screen keys** (taller, 180 px) with octave buttons on Opal and Quartz too (`devices/PanelKeys.tsx`); octave + on top, − below.
- **Quartz** got Opal's modulation (shared `devices/ModRow.tsx`). Opal / Quartz approved-ish; Quartz still waits for the user's ears.
- **Garnet**: held notes sustain (less loop loss while held); **Whammy ribbon** (param `wham`, springs back); computer keys light the note on the neck and ring its string; **chord guide** in Notes mode (root light blue, 2nd light red, 3rd light green, next chord purple, Roman numerals inside each note; notes are rectangles ≥ half a fret wide; legend above the neck). Rules in `garnet/music.ts` (`guideStep`, `guideRoles`, `chordLabel`), colours = tokens `--dev-guide-*`.
- **Recording**: Shift+Space arms Rec and waits for the first note (it starts the song at step 0; the transport starts already that far in, `TransportSync.play(row, since)`, so later notes stay in time); clicking Rec arms and starts the song; right-click Rec = replace (the first note clears the pattern). A take runs past the loop: the pattern grows a bar ahead of the playhead, up to **MAX_LEN = 512 steps (128 beats)**, then wraps and overdubs (`recTake` in `Studio.tsx`).
- **Piano roll**: length typed in bars + "bar ▾" presets dropdown; **Duplicate pattern** (green, doubles length + repeats notes/automation) and **Clear pattern** (red). New app token `--fwm-ok`.
- Browser test roles cover all of it (`?e2e=opal` has the recording checks, `?e2e=garnet` the guide / whammy / neck lights).
Open: Quartz listening review; Geode (planned in PLAN.md, draft mock-up `design/kit/geode.html`); device kit artifacts are stale (Opal pearl skin, Quartz, new tokens). The user is often low on weekly budget: keep turns lean.
Screenshot trick for state after an e2e run: serve `apps/harness` with the scratch `srv.py` (has `/slow`) on another port and frame `dist/index.html?e2e=…` in a page whose chained `/slow` images delay the load event (~18 s), scrolling the iframe to the element first.

### Earlier today: Opal built
### Before that: Garnet + My look + arrangement drag and drop
Since the last notes: **My look** (each person's own stylesheet from their AI agent, docs/LOOKS.md) and the
**song arrangement cells** (double-click / Delete empties; drag to another TRACK = same pattern, Ctrl = copy;
into another instrument = a copy, melodies↔melodic and drums↔drum machines only; onto + Add TRACK = a new
TRACK; edge scrolling; one undo step each, `Project.placePattern`). All tested (`?e2e=look`, `?e2e=arrange`),
pushed. Waiting for the user to try them. Next: the **Opal** pad mock-up with sound (Juno-style chorus,
unison, slow motion; family layout: two oscillator rows + filter block on the right), then Quartz.
Browser test gotchas: in a 682 px headless window the arrangement panel is short (maximise it before dragging);
Firefox can't drag `<button>` natively, so drags are pointer-based.

## Earlier (2026-11-25, late night): Garnet approved ("amazing", with Distortion); My look built
The user tested Garnet and its Distortion knob: approved. Then asked that friends can restyle the UI with their
own AI agent without changing anyone else's: built as **My look** (docs/LOOKS.md, PLAN.md "My look"). Next: the
user's review of My look, then the Opal mock-up (pads, with sound).
Learnt: in Vitest (jsdom) `import.meta.url` is http and `?raw` CSS imports come back empty; read files with
node:fs from `process.cwd()` and assert you really read something.

## Earlier (2026-11-25, night): Garnet (string synth) built, all three slices
Mixer, effects and Scope were approved. Phase 5 started with **Garnet** (user's choice; Cobalt parked, then Opal pads,
then Quartz FM with two oscillator rows + filter block on the right). Mock-up `design/kit/garnet.html` approved
("purfect, fun to play"). Built: engine (`src/devices/garnet.rs`, kind 3), studio panel (`devices/garnet/`), the neck
(Chords from the song's Key with types, Notes with the scale lit), strums recorded as strums. See PLAN.md "Phase 5
progress". Next: the user's review of Garnet in the studio, then the Opal mock-up (with sound).
Things learnt: a strum recorded with Rec quantize on was split across two steps (each note snapped alone); for Garnet,
notes within 75 ms of the previous one keep their distance from the first (which snaps). Garnet's sunburst can't live
in `--dev-texture` (the template tiles textures at 7 px: chips and Library cards turned into a checkerboard); the
texture is a fine grain and the panel CSS draws the glow. `.fwm-app button { color: inherit }` beats `.fwm-btn--hw`
colours: on a light button the text vanished (scope the fix in the device CSS). Each rack slot keeps Garnet's string
memory from the static pool (now 4 MiB) and reuses it, so add/remove never leaks.

## Earlier (2026-11-25, evening): Mixer + effects + Scope all done
All four slices are built (PLAN.md "Mixer and effects").

## Earlier (2026-11-25, later): Mixer slices 1–3 done
The user said "just do Slice 2 - 3 in one go" and asked that Song arrangement cells preview their pattern: all done
(PLAN.md "Mixer and effects"). Things learnt: the Dattorro tank applies its decay gain twice per half loop (formula
uses 1.5 not 3); Lo-fi must not delay the mix when off (it made the whole studio 8 ms late, caught by
`rack_events_are_sample_accurate`); Lo-fi saturation is level-matched at 0.25, not 0.5 (else +5 dB on normal
instruments); Basalt has a sub-octave, so a closed low-pass barely quietens a bass note (test with C5). Two-tab sync
got 6–8 ms gaps once Reverb / Delay ran all the time in two headless tabs; letting them sleep when unused fixed it
(0–1.6 ms again). Next: slice 4, the Scope panel (mock-up `design/kit/mixer.html`), then ask the user what's next
(Phase 5 instruments: Cobalt, Quartz, Opal).

## Earlier (2026-11-25): building the Mixer (slice 1 of 4 done)
The user approved the mock-up ("Alright you can push this!"). Slices and progress: PLAN.md "Mixer and effects".
Slice 1 (mixer strips, master, meters, Mixer panel) is built. Next: slice 2, Reverb + Delay + sends + the draggable
chain (shown when the Mixer panel is maximised: pass `L.max === i` from Workspace to MixerView). Engine plan: each
effect is a stage with in ➜ out; Reverb / Delay stages add their send-fed return; the chain order is a list in the
song (`fwm.meta` or a new top-level `fwm.fx` map). Lo-fi DSP = the mock-up's tape/vinyl worklet, ported to Rust.
Screenshot of a given panel layout: my scratch server's `/lay?<ms>&<v1,v2,v3,v4>&<query>` (sets user + layout).

## Earlier (2026-11-25): Mixer + Scope mock-up
The user tested Phase 4 ("tested it's amazing!", and is relaxed about live delay: "even if it's 200ms who cares we
just want to play around"). They renamed the Main sequencer panel to **Song arrangement** (done, a430158) and asked for
a **main mixer** (a Reverb and a Delay send knob per instrument; expanding the Mixer shows Reverb / Delay / Lo-fi /
main Low-pass settings) and an **Oscilloscope** as its own panel. Mock-up: `design/kit/mixer.html` (rough WebAudio
preview sound; `#effects` opens it expanded). **Lo-fi is tape / vinyl** (the user rejected a bit-crusher): wow + flutter (modulated delay line),
level-matched tanh saturation, Age (2-pole high cut + low cut), hiss or darker vinyl surface noise, crackle; Tape / Vinyl
presets (each style remembers its own settings; Noise and Crackle start at 0).
**The effects rack is the chain** (user): Instruments ➜ Reverb ➜ Delay ➜ Lo-fi ➜ Low-pass ➜ Master, drawn left to right
with ➜ arrows; drag an effect by its title to reorder, onto the shelf to take it out, back to add (◀ ▶ × too). Each
effect is a stage (in ➜ out); Reverb / Delay stages pass the sound through and add their return (fed by the
instruments' send knobs) at their place in the chain. Proposed chain: instruments (fader, pan, mute/solo, post-fader sends)
+ Reverb return + Delay return → Lo-fi → Low-pass → Master. Everything shared in the doc. Build only after sign-off;
then plan slices (likely: 1 mixer strips + master in the engine, 2 Reverb + Delay, 3 Lo-fi + Low-pass, 4 Scope panel).

## Earlier (2026-11-24, evening): Phase 4 done (slices 1–3), waiting for the user's review
The user said "Go ahead with slice 2 & slice 3 then commit and push" and left for work; next session starts with
their review of Phase 4 (ask how playing together feels: Even vs Tight, the chips, Play alone).
- Slice 2: `collab/liveTiming.ts` (LiveTiming: when to play another person's key / knob turn), worklet timed
  events, `HeldParams` in `engine/useDeviceSync.ts`, `Project.onLocalParam` (local knob turns go out on the
  channel as `{t:'param'}` with their time; the value still goes through the doc). Even/Tight in the top bar.
- Slice 3: people chips in `TopBar.tsx` (`useLinks`), styles `.fwm-plink` in `styles/shell.css`.
- Timing words: every time handed to the engine is "page time when it is heard" (getOutputTimestamp). A key's
  `at` = sender's page time + its output delay. LiveTiming's `now` = page time + my output delay (the soonest I
  can sound anything). TransportSync's clock is plain page time, its Play lead includes everyone's output delay.
- Harness: `?ghost` opens a hidden second person in the same room (screenshots of chips); `?newuser` = a fresh
  identity. For screenshots that need time, my scratch server had `/shot?<ms>&<query>` (holds the load event).
- Tests: `packages/studio/test/transport.test.ts` (sync + Even/Tight over a simulated wobbly network),
  `packages/engine/test/timed.test.ts` (real WASM: a timed note starts on its sample), browser `?e2e=ta`/`tb` (21 checks).
- A flaky `?e2e=songs` failure ("INIT is silent") appeared mid-slice (1 in 3 runs) and went away (0 in 10) after
  Play stopped being scheduled sooner than the output delay; the exact link was not proven. If it comes back, look there.
- Not done / ideas: the Studio artifact (HEVoA3TExTjSF2bRmVUUei) is still the Phase 1–3 build; the mock-up's
  "Mira reloads" is covered by `hello`, but a real reload test across two Firefox tabs isn't automated.

## Earlier (2026-11-24, later): Phase 4 slice 1 (shared transport)
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
