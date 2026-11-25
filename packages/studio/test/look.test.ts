// "My look": a person's own stylesheet is scoped to the studio, never fetches anything, and the brief for
// their AI agent names every token.
import { describe, expect, it } from 'vitest';
import { LOOK_EXAMPLE, LOOK_MAX, lookBrief, prepareLook } from '../src/model/look';

describe('prepareLook', () => {
  it('nests a look under the studio root; :root and .fwm-root mean the root', () => {
    const { css, removed } = prepareLook(':root { --fwm-bg: #000; }\n.fwm-cell { color: red; }\n.fwm-root .fwm-pane{gap:2px}');
    expect(removed).toEqual([]);
    expect(css.startsWith('.fwm-root {')).toBe(true);
    expect(css).toContain('& { --fwm-bg: #000; }');
    expect(css).toContain('& .fwm-pane{gap:2px}');
    expect(css.trim().endsWith('}')).toBe(true);
  });
  it('keeps @media inside, lifts @font-face and @keyframes out', () => {
    const { css } = prepareLook('@keyframes pulse { 0% { opacity: 1 } 100% { opacity: .5 } }\n@media (max-width: 600px) { .fwm-tb { font-size: 12px } }\n@font-face { font-family: X; src: url(data:font/woff2;base64,AAAA) }');
    const [outside, inside] = css.split('.fwm-root {');
    expect(outside).toContain('@keyframes pulse');
    expect(outside).toContain('@font-face');
    expect(outside).toContain('data:font/woff2');
    expect(inside).toContain('@media (max-width: 600px)');
  });
  it('never fetches: @import and remote url() are removed and reported', () => {
    const { css, removed } = prepareLook('@import url("https://example.com/x.css");\n.fwm-dev { background: url(https://example.com/wood.png), url("data:image/png;base64,AA"); }');
    expect(css).not.toContain('example.com');
    expect(css).toContain('data:image/png');
    expect(removed.join(' ')).toMatch(/import/);
    expect(removed.join(' ')).toMatch(/1 link/);
  });
  it('strings and comments with braces do not confuse it', () => {
    const { css } = prepareLook('/* { */ .fwm-tb::after { content: "}"; }\n.fwm-pane { color: blue }');
    expect(css).toContain('.fwm-tb::after { content: "}"; }');
    expect(css).toContain('.fwm-pane { color: blue }');
  });
  it('pasted <style> tags are fine; empty and huge looks give nothing', () => {
    expect(prepareLook('<style>.fwm-tb{color:red}</style>').css).toContain('.fwm-tb{color:red}');
    expect(prepareLook('   ').css).toBe('');
    expect(prepareLook(null).css).toBe('');
    const big = prepareLook('a'.repeat(LOOK_MAX + 1));
    expect(big.css).toBe('');
    expect(big.removed.length).toBe(1);
  });
  it('the example look applies cleanly', () => {
    const { css, removed } = prepareLook(LOOK_EXAMPLE);
    expect(removed).toEqual([]);
    expect(css).toContain('--fwm-bg: #f3efe6');
  });
});

describe('lookBrief', () => {
  it('names every app and instrument token, so an agent can restyle everything', async () => {
    const brief = lookBrief();
    // node:fs through a dynamic import (the studio's tests are typed without Node's types)
    const fs: { readFileSync(p: string, enc: string): string; existsSync(p: string): boolean } = await import('node:' + 'fs');
    const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
    // tests run from the repo root (npm test) or from the package folder
    const dir = [`${cwd}/packages/studio/src/skins`, `${cwd}/src/skins`].find((d) => fs.existsSync(d))!;
    const read = (f: string) => fs.readFileSync(`${dir}/${f}`, 'utf8');
    const tokens = new Set(['app.css', 'device-base.css'].flatMap((f) => read(f).match(/--(?:fwm|dev)-[a-z0-9-]+/g) ?? []));
    expect(tokens.size).toBeGreaterThan(40);
    for (const t of tokens) expect(brief, t).toContain(t);
  });
  it('includes the current look to refine, or says there is none', () => {
    expect(lookBrief('.fwm-tb { color: red }')).toContain('```css\n.fwm-tb { color: red }\n```');
    expect(lookBrief(null)).toContain('(none yet: the default look)');
  });
});
