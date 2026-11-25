# free-web-music

A collaborative, device-based music studio for the browser. This repo is the **core**: a React component that a host web app (a friend's app) embeds. The host supplies collaboration (a Yjs doc, awareness and a low-latency message channel) and can restyle everything.

- Plan, phases, progress: `docs/PLAN.md`
- Theming contract (tokens, skins, replaceable controls): `docs/THEMING.md`
- Each person's own look (a stylesheet only they see, written by their AI agent from the brief in **My look**): `docs/LOOKS.md`. Never put a look in the shared Yjs doc.
- Status: **Phases 1–3 built** (song arrangement, Flint drum machine), reviewed. **Phase 4** (playing together, mock-up `design/kit/together.html` approved): done and signed off. **Mixer + effects + Scope** approved (mock-up `design/kit/mixer.html`), all built (mixer, Reverb / Delay / sends / draggable chain, Lo-fi / Low-pass, Scope panel). Approved. **Phase 5**: **Garnet** string synth built and approved (with a Distortion knob). **My look** (per-person stylesheet) and arrangement drag/drop + double-click done. **Opal** pad synth approved (with Basalt-style LFO / envelope modulation). **Quartz** FM keys built (awaiting review). SEND knobs (Reverb / Delay = the Mixer's sends) on every instrument. **Geode** (grow a sound, for beginners) planned in PLAN.md with a draft mock-up `design/kit/geode.html`. Next: Quartz review, then Geode. See HANDOFF START HERE. Progress checklists: `docs/PLAN.md`. Start with `docs/HANDOFF.md`.
- Words: in code a **track** is an instrument lane; the song's rows (TRACK 1, TRACK 2… in the UI) are **rows**.
- The arrangement panel is called **Song arrangement** in the UI (user, 2026-11-25: "Main sequencer" made people think of the Piano roll). In code it is still `seq` / `SeqView`.
- Prototypes (no build step): `design/kit/index.html` (device kit, has a Sound button), `design/kit/workspace.html` (workspace), `design/kit/arrange.html` (song arrangement mock-up), `design/kit/flint.html` (Flint drum machine mock-up, with rough WebAudio preview sounds), `design/kit/together.html` (Phase 4: playing together over a pretend network), `design/kit/mixer.html` (mixer, effects and scope, with preview sound), `design/kit/garnet.html` (Garnet string synth: strummable neck, chord and notes modes, real string sound; `?selftest` checks tuning and levels). Serve with `python3 spikes/serve.py`.

## Commands
Node comes from nvm: run `. ~/.nvm/nvm.sh` first in a fresh shell if `node` is missing.
- `npm run dev`: harness at http://localhost:5173: the full studio, synced between tabs (open two tabs = two people). `?basalt` = Basalt alone, `?room=x` = a separate session, `?seednow` = demo track before first paint, `?ghost` = a hidden second person in the room
- `npm test`: Rust engine tests + Vitest (studio model and components)
- `npm run typecheck`, `npm run build`
- `packages/engine/build.sh`: rebuild `packages/engine/web/fwm_engine.wasm` after any Rust change (it is committed, the kit and the studio load it)

## Browser checks (headless Firefox, no automation tools needed)
Build (`npm run build -w apps/harness`), serve the repo root with COOP/COEP and a POST endpoint that appends the body to a log file, and use a fresh Firefox profile whose `user.js` sets `media.autoplay.default` to 0.
- Two people: open `dist/index.html?e2e=a&room=R` and `dist/index.html?e2e=b&room=R` in ONE `firefox --headless` command (two tabs share BroadcastChannel). Each tab POSTs PASS/FAIL lines to `./log`. Playing together (shared Play, live keys, chips): `?e2e=ta` + `?e2e=tb`. Single-tab roles: multi, switch, roll, song, songs, flint, drums, mixer, fx, scope, garnet, opal, quartz, look, arrange (add `&newuser`).
- Basalt alone: `dist/index.html?basalt&selftest`. Opal / Quartz alone: `dist/index.html?opal`, `?quartz`.
- Screenshots: `firefox --headless --screenshot out.png URL` (add `?seednow&room=<random>` for a populated studio).

## Rules
- **Our own designs only.** The visual reference is the *feel* of KORG Gadget, but device names, art and layouts are ours (devices are named after minerals: Basalt, Quartz, Cobalt…). Never copy KORG names, graphics or screens.
- **`design/refs/` holds copyrighted reference images.** It is git-ignored. Never commit, publish or upload anything from it.
- **No hard-coded colours, fonts or shadows** in device or app code. Use the tokens (`--fwm-*`, `--dev-*`) and the dials `--fwm-depth`, `--fwm-glow`, `--fwm-round`.
- **The core never does networking.** Sync, persistence and storage belong to the host.
- **The repo is public** (MIT). No secrets, no personal emails, no local paths in committed files.

## Layout
```
packages/engine/             Rust DSP (src/), device manifests (devices/*.json), tests (tests/)
packages/engine/web/         AudioWorklet host: worklet.js, engine.js (+ .d.ts), built fwm_engine.wasm, test.html
packages/studio/src/         React library: primitives/, devices/<id>/, engine/ (provider, sync hooks), model/, theme/, styles/studio.css
packages/studio/src/skins/   ALL skins: app.css (app tokens), device-base.css (every --dev-* token), <device>.css, host-examples.css
packages/studio/test/        Vitest tests
apps/harness/                Vite dev app playing the host: tabSync.ts (BroadcastChannel collab stand-in), e2e.ts (two-tab test)
design/kit/                  Phase 0 prototypes. skins/ and engine/ are symlinks into packages/
design/check-skin.sh         screenshot a skin in default / flat / brand
spikes/                      Phase 0 tech tests, RESULTS.md
docs/                        PLAN.md, THEMING.md, HANDOFF.md
```

## Reskin a device
1. Open `packages/studio/src/skins/<device>.css`. Each one is a single `:where(.<device>, [data-device="<device>"]) { ... }` block of `--dev-*` tokens. Only set what differs from `device-base.css`, which lists every token with a comment.
2. Keep the selector wrapped in `:where(...)` (zero specificity) so host apps can override it.
3. Check contrast: `--dev-silk` must read on `--dev-case`, `--dev-lcdink` on `--dev-lcd`, `--dev-btnink` on `--dev-btn`.
4. Run `design/check-skin.sh <device>`. It prints the path of a PNG showing the full instrument in the default, flat and brand styles. Look at it. All three must read well.

## New device skin
1. Copy `packages/studio/src/skins/quartz.css` to `packages/studio/src/skins/<name>.css`, rename the selector and change the colours.
2. Add `@import '../skins/<name>.css';` in `packages/studio/src/styles/studio.css`, and `<link rel="stylesheet" href="skins/<name>.css">` in `design/kit/index.html` and `design/kit/workspace.html`, next to the other skins.
3. Run `design/check-skin.sh <name>`.

## Publishing the design kit
Two private claude.ai artifacts, each published with its page as `index.html` plus `skins/*.css` (same relative paths): the **Device Kit Sheet** (`design/kit/index.html`) and the **Studio Workspace** (`design/kit/workspace.html`). When a skin changes, republish it to both.
