//! Basalt: mono bass synth.
//!
//! Signal path (oscillators, drive and filter run at 2× the output rate, then a half-band decimator):
//!   Osc (Saw/Square/Triangle/Sine + Shape) + Sub (square, -1 oct)
//!     → Drive (soft saturation) → TPT state-variable low-pass (Cutoff, Reso)
//!     → × Amp envelope × velocity × Level
//! Modulation: LFO 1, Amp env and Filter env → any continuous parameter (see `basalt.json`).
//! Mono, last-note priority. Legato notes glide (if Glide > 0) and do not restart the envelopes.

use crate::device::{Device, ModSource, RouteError, MAX_ROUTES};
use crate::dsp::env::{Adsr, AdsrCoefs, AdsrTimes};
use crate::dsp::halfband::Decimator;
use crate::dsp::lfo::{Lfo, LfoMode, LfoWave};
use crate::dsp::osc::{Osc, Sub, Wave};
use crate::dsp::rng::Rng;
use crate::dsp::smooth::{smoothing_coef, Smoother};
use crate::dsp::svf::Svf;
use crate::dsp::{clamp01, exp2, one_pole_coef, sat};

/// Parameter indices, in the same order as `devices/basalt.json` (a test checks this).
pub mod p {
    pub const WAVE: usize = 0;
    pub const TUNE: usize = 1;
    pub const SHAPE: usize = 2;
    pub const SUB: usize = 3;
    pub const CUT: usize = 4;
    pub const RES: usize = 5;
    pub const ENVAMT: usize = 6;
    pub const DRIVE: usize = 7;
    pub const GLIDE: usize = 8;
    pub const LVL: usize = 9;
    pub const AMP_A: usize = 10;
    pub const AMP_D: usize = 11;
    pub const AMP_S: usize = 12;
    pub const AMP_R: usize = 13;
    pub const FILT_A: usize = 14;
    pub const FILT_D: usize = 15;
    pub const FILT_S: usize = 16;
    pub const FILT_R: usize = 17;
    pub const LWAVE: usize = 18;
    pub const LMODE: usize = 19;
    pub const LRATE: usize = 20;
    pub const LAMT: usize = 21;
    pub const COUNT: usize = 22;
}

pub const PARAM_IDS: [&str; p::COUNT] = [
    "wave", "tune", "shape", "sub", "cut", "res", "envamt", "drive", "glide", "lvl", "amp.A",
    "amp.D", "amp.S", "amp.R", "filt.A", "filt.D", "filt.S", "filt.R", "lwave", "lmode", "lrate",
    "lamt",
];

pub const DEFAULTS: [f32; p::COUNT] = [
    0.0, 0.5, 0.3, 0.6, 0.42, 0.55, 0.7, 0.25, 0.2, 0.8, 0.05, 0.35, 0.55, 0.3, 0.02, 0.3, 0.2,
    0.25, 0.0, 0.0, 0.45, 0.6,
];

/// Enum parameters: set instantly, never smoothed or modulated.
fn is_discrete(i: usize) -> bool {
    matches!(i, p::WAVE | p::LWAVE | p::LMODE)
}

/// A source may not modulate its own controls (no feedback loops).
fn route_allowed(src: ModSource, target: usize) -> bool {
    if target >= p::COUNT || is_discrete(target) {
        return false;
    }
    match src {
        ModSource::Lfo => !matches!(target, p::LRATE | p::LAMT),
        ModSource::AmpEnv => !(p::AMP_A..=p::AMP_R).contains(&target),
        ModSource::FiltEnv => !(p::FILT_A..=p::FILT_R).contains(&target),
    }
}

#[derive(Clone, Copy)]
struct Route {
    src: ModSource,
    target: usize,
    depth: f32,
}

const MAX_HELD: usize = 16;

// Normalised value → physical value. Must match the "map" entries in basalt.json.
#[inline]
fn exp_map(v: f32, lo: f32, hi: f32) -> f32 {
    lo * exp2(v * libm::log2f(hi / lo))
}

/// Control-rate period: envelope times, glide and LFO rate are recomputed every 16 samples (3 kHz).
/// Levels, pitch and cutoff still move every sample.
const CTL: u32 = 16;

#[derive(Clone, Copy)]
struct Ctl {
    amp: AdsrCoefs,
    filt: AdsrCoefs,
    glide: f32,
    lfo_inc: f32,
}

pub struct Basalt {
    fs: f32,
    smooth_coef: f32,
    params: [Smoother; p::COUNT],
    /// Effective (modulated) values from the latest sample, for the UI.
    eff: [f32; p::COUNT],
    routes: [Option<Route>; MAX_ROUTES],

    held: [(u8, f32); MAX_HELD],
    n_held: usize,
    pitch: f32,
    pitch_target: f32,
    vel: Smoother,

    osc: Osc,
    sub: Sub,
    svf: Svf,
    dec: Decimator,
    amp: Adsr,
    filt: Adsr,
    lfo: Lfo,
    lfo_out: f32,
    rng: Rng,
    quiet: usize,
    ctl: Ctl,
    ctl_count: u32,
}

impl Basalt {
    pub fn new() -> Basalt {
        let mut params = [Smoother::new(0.0); p::COUNT];
        for (s, d) in params.iter_mut().zip(DEFAULTS.iter()) {
            s.snap(*d);
        }
        let mut b = Basalt {
            fs: 48_000.0,
            smooth_coef: 1.0,
            params,
            eff: DEFAULTS,
            routes: [None; MAX_ROUTES],
            held: [(0, 0.0); MAX_HELD],
            n_held: 0,
            pitch: 36.0,
            pitch_target: 36.0,
            vel: Smoother::new(1.0),
            osc: Osc::new(),
            sub: Sub::new(),
            svf: Svf::new(),
            dec: Decimator::new(),
            amp: Adsr::new(),
            filt: Adsr::new(),
            lfo: Lfo::new(),
            lfo_out: 0.0,
            rng: Rng::new(0x5EED_BA5A),
            quiet: usize::MAX,
            ctl: Ctl {
                amp: AdsrCoefs { a: 1.0, d: 1.0, s: 0.0, r: 1.0 },
                filt: AdsrCoefs { a: 1.0, d: 1.0, s: 0.0, r: 1.0 },
                glide: 1.0,
                lfo_inc: 0.0,
            },
            ctl_count: 0,
        };
        b.prepare(48_000.0);
        // Default route, as in the design kit: LFO 1 → Cutoff.
        let _ = b.set_route(0, ModSource::Lfo, p::CUT, 0.45);
        b
    }

    fn top_note(&self) -> Option<(u8, f32)> {
        if self.n_held == 0 {
            None
        } else {
            Some(self.held[self.n_held - 1])
        }
    }

    fn remove_held(&mut self, note: u8) {
        let mut j = 0;
        for i in 0..self.n_held {
            if self.held[i].0 != note {
                self.held[j] = self.held[i];
                j += 1;
            }
        }
        self.n_held = j;
    }

    fn lfo_mode(&self) -> LfoMode {
        LfoMode::from_index(self.params[p::LMODE].value as u32)
    }

    fn update_ctl(&mut self, eff: &[f32; p::COUNT]) {
        let fs = self.fs;
        let times = |a: usize| AdsrTimes {
            a: exp_map(eff[a], 0.0005, 5.0),
            d: exp_map(eff[a + 1], 0.005, 10.0),
            s: eff[a + 2],
            r: exp_map(eff[a + 3], 0.005, 10.0),
        };
        self.ctl.amp = AdsrCoefs::new(&times(p::AMP_A), fs);
        self.ctl.filt = AdsrCoefs::new(&times(p::FILT_A), fs);
        let g = eff[p::GLIDE];
        self.ctl.glide = if g <= 0.0 { 1.0 } else { one_pole_coef(exp_map(g, 0.003, 3.0) / 3.0, fs) };
        self.ctl.lfo_inc = exp_map(eff[p::LRATE], 0.1, 20.0) / fs;
    }

    /// Renders one output sample.
    #[inline]
    fn tick(&mut self) -> f32 {
        let fs = self.fs;
        // 1. Smoothed base values.
        let mut base = [0.0f32; p::COUNT];
        for (i, s) in self.params.iter_mut().enumerate() {
            base[i] = if is_discrete(i) { s.target } else { s.next(self.smooth_coef) };
        }
        // 2. Modulation (sources from the previous sample, so there is no evaluation-order loop).
        let lfo_src = self.lfo_out * self.eff[p::LAMT];
        let src_val = |s: ModSource| match s {
            ModSource::Lfo => lfo_src,
            ModSource::AmpEnv => self.amp.level,
            ModSource::FiltEnv => self.filt.level,
        };
        let mut eff = base;
        for r in self.routes.iter().flatten() {
            eff[r.target] += r.depth * src_val(r.src);
        }
        for (i, e) in eff.iter_mut().enumerate() {
            if !is_discrete(i) {
                *e = clamp01(*e);
            }
        }
        self.eff = eff;

        // 3. Control rate: coefficients that need exp().
        if self.ctl_count == 0 {
            self.update_ctl(&eff);
        }
        self.ctl_count = (self.ctl_count + 1) % CTL;
        self.ctl.amp.s = eff[p::AMP_S];
        self.ctl.filt.s = eff[p::FILT_S];

        // 4. Envelopes, LFO, pitch with glide.
        let amp = self.amp.next(&self.ctl.amp);
        let fenv = self.filt.next(&self.ctl.filt);
        let lwave = LfoWave::from_index(eff[p::LWAVE] as u32);
        self.lfo_out = self.lfo.next(lwave, self.ctl.lfo_inc, &mut self.rng);
        self.pitch += (self.pitch_target - self.pitch) * self.ctl.glide;
        let note = self.pitch + (eff[p::TUNE] - 0.5) * 24.0;
        let os = 2.0 * fs;
        let dt = (440.0 * exp2((note - 69.0) / 12.0) / os).min(0.45);

        // 5. Filter: cutoff from knob + filter envelope + 50% key tracking (from C2).
        let c = eff[p::CUT] + eff[p::ENVAMT] * fenv * 0.8 + 0.5 * (self.pitch - 36.0) / 120.0;
        let fc = 20.0 * exp2(10.0 * c.clamp(0.0, 1.15));
        let gk = Svf::g(fc, os);
        let k = 2.0 * (1.0 - 0.985 * eff[p::RES]);
        let drive = 1.0 + 7.0 * eff[p::DRIVE] * eff[p::DRIVE];
        let makeup = 1.0 / (1.0 + 0.8 * eff[p::DRIVE]);
        let drive_mix = (eff[p::DRIVE] * 4.0).min(1.0);
        let wave = Wave::from_index(eff[p::WAVE] as u32);
        let shape = eff[p::SHAPE];
        let sub = eff[p::SUB];
        let mix_norm = 1.0 / (1.0 + 0.6 * sub);

        // 6. Two oversampled steps, then decimate.
        let mut two = [0.0f32; 2];
        for y in two.iter_mut() {
            let o = self.osc.next(wave, dt, shape);
            let s = self.sub.next(dt);
            let x = (o + 0.9 * sub * s) * mix_norm;
            // Drive: clean at 0, fully saturating from a quarter of the knob up.
            let x = x + (sat(x * drive * 0.8) * 1.25 * makeup - x) * drive_mix;
            *y = self.svf.tick(x, gk, k).lp;
        }
        let y = self.dec.process(two[0], two[1]);

        // 7. Amp.
        let lvl = eff[p::LVL];
        y * amp * self.vel.next(self.smooth_coef) * lvl * lvl * 0.5
    }
}

impl Default for Basalt {
    fn default() -> Self {
        Self::new()
    }
}

impl Device for Basalt {
    fn prepare(&mut self, sample_rate: f32) {
        self.fs = sample_rate;
        self.smooth_coef = smoothing_coef(sample_rate);
        self.lfo.prepare(sample_rate);
    }

    fn param_count(&self) -> usize {
        p::COUNT
    }

    fn set_param(&mut self, index: usize, value: f32) {
        if index >= p::COUNT || !value.is_finite() {
            return;
        }
        if is_discrete(index) {
            self.params[index].snap(libm::roundf(value).max(0.0));
        } else {
            self.params[index].target = clamp01(value);
        }
    }

    fn param(&self, index: usize) -> f32 {
        self.params.get(index).map_or(0.0, |s| s.target)
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
        match src {
            ModSource::Lfo => self.lfo_out,
            ModSource::AmpEnv => self.amp.level,
            ModSource::FiltEnv => self.filt.level,
        }
    }

    fn note_on(&mut self, note: u8, velocity: f32) {
        let legato = self.n_held > 0;
        self.remove_held(note);
        if self.n_held == MAX_HELD {
            // drop the oldest
            self.held.copy_within(1..MAX_HELD, 0);
            self.n_held -= 1;
        }
        let v = velocity.clamp(0.0, 1.0);
        self.held[self.n_held] = (note, v);
        self.n_held += 1;

        self.pitch_target = note as f32;
        self.vel.target = 0.3 + 0.7 * v;
        if !legato {
            self.pitch = self.pitch_target;
            if self.amp.is_idle() {
                self.osc.reset();
                self.sub.reset();
                self.vel.snap(0.3 + 0.7 * v);
            }
            self.amp.gate_on();
            self.filt.gate_on();
        }
        if self.lfo_mode() != LfoMode::Free {
            self.lfo.retrigger(&mut self.rng);
        }
        self.quiet = 0;
        self.ctl_count = 0;
    }

    fn note_off(&mut self, note: u8) {
        let was_top = self.top_note().map(|n| n.0) == Some(note);
        self.remove_held(note);
        match self.top_note() {
            Some((n, _)) if was_top => self.pitch_target = n as f32, // fall back, legato
            Some(_) => {}
            None => {
                self.amp.gate_off();
                self.filt.gate_off();
            }
        }
    }

    fn all_notes_off(&mut self) {
        self.n_held = 0;
        self.amp.gate_off();
        self.filt.gate_off();
    }

    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            // Idle and fully flushed: skip the DSP (but keep params smoothing toward targets).
            if self.amp.is_idle() && self.quiet > crate::dsp::halfband::TAPS {
                for s in self.params.iter_mut() {
                    s.snap(s.target);
                }
                if self.ctl_count == 0 {
                    let e = self.eff;
                    self.update_ctl(&e);
                }
                self.ctl_count = (self.ctl_count + 1) % CTL;
                self.lfo_out = self.lfo.next(
                    LfoWave::from_index(self.params[p::LWAVE].target as u32),
                    self.ctl.lfo_inc,
                    &mut self.rng,
                );
                *l = 0.0;
                *r = 0.0;
                continue;
            }
            let y = self.tick();
            if self.amp.is_idle() {
                self.quiet = self.quiet.saturating_add(1);
                if self.quiet > crate::dsp::halfband::TAPS {
                    self.svf.reset();
                    self.dec.reset();
                }
            }
            *l = y;
            *r = y;
        }
    }
}
