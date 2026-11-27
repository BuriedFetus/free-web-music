// Mica's room: the picture on Geode's front. A wireframe room in perspective with Mica (our crystal
// buddy) inside; everything in it is a control or shows the sound:
//   the thermometer dresses Mica (winter suit, sweater, tank top, sweat) and colours the neon,
//   the window opens with Air and its blinds sway with the filter's LFO, the room stretches into the
//   distance as Room grows, waves leave Mica for every voice (spiky with drive, stepped with crunch,
//   dotted with grains), echoes bounce off the back wall once per repeat, grains crack out of her edge,
//   the tape hangs on the right wall as a film strip, the lamp dims the whole room.
// Colours come from --dev-geode-* tokens (read from the page, so a skin or a look can change them).
// Plain canvas drawing, no React: the panel calls `frame` from requestAnimationFrame.

export type RGB = [number, number, number];
export interface Palette {
  bg: RGB;
  neon: [RGB, RGB, RGB, RGB]; // the room's lines: FREEZING, CHILL, WARM, HOT
  temp: [RGB, RGB, RGB, RGB]; // temperature colours (clothes): FREEZING, CHILL, WARM, HOT
  night: RGB;
  frost: RGB;
  accent: RGB;
  lamp: RGB;
  mica: RGB;
  micaFill: RGB;
  ink: RGB;
  mute: RGB;
  rec: RGB;
  pitchSat: number;
  pitchLight: number;
  glow: number;
  font: string;
}

export interface RoomInput {
  /** Eased by the engine (true) or straight from the knobs (false: the painter eases them). */
  eased: boolean;
  temp: number;
  air: number;
  room: number;
  light: number;
  grains: number;
  gsize: number;
  spread: number;
  crunch: number;
  drive: number;
  sway: number;
  decay: number;
  wet: number;
  echoWet: number;
  fb: number;
  /** Echo time, seconds. */
  echoSec: number;
  start: number;
  end: number;
  pos: number;
  /** Motion's value now (-1..1, depth included), and whether it moves anything. */
  motion: number;
  moving: boolean;
  /** Mica's place: x -0.85..0.85, z 0.25..2.2. */
  x: number;
  z: number;
  voices: [number, number][];
  /** Tape playing on its own (Mica's ▶): 0..1 through the trimmed part, or -1. */
  aud: number;
  /** Grain events since the last frame: [position 0..1 in the trimmed part, note]. */
  events: [number, number][];
  tape: { peaks: Float32Array; name: string; secs: number } | null;
  rec: { phase: 'armed' | 'rec' | 'saving'; secs: number } | null;
  /** Zoomed into Mica's head (her menu). */
  zoom: boolean;
  reduceMotion: boolean;
}

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const rgba = (c: RGB, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
const along = (cs: RGB[], t: number, smooth = true): RGB => {
  const x = clamp(t) * (cs.length - 1);
  const i = Math.min(cs.length - 2, Math.floor(x));
  return mix(cs[i], cs[i + 1], smooth ? sstep(0, 1, x - i) : x - i);
};
const GLOW = [1.5, 5, 11, 15]; // neon blur by temperature: sharp when cold, soft when warm

/** Read the room's colours from the page (tokens on `el` or its ancestors). */
export function readPalette(el: HTMLElement): Palette {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  el.appendChild(probe);
  const col = (v: string): RGB => {
    probe.style.color = '';
    probe.style.color = `var(${v})`;
    const m = getComputedStyle(probe).color.match(/[\d.]+/g);
    return m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : [128, 128, 128];
  };
  const cs = getComputedStyle(el);
  const num = (v: string, d: number) => {
    const x = parseFloat(cs.getPropertyValue(v));
    return Number.isFinite(x) ? x : d;
  };
  const p: Palette = {
    bg: col('--dev-geode-bg'),
    neon: [col('--dev-geode-neon-freeze'), col('--dev-geode-neon-chill'), col('--dev-geode-neon-warm'), col('--dev-geode-neon-hot')],
    temp: [col('--dev-geode-freeze'), col('--dev-geode-chill'), col('--dev-geode-warm'), col('--dev-geode-hot')],
    night: col('--dev-geode-night'),
    frost: col('--dev-geode-frost'),
    accent: col('--dev-geode-accent'),
    lamp: col('--dev-geode-lamp'),
    mica: col('--dev-geode-mica'),
    micaFill: col('--dev-geode-mica-fill'),
    ink: col('--dev-geode-ink'),
    mute: col('--dev-geode-mute'),
    rec: col('--dev-geode-rec'),
    pitchSat: num('--dev-geode-pitch-sat', 90),
    pitchLight: num('--dev-geode-pitch-light', 66),
    glow: num('--fwm-glow', 1),
    font: cs.getPropertyValue('--fwm-font-ui').trim() || 'sans-serif',
  };
  probe.remove();
  return p;
}

const MICA_SHAPE: [number, number][] = [[0, -1.25], [0.42, -1.05], [0.48, -0.45], [0.3, -0.18], [-0.3, -0.18], [-0.48, -0.45], [-0.42, -1.05]];

interface Ring { n: number; a: number; r: number; t: number; x: number; z: number }
interface Echo { n: number; born: number; z: number }
interface Spark { segs: [number, number, number, number, number][]; t: number; m: number }

export class RoomPainter {
  private W = 0;
  private H = 0;
  private dpr = 1;
  private G = { vx: 0, vy: 0, hw: 1, top: 1, bot: 1, L: 2, D: 1.5, zoom: 1 };
  private S = { temp: 0.6, tv: 0, air: 0, av: 0, room: 0.35, z: 0, zv: 0, x: 0, z0: 0.55 };
  private vis = {
    rings: [] as Ring[], echoes: [] as Echo[], sparks: [] as Spark[], grains: [] as { x: number; t: number }[],
    drops: [] as { x: number; y: number; v: number }[],
    fog: [] as { x: number; y: number; r: number; t: number }[], blink: 0, ringT: 0, step: 0, speed: 0, dir: 1,
    prev: [] as [number, number][],
  };
  /** Where things are on screen, for the pointer (CSS pixels). */
  mica: { x: number; y: number; u: number } | null = null;
  wall: { z0: number; z1: number; poly: [number, number][] } | null = null;
  private primed = false;
  constructor(private cv: HTMLCanvasElement, public pal: Palette) {}

  size() {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.W = this.cv.clientWidth;
    this.H = this.cv.clientHeight;
    this.cv.width = Math.max(1, Math.round(this.W * this.dpr));
    this.cv.height = Math.max(1, Math.round(this.H * this.dpr));
  }

  // ---- geometry: x -1..1 across, y -1 ceiling … 1 floor, Z = depth in room units (0 = the front) ----
  private geom() {
    const { W, H, S } = this;
    const zoom = lerp(1, 0.86, S.room);
    const mx = W * 0.05, top = H * 0.05, bot = H - Math.max(84, H * 0.16);
    const fw = (W - 2 * mx) * zoom, vx = W / 2, vy = top + (bot - top) * 0.44;
    this.G = { vx, vy, hw: fw / 2, top: (top - vy) * zoom, bot: (bot - vy) * zoom, L: lerp(1.3, 9, S.room ** 1.4), D: 1.5, zoom };
  }
  private sc(Z: number) {
    return this.G.D / (this.G.D + Z);
  }
  private P(x: number, y: number, Z: number): [number, number] {
    const s = this.sc(Z), G = this.G;
    return [G.vx + x * G.hw * s, G.vy + (y < 0 ? -y * G.top : y * G.bot) * s];
  }
  /** The floor point under the pointer (for dragging Mica), or null above the horizon. */
  floorAt(px: number, py: number): { x: number; z: number } | null {
    const G = this.G;
    const s2 = (py - G.vy) / G.bot;
    if (s2 <= 0.05) return null;
    const Z = G.D / s2 - G.D;
    return { x: clamp((px - G.vx) / (G.hw * s2), -0.85, 0.85), z: clamp(Z, 0.25, Math.max(0.3, Math.min(G.L - 0.35, 2.2))) };
  }
  /** The back wall (drag it to make the room bigger or smaller). */
  hitBackWall(px: number, py: number) {
    if (!this.W) return false;
    const a = this.P(-1, -1, this.G.L), b = this.P(1, 1, this.G.L);
    return px > a[0] - 8 && px < b[0] + 8 && py > a[1] - 8 && py < b[1] + 8;
  }
  /** The ceiling lamp (drag it up / down: the Light). */
  hitLamp(px: number, py: number) {
    if (!this.W) return false;
    const a = this.P(-0.2, -1, 0.75), b = this.P(0.2, -0.86, 0.75);
    return px > a[0] - 10 && px < b[0] + 10 && py > a[1] - 6 && py < b[1] + 14;
  }
  /** The window on the left wall (drag up to open it: the Air). */
  hitWindow(px: number, py: number) {
    if (!this.W) return false;
    const z1 = Math.min(0.75, this.G.L - 0.1);
    const pts = [this.P(-1, -0.62, 0.12), this.P(-1, -0.62, z1), this.P(-1, 0.02, z1), this.P(-1, 0.02, 0.12)];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return px > Math.min(...xs) - 8 && px < Math.max(...xs) + 8 && py > Math.min(...ys) - 8 && py < Math.max(...ys) + 8;
  }
  /** The window's height on screen (px), so a drag across it opens it fully. */
  windowPx() {
    const p = this.P(-1, -0.62, 0.12), q = this.P(-1, 0.02, 0.12);
    return Math.max(60, q[1] - p[1]);
  }
  hitMica(px: number, py: number) {
    const m = this.mica;
    return !!m && Math.abs(px - m.x) < m.u * 0.65 && py > m.y - m.u * 1.4 && py < m.y + m.u * 0.15;
  }
  /** Position 0..1 along the film strip under the pointer, or null. */
  wallU(px: number, py: number): number | null {
    const w = this.wall;
    if (!w) return null;
    const xs = w.poly.map((p) => p[0]), ys = w.poly.map((p) => p[1]);
    if (px < Math.min(...xs) - 8 || px > Math.max(...xs) + 8 || py < Math.min(...ys) - 14 || py > Math.max(...ys) + 14) return null;
    const s2 = (px - this.G.vx) / this.G.hw;
    if (s2 <= 0.01) return null;
    return clamp((this.G.D / s2 - this.G.D - w.z0) / (w.z1 - w.z0));
  }
  private hue(m: number) {
    return `hsl(${((((m % 12) + 12) % 12) * 30 + 190) % 360} ${this.pal.pitchSat}% ${this.pal.pitchLight}%)`;
  }
  private line(c: CanvasRenderingContext2D, pts: [number, number][], close = false) {
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    if (close) c.closePath();
    c.stroke();
  }

  frame(I: RoomInput, t: number, dt: number) {
    if (!this.W || !this.H) return;
    const S = this.S;
    const spring = (k: 'temp' | 'air' | 'z', v: 'tv' | 'av' | 'zv', target: number, w: number) => {
      const a = w * w * (target - S[k]) - 2 * w * S[v];
      S[v] += a * dt;
      S[k] += S[v] * dt;
    };
    if (!this.primed || I.reduceMotion) {
      S.temp = I.temp;
      S.air = I.air;
      S.room = I.room;
      S.z = I.zoom ? 1 : 0;
      this.primed = true;
    } else {
      if (I.eased) {
        S.temp += (I.temp - S.temp) * Math.min(1, dt * 20);
        S.air += (I.air - S.air) * Math.min(1, dt * 20);
        S.room += (I.room - S.room) * Math.min(1, dt * 20);
      } else {
        spring('temp', 'tv', I.temp, 4.2);
        spring('air', 'av', I.air, 5);
        S.room += (I.room - S.room) * Math.min(1, dt * 4);
      }
      spring('z', 'zv', I.zoom ? 1 : 0, 6);
    }
    // Mica's step: how fast she moves
    const ox = S.x, oz = S.z0;
    S.x += (I.x - S.x) * Math.min(1, dt * 12);
    S.z0 += (I.z - S.z0) * Math.min(1, dt * 12);
    const sp = Math.hypot(S.x - ox, S.z0 - oz) / Math.max(dt, 1e-3);
    this.vis.step += sp * dt * 14;
    this.vis.speed = sp;
    this.vis.dir = Math.sign(S.x - ox) || this.vis.dir;
    // new notes send an echo wave
    const v = this.vis;
    I.voices.forEach(([n, e], k) => {
      const [pn, pe] = v.prev[k] ?? [-1, 0];
      // a note starts (a new note in this voice, or a key pressed again): a ring at once, and its echo
      if (n >= 0 && e > 0 && (pn !== n || pe < 0.01 || e - pe > 0.15)) {
        v.rings.push({ n, a: Math.max(0.7, Math.min(1, e)), r: 0.05, t: 0, x: S.x, z: S.z0 });
        v.ringT = 0;
        if (I.echoWet > 0.02) v.echoes.push({ n, born: t, z: S.z0 });
      }
    });
    v.prev = I.voices.map((x) => [x[0], x[1]]);
    for (const [x, m] of I.events) this.spawnGrain(x, m, I);
    this.draw(I, t, dt);
  }

  private spawnGrain(x: number, m: number, I: RoomInput) {
    const v = this.vis;
    if (v.grains.length < 24) v.grains.push({ x, t: 0 });
    if (v.sparks.length > 60) return;
    const i = Math.floor(Math.random() * MICA_SHAPE.length), a = MICA_SHAPE[i], b = MICA_SHAPE[(i + 1) % MICA_SHAPE.length], f = Math.random();
    const px = lerp(a[0], b[0], f), py = lerp(a[1], b[1], f);
    const ang = Math.atan2(py + 0.7, px) + (Math.random() - 0.5) * lerp(0.2, 1.4, I.spread), len = lerp(0.12, 0.5, I.gsize);
    const segs: Spark['segs'] = [];
    const grow = (x0: number, y0: number, an: number, l: number, d: number) => {
      const x1 = x0 + Math.cos(an) * l, y1 = y0 + Math.sin(an) * l;
      segs.push([x0, y0, x1, y1, d]);
      if (d < 2) {
        grow(x1, y1, an + 0.4 + Math.random() * 0.3, l * 0.62, d + 1);
        grow(x1, y1, an - 0.4 - Math.random() * 0.3, l * 0.62, d + 1);
      }
    };
    grow(px, py, ang, len, 0);
    v.sparks.push({ segs, t: 0, m });
  }

  private draw(I: RoomInput, t: number, dt: number) {
    const c = this.cv.getContext('2d');
    if (!c) return;
    const { W, H, S, pal } = this;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = rgba(pal.bg);
    c.fillRect(0, 0, W, H);
    this.geom();
    const G = this.G;
    const P = this.P.bind(this);
    const line = (pts: [number, number][], close = false) => this.line(c, pts, close);
    // the camera flies into Mica's head (her menu)
    const mh = P(S.x, 1, S.z0), msz = Math.min(W, H) * 0.2 * this.sc(S.z0) * G.zoom, head: [number, number] = [mh[0], mh[1] - msz * 1.05];
    const z = sstep(0, 1, S.z), zs = lerp(1, 5.2, z);
    c.save();
    c.translate(W / 2, H / 2);
    c.scale(zs, zs);
    c.translate(-lerp(W / 2, head[0], z), -lerp(H / 2, head[1], z));
    const lit = 1; // the Light dims only the lamp, never the room
    const nc = along(pal.neon, S.temp);
    const x = clamp(S.temp) * 3, gi = Math.min(2, Math.floor(x));
    const nb = lerp(GLOW[gi], GLOW[gi + 1], sstep(0, 1, x - gi)) * pal.glow;
    // plain lines (no blur: it was costly and filled the room with haze); a neon look only on the room's edges,
    // from a wide faint stroke under the thin one
    const lw = (1 / zs + 0.4) * lerp(0.85, 1.35, S.temp);
    c.lineWidth = lw;
    c.shadowBlur = 0;
    const L = G.L, fade = 1 - sstep(0.72, 1, S.room);
    const corners = (Z: number) => [P(-1, -1, Z), P(1, -1, Z), P(1, 1, Z), P(-1, 1, Z)];
    const glow = Math.min(0.22, nb / 70) * pal.glow * lit; // soft and wide when warm, sharp when cold
    const edges = (alpha: number, width: number) => {
      c.lineWidth = width;
      c.strokeStyle = rgba(nc, alpha);
      line(corners(0), true);
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) line([P(a, b, 0), P(a, b, L * (0.55 + 0.45 * fade))]);
      c.globalAlpha = fade;
      line(corners(L), true);
      c.globalAlpha = 1;
    };
    if (glow > 0.01) edges(glow, lw * 5);
    edges(0.85 * lit, lw);
    // floor and ceiling: a quiet grid that fades into the dark
    c.lineWidth = lw * 0.8;
    for (let i = 1; i < 40; i++) {
      const Z = i * 0.35;
      if (Z >= L) break;
      c.strokeStyle = rgba(nc, 0.16 * lit * (1 - Z / (L + 0.5)));
      line([P(-1, 1, Z), P(1, 1, Z)]);
      line([P(-1, -1, Z), P(1, -1, Z)]);
    }
    c.strokeStyle = rgba(nc, 0.12 * lit);
    for (let i = -4; i <= 4; i++) line([P(i / 5, 1, 0), P(i / 5, 1, L * (0.55 + 0.45 * fade))]);
    c.lineWidth = lw;
    this.drawWindow(c, I, t, lit, nc);
    this.drawMemoryWall(c, I, lit, nc, dt);
    this.drawLamp(c, I, nc);
    c.save();
    {
      const f = corners(0);
      c.beginPath();
      f.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)));
      c.closePath();
      c.clip();
    }
    this.drawWaves(c, I, t, dt, lit);
    c.restore();
    this.drawMica(c, I, t, dt, msz, mh, lit);
    this.drawSparks(c, dt, lit);
    c.restore();
    if (z > 0.02) this.drawBrain(c, I, z, t);
  }

  private drawWindow(c: CanvasRenderingContext2D, I: RoomInput, t: number, lit: number, nc: RGB) {
    const P = this.P.bind(this), pal = this.pal, S = this.S;
    const line = (pts: [number, number][], close = false) => this.line(c, pts, close);
    const z0 = 0.12, z1 = Math.min(0.75, this.G.L - 0.1), y0 = -0.62, y1 = 0.02, open = S.air;
    const q = (y: number, Z: number) => P(-1, y, Z);
    c.strokeStyle = rgba(nc, 0.9 * lit);
    line([q(y0, z0), q(y0, z1), q(y1, z1), q(y1, z0)], true);
    const ym = lerp(y0, y1, 0.5), so = lerp(y1, y0 + 0.08, open * 0.85);
    c.strokeStyle = rgba(nc, 0.55 * lit);
    line([q(ym, z0), q(ym, z1)]);
    line([q(so, z0), q(so, z1)]);
    c.fillStyle = rgba(pal.night, 0.25 * open);
    c.beginPath();
    [q(so, z0), q(so, z1), q(y1, z1), q(y1, z0)].forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.fill();
    // blinds: their sway is the filter's LFO
    const n = 9, sway = I.sway * 0.9 * Math.sin(t * Math.PI * 2 * lerp(0.15, 0.9, S.air));
    for (let i = 0; i < n; i++) {
      const y = lerp(y0 + 0.03, y1 - 0.03, (i + 0.5) / n), ph = Math.sin(t * 2.3 + i * 0.7) * 0.25 * S.air + sway, tilt = 0.04 * (1 + ph);
      c.strokeStyle = rgba(pal.frost, 0.5 * lit);
      const a = P(-1 + 0.02 + Math.abs(ph) * 0.06, y - tilt, z0 + 0.02), b = P(-1 + 0.02 + Math.abs(ph) * 0.06, y + tilt * 0.3, z1 - 0.02);
      line([a, b]);
    }
  }

  private drawMemoryWall(c: CanvasRenderingContext2D, I: RoomInput, lit: number, nc: RGB, dt: number) {
    // the tape hangs on the right wall as a film strip; lit windows show where grains are read
    const P = this.P.bind(this), pal = this.pal;
    const line = (pts: [number, number][], close = false) => this.line(c, pts, close);
    if (!I.tape || I.zoom) {
      this.wall = null;
      if (!I.tape) return;
    }
    const z0 = 0.2, z1 = Math.min(this.G.L - 0.1, 2.4), y0 = -0.5, y1 = -0.2;
    const q = (u: number, y: number) => P(1, y, lerp(z0, z1, u));
    if (!I.zoom) this.wall = { z0, z1, poly: [q(0, y0), q(1, y0), q(1, y1), q(0, y1)] };
    c.strokeStyle = rgba(nc, 0.6 * lit);
    line([q(0, y0), q(1, y0), q(1, y1), q(0, y1)], true);
    c.strokeStyle = rgba(nc, 0.45 * lit);
    c.beginPath();
    const pk = I.tape!.peaks, n = pk.length;
    for (let i = 0; i <= 80; i++) {
      const u = i / 80;
      const p = pk[Math.min(n - 1, Math.floor(u * n))] ?? 0;
      const [x, ya] = q(u, lerp(y0, y1, 0.5 - p * 0.45)), [, yb] = q(u, lerp(y0, y1, 0.5 + p * 0.45));
      c.moveTo(x, ya);
      c.lineTo(x, yb);
    }
    c.stroke();
    c.fillStyle = rgba(pal.bg, 0.6);
    for (const [a, b] of [[0, I.start], [I.end, 1]]) {
      if (b - a < 0.002) continue;
      c.beginPath();
      [q(a, y0), q(b, y0), q(b, y1), q(a, y1)].forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.fill();
    }
    const span = Math.max(0.02, I.end - I.start);
    if (I.aud >= 0) {
      const u = I.start + I.aud * span;
      c.strokeStyle = rgba(nc, lit);
      c.lineWidth = 2.5;
      line([q(u, y0 - 0.1), q(u, y1 + 0.1)]);
      c.lineWidth = 1.3;
    }
    const u = I.start + I.pos * span;
    c.strokeStyle = rgba(pal.accent, lit);
    c.lineWidth = 2;
    line([q(u, y0 - 0.06), q(u, y1 + 0.06)]);
    c.lineWidth = 1.3;
    this.vis.grains = this.vis.grains.filter((g) => {
      g.t += dt;
      const gu = I.start + g.x * span, w = 0.008;
      c.strokeStyle = rgba(pal.accent, (1 - g.t / 0.3) * 0.8 * lit);
      line([q(gu - w, y0 - 0.01), q(gu + w, y0 - 0.01), q(gu + w, y1 + 0.01), q(gu - w, y1 + 0.01)], true);
      return g.t < 0.3;
    });
  }

  private drawLamp(c: CanvasRenderingContext2D, I: RoomInput, nc: RGB) {
    // a neon tube on the ceiling that dims with the Light (no light cone)
    const P = this.P.bind(this), pal = this.pal;
    const line = (pts: [number, number][]) => this.line(c, pts);
    const on = I.light;
    const a = P(-0.18, -0.88, 0.75), b = P(0.18, -0.88, 0.75);
    c.strokeStyle = rgba(nc, 0.5);
    c.lineWidth = 1;
    line([P(-0.13, -1, 0.75), P(-0.13, -0.88, 0.75)]);
    line([P(0.13, -1, 0.75), P(0.13, -0.88, 0.75)]);
    const w = this.sc(0.75) * this.G.hw * 0.022;
    c.lineCap = 'round';
    c.lineWidth = w * 2.6;
    c.strokeStyle = rgba(pal.lamp, 0.12 * on * pal.glow);
    line([a, b]);
    c.lineWidth = w;
    c.strokeStyle = rgba(pal.lamp, 0.12 + 0.88 * on);
    line([a, b]);
    c.lineCap = 'butt';
    c.lineWidth = 1.3;
  }

  private wobble(I: RoomInput, u: number, amp: number, t: number) {
    // the line's shape tells the sound: smooth, spiky with drive, stepped with crunch
    let uu = u;
    if (I.crunch > 0.02) {
      const st = Math.round(lerp(80, 7, I.crunch));
      uu = Math.round(u * st) / st;
    }
    let s = Math.sin(uu * Math.PI * 2 * 9 + t * 6);
    const dr = I.drive;
    if (dr > 0.05) s = Math.sign(s) * Math.pow(Math.abs(s), lerp(1, 0.12, dr)) + (((uu * 37) % 1) < 0.12 ? dr * 0.8 : 0);
    if (I.crunch > 0.02) {
      const q = lerp(8, 2, I.crunch);
      s = Math.round(s * q) / q;
    }
    return s * amp;
  }

  private drawWaves(c: CanvasRenderingContext2D, I: RoomInput, t: number, dt: number, lit: number) {
    // each voice sends rings from Mica (their size follows the envelope); echoes travel to the back wall and back, once per repeat
    const P = this.P.bind(this), v = this.vis, S = this.S;
    v.ringT += dt;
    if (v.ringT > 0.16) {
      v.ringT = 0;
      for (const [n, e] of I.voices) if (n >= 0 && e > 0.02) v.rings.push({ n, a: Math.min(1, e), r: 0.05, t: 0, x: S.x, z: S.z0 });
    }
    const life = lerp(0.6, 3.2, I.decay) * (0.5 + I.wet);
    c.setLineDash(I.grains > 0.08 ? [2.4, lerp(2, 6, I.grains)] : []);
    c.lineCap = 'round';
    c.lineWidth = 2;
    v.rings = v.rings.filter((g) => {
      g.t += dt;
      g.r += dt * lerp(0.6, 1.4, S.room);
      const a = g.a * (1 - g.t / life) * (1 - sstep(0.7, 1.1, g.r));
      if (a <= 0) return false;
      c.strokeStyle = this.hue(g.n);
      c.globalAlpha = a * lit;
      c.beginPath();
      for (let i = 0; i <= 64; i++) {
        const th = (i / 64) * Math.PI * 2, rr = g.r * (1 + this.wobble(I, i / 64, 0.06 * g.a, t));
        const [x, y] = P(g.x + Math.cos(th) * rr, 1, g.z + Math.sin(th) * rr * 0.9);
        if (i) c.lineTo(x, y);
        else c.moveTo(x, y);
      }
      c.stroke();
      c.globalAlpha = 1;
      return true;
    });
    const T2 = Math.max(0.05, I.echoSec), back = this.G.L - 0.05, fb = I.fb * 0.92;
    v.echoes = v.echoes.filter((e) => {
      const trip = (t - e.born) / T2, k = Math.floor(trip), f = trip - k, amp = Math.pow(fb, k) * I.echoWet * 1.6;
      if (amp < 0.03 || k > 40) return false;
      const Z = f < 0.5 ? lerp(e.z, back, f * 2) : lerp(back, e.z, (f - 0.5) * 2);
      c.strokeStyle = this.hue(e.n);
      c.globalAlpha = Math.min(1, amp) * lit;
      c.beginPath();
      for (let i = 0; i <= 60; i++) {
        const u = i / 60, [px, py] = P(lerp(-0.92, 0.92, u), 1 - 0.05 - Math.abs(this.wobble(I, u, 0.25 * amp, t)), Z);
        if (i) c.lineTo(px, py);
        else c.moveTo(px, py);
      }
      c.stroke();
      c.globalAlpha = 1;
      return true;
    });
    c.setLineDash([]);
  }

  private drawSparks(c: CanvasRenderingContext2D, dt: number, lit: number) {
    // each grain cracks out of Mica's edge and splits: length = grain size, how many = density, scatter = spread, colour = pitch
    const mg = this.mica;
    if (!mg) return;
    c.lineWidth = 1.2;
    this.vis.sparks = this.vis.sparks.filter((s) => {
      s.t += dt;
      const life = 0.55;
      c.strokeStyle = this.hue(s.m);
      for (const [x0, y0, x1, y1, d] of s.segs) {
        const show = clamp((s.t - d * 0.05) / 0.05);
        if (show <= 0) continue;
        c.globalAlpha = clamp(1 - s.t / life) * lit * (1 - d * 0.2);
        c.beginPath();
        c.moveTo(mg.x + x0 * mg.u, mg.y + y0 * mg.u);
        c.lineTo(mg.x + lerp(x0, x1, show) * mg.u, mg.y + lerp(y0, y1, show) * mg.u);
        c.stroke();
      }
      c.globalAlpha = 1;
      return s.t < life;
    });
  }

  private drawMica(c: CanvasRenderingContext2D, I: RoomInput, t: number, dt: number, u: number, foot: [number, number], lit: number) {
    // Mica: a small faceted crystal with stubby legs. Clothes are layers she takes off as it warms up.
    const pal = this.pal, v = this.vis, S = this.S;
    const line = (pts: [number, number][], close = false) => this.line(c, pts, close);
    const tt = S.temp, lvl = Math.min(1, I.voices.reduce((m, [n, e]) => (n >= 0 ? Math.max(m, e) : m), 0));
    const still = I.reduceMotion ? 0 : 1;
    const shiver = (1 - sstep(0, 0.2, tt)) * Math.sin(t * 40) * u * 0.012 * still;
    const bob = (Math.sin(t * 2) * u * 0.01 + lvl * u * 0.03 * Math.sin(t * 9)) * still;
    const sway = I.moving ? I.motion * u * 0.14 : 0;
    const x = foot[0] + shiver + sway, y = foot[1] - bob;
    this.mica = I.zoom ? null : { x, y, u };
    const col = rgba(pal.mica, lit);
    c.save();
    c.translate(x, y);
    c.rotate((I.moving ? I.motion * 0.12 : 0) + v.dir * Math.min(1, v.speed * 2.5) * 0.08);
    c.lineWidth = 1.6;
    c.strokeStyle = col;
    c.shadowColor = rgba(pal.mica);
    c.shadowBlur = 0;
    const wk = Math.min(1, v.speed * 2.5), lg = Math.sin(v.step) * wk * u * 0.1, lift = (q: number) => Math.max(0, q) * 0.8;
    line([[-u * 0.18, -u * 0.2], [-u * 0.2 + lg, -lift(lg)], [-u * 0.32 + lg, -lift(lg)]]);
    line([[u * 0.18, -u * 0.2], [u * 0.2 - lg, -lift(-lg)], [u * 0.32 - lg, -lift(-lg)]]);
    const B = MICA_SHAPE.map(([a, b]) => [a * u, b * u] as [number, number]);
    c.fillStyle = rgba(pal.micaFill, 0.9);
    c.beginPath();
    B.forEach(([a, b], i) => (i ? c.lineTo(a, b) : c.moveTo(a, b)));
    c.closePath();
    c.fill();
    c.stroke();
    c.globalAlpha = 0.45;
    line([[0, -u * 1.25], [-u * 0.12, -u * 0.7], [-u * 0.3, -u * 0.18]]);
    line([[-u * 0.12, -u * 0.7], [u * 0.48, -u * 0.45]]);
    c.globalAlpha = 1;
    const ar = lvl * 0.6;
    line([[-u * 0.46, -u * 0.6], [-u * 0.72, -u * (0.42 + ar * 0.5)]]);
    line([[u * 0.46, -u * 0.6], [u * 0.72, -u * (0.42 + ar * 0.5)]]);
    // clothes (inside out): tank top below HOT, sweater below WARM, winter suit when FREEZING
    const layer = (th: number) => 1 - sstep(th - 0.07, th + 0.07, tt);
    const tank = layer(0.84), sweat = layer(0.5), suit = layer(0.18);
    const [cFreeze, cChill, cWarm, cHot] = pal.temp;
    const wear = (p: number, fill: string, stroke: string, draw: () => void) => {
      if (p < 0.01) return;
      c.save();
      c.globalAlpha = Math.pow(p, 0.7);
      c.translate(0, -(1 - p) * u * 1.6);
      c.fillStyle = fill;
      c.strokeStyle = stroke;
      draw();
      c.restore();
    };
    const torso = (top: number, bot: number, w: number) => {
      c.beginPath();
      c.moveTo(-u * w, -u * top);
      c.lineTo(u * w, -u * top);
      c.lineTo(u * (w - 0.12), -u * bot);
      c.lineTo(-u * (w - 0.12), -u * bot);
      c.closePath();
      c.fill();
      c.stroke();
    };
    wear(tank, rgba(cWarm, 0.35), rgba(cWarm), () => {
      torso(0.6, 0.2, 0.47);
      line([[-u * 0.3, -u * 0.62], [-u * 0.22, -u * 0.8]]);
      line([[u * 0.3, -u * 0.62], [u * 0.22, -u * 0.8]]);
    });
    wear(sweat, rgba(cChill, 0.45), rgba(cChill), () => {
      torso(0.72, 0.16, 0.5);
      for (let i = 0; i < 4; i++) line([[-u * 0.36 + i * u * 0.24, -u * 0.22], [-u * 0.36 + i * u * 0.24, -u * 0.16]]);
      line([[-u * 0.47, -u * 0.62], [-u * 0.74, -u * (0.4 + ar * 0.5)]]);
      line([[u * 0.47, -u * 0.62], [u * 0.74, -u * (0.4 + ar * 0.5)]]);
      c.beginPath();
      c.ellipse(0, -u * 0.73, u * 0.3, u * 0.05, 0, 0, 7);
      c.stroke();
    });
    wear(suit, rgba(cFreeze, 0.55), rgba(cFreeze), () => {
      torso(0.76, 0.1, 0.56);
      for (let i = 1; i < 3; i++) line([[-u * 0.5, -u * (0.1 + i * 0.22)], [u * 0.5, -u * (0.1 + i * 0.22)]]);
      c.save();
      c.globalAlpha *= 0.9;
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(-u * 0.5, -u * 0.78);
      c.lineTo(-u * 0.46, -u * 1.1);
      c.lineTo(0, -u * 1.36);
      c.lineTo(u * 0.46, -u * 1.1);
      c.lineTo(u * 0.5, -u * 0.78);
      c.stroke();
      c.restore();
      for (const sx of [-1, 1]) {
        c.beginPath();
        c.arc(sx * u * 0.76, -u * (0.4 + ar * 0.5), u * 0.08, 0, 7);
        c.fill();
        c.stroke();
      }
      c.strokeStyle = rgba(cHot);
      c.lineWidth = 3;
      line([[-u * 0.34, -u * 0.76], [u * 0.34, -u * 0.76], [u * 0.38, -u * 0.52]]);
    });
    // face: eyes blink, the mouth opens with the envelope (a slow attack opens it slowly)
    v.blink -= dt;
    if (v.blink < -3.2) v.blink = 0.12;
    const eh = v.blink > 0 ? 0.2 : 1;
    c.fillStyle = col;
    for (const ex of [-0.14, 0.14]) {
      c.beginPath();
      c.ellipse(u * ex, -u * 0.98, u * 0.045, u * 0.06 * eh, 0, 0, 7);
      c.fill();
    }
    c.beginPath();
    if (lvl > 0.03) c.ellipse(0, -u * 0.84, u * 0.07 + lvl * u * 0.03, u * 0.015 + lvl * u * 0.09, 0, 0, 7);
    else {
      c.moveTo(-u * 0.07, -u * 0.86);
      c.quadraticCurveTo(0, -u * 0.8, u * 0.07, -u * 0.86);
    }
    c.stroke();
    // HOT: sweat and flushed cheeks; FREEZING: breath fog
    const hot = sstep(0.84, 1, tt);
    if (hot > 0.02) {
      c.fillStyle = rgba(cHot, 0.35 * hot);
      for (const ex of [-0.24, 0.24]) {
        c.beginPath();
        c.ellipse(u * ex, -u * 0.88, u * 0.06, u * 0.03, 0, 0, 7);
        c.fill();
      }
      if (still && Math.random() < hot * 0.08) v.drops.push({ x: (Math.random() - 0.5) * u * 0.7, y: -u * 1.1, v: 0 });
    }
    c.strokeStyle = rgba(cChill, 0.9);
    v.drops = v.drops.filter((d) => {
      d.v += (60 * dt * u) / 80;
      d.y += d.v;
      c.beginPath();
      c.moveTo(d.x, d.y - u * 0.05);
      c.quadraticCurveTo(d.x + u * 0.03, d.y + u * 0.02, d.x, d.y + u * 0.03);
      c.quadraticCurveTo(d.x - u * 0.03, d.y + u * 0.02, d.x, d.y - u * 0.05);
      c.stroke();
      return d.y < 0;
    });
    const cold = 1 - sstep(0, 0.2, tt);
    if (still && cold > 0.02 && Math.random() < cold * (0.04 + lvl * 0.2)) v.fog.push({ x: u * 0.1, y: -u * 0.84, r: u * 0.04, t: 0 });
    v.fog = v.fog.filter((f) => {
      f.t += dt;
      f.x += u * 0.3 * dt;
      f.y -= u * 0.12 * dt;
      f.r += u * 0.1 * dt;
      c.strokeStyle = rgba(cFreeze, 0.5 * (1 - f.t / 1.6) * cold);
      c.beginPath();
      c.arc(f.x, f.y, f.r, 0, 7);
      c.stroke();
      return f.t < 1.6;
    });
    c.restore();
  }

  private drawBrain(c: CanvasRenderingContext2D, I: RoomInput, z: number, t: number) {
    // inside Mica's head: a little tape machine recording into her memory
    const { W, H, pal } = this;
    const line = (pts: [number, number][]) => this.line(c, pts);
    c.save();
    c.globalAlpha = sstep(0.4, 1, z);
    c.fillStyle = rgba(pal.bg, 0.82);
    c.fillRect(0, 0, W, H);
    const rec = I.rec?.phase;
    const cx = W / 2, cy = H * 0.15, r = Math.min(W, H) * 0.058, spin = rec === 'rec' || I.aud >= 0 ? t * 3 : rec === 'armed' ? t * 0.4 : 0;
    c.strokeStyle = rgba(pal.ink);
    c.lineWidth = 1.5;
    c.shadowColor = rgba(pal.neon[1]);
    c.shadowBlur = 0;
    for (const dx of [-1.6, 1.6]) {
      c.beginPath();
      c.arc(cx + dx * r, cy, r, 0, 7);
      c.stroke();
      c.beginPath();
      c.arc(cx + dx * r, cy, r * 0.2, 0, 7);
      c.stroke();
      for (let k = 0; k < 3; k++) {
        const a = spin + k * 2.09;
        line([[cx + dx * r + Math.cos(a) * r * 0.28, cy + Math.sin(a) * r * 0.28], [cx + dx * r + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8]]);
      }
    }
    line([[cx - 1.6 * r, cy + r], [cx - 0.3 * r, cy + r * 1.25], [cx + 0.3 * r, cy + r * 1.25], [cx + 1.6 * r, cy + r]]);
    c.font = `300 ${Math.round(r * 0.45)}px ${pal.font}`;
    c.fillStyle = rgba(rec === 'rec' ? pal.rec : pal.ink);
    c.textAlign = 'center';
    const tapeLen = I.tape ? I.tape.secs * (I.end - I.start) : 0;
    const s = I.aud >= 0 ? I.aud * tapeLen : I.rec ? I.rec.secs : tapeLen;
    c.fillText(`00:${String(Math.floor(s)).padStart(2, '0')}.${Math.floor((s % 1) * 10)}`, cx, cy - r * 1.25);
    c.font = `300 ${Math.round(r * 0.22)}px ${pal.font}`;
    c.fillStyle = rgba(pal.mute);
    c.fillText(rec === 'armed' ? 'WAITING FOR SOUND' : rec === 'rec' ? 'RECORDING INTO MEMORY' : rec === 'saving' ? 'SAVING' : (I.tape?.name || 'EMPTY').toUpperCase(), cx, cy + r * 1.6);
    c.restore();
  }
}

/** A tape's outline for the film strip: the peak of each of `n` pieces, 0..1. */
export function tapePeaks(pcm: Int16Array, frames: number, n = 160): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i / n) * frames), b = Math.max(a + 1, Math.floor(((i + 1) / n) * frames));
    let pk = 0;
    for (let j = a; j < b; j += 8) pk = Math.max(pk, Math.abs(pcm[j]));
    out[i] = pk / 32767;
  }
  return out;
}
