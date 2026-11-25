# My look: restyle the studio for yourself only

Everyone in a session can have their own look. A look is one CSS stylesheet. Only the person who keeps it
sees it; it is never put in the shared song, so it can't change anyone else's screen.

## For people (and their AI agent)
1. In the studio's top bar, click **My look**.
2. **Copy the brief** and paste it to your AI agent (Claude, or any other). Write what you want where it
   says "What I want": a mood, colours, fonts, flat or hardware-like, light or dark. The brief already has
   the rules, every colour and font setting (tokens), and the main parts of the screen. If you already have
   a look, the brief includes it, so the agent changes it instead of starting over.
3. Paste the stylesheet your agent gives back (or **Load a .css file**), click **Try it**, then
   **Keep this look**. **Back to default** removes it.
4. If a look ever hides the My look button, open the studio with `?nolook` in the address: looks are off
   on that page, so you can fix or remove yours.

The brief's text is `lookBrief()` in `packages/studio/src/model/look.ts`; a test checks it names every
token in `skins/app.css` and `skins/device-base.css`.

## For agents writing a look
Write plain CSS. It is applied nested under the studio root, `.fwm-root { <your CSS> }`:
- Use `&` for the root (`:root` and `.fwm-root` are turned into `&`). Set tokens there first: they restyle
  everything at once (`--fwm-*` for the app, `--dev-*` for the instruments; one instrument via
  `[data-device="garnet"]` and so on). Token tables: `docs/THEMING.md`.
- Then add rules for `fwm-` classes where tokens aren't enough. The default look is
  `packages/studio/src/skins/*.css` and `packages/studio/src/styles/*.css`. A look's rules are one class more
  specific than the default ones (they sit under `.fwm-root`), so plain `.fwm-cell { … }` wins.
- Nothing is downloaded: `@import` and `url()` that isn't a `data:` URI are removed. Use fonts the computer
  has, the studio's own (Big Shoulders Display, Michroma, VT323, Figtree), or a small font as a data: URI.
- `@font-face`, `@keyframes` and `@property` are kept at the top level; `@media`, `@container` and
  `@supports` work inside.
- Keep every control visible and usable, text readable (4.5:1), notes, playheads and the record button
  clear. Don't override people's own colours (avatars, the tag and outline on a control someone is
  touching). Honour `prefers-reduced-motion`.
- At most 200 KB.

## For the host app
By default a look is kept in the browser (`localStorage`, key `fwm.look.<user id>`). To keep it with the
person's account instead, so it follows them to other computers, pass it in and save it when it changes:

```tsx
<Studio user={me} look={profile.look ?? null} onLookChange={(css) => saveProfile({ look: css })} … />
```

A look is the person's own CSS, applied only on their own page: it can restyle their studio, nothing more.
It can't reach the host app's styles (it is nested under `.fwm-root`) and can't load anything from the
internet. Hosts that also set a theme for everyone (`theme` prop, `docs/THEMING.md`) still can: a look is
applied on top of it, for that one person.
