# Theming: making the studio match the host app

The studio ships with its own look: hardware-style devices and a blue sequencer world. That look is only the **default skin**. A host app can restyle everything without touching device or engine code, in three levels:

| Level | What it changes | How |
|---|---|---|
| 1. Tokens | Colours, fonts, depth, roundness, glow, for the whole studio | CSS custom properties (`--fwm-*`) |
| 2. Device skins | One device, or all devices (casing, accent, screen colours) | Device tokens (`--dev-*`) |
| 3. Components | The controls themselves (knob, fader, button, screen, keys) | Pass your own React components |
| 4. My look | Anything, for one person only | A stylesheet that person keeps (**My look** in the top bar) |

You can try levels 1 and 2 live in the harness (`npm run dev`) or on the design sheet (`design/kit/index.html`), using the skin buttons **Default / Flat / Host brand**. All skin files live in `packages/studio/src/skins/`.

---

## 1. App tokens (`--fwm-*`)

Set them on any ancestor of the studio: `:root`, a wrapper element, or through the `theme` prop (see below).

| Token | Default | Used for |
|---|---|---|
| `--fwm-bg`, `--fwm-panel`, `--fwm-line` | `#14161b`, `#1d2027`, `#2c313b` | App background, panels, borders |
| `--fwm-ink`, `--fwm-mute` | `#eef0f4`, `#a3a9b6` | Text, secondary text |
| `--fwm-me`, `--fwm-peer` | `#4fc3ff`, `#ff4fa3` | Fallback presence colours (real users bring their own colour) |
| `--fwm-mod` | `#b48cff` | Modulation (LFO arcs, routes) |
| `--fwm-roll`, `--fwm-roll2` | `#1d4fb8`, `#173f94` | Sequencer / piano-roll grid |
| `--fwm-roll-btn`, `--fwm-roll-deep`, `--fwm-roll-ink` | `#2a5fcc`, `#0b2a66`, `#e6f1ff` | Sequencer buttons, displays, text |
| `--fwm-note`, `--fwm-rec` | `#3fe0ff`, `#ff3b4a` | Notes, record button |
| `--fwm-on-me`, `--fwm-on-peer`, `--fwm-on-mod`, `--fwm-on-note`, `--fwm-on-rec` | dark inks, white on rec | Text drawn on top of those colours |
| `--fwm-roll-key`, `--fwm-roll-keyb`, `--fwm-roll-keyink`, `--fwm-roll-keyline` | light/dark blue-greys | Piano-roll key column |
| `--fwm-font-display` | Big Shoulders Display | Device nameplates, big titles |
| `--fwm-font-label` | Michroma | Silkscreen labels on devices |
| `--fwm-font-screen` | VT323 | Device screens, readouts |
| `--fwm-font-ui` | Figtree | Everything else |

### Style dials
These change the overall *feel* with one number each:

| Token | Default | Effect |
|---|---|---|
| `--fwm-depth` | `1` | `0` = flat (no bevels, gradients or shadows), `1` = full hardware look. In-between values work. |
| `--fwm-glow` | `1` | `0` turns off screen and note glow. |
| `--fwm-round` | `1` | Multiplies every corner radius (`0` = square, `2` = very round). |

Example: a flat, square, brand-coloured studio.

```css
.my-app .studio-host {
  --fwm-depth: 0;
  --fwm-glow: 0;
  --fwm-round: .4;
  --fwm-bg: #ffffff;
  --fwm-ink: #111;
  --fwm-font-ui: Inter, system-ui, sans-serif;
  --fwm-font-display: Inter, system-ui, sans-serif;
}
```

## 2. Device tokens (`--dev-*`)

Every device is drawn from the same template. Its skin is just these tokens:

| Token | Used for |
|---|---|
| `--dev-case`, `--dev-case2` | Casing gradient (top-left → bottom-right) |
| `--dev-texture` | Optional casing texture (any CSS image, e.g. a gradient pattern) |
| `--dev-silk` | Labels printed on the casing |
| `--dev-acc` | Accent: value arcs, active buttons, section titles |
| `--dev-lcd`, `--dev-lcdink` | Screen background and text |
| `--dev-cap`, `--dev-capd` | Knob and fader caps (light → dark) |
| `--dev-btn`, `--dev-btn2`, `--dev-btnink`, `--dev-btnedge` | Hardware buttons |
| `--dev-sec`, `--dev-track` | Section panels, fader tracks |
| `--dev-key`, `--dev-keyb` | White and black keys |

Each device's skin lives in its own small file, `packages/studio/src/skins/<device>.css` (the template defaults, all commented, are in `device-base.css`). Preview any skin in all three reference styles with `design/check-skin.sh <device>`.

Built-in skins are declared with `:where(...)`, so they have **zero specificity**. Any rule you write wins, with no `!important` needed.

```css
/* all devices use the host brand accent and dark screens */
.my-app .dev { --dev-acc: #5b4dff; --dev-lcd: #1d1766; --dev-lcdink: #c9c4ff; }

/* just one device */
.my-app [data-device="basalt"] { --dev-case: #222; --dev-case2: #000; }
```

## 3. Replacing components (React API)

Devices never draw their own controls. They only use a small set of **primitives**, so swapping a primitive restyles every device in the library at once.

```tsx
<Studio
  doc={ydoc}
  awareness={awareness}
  channel={channel}
  user={{ id, name, color }}
  theme={{
    tokens: { '--fwm-depth': 0, '--fwm-bg': '#fff' },      // level 1
    devices: { basalt: { '--dev-acc': '#5b4dff' } },        // level 2
    components: { Knob: MyKnob, Fader: MyFader },           // level 3
    loadFonts: false,                                       // host provides its own fonts
  }}
/>
```

Primitive contracts (props every replacement receives):

| Primitive | Props |
|---|---|
| `Knob` | `value` (0–1), `onChange(v)`, `label`, `format(v) → string`, `size` (`md`/`lg`), `modulation?: { low, high, current? }` (offsets from `value`, plus the live value when sound is on), `presence?: { userId, name, color }[]`, `defaultValue`, `onGestureStart/End?` |
| `Fader` | Same as Knob, vertical |
| `Button` / `Toggle` | `pressed`, `onPress`, `label`, `icon?`, `presence` |
| `Screen` | `children` (text or canvas), `variant` ("preset" / "scope" / "readout") |
| `Keys` | `low`, `high`, `held: number[]`, `peerHeld: { note, color }[]`, `onNoteOn(n, velocity)`, `onNoteOff(n)` |

The exact TypeScript contracts are in `packages/studio/src/primitives/types.ts`; `packages/studio/test/basalt.test.tsx` shows a host Knob replacing the default one.

Presence (who is touching what) and modulation are **data passed in**. A replacement component decides how to show them, and the studio never draws on top of it.

## 4. Each person's own look

On top of the host's theme, every person can keep their own **look**: one stylesheet, usually written by
their own AI agent from a brief the studio gives them (top bar, **My look**). Only they see it; it is never
in the shared song. It is nested under `.fwm-root` and can't load anything from the internet. The host can
keep it with the person's account through `look` / `onLookChange`. Details: `docs/LOOKS.md`.

## Rules the studio follows so this keeps working

- **No hard-coded colours, fonts or shadows** in device or app code: everything goes through tokens.
- **Scoped styles.** The package prefixes its classes (`fwm-`), never styles global elements (`body`, `button`, `h1`…), and can render inside a Shadow DOM if the host wants full isolation. (The Phase 0 prototype still uses short class names; `@fwm/studio` uses `fwm-` everywhere.)
- **Fonts are optional.** With `loadFonts: false` the studio loads nothing and uses whatever fonts the tokens name. The default fonts are requested with CORS (`crossorigin`), so they also load on a cross-origin-isolated page; a host loading its own web fonts there must do the same.
- **Light and dark.** The host can switch the whole palette at runtime by changing tokens; nothing is cached.
- New devices must pass a "skin check": they render correctly with `--fwm-depth: 0`, with `--fwm-round: 0`, and with the host-brand example.
