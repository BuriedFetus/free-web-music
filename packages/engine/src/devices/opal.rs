//! Opal: pad synth. Eight voices, each:
//!   Osc 1 (Saw / Square / Triangle / Sine + Shape) stacked 1, 3, 5 or 7 times, detuned and spread
//!   left to right, + Osc 2 (an interval above or below, fine-tuned) + Air (noise)
//!   → two state-variable low-pass filters (left, right) with Swell (a filter envelope with its own,
//!     usually slow, attack) → amp envelope.
//! Shared by all voices: Drift (each oscillator wanders a few cents on its own, like an old analog
//! synth), Movement (a slow LFO on the cutoff and the Shape), an ensemble chorus (I, II, I+II: two
//! modulated short delays, one per side, moving in opposite directions), Width (mid/side) and Level.
//! Voices: a note re-pressed takes its own voice back; otherwise a free voice, else the oldest
//! released one, else the oldest.

use crate::device::{Device, ModSource, RouteError, MAX_ROUTES};
use crate::dsp::env::{Adsr, AdsrCoefs, AdsrTimes};
use crate::dsp::osc::{Osc, Wave};
use crate::dsp::rng::Rng;
use crate::dsp::svf::Svf;
use crate::dsp::{clamp01, exp2, flush, note_hz, one_pole_coef, sat, sinf, TAU};

pub const VOICES: usize = 8;
pub const MAX_STACK: usize = 7;
pub const STACKS: [usize; 4] = [1, 3, 5, 7];
pub const INTERVALS: [f32; 5] = [-12.0, 0.0, 7.0, 12.0, 24.0];
const CTL: usize = 16;
const CH: usize = 1024;

pub mod p {
    pub const W1: usize = 0;
    pub const SHAPE: usize = 1;
    pub const STACK: usize = 2;
    pub const DETUNE: usize = 3;
    pub const W2: usize = 4;
    pub const INT2: usize = 5;
    pub const FINE2: usize = 6;
    pub const MIX2: usize = 7;
    pub const AIR: usize = 8;
    pub const CUT: usize = 9;
    pub const RES: usize = 10;
    pub const FENV: usize = 11;
    pub const SWELL: usize = 12;
    pub const ATK: usize = 13;
    pub const DEC: usize = 14;
    pub const SUS: usize = 15;
    pub const REL: usize = 16;
    pub const DRIFT: usize = 17;
    pub const RATE: usize = 18;
    pub const MOVE: usize = 19;
    pub const CHORUS: usize = 20;
    pub const WIDTH: usize = 21;
    pub const LVL: usize = 22;
    pub const LWAVE: usize = 23;
    pub const COUNT: usize = 24;
}

/// Parameter ids, in index order (they match `devices/opal.json`).
pub const IDS: [&str; p::COUNT] = [
    "w1", "shape", "stack", "detune", "w2", "int2", "fine2", "mix2", "air", "cut", "res", "fenv", "swell", "atk", "dec", "sus",
    "rel", "drift", "rate", "move", "chorus", "width", "lvl", "lwave",
];

/// "Warm Pad".
pub fn defaults() -> [f32; p::COUNT] {
    [0.0, 0.3, 2.0, 0.35, 1.0, 3.0, 0.55, 0.3, 0.05, 0.45, 0.2, 0.35, 0.45, 0.45, 0.6, 0.8, 0.55, 0.3, 0.3, 0.25, 1.0, 0.7, 0.7, 0.0]
}

fn discrete_max(i: usize) -> Option<f32> {
    match i {
        p::W1 | p::W2 | p::STACK | p::CHORUS | p::LWAVE => Some(3.0),
        p::INT2 => Some(4.0),
        _ => None,
    }
}

// Normalised → physical. Must match the "map" entries in opal.json.
#[inline]
fn exp_map(v: f32, lo: f32, hi: f32) -> f32 {
    lo * exp2(v * libm::log2f(hi / lo))
}
#[inline]
fn sq_map(v: f32, lo: f32, hi: f32) -> f32 {
    lo + v * v * (hi - lo)
}
pub fn cutoff_hz(v: f32) -> f32 {
    exp_map(v, 40.0, 16000.0)
}
pub fn attack_s(v: f32) -> f32 {
    sq_map(v, 0.002, 8.0)
}
pub fn release_s(v: f32) -> f32 {
    sq_map(v, 0.02, 10.0)
}

/// A source may not modulate its own controls (no feedback loops).
fn route_allowed(src: ModSource, target: usize) -> bool {
    if target >= p::COUNT || discrete_max(target).is_some() {
        return false;
    }
    match src {
        ModSource::Lfo => target != p::RATE,
        ModSource::AmpEnv => !(p::ATK..=p::REL).contains(&target),
        ModSource::FiltEnv => target != p::SWELL,
    }
}

#[derive(Clone, Copy)]
struct Route {
    src: ModSource,
    target: usize,
    depth: f32,
}

#[derive(Clone, Copy)]
struct Voice {
    note: u8,
    vel: f32,
    held: bool,
    live: bool,
    age: u32,
    osc: [Osc; MAX_STACK],
    osc2: Osc,
    /// Drift per oscillator (the last one is Osc 2): where it is and where it is wandering to, -1..1.
    drift: [f32; MAX_STACK + 1],
    dgoal: [f32; MAX_STACK + 1],
    svf: [Svf; 2],
    amp: Adsr,
    filt: Adsr,
}

impl Voice {
    const fn new() -> Voice {
        Voice {
            note: 0,
            vel: 0.0,
            held: false,
            live: false,
            age: 0,
            osc: [Osc::new(); MAX_STACK],
            osc2: Osc::new(),
            drift: [0.0; MAX_STACK + 1],
            dgoal: [0.0; MAX_STACK + 1],
            svf: [Svf::new(); 2],
            amp: Adsr::new(),
            filt: Adsr::new(),
        }
    }
}

/// Per-voice values recomputed every CTL samples.
#[derive(Clone, Copy, Default)]
struct VCtl {
    dt: [f32; MAX_STACK],
    dt2: f32,
    g: f32,
}

struct Chorus {
    buf: [[f32; CH]; 2],
    w: usize,
    wet: f32,
    lp: [f32; 2],
    /// LFO phase, 0..1.
    lph: f32,
}

pub struct Opal {
    fs: f32,
    params: [f32; p::COUNT],
    sm: [f32; p::COUNT],
    /// Values after modulation (what the sound uses, and what the knobs' arcs show).
    eff: [f32; p::COUNT],
    routes: [Option<Route>; MAX_ROUTES],
    /// The voice played last: its envelopes are the Amp env / Filter env sources.
    last: usize,
    lfo_prev: f32,
    primed: bool,
    v: [Voice; VOICES],
    vc: [VCtl; VOICES],
    clock: u32,
    rng: Rng,
    lfo: f32,
    lfo_out: f32,
    ctl_n: usize,
    amp_c: AdsrCoefs,
    filt_c: AdsrCoefs,
    ch: Chorus,
    /// Osc 1's Shape after Movement, for this control period.
    shape_now: f32,
}

impl Default for Opal {
    fn default() -> Self {
        Self::new()
    }
}

impl Opal {
    pub fn new() -> Opal {
        let d = defaults();
        let z = AdsrCoefs::new(&AdsrTimes { a: 0.01, d: 0.1, s: 1.0, r: 0.1 }, 48_000.0);
        Opal {
            fs: 48_000.0,
            params: d,
            sm: d,
            eff: d,
            routes: [None; MAX_ROUTES],
            last: 0,
            lfo_prev: 0.0,
            primed: false,
            v: [Voice::new(); VOICES],
            vc: [VCtl::default(); VOICES],
            clock: 0,
            rng: Rng::new(0x0FA1),
            lfo: 0.0,
            lfo_out: 0.0,
            ctl_n: 0,
            amp_c: z,
            filt_c: z,
            ch: Chorus { buf: [[0.0; CH]; 2], w: 0, wet: 0.0, lp: [0.0; 2], lph: 0.0 },
            shape_now: 0.3,
        }
    }

    /// Voices sounding now (held or releasing).
    pub fn active(&self) -> usize {
        self.v.iter().filter(|v| v.live).count()
    }

    fn choose(&self, note: u8) -> usize {
        if let Some(i) = (0..VOICES).find(|&i| self.v[i].live && self.v[i].note == note) {
            return i;
        }
        if let Some(i) = (0..VOICES).find(|&i| !self.v[i].live) {
            return i;
        }
        let oldest = |held: bool| (0..VOICES).filter(|&i| self.v[i].held == held).min_by_key(|&i| self.v[i].age);
        oldest(false).or_else(|| oldest(true)).unwrap_or(0)
    }

    fn control(&mut self) {
        let fs = self.fs;
        // Movement / LFO: Sine, Triangle, Square or Random (a new value each cycle)
        let rate = exp_map(self.eff[p::RATE], 0.05, 8.0);
        let ph = (self.lfo + rate * CTL as f32 / fs) % 1.0;
        let wrapped = ph < self.lfo;
        self.lfo = ph;
        self.lfo_out = match self.params[p::LWAVE] as u32 {
            1 => 1.0 - 4.0 * libm::fabsf(ph - 0.5),
            2 => if ph < 0.5 { 1.0 } else { -1.0 },
            3 => {
                if wrapped {
                    self.lfo_prev = self.rng.bipolar();
                }
                self.lfo_prev
            }
            _ => sinf(ph * TAU),
        };
        // routes: depth × source added to the knob's value
        let lv = &self.v[self.last];
        let (amp_l, filt_l) = if lv.live { (lv.amp.level, lv.filt.level) } else { (0.0, 0.0) };
        self.eff = self.sm;
        for r in self.routes.iter().flatten() {
            let src = match r.src {
                ModSource::Lfo => self.lfo_out,
                ModSource::AmpEnv => amp_l,
                ModSource::FiltEnv => filt_l,
            };
            self.eff[r.target] += r.depth * src;
        }
        for i in 0..p::COUNT {
            if discrete_max(i).is_none() {
                self.eff[i] = clamp01(self.eff[i]);
            }
        }
        let s = &self.eff;
        self.amp_c = AdsrCoefs::new(&AdsrTimes { a: attack_s(s[p::ATK]), d: sq_map(s[p::DEC], 0.05, 8.0), s: s[p::SUS], r: release_s(s[p::REL]) }, fs);
        self.filt_c = AdsrCoefs::new(&AdsrTimes { a: attack_s(s[p::SWELL]), d: 2.5, s: 0.35, r: release_s(s[p::REL]) }, fs);
        let n = STACKS[self.params[p::STACK] as usize];
        let det = s[p::DETUNE] * s[p::DETUNE] * 40.0; // cents at the outer oscillators
        let drift_ct = s[p::DRIFT] * 9.0;
        let int2 = INTERVALS[self.params[p::INT2] as usize] + (s[p::FINE2] - 0.5);
        let base = cutoff_hz(s[p::CUT]);
        let fenv = s[p::FENV] * 6.0;
        let mv = s[p::MOVE] * 1.5 * self.lfo_out;
        let ny = fs * 0.45;
        let dc = one_pole_coef(0.4, fs / CTL as f32);
        for (vi, v) in self.v.iter_mut().enumerate() {
            if !v.live {
                continue;
            }
            for k in 0..=MAX_STACK {
                if self.rng.next_u32() % 1200 == 0 {
                    v.dgoal[k] = self.rng.bipolar();
                }
                v.drift[k] += (v.dgoal[k] - v.drift[k]) * dc;
            }
            let c = &mut self.vc[vi];
            let note = v.note as f32;
            for k in 0..n {
                let pos = if n == 1 { 0.0 } else { k as f32 / (n - 1) as f32 * 2.0 - 1.0 };
                let cents = pos * det + v.drift[k] * drift_ct;
                c.dt[k] = (note_hz(note + cents * 0.01) / fs).min(0.45);
            }
            c.dt2 = (note_hz(note + int2 + v.drift[MAX_STACK] * drift_ct * 0.01) / fs).min(0.45);
            // filter: base, + Swell envelope, + Movement, + a little key tracking
            let fc = base * exp2(fenv * v.filt.level + mv + (note - 60.0) / 24.0);
            c.g = Svf::g(fc.clamp(20.0, ny), fs);
        }
    }
}

impl Device for Opal {
    fn prepare(&mut self, sample_rate: f32) {
        self.fs = sample_rate;
        for v in self.v.iter_mut() {
            *v = Voice::new();
        }
        self.ch.buf = [[0.0; CH]; 2];
        self.primed = false;
    }
    fn param_count(&self) -> usize {
        p::COUNT
    }
    fn set_param(&mut self, index: usize, value: f32) {
        if index >= p::COUNT || !value.is_finite() {
            return;
        }
        self.params[index] = match discrete_max(index) {
            Some(max) => libm::roundf(value).clamp(0.0, max),
            None => clamp01(value),
        };
    }
    fn param(&self, index: usize) -> f32 {
        self.params.get(index).copied().unwrap_or(0.0)
    }
    fn effective(&self) -> &[f32] {
        &self.eff
    }
    fn set_route(&mut self, slot: usize, src: ModSource, target: usize, depth: f32) -> Result<(), RouteError> {
        if slot >= MAX_ROUTES {
            return Err(RouteError::NoSlot);
        }
        if !route_allowed(src, target) {
            return Err(RouteError::NotAllowed);
        }
        self.routes[slot] = Some(Route { src, target, depth: depth.clamp(-1.0, 1.0) });
        Ok(())
    }
    fn clear_route(&mut self, slot: usize) {
        if slot < MAX_ROUTES {
            self.routes[slot] = None;
        }
    }
    fn mod_source_value(&self, src: ModSource) -> f32 {
        let v = &self.v[self.last];
        match src {
            ModSource::Lfo => self.lfo_out,
            ModSource::AmpEnv => if v.live { v.amp.level } else { 0.0 },
            ModSource::FiltEnv => if v.live { v.filt.level } else { 0.0 },
        }
    }
    fn note_on(&mut self, note: u8, velocity: f32) {
        if velocity <= 0.0 {
            self.note_off(note);
            return;
        }
        let i = self.choose(note);
        self.clock = self.clock.wrapping_add(1);
        let fresh = !self.v[i].live;
        let v = &mut self.v[i];
        if fresh {
            *v = Voice::new();
            // free-running analog oscillators: every one starts somewhere else (no phasing on the attack)
            for o in v.osc.iter_mut() {
                o.phase = (self.rng.next_u32() >> 8) as f32 / 16_777_216.0;
            }
            v.osc2.phase = (self.rng.next_u32() >> 8) as f32 / 16_777_216.0;
            for k in 0..=MAX_STACK {
                v.drift[k] = self.rng.bipolar();
                v.dgoal[k] = v.drift[k];
            }
        }
        v.note = note;
        v.vel = 0.35 + 0.65 * velocity.min(1.0);
        v.held = true;
        v.live = true;
        v.age = self.clock;
        v.amp.gate_on();
        v.filt.gate_on();
        self.last = i;
        self.ctl_n = 0; // its pitch and filter are worked out before the next sample
    }
    fn note_off(&mut self, note: u8) {
        for v in self.v.iter_mut().filter(|v| v.held && v.note == note) {
            v.held = false;
            v.amp.gate_off();
            v.filt.gate_off();
        }
    }
    fn all_notes_off(&mut self) {
        for v in self.v.iter_mut().filter(|v| v.live) {
            v.held = false;
            v.amp.gate_off();
            v.filt.gate_off();
        }
    }
    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        let fs = self.fs;
        let k = if self.primed { one_pole_coef(0.015, fs / n.max(1) as f32) } else { 1.0 };
        for i in 0..p::COUNT {
            self.sm[i] = if discrete_max(i).is_some() { self.params[i] } else { self.sm[i] + (self.params[i] - self.sm[i]) * k };
        }
        self.primed = true;
        // the per-period values below are worked out at the first sample of every block
        self.ctl_n = 0;
        let w1 = Wave::from_index(self.params[p::W1] as u32);
        let w2 = Wave::from_index(self.params[p::W2] as u32);
        let stack = STACKS[self.params[p::STACK] as usize];
        // equal-power pans across the stack
        let mut gl = [0.0f32; MAX_STACK];
        let mut gr = [0.0f32; MAX_STACK];
        let norm = 1.0 / libm::sqrtf(stack as f32);
        for j in 0..stack {
            let pos = if stack == 1 { 0.0 } else { j as f32 / (stack - 1) as f32 * 2.0 - 1.0 };
            let a = (pos * 0.8 + 1.0) * core::f32::consts::FRAC_PI_4;
            gl[j] = libm::cosf(a) * norm * 1.414;
            gr[j] = libm::sinf(a) * norm * 1.414;
        }
        let (mut rk, mut mix1, mut mix2, mut air, mut gain, mut width) = (2.0f32, 1.0f32, 0.0f32, 0.0f32, 0.0f32, 0.0f32);
        // chorus mode: (rate Hz, depth ms); Juno-like: I slow, II faster and deeper, I+II a quick shimmer
        let mode = self.params[p::CHORUS] as usize;
        let (crate_, cdepth) = [(0.0, 0.0), (0.5, 1.7), (0.85, 2.1), (6.0, 0.3)][mode];
        let wet_goal = if mode == 0 { 0.0 } else { 1.0 };
        let wet_k = one_pole_coef(0.03, fs);
        let clp = one_pole_coef(1.0 / (TAU * 9000.0), fs);
        for i in 0..n {
            if self.ctl_n == 0 {
                self.control();
                let e = &self.eff;
                self.shape_now = clamp01(e[p::SHAPE] + e[p::MOVE] * 0.35 * self.lfo_out);
                rk = 2.0 * (1.0 - 0.96 * e[p::RES]);
                mix2 = e[p::MIX2] * 0.8;
                mix1 = 1.0 - e[p::MIX2] * 0.45;
                air = e[p::AIR] * e[p::AIR] * 0.6;
                gain = e[p::LVL] * e[p::LVL] * 0.42;
                width = e[p::WIDTH];
            }
            self.ctl_n = (self.ctl_n + 1) % CTL;
            let shape = self.shape_now;
            let (mut l, mut r) = (0.0f32, 0.0f32);
            for (vi, v) in self.v.iter_mut().enumerate() {
                if !v.live {
                    continue;
                }
                let c = &self.vc[vi];
                let (mut a, mut b) = (0.0f32, 0.0f32);
                for j in 0..stack {
                    let o = v.osc[j].next(w1, c.dt[j], shape);
                    a += o * gl[j];
                    b += o * gr[j];
                }
                a *= mix1;
                b *= mix1;
                let o2 = v.osc2.next(w2, c.dt2, 0.0) * mix2;
                let nz = self.rng.bipolar() * air;
                let a = v.svf[0].tick(a + o2 + nz, c.g, rk).lp;
                let b = v.svf[1].tick(b + o2 + nz, c.g, rk).lp;
                let e = v.amp.next(&self.amp_c) * v.vel;
                v.filt.next(&self.filt_c);
                l += a * e;
                r += b * e;
                if !v.held && v.amp.is_idle() {
                    v.live = false;
                }
            }
            // ensemble chorus
            let ch = &mut self.ch;
            ch.wet += (wet_goal - ch.wet) * wet_k;
            let (mut ol, mut or) = (l, r);
            if ch.wet > 1e-4 {
                ch.lph = (ch.lph + crate_ / fs) % 1.0;
                let t = 4.0 * libm::fabsf(ch.lph - 0.5) - 1.0; // triangle -1..1
                ch.buf[0][ch.w] = l;
                ch.buf[1][ch.w] = r;
                let ms = fs * 0.001;
                let dl = (4.0 + cdepth * t) * ms;
                let dr = (4.0 - cdepth * t) * ms;
                let read = |buf: &[f32; CH], d: f32, w: usize| {
                    let pos = w as f32 + CH as f32 - d;
                    let i0 = pos as usize;
                    let fr = pos - i0 as f32;
                    let x0 = buf[i0 % CH];
                    let x1 = buf[(i0 + 1) % CH];
                    x0 + (x1 - x0) * fr
                };
                let yl = read(&ch.buf[0], dl, ch.w);
                let yr = read(&ch.buf[1], dr, ch.w);
                ch.lp[0] += (yl - ch.lp[0]) * clp;
                ch.lp[1] += (yr - ch.lp[1]) * clp;
                ch.lp[0] = flush(ch.lp[0]);
                ch.lp[1] = flush(ch.lp[1]);
                ch.w = (ch.w + 1) % CH;
                // dry + wet, each side's wet from the opposite-moving delay
                let wt = ch.wet * 0.75;
                ol = l * (1.0 - wt * 0.35) + ch.lp[0] * wt;
                or = r * (1.0 - wt * 0.35) + ch.lp[1] * wt;
            }
            let m = (ol + or) * 0.5;
            let sd = (ol - or) * 0.5 * width;
            left[i] = 0.98 * sat((m + sd) * gain);
            right[i] = 0.98 * sat((m - sd) * gain);
        }
    }
}

