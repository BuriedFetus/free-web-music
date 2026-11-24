//! Flint: drum machine with 8 pads.
//!
//! Each pad is one voice that can be any of 8 drum types (Kick, Snare, Clap, Closed hat, Open hat, Tom, Rim,
//! Perc) in one of 4 characters:
//!   Analog  – clean sine bodies, smooth decays
//!   Digital – square bodies, bit-crushed (harder, gritty)
//!   Noise   – mostly filtered noise, thin bodies
//!   Vintage – triangle bodies pushed into soft saturation, slightly longer, darker
//! Per pad: Tune (±12 st), Decay, Tone (brightness / noise balance), Level. Global: Accent amount, Level.
//!
//! Notes: pad i (0..8) = note 36 + i. Accented hits use note 48 + i (the sequencer adds 12), and play louder
//! and a little brighter by the Accent amount. Drums are one-shots: note-off is ignored. A Closed hat chokes
//! every ringing Open hat. Re-triggering a pad restarts it (with a 1 ms fade-in so it never clicks).

use crate::device::{Device, ModSource, RouteError};
use crate::dsp::rng::Rng;
use crate::dsp::svf::Svf;
use crate::dsp::{clamp01, exp2, expf, flush, sat, sinf, TAU};

pub const PADS: usize = 8;
pub const PER_PAD: usize = 6;
/// Parameter indices: pad i uses `i * PER_PAD + {TYPE, MODEL, TUNE, DECAY, TONE, LEVEL}`, then the globals.
pub mod p {
    pub const TYPE: usize = 0;
    pub const MODEL: usize = 1;
    pub const TUNE: usize = 2;
    pub const DECAY: usize = 3;
    pub const TONE: usize = 4;
    pub const LEVEL: usize = 5;
    pub const ACCENT: usize = 48;
    pub const LVL: usize = 49;
    pub const COUNT: usize = 50;
}
pub const FIRST_NOTE: u8 = 36;
pub const ACCENT_OFFSET: u8 = 12;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DrumType {
    Kick = 0,
    Snare = 1,
    Clap = 2,
    ClosedHat = 3,
    OpenHat = 4,
    Tom = 5,
    Rim = 6,
    Perc = 7,
}
impl DrumType {
    pub fn from_index(i: usize) -> DrumType {
        match i {
            1 => DrumType::Snare,
            2 => DrumType::Clap,
            3 => DrumType::ClosedHat,
            4 => DrumType::OpenHat,
            5 => DrumType::Tom,
            6 => DrumType::Rim,
            7 => DrumType::Perc,
            _ => DrumType::Kick,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Model {
    Analog = 0,
    Digital = 1,
    Noise = 2,
    Vintage = 3,
}
impl Model {
    pub fn from_index(i: usize) -> Model {
        match i {
            1 => Model::Digital,
            2 => Model::Noise,
            3 => Model::Vintage,
            _ => Model::Analog,
        }
    }
}

/// Ids in manifest order (a test checks `devices/flint.json` against this).
pub fn param_id(i: usize) -> ([u8; 12], usize) {
    let mut b = [0u8; 12];
    let s: &[u8] = if i < PADS * PER_PAD {
        let names: [&[u8]; PER_PAD] = [b"type", b"model", b"tune", b"decay", b"tone", b"level"];
        b[0] = b'p';
        b[1] = b'1' + (i / PER_PAD) as u8;
        b[2] = b'.';
        let n = names[i % PER_PAD];
        b[3..3 + n.len()].copy_from_slice(n);
        return (b, 3 + n.len());
    } else if i == p::ACCENT {
        b"accent"
    } else {
        b"lvl"
    };
    b[..s.len()].copy_from_slice(s);
    (b, s.len())
}

/// The "Basement" kit: one of each drum, Analog.
pub fn defaults() -> [f32; p::COUNT] {
    let mut d = [0.0; p::COUNT];
    for i in 0..PADS {
        let b = i * PER_PAD;
        d[b + p::TYPE] = i as f32;
        d[b + p::MODEL] = 0.0;
        d[b + p::TUNE] = if i == 5 { 0.45 } else { 0.5 };
        d[b + p::DECAY] = if i == 3 { 0.3 } else { 0.5 };
        d[b + p::TONE] = 0.5;
        d[b + p::LEVEL] = 0.8;
    }
    d[p::ACCENT] = 0.6;
    d[p::LVL] = 0.8;
    d
}

fn is_discrete(i: usize) -> bool {
    i < PADS * PER_PAD && matches!(i % PER_PAD, p::TYPE | p::MODEL)
}

/// Exponential decay coefficient for a time constant in seconds.
#[inline]
fn decay_coef(tau: f32, fs: f32) -> f32 {
    expf(-1.0 / (tau.max(0.0005) * fs))
}

/// Metallic ratios for hats and cymbal-like sounds (inharmonic square bank).
const METAL: [f32; 6] = [2.0, 3.0, 4.16, 5.43, 6.79, 8.21];

#[derive(Clone, Copy)]
struct Voice {
    on: bool,
    ty: DrumType,
    model: Model,
    gain: f32,
    // body oscillator
    ph: f32,
    f0: f32,
    sweep: f32, // extra pitch ratio at the start, decays with `pc`
    p_env: f32,
    pc: f32,
    body: f32,
    b_env: f32,
    bc: f32,
    // second body partial (snare, perc)
    ph2: f32,
    f2: f32,
    // noise / click
    n_env: f32,
    nc: f32,
    noise: f32,
    click: f32,
    c_env: f32,
    cc: f32,
    // metallic bank (hats)
    mph: [f32; 6],
    mf: f32,
    metal: f32,
    // clap bursts: samples since trigger
    t: u32,
    // filters
    svf: Svf,
    svf2: Svf,
    g: f32,
    k: f32,
    g2: f32,
    lp: f32,
    lpc: f32,
    // fade-in (anti-click) and choke
    fade: f32,
    /// Choke / stop: `chk` is a gain that falls by `chc` per sample once choked (chc = 1: not choked).
    chk: f32,
    chc: f32,
    hold: f32,
    hold_n: u32,
    hold_i: u32,
}

impl Voice {
    const fn new() -> Voice {
        Voice {
            on: false,
            ty: DrumType::Kick,
            model: Model::Analog,
            gain: 0.0,
            ph: 0.0,
            f0: 0.0,
            sweep: 0.0,
            p_env: 0.0,
            pc: 0.0,
            body: 0.0,
            b_env: 0.0,
            bc: 0.0,
            ph2: 0.0,
            f2: 0.0,
            n_env: 0.0,
            nc: 0.0,
            noise: 0.0,
            click: 0.0,
            c_env: 0.0,
            cc: 0.0,
            mph: [0.0; 6],
            mf: 0.0,
            metal: 0.0,
            t: 0,
            svf: Svf::new(),
            svf2: Svf::new(),
            g: 0.0,
            k: 2.0,
            g2: 0.0,
            lp: 0.0,
            lpc: 1.0,
            fade: 0.0,
            chk: 1.0,
            chc: 1.0,
            hold: 0.0,
            hold_n: 1,
            hold_i: 0,
        }
    }
}

pub struct Flint {
    fs: f32,
    params: [f32; p::COUNT],
    voices: [Voice; PADS],
    rng: Rng,
    lvl: f32,
}

impl Default for Flint {
    fn default() -> Self {
        Flint::new()
    }
}

impl Flint {
    pub fn new() -> Flint {
        Flint { fs: 48_000.0, params: defaults(), voices: [Voice::new(); PADS], rng: Rng::new(0x5EED_F11A), lvl: 0.8 }
    }

    fn pad(&self, i: usize, k: usize) -> f32 {
        self.params[i * PER_PAD + k]
    }

    /// Is any pad sounding? (for tests and future CPU savings)
    pub fn active(&self) -> bool {
        self.voices.iter().any(|v| v.on)
    }

    fn trigger(&mut self, pad: usize, vel: f32, accent: bool) {
        let fs = self.fs;
        let ty = DrumType::from_index(self.pad(pad, p::TYPE) as usize);
        let model = Model::from_index(self.pad(pad, p::MODEL) as usize);
        let tune = exp2((self.pad(pad, p::TUNE) - 0.5) * 2.0); // ±12 semitones
        let dk = 0.25 + 1.75 * self.pad(pad, p::DECAY) * self.pad(pad, p::DECAY); // 0.25×…2×
        let acc = if accent { self.params[p::ACCENT] } else { 0.0 };
        let tone = clamp01(self.pad(pad, p::TONE) + 0.25 * acc);
        let level = self.pad(pad, p::LEVEL);
        let long = if model == Model::Vintage { 1.2 } else { 1.0 };
        let noisy = model == Model::Noise;

        // A Closed hat chokes ringing Open hats.
        if ty == DrumType::ClosedHat {
            for v in self.voices.iter_mut() {
                if v.on && v.ty == DrumType::OpenHat {
                    v.chc = decay_coef(0.006, fs);
                }
            }
        }

        let mut v = Voice::new();
        v.on = true;
        v.ty = ty;
        v.model = model;
        let vel = clamp01(vel);
        v.gain = level * (0.25 + 0.75 * vel) * (1.0 + 0.8 * acc);
        v.lpc = if model == Model::Vintage { 1.0 - expf(-TAU * (3500.0 + 7000.0 * tone) / fs) } else { 1.0 };
        v.hold_n = if model == Model::Digital { 2 } else { 1 };
        // Re-triggering continues from the old phase so the restart has no step.
        v.ph = self.voices[pad].ph;
        let body_mul = if noisy { 0.4 } else { 1.0 };
        let noise_mul = if noisy { 2.2 } else { 1.0 };

        match ty {
            DrumType::Kick => {
                v.f0 = 48.0 * tune;
                v.sweep = if model == Model::Vintage { 5.0 } else { 3.5 };
                v.pc = decay_coef(if model == Model::Vintage { 0.03 } else { 0.018 }, fs);
                v.body = body_mul;
                v.bc = decay_coef(0.22 * dk * long, fs);
                v.click = 0.35 + 0.4 * tone;
                v.cc = decay_coef(0.0025, fs);
                v.noise = if noisy { 0.5 } else { 0.06 };
                v.nc = decay_coef(0.03 * dk, fs);
                v.g = Svf::g(600.0 + 4000.0 * tone, fs);
                v.k = 1.4;
            }
            DrumType::Snare => {
                v.f0 = 185.0 * tune;
                v.f2 = 330.0 * tune;
                v.sweep = 0.5;
                v.pc = decay_coef(0.012, fs);
                v.body = 0.55 * body_mul * (1.2 - tone * 0.6);
                v.bc = decay_coef(0.06 * dk * long, fs);
                v.noise = 0.55 * noise_mul * (0.6 + tone * 0.6);
                v.nc = decay_coef(0.11 * dk * long, fs);
                v.g = Svf::g(1500.0 + 4500.0 * tone, fs); // band-pass on the noise
                v.k = 1.2;
                v.g2 = Svf::g(900.0, fs); // high-pass below
            }
            DrumType::Clap => {
                v.noise = 0.8 * noise_mul.min(1.4);
                v.nc = decay_coef(0.12 * dk * long, fs);
                v.g = Svf::g(900.0 * tune + 900.0 * tone, fs);
                v.k = 0.9;
            }
            DrumType::ClosedHat | DrumType::OpenHat => {
                let open = ty == DrumType::OpenHat;
                v.mf = 40.0 * tune * (1.0 + 0.4 * tone);
                v.metal = if noisy { 0.0 } else { 0.45 };
                v.noise = if noisy { 0.9 } else { 0.25 };
                let tau = if open { 0.32 } else { 0.035 } * dk * long;
                v.bc = decay_coef(tau, fs); // used for the metal bank
                v.nc = decay_coef(tau, fs);
                v.g = Svf::g(6500.0 + 3500.0 * tone, fs); // high-pass
                v.k = 1.4;
                v.g2 = Svf::g(10_000.0 + 4000.0 * tone, fs); // band-pass shimmer
                // independent phases per hit, so hats don't sound identical
                for i in 0..6 {
                    v.mph[i] = ((self.rng.next_u32() >> 8) as f32) / 16_777_216.0;
                }
            }
            DrumType::Tom => {
                v.f0 = 105.0 * tune;
                v.sweep = 0.7;
                v.pc = decay_coef(0.06, fs);
                v.body = body_mul;
                v.bc = decay_coef(0.18 * dk * long, fs);
                v.noise = if noisy { 0.45 } else { 0.08 };
                v.nc = decay_coef(0.03 * dk, fs);
                v.g = Svf::g(1200.0 + 2000.0 * tone, fs);
                v.k = 1.4;
                v.click = 0.2 * tone;
                v.cc = decay_coef(0.002, fs);
            }
            DrumType::Rim => {
                v.f0 = 420.0 * tune;
                v.f2 = 1600.0 * tune;
                v.sweep = 0.3;
                v.pc = decay_coef(0.004, fs);
                v.body = 0.7 * body_mul;
                v.bc = decay_coef(0.018 * dk * long, fs);
                v.noise = 0.35 * noise_mul;
                v.nc = decay_coef(0.012 * dk, fs);
                v.g = Svf::g(2500.0 + 2500.0 * tone, fs);
                v.k = 0.5;
            }
            DrumType::Perc => {
                v.f0 = 540.0 * tune;
                v.f2 = 800.0 * tune;
                v.body = 0.4 * body_mul;
                v.bc = decay_coef(0.09 * dk * long, fs);
                v.noise = if noisy { 0.7 } else { 0.0 };
                v.nc = decay_coef(0.08 * dk, fs);
                v.g = Svf::g(1800.0 * tune + 1200.0 * tone, fs); // band-pass over the partials
                v.k = 0.7;
            }
        }
        v.p_env = 1.0;
        v.b_env = 1.0;
        v.n_env = 1.0;
        v.c_env = 1.0;
        v.fade = 0.0;
        self.voices[pad] = v;
    }

    #[inline]
    fn body_wave(model: Model, ph: f32) -> f32 {
        match model {
            Model::Digital => {
                if ph < 0.5 {
                    0.8
                } else {
                    -0.8
                }
            }
            Model::Vintage => 4.0 * (ph - 0.5).abs() - 1.0,
            _ => sinf(TAU * ph),
        }
    }

    #[inline]
    fn tick(v: &mut Voice, rng: &mut Rng, fs: f32) -> f32 {
        let n = rng.bipolar();
        let inv = 1.0 / fs;
        let out;
        let model = v.model;
        match v.ty {
            DrumType::Kick | DrumType::Tom => {
                let f = v.f0 * (1.0 + v.sweep * v.p_env);
                v.ph += f * inv;
                v.ph -= libm::floorf(v.ph);
                let mut b = Self::body_wave(model, v.ph) * v.body * v.b_env;
                if model == Model::Digital {
                    b = v.svf2.tick(b, Svf::g(700.0, fs), 1.6).lp * 1.6; // tame the square, keep the thump
                }
                let nz = v.svf.tick(n, v.g, v.k).lp * v.noise * v.n_env;
                let click = n * v.click * v.c_env;
                out = b + nz + click * 0.5;
            }
            DrumType::Snare | DrumType::Rim => {
                let f = v.f0 * (1.0 + v.sweep * v.p_env);
                v.ph += f * inv;
                v.ph -= libm::floorf(v.ph);
                v.ph2 += v.f2 * (1.0 + v.sweep * v.p_env) * inv;
                v.ph2 -= libm::floorf(v.ph2);
                let b = (Self::body_wave(model, v.ph) + 0.6 * Self::body_wave(model, v.ph2)) * 0.6 * v.body * v.b_env;
                let bp = v.svf.tick(n, v.g, v.k).bp;
                let nz = if v.ty == DrumType::Snare { v.svf2.tick(bp + n * 0.3, v.g2, 1.4).hp } else { bp };
                out = b + nz * v.noise * v.n_env;
            }
            DrumType::Clap => {
                // three quick bursts, then the tail
                let ms = v.t as f32 * 1000.0 * inv;
                let burst = if ms < 30.0 {
                    let phase = ms % 10.0;
                    expf(-phase / 2.2)
                } else {
                    0.0
                };
                let env = if ms < 30.0 { burst } else { v.n_env };
                out = v.svf.tick(n, v.g, v.k).bp * v.noise * env * 2.0;
            }
            DrumType::ClosedHat | DrumType::OpenHat => {
                let mut m = 0.0;
                if v.metal > 0.0 {
                    for (i, r) in METAL.iter().enumerate() {
                        v.mph[i] += v.mf * r * inv;
                        v.mph[i] -= libm::floorf(v.mph[i]);
                        m += if v.mph[i] < 0.5 { 1.0 } else { -1.0 };
                    }
                    m *= v.metal / 6.0;
                }
                let x = m * v.b_env + n * v.noise * v.n_env;
                let hp = v.svf.tick(x, v.g, v.k).hp;
                let shimmer = v.svf2.tick(hp, v.g2, 1.0).bp;
                // metallic hats sit lower than noise ones: bring them up to the same loudness
                out = (hp * 0.7 + shimmer * 0.6) * if v.metal > 0.0 { 2.2 } else { 1.0 };
            }
            DrumType::Perc => {
                v.ph += v.f0 * inv;
                v.ph -= libm::floorf(v.ph);
                v.ph2 += v.f2 * inv;
                v.ph2 -= libm::floorf(v.ph2);
                let sq = |ph: f32| if ph < 0.5 { 1.0 } else { -1.0 };
                let raw = match model {
                    Model::Analog | Model::Digital => sq(v.ph) + sq(v.ph2),
                    _ => Self::body_wave(model, v.ph) + Self::body_wave(model, v.ph2),
                };
                let tone = raw * v.body + n * v.noise * v.n_env / v.b_env.max(1e-3) * 0.5;
                out = v.svf.tick(tone, v.g, v.k).bp * 1.4 * v.b_env;
            }
        }
        // envelopes
        v.p_env = flush(v.p_env * v.pc);
        v.b_env = flush(v.b_env * v.bc);
        v.n_env = flush(v.n_env * v.nc);
        v.c_env = flush(v.c_env * v.cc);
        v.chk = flush(v.chk * v.chc);
        v.t = v.t.saturating_add(1);
        out * v.chk
    }

    fn render_voice(v: &mut Voice, rng: &mut Rng, fs: f32, lvl: f32, l: &mut [f32]) {
        let fade_inc = 1.0 / (0.001 * fs);
        for o in l.iter_mut() {
            let mut x = Self::tick(v, rng, fs);
            // character
            match v.model {
                Model::Digital => {
                    x = libm::roundf(x * 12.0) / 12.0; // ~5-bit crush
                    // sample-and-hold at half rate: grit
                    if v.hold_i == 0 {
                        v.hold = x;
                    }
                    v.hold_i = (v.hold_i + 1) % v.hold_n;
                    x = v.hold;
                }
                Model::Vintage => {
                    x = sat(x * 1.8) * 0.75;
                    v.lp += (x - v.lp) * v.lpc;
                    v.lp = flush(v.lp);
                    x = v.lp;
                }
                _ => {}
            }
            if v.fade < 1.0 {
                v.fade = (v.fade + fade_inc).min(1.0);
            }
            *o += x * v.gain * v.fade * lvl;
        }
        // Silent? Envelopes are exponential: stop once the loudest one is inaudible.
        let loud = v.b_env.max(v.n_env).max(v.c_env) * v.chk;
        let tail = if v.ty == DrumType::Clap { v.t < (0.03 * fs) as u32 } else { false };
        if loud < 1e-4 && !tail {
            v.on = false;
            v.svf.reset();
            v.svf2.reset();
            v.lp = 0.0;
        }
    }
}

impl Device for Flint {
    fn prepare(&mut self, sample_rate: f32) {
        self.fs = sample_rate;
        self.voices = [Voice::new(); PADS];
    }
    fn param_count(&self) -> usize {
        p::COUNT
    }
    fn set_param(&mut self, index: usize, value: f32) {
        if index >= p::COUNT {
            return;
        }
        let v = if is_discrete(index) {
            let max = if index % PER_PAD == p::TYPE { 7.0 } else { 3.0 };
            libm::roundf(value).clamp(0.0, max)
        } else {
            clamp01(value)
        };
        self.params[index] = v;
        if index == p::LVL {
            self.lvl = v;
        }
    }
    fn param(&self, index: usize) -> f32 {
        self.params.get(index).copied().unwrap_or(0.0)
    }
    fn effective(&self) -> &[f32] {
        &self.params
    }
    fn set_route(&mut self, _slot: usize, _src: ModSource, _target: usize, _depth: f32) -> Result<(), RouteError> {
        Err(RouteError::NotAllowed)
    }
    fn clear_route(&mut self, _slot: usize) {}
    fn mod_source_value(&self, _src: ModSource) -> f32 {
        0.0
    }
    fn note_on(&mut self, note: u8, velocity: f32) {
        let (pad, accent) = if (FIRST_NOTE + ACCENT_OFFSET..FIRST_NOTE + ACCENT_OFFSET + PADS as u8).contains(&note) {
            ((note - FIRST_NOTE - ACCENT_OFFSET) as usize, true)
        } else if (FIRST_NOTE..FIRST_NOTE + PADS as u8).contains(&note) {
            ((note - FIRST_NOTE) as usize, false)
        } else {
            return;
        };
        if velocity > 0.0 {
            self.trigger(pad, velocity, accent);
        }
    }
    fn note_off(&mut self, _note: u8) {}
    fn all_notes_off(&mut self) {
        let c = decay_coef(0.004, self.fs);
        for v in self.voices.iter_mut().filter(|v| v.on) {
            v.chc = c;
        }
    }
    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        left.fill(0.0);
        let (fs, lvl) = (self.fs, self.lvl * 0.9);
        for v in self.voices.iter_mut() {
            if v.on {
                Self::render_voice(v, &mut self.rng, fs, lvl, left);
            }
        }
        for (r, l) in right.iter_mut().zip(left.iter_mut()) {
            *l = sat(*l * 0.9) / 0.9 * 0.9; // gentle bus limiter against stacked hits
            *r = *l;
        }
    }
}
