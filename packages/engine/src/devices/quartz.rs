//! Quartz: FM keys. Eight voices, each with two rows; a row is a carrier whose phase is pushed by its
//! own modulator (phase modulation, the classic way to make electric pianos, bells and glassy keys):
//!   Harmonics = the modulator's frequency as a multiple of the note (½ … 14: 14 is the bright "tine"),
//!   Depth = how hard it pushes (brightness), Env = how fast that push dies away after the key is hit
//!   (the bark of a struck key), Wave = what the carrier's sine is bent into (Sine, Warm, Hollow,
//!   Pulse), Pitch = the row's interval, Level.
//! Then a low-pass filter (Cutoff, Reso) and the amp envelope; Touch = how much harder playing brightens;
//! Tremolo (the sound swings left and right, like a stage piano's), Drive, Level.

use crate::device::{Device, ModSource, RouteError, MAX_ROUTES};
use crate::dsp::env::{Adsr, AdsrCoefs, AdsrTimes};
use crate::dsp::svf::Svf;
use crate::dsp::rng::Rng;
use crate::dsp::{clamp01, exp2, expf, flush, note_hz, one_pole_coef, sat, sinf, TAU};

pub const VOICES: usize = 8;
pub const PITCHES: [f32; 6] = [-12.0, 0.0, 7.0, 12.0, 19.0, 24.0];
pub const RATIOS: [f32; 9] = [0.5, 1.0, 2.0, 3.0, 4.0, 5.0, 7.0, 9.0, 14.0];
const CTL: usize = 16;

pub mod p {
    pub const W1: usize = 0;
    pub const PITCH1: usize = 1;
    pub const HARM1: usize = 2;
    pub const DEPTH1: usize = 3;
    pub const ENV1: usize = 4;
    pub const LVL1: usize = 5;
    pub const W2: usize = 6;
    pub const PITCH2: usize = 7;
    pub const HARM2: usize = 8;
    pub const DEPTH2: usize = 9;
    pub const ENV2: usize = 10;
    pub const LVL2: usize = 11;
    pub const CUT: usize = 12;
    pub const RES: usize = 13;
    pub const TOUCH: usize = 14;
    pub const ATK: usize = 15;
    pub const DEC: usize = 16;
    pub const SUS: usize = 17;
    pub const REL: usize = 18;
    pub const TREM: usize = 19;
    pub const TRATE: usize = 20;
    pub const DRIVE: usize = 21;
    pub const LVL: usize = 22;
    pub const LRATE: usize = 23;
    pub const LWAVE: usize = 24;
    pub const COUNT: usize = 25;
}

/// Parameter ids, in index order (they match `devices/quartz.json`).
pub const IDS: [&str; p::COUNT] = [
    "w1", "pitch1", "harm1", "depth1", "env1", "lvl1", "w2", "pitch2", "harm2", "depth2", "env2", "lvl2", "cut", "res", "touch", "atk", "dec",
    "sus", "rel", "trem", "trate", "drive", "lvl", "lrate", "lwave",
];

/// "Tine Keys".
pub fn defaults() -> [f32; p::COUNT] {
    [0.0, 1.0, 1.0, 0.35, 0.35, 0.85, 0.0, 1.0, 8.0, 0.3, 0.15, 0.35, 0.85, 0.1, 0.6, 0.0, 0.55, 0.2, 0.3, 0.3, 0.4, 0.15, 0.7, 0.3, 0.0]
}

fn discrete_max(i: usize) -> Option<f32> {
    match i {
        p::W1 | p::W2 | p::LWAVE => Some(3.0),
        p::PITCH1 | p::PITCH2 => Some(5.0),
        p::HARM1 | p::HARM2 => Some(8.0),
        _ => None,
    }
}

// Normalised → physical. Must match the "map" entries in quartz.json.
#[inline]
fn exp_map(v: f32, lo: f32, hi: f32) -> f32 {
    lo * exp2(v * libm::log2f(hi / lo))
}
#[inline]
fn sq_map(v: f32, lo: f32, hi: f32) -> f32 {
    lo + v * v * (hi - lo)
}
/// Modulation index at full Depth.
const MAX_INDEX: f32 = 8.0;

#[inline]
fn bend(s: f32, w: u32) -> f32 {
    match w {
        1 => sat(s * 2.2) * 1.05,         // Warm: rounded, odd harmonics
        2 => s * libm::fabsf(s) * 1.3,    // Hollow
        3 => sat(s * 7.0),                // Pulse: nearly square
        _ => s,                           // Sine
    }
}

/// A source may not modulate its own controls (no feedback loops).
fn route_allowed(src: ModSource, target: usize) -> bool {
    if target >= p::COUNT || discrete_max(target).is_some() {
        return false;
    }
    match src {
        ModSource::Lfo => target != p::LRATE,
        ModSource::AmpEnv => !(p::ATK..=p::REL).contains(&target),
        ModSource::FiltEnv => target != p::ENV1,
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
    pc: [f32; 2],
    pm: [f32; 2],
    menv: [f32; 2],
    svf: Svf,
    amp: Adsr,
}

impl Voice {
    const fn new() -> Voice {
        Voice { note: 0, vel: 0.0, held: false, live: false, age: 0, pc: [0.0; 2], pm: [0.0; 2], menv: [0.0; 2], svf: Svf::new(), amp: Adsr::new() }
    }
}

#[derive(Clone, Copy, Default)]
struct VCtl {
    dc: [f32; 2],
    dm: [f32; 2],
    idx: [f32; 2],
    g: f32,
}

pub struct Quartz {
    fs: f32,
    params: [f32; p::COUNT],
    sm: [f32; p::COUNT],
    /// Values after modulation (what the sound uses, and what the knobs' arcs show).
    eff: [f32; p::COUNT],
    routes: [Option<Route>; MAX_ROUTES],
    /// The voice played last: its envelopes are the Amp env / Bark env sources.
    last: usize,
    lfo: f32,
    lfo_out: f32,
    lfo_hold: f32,
    rng: Rng,
    primed: bool,
    v: [Voice; VOICES],
    vc: [VCtl; VOICES],
    clock: u32,
    ctl_n: usize,
    amp_c: AdsrCoefs,
    mdec: [f32; 2],
    trem: f32,
}

impl Default for Quartz {
    fn default() -> Self {
        Self::new()
    }
}

impl Quartz {
    pub fn new() -> Quartz {
        let d = defaults();
        Quartz {
            fs: 48_000.0,
            params: d,
            sm: d,
            eff: d,
            routes: [None; MAX_ROUTES],
            last: 0,
            lfo: 0.0,
            lfo_out: 0.0,
            lfo_hold: 0.0,
            rng: Rng::new(0x0A27),
            primed: false,
            v: [Voice::new(); VOICES],
            vc: [VCtl::default(); VOICES],
            clock: 0,
            ctl_n: 0,
            amp_c: AdsrCoefs::new(&AdsrTimes { a: 0.01, d: 0.1, s: 1.0, r: 0.1 }, 48_000.0),
            mdec: [0.999; 2],
            trem: 0.0,
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

    /// Amp env and Bark env (row 1's push) of the voice played last.
    fn env_levels(&self) -> (f32, f32) {
        let v = &self.v[self.last];
        if v.live { (v.amp.level, v.menv[0]) } else { (0.0, 0.0) }
    }

    fn control(&mut self) {
        let fs = self.fs;
        // mod LFO: Sine, Triangle, Square or Random (a new value each cycle)
        let ph = (self.lfo + exp_map(self.eff[p::LRATE], 0.05, 8.0) * CTL as f32 / fs) % 1.0;
        let wrapped = ph < self.lfo;
        self.lfo = ph;
        self.lfo_out = match self.params[p::LWAVE] as u32 {
            1 => 1.0 - 4.0 * libm::fabsf(ph - 0.5),
            2 => if ph < 0.5 { 1.0 } else { -1.0 },
            3 => {
                if wrapped {
                    self.lfo_hold = self.rng.bipolar();
                }
                self.lfo_hold
            }
            _ => sinf(ph * TAU),
        };
        let (amp_l, bark_l) = self.env_levels();
        self.eff = self.sm;
        for r in self.routes.iter().flatten() {
            let src = match r.src {
                ModSource::Lfo => self.lfo_out,
                ModSource::AmpEnv => amp_l,
                ModSource::FiltEnv => bark_l,
            };
            self.eff[r.target] += r.depth * src;
        }
        for i in 0..p::COUNT {
            if discrete_max(i).is_none() {
                self.eff[i] = clamp01(self.eff[i]);
            }
        }
        let s = self.eff;
        self.amp_c = AdsrCoefs::new(
            &AdsrTimes { a: sq_map(s[p::ATK], 0.001, 4.0), d: sq_map(s[p::DEC], 0.05, 10.0), s: s[p::SUS], r: sq_map(s[p::REL], 0.02, 6.0) },
            fs,
        );
        for (r, e) in [(0, p::ENV1), (1, p::ENV2)] {
            self.mdec[r] = expf(-1.0 / (sq_map(s[e], 0.02, 4.0) * fs));
        }
        let base = exp_map(s[p::CUT], 60.0, 18000.0);
        let k = s[p::TOUCH];
        for (vi, v) in self.v.iter_mut().enumerate() {
            if !v.live {
                continue;
            }
            let c = &mut self.vc[vi];
            let note = v.note as f32;
            let touch = 1.0 - k + k * v.vel * 1.4;
            for (r, (pi, hi, di)) in [(p::PITCH1, p::HARM1, p::DEPTH1), (p::PITCH2, p::HARM2, p::DEPTH2)].into_iter().enumerate() {
                let hz = note_hz(note + PITCHES[self.params[pi] as usize] + r as f32 * 0.03);
                c.dc[r] = (hz / fs).min(0.45);
                c.dm[r] = (hz * RATIOS[self.params[hi] as usize] / fs).min(0.45);
                // high notes get a gentler push (FM gets harsh fast up the keyboard)
                let up = exp2(-((note - 60.0).max(0.0)) / 24.0);
                c.idx[r] = s[di] * s[di] * MAX_INDEX * touch * up;
            }
            // the filter opens a little with touch
            let fc = base * exp2(k * (v.vel - 0.6) * 1.5);
            c.g = Svf::g(fc.clamp(20.0, fs * 0.45), fs);
        }
    }
}

impl Device for Quartz {
    fn prepare(&mut self, sample_rate: f32) {
        self.fs = sample_rate;
        for v in self.v.iter_mut() {
            *v = Voice::new();
        }
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
        let (a, b) = self.env_levels();
        match src {
            ModSource::Lfo => self.lfo_out,
            ModSource::AmpEnv => a,
            ModSource::FiltEnv => b,
        }
    }
    fn note_on(&mut self, note: u8, velocity: f32) {
        if velocity <= 0.0 {
            self.note_off(note);
            return;
        }
        let i = self.choose(note);
        self.clock = self.clock.wrapping_add(1);
        let v = &mut self.v[i];
        if !v.live {
            *v = Voice::new();
        }
        // a struck key: every strike starts the carriers and modulators together (the same attack each time)
        v.pc = [0.0; 2];
        v.pm = [0.0; 2];
        v.menv = [1.0; 2];
        v.note = note;
        v.vel = velocity.min(1.0);
        v.held = true;
        v.live = true;
        v.age = self.clock;
        v.amp.gate_on();
        self.last = i;
        self.ctl_n = 0;
    }
    fn note_off(&mut self, note: u8) {
        for v in self.v.iter_mut().filter(|v| v.held && v.note == note) {
            v.held = false;
            v.amp.gate_off();
        }
    }
    fn all_notes_off(&mut self) {
        for v in self.v.iter_mut().filter(|v| v.live) {
            v.held = false;
            v.amp.gate_off();
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
        let w = [self.params[p::W1] as u32, self.params[p::W2] as u32];
        let (mut lv, mut rk, mut drive, mut gain, mut trate, mut tdepth) = ([0.0f32; 2], 2.0f32, 1.0f32, 0.0f32, 0.0f32, 0.0f32);
        // the per-period values below are worked out at the first sample of every block
        self.ctl_n = 0;
        for i in 0..n {
            if self.ctl_n == 0 {
                self.control();
                let s = &self.eff;
                lv = [s[p::LVL1] * s[p::LVL1], s[p::LVL2] * s[p::LVL2]];
                rk = 2.0 * (1.0 - 0.95 * s[p::RES]);
                drive = 1.0 + s[p::DRIVE] * s[p::DRIVE] * 6.0;
                // level-matched: more Drive, more grit, about the same loudness
                gain = s[p::LVL] * s[p::LVL] * 0.5 / libm::sqrtf(drive);
                trate = exp_map(s[p::TRATE], 0.5, 9.0) / fs;
                tdepth = s[p::TREM] * 0.9;
            }
            self.ctl_n = (self.ctl_n + 1) % CTL;
            let mut out = 0.0f32;
            for (vi, v) in self.v.iter_mut().enumerate() {
                if !v.live {
                    continue;
                }
                let c = &self.vc[vi];
                let mut x = 0.0;
                for r in 0..2 {
                    if lv[r] <= 0.0 {
                        continue;
                    }
                    let idx = c.idx[r] * (0.2 + 0.8 * v.menv[r]);
                    let m = sinf(v.pm[r] * TAU) * idx;
                    x += bend(sinf(v.pc[r] * TAU + m), w[r]) * lv[r];
                    v.pc[r] += c.dc[r];
                    if v.pc[r] >= 1.0 {
                        v.pc[r] -= 1.0;
                    }
                    v.pm[r] += c.dm[r];
                    if v.pm[r] >= 1.0 {
                        v.pm[r] -= 1.0;
                    }
                    v.menv[r] = flush(v.menv[r] * self.mdec[r]);
                }
                let y = v.svf.tick(x, c.g, rk).lp;
                out += y * v.amp.next(&self.amp_c) * (0.3 + 0.7 * v.vel);
                if !v.held && v.amp.is_idle() {
                    v.live = false;
                }
            }
            let y = sat(out * drive * 0.5) * 2.0;
            // tremolo: the sound swings between the speakers
            self.trem = (self.trem + trate) % 1.0;
            let pan = sinf(self.trem * TAU) * tdepth;
            let a = (pan + 1.0) * core::f32::consts::FRAC_PI_4;
            left[i] = 0.98 * sat(y * gain * libm::cosf(a) * 1.414);
            right[i] = 0.98 * sat(y * gain * libm::sinf(a) * 1.414);
        }
    }
}
