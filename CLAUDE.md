# free-web-music

A collaborative, device-based music studio for the browser. This repo is the **core**: a React component that a host web app (a friend's app) embeds. The host supplies collaboration (a Yjs doc, awareness and a low-latency message channel) and can restyle everything.

- Plan, phases, progress: `docs/PLAN.md`
- Theming contract (tokens, skins, replaceable controls): `docs/THEMING.md`
- Status: **Phase 0, design**. No engine code yet. The design kit is `design/kit/index.html` (open it in a browser, no build step).

## Rules
- **Our own designs only.** The visual reference is the *feel* of KORG Gadget, but device names, art and layouts are ours (devices are named after minerals: Basalt, Quartz, Cobalt…). Never copy KORG names, graphics or screens.
- **`design/refs/` holds copyrighted reference images.** It is git-ignored. Never commit, publish or upload anything from it.
- **No hard-coded colours, fonts or shadows** in device or app code. Use the tokens (`--fwm-*`, `--dev-*`) and the dials `--fwm-depth`, `--fwm-glow`, `--fwm-round`.
- **The core never does networking.** Sync, persistence and storage belong to the host.
- **The repo is public** (MIT). No secrets, no personal emails, no local paths in committed files.

## Layout
```
design/kit/index.html        design kit: Basalt synth, sequencer lane, materials, knob states, skin switcher
design/kit/skins/app.css     app-level tokens (shell, sequencer, fonts, dials)
design/kit/skins/device-base.css   device template defaults (every --dev-* token, commented)
design/kit/skins/<device>.css      one file per device skin (basalt, quartz, cobalt)
design/kit/skins/host-examples.css example host overrides: "flat" and "brand"
design/check-skin.sh         screenshot a skin in default / flat / brand
docs/                        PLAN.md, THEMING.md
```

## Reskin a device
1. Open `design/kit/skins/<device>.css`. Each one is a single `:where(.<device>, [data-device="<device>"]) { ... }` block of `--dev-*` tokens. Only set what differs from `device-base.css`, which lists every token with a comment.
2. Keep the selector wrapped in `:where(...)` (zero specificity) so host apps can override it.
3. Check contrast: `--dev-silk` must read on `--dev-case`, `--dev-lcdink` on `--dev-lcd`, `--dev-btnink` on `--dev-btn`.
4. Run `design/check-skin.sh <device>`. It prints the path of a PNG showing the full instrument in the default, flat and brand styles. Look at it. All three must read well.

## New device skin
1. Copy `design/kit/skins/quartz.css` to `design/kit/skins/<name>.css`, rename the selector and change the colours.
2. Add `<link rel="stylesheet" href="skins/<name>.css">` in `design/kit/index.html`, next to the other skins.
3. Run `design/check-skin.sh <name>`.

## Publishing the design kit
The kit is published as a private claude.ai artifact with `index.html` plus `skins/*.css`, so the files keep the same relative paths. Republish all changed files together.
