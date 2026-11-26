// "My look": a stylesheet one person uses to restyle the studio for themselves only. It is kept on their
// side (this browser, or the host app's user profile) and never enters the shared song, so everyone in a
// session can have a different look. Usually written by the person's own AI agent from LOOK_BRIEF.
//
// Before use a look is made safe and scoped:
// - Everything is nested under the studio root (`.fwm-root { … }`), so it can't restyle the host app.
//   `:root` and `.fwm-root` in the look mean the studio root (`&`).
// - Nothing is fetched: `@import` and any `url()` that isn't a `data:` URI are removed (the core never
//   goes online). Fonts can be embedded as data: URIs or be fonts the computer already has.
// - @font-face, @keyframes and @property can't be nested, so they stay at the top level.

/** Larger looks are refused (they would slow the page and are almost certainly not a look). */
export const LOOK_MAX = 200_000;

export interface PreparedLook {
  /** The CSS to put on the page ('' when there is nothing to apply). */
  css: string;
  /** What was taken out, in plain words (shown to the person). */
  removed: string[];
}

const HOIST = /^@(-webkit-)?(font-face|keyframes|property)\b/i;
const DROP = /^@(import|charset|namespace)\b/i;

/** Split CSS into its top-level statements (rules and at-rules), respecting strings and comments. */
function statements(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
    } else if (c === '"' || c === "'") {
      for (i++; i < css.length && css[i] !== c; i++) if (css[i] === '\\') i++;
    } else if (c === '{') depth++;
    else if (c === '}') {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        out.push(css.slice(start, i + 1));
        start = i + 1;
      }
    } else if (c === ';' && depth === 0) {
      out.push(css.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (css.slice(start).trim()) out.push(css.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** Make a look safe and scoped to the studio. */
export function prepareLook(input: string | null | undefined): PreparedLook {
  const removed: string[] = [];
  if (!input || !input.trim()) return { css: '', removed };
  if (input.length > LOOK_MAX) return { css: '', removed: [`the whole look: it is over ${LOOK_MAX / 1000} KB`] };
  const css = input.replace(/<\/?style[^>]*>/gi, ''); // pasted with its <style> tags
  const top: string[] = [];
  const inside: string[] = [];
  let remote = 0;
  for (const raw of statements(css)) {
    const head = stripComments(raw).trim();
    if (!head) continue;
    if (DROP.test(head)) {
      if (/^@import/i.test(head)) removed.push(`${head.slice(0, 60)}${head.length > 60 ? '…' : ''} (imports are never loaded)`);
      continue;
    }
    // remote files: never fetched (data: URIs are inside the look, so they stay)
    const st = raw.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, _q, u: string) => {
      if (/^data:/i.test(u.trim())) return m;
      remote++;
      return 'none';
    });
    if (HOIST.test(head)) top.push(st);
    else inside.push(st);
  }
  if (remote) removed.push(`${remote} link${remote === 1 ? '' : 's'} to files elsewhere (url(…)): the studio never loads anything from the internet`);
  // `:root` / `.fwm-root` in a look mean the studio itself
  const body = inside.join('\n').replace(/:root\b/g, '&').replace(/\.fwm-root(?![\w-])/g, '&');
  const out = (top.length ? top.join('\n') + '\n' : '') + (body.trim() ? `.fwm-root {\n${body}\n}\n` : '');
  return { css: out, removed };
}

/** Where a person's look is kept when the host app doesn't keep it. */
export const lookStorageKey = (userId: string) => `fwm.look.${userId}`;

/** A small example: a light, paper-and-ink look. */
export const LOOK_EXAMPLE = `/* Paper: a light look (example) */
& {
  --fwm-bg: #f3efe6;
  --fwm-panel: #fffdf8;
  --fwm-line: #ddd5c4;
  --fwm-ink: #1f1b16;
  --fwm-mute: #6b6356;
  --fwm-roll: #e8e1d2;
  --fwm-roll2: #ddd4c1;
  --fwm-roll-btn: #cfc4ad;
  --fwm-roll-deep: #c3b79c;
  --fwm-roll-ink: #2a241c;
  --fwm-note: #d9480f;
  --fwm-on-note: #ffffff;
  --fwm-depth: 0.4;
  --fwm-glow: 0;
  --fwm-round: 1.4;
}
.fwm-pane { box-shadow: 0 2px 10px rgba(60, 45, 20, .12); }
`;

const APP_TOKENS: [string, string][] = [
  ['--fwm-bg, --fwm-panel, --fwm-line', 'app background, panels, borders'],
  ['--fwm-ink, --fwm-mute', 'text, secondary text'],
  ['--fwm-me, --fwm-peer', 'fallback presence colours (real people bring their own colour: never override those)'],
  ['--fwm-mod', 'modulation (LFO arcs, routes)'],
  ['--fwm-roll, --fwm-roll2', 'the blue "sequencer world": song arrangement, piano roll, mixer, effects, scope backgrounds'],
  ['--fwm-roll-btn, --fwm-roll-deep, --fwm-roll-ink', 'buttons, displays and text in that world'],
  ['--fwm-roll-key, --fwm-roll-keyb, --fwm-roll-keyink, --fwm-roll-keyline', 'the piano-roll key column'],
  ['--fwm-note, --fwm-rec', 'notes and playheads, the record button (and Clear pattern)'],
  ['--fwm-ok', 'go / add actions (Duplicate pattern)'],
  ['--fwm-on-me, --fwm-on-peer, --fwm-on-mod, --fwm-on-note, --fwm-on-rec, --fwm-on-ok', 'text drawn on top of those colours (keep them readable)'],
  ['--fwm-font-display, --fwm-font-label, --fwm-font-screen, --fwm-font-ui', 'fonts: nameplates and big titles, device silkscreen, device screens, everything else'],
  ['--fwm-depth', 'dial 0..1: 0 = flat (no bevels or shadows), 1 = full hardware look'],
  ['--fwm-glow', 'dial 0..1: glow on screens, notes and lights'],
  ['--fwm-round', 'dial: 0 = square corners, 1 = default, 2 = very round'],
];
const DEV_TOKENS: [string, string][] = [
  ['--dev-case, --dev-case2, --dev-texture, --dev-edge', 'instrument casing: gradient, optional pattern (tiled at 7 px), edges'],
  ['--dev-silk, --dev-acc', 'printed labels, accent (value arcs, active buttons, section titles)'],
  ['--dev-lcd, --dev-lcdink', 'screens and their text (Garnet: the neck wood is --dev-lcd)'],
  ['--dev-cap, --dev-capd', 'knob and fader caps (light and dark side)'],
  ['--dev-btn, --dev-btn2, --dev-btnink, --dev-btnedge', 'hardware buttons: top, bottom, text, lower edge'],
  ['--dev-sec, --dev-track', 'section panels, fader tracks'],
  ['--dev-key, --dev-keyb, --dev-keyb2, --dev-keybed, --dev-keyhi, --dev-keylabel', 'on-screen keys (Garnet: the strings are --dev-key and --dev-keyb)'],
  ['--dev-guide-root, --dev-guide-2, --dev-guide-3, --dev-guide-alt, --dev-guide-ink', "Garnet's chord guide: root, the chord's 2nd and 3rd notes, the next chord, text on them"],
];
const AREAS: [string, string][] = [
  ['&', 'the studio root: set tokens here'],
  ['.fwm-app, .fwm-topbar, .fwm-tb', 'the whole app, the top bar, its buttons (Play, Rec, Loop…)'],
  ['.fwm-ws, .fwm-pane, .fwm-ph, .fwm-pb, .fwm-split', 'the 2×2 panel grid, a panel, its header, its body, the dividers'],
  ['.fwm-cell, .fwm-tname', 'song arrangement: pattern cells, instrument names'],
  ['.fwm-dev, .fwm-plate, .fwm-sec, .fwm-lcd, .fwm-knob, .fwm-fader, .fwm-btn--hw, .fwm-btn--seg', 'instruments: casing, nameplate, sections, screens, knobs, faders, buttons'],
  ['[data-device="basalt"], [data-device="flint"], [data-device="garnet"]', 'one instrument (set --dev-* tokens on it to reskin just that one)'],
  ['.fwm-garnet__neck, .fwm-garnet__str, .fwm-garnet__ch, .fwm-garnet__dot', "Garnet's neck, strings, chord buttons, note dots"],
  ['.fwm-mixer, .fwm-strip, .fwm-meter, .fwm-fxu, .fwm-scopev', 'mixer, channel strips, meters, effect units, scope'],
  ['.fwm-card, .fwm-thumb', 'Library cards'],
  ['.fwm-av, .fwm-plink, .fwm-knob__tag', "people: avatars, people chips, the name tag on a knob someone is turning (their colour comes from the person: don't override it)"],
];

/** The brief a person gives their AI agent (with their current look, if any, to refine). */
export function lookBrief(current?: string | null): string {
  const list = (rows: [string, string][]) => rows.map(([a, b]) => `- \`${a}\`: ${b}`).join('\n');
  return `# Restyle free-web-music for me (my own look)

free-web-music is a music studio in the browser that friends use together. Each person can restyle it for
themselves with one CSS stylesheet, their "look". Nobody else sees my look, and their looks don't change
mine. Please write my look: one CSS stylesheet, as plain text, and nothing else.

## What I want
(Describe the style you want here: mood, colours, fonts, flat or hardware-like, light or dark…)

## How a look is applied (rules)
1. It is nested inside the studio root: \`.fwm-root { <your CSS> }\`. Use \`&\` for the root itself
   (\`:root\` and \`.fwm-root\` also work and mean the same). Don't target \`html\` or \`body\`.
2. Start with the tokens (CSS custom properties) below: they restyle everything consistently. Then add
   rules for the class names listed further down where tokens aren't enough.
3. Nothing is downloaded: \`@import\` and any \`url()\` that isn't a \`data:\` URI are removed. For fonts,
   use fonts the computer has (system-ui, Georgia, "Courier New"…) or the studio's own (Big Shoulders
   Display, Michroma, VT323, Figtree), or embed a small font as a data: URI.
4. Keep it usable: every control stays visible and big enough to use, text stays readable (contrast at
   least 4.5:1 for text), notes, playheads and the record button stay easy to see.
5. Don't hide or recolour other people's colours (avatars, knob tags, the outline on a control someone
   else is touching): they come from each person.
6. Animations are fine; honour \`@media (prefers-reduced-motion: reduce)\`.
7. The studio's own stylesheet uses the same class names; a look's rules are one level more specific,
   so a plain \`.fwm-cell { … }\` overrides the default.

## App tokens (--fwm-*)
${list(APP_TOKENS)}

## Instrument tokens (--dev-*), set on & for all instruments or on one [data-device="…"]
${list(DEV_TOKENS)}

## Main parts of the screen (every class starts with fwm-)
${list(AREAS)}

If you have the code (github: free-web-music), the default look is in
packages/studio/src/skins/*.css and packages/studio/src/styles/*.css, and docs/LOOKS.md has more.

## My current look${current && current.trim() ? ' (change it, don\'t start over unless I ask)' : ''}
${current && current.trim() ? '```css\n' + current.trim() + '\n```' : '(none yet: the default look)'}

Reply with the complete stylesheet only, ready to paste.
`;
}
