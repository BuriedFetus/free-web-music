//! Lo-fi: tape and vinyl, not bit-crushing.
//! - Wow and flutter: a short delay line whose length wobbles slowly (0.55 + 0.93 Hz) and quickly
//!   (6.7 + 11.3 Hz), which bends the pitch like a stretched tape or a warped record.
//! - Saturation: soft clipping, level-matched at -12 dBFS (a typical instrument level), so it warms
//!   and squashes peaks without making the mix louder.
//! Off, the sound passes untouched (no delay). On, it goes through an 8 ms line (the room the pitch
//! wobble needs); switching crossfades over ~30 ms so it never clicks.
//! - Age: a two-pole high cut closing from 18 kHz to 3 kHz and a low cut rising from 20 Hz.
//! - Noise: bright tape hiss, or darker record-surface noise in Vinyl style. Crackle: dust and pops.
//! - Mix: dry / wet (the dry path is delayed to line up with the wet one).

use super::line::{lp_coef, one_pole, Line};
use crate::dsp::{flush, powf, rng::Rng, sat, sinf, smooth::Smoother, TAU};

/// The level the saturation leaves unchanged.
const REF: f32 = 0.25;

pub struct Lofi {
    fs: f32,
    lines: [Line; 2],
    base: usize,
    t: f32,
    rng: Rng,
    pop: f32,
    hc1: [f32; 2],
    hc2: [f32; 2],
    lc: [f32; 2],
    noise: [f32; 2],
    pub wow: f32,
    pub flutter: f32,
    pub saturation: f32,
    pub age: f32,
    pub hiss: f32,
    pub crackle: f32,
    pub mix: f32,
    pub vinyl: bool,
    pub on: bool,
    s_wow: Smoother,
    s_flutter: Smoother,
    s_drive: Smoother,
    s_mix: Smoother,
    s_on: Smoother,
    hc_c: f32,
    lc_c: f32,
    coef: f32,
}

impl Lofi {
    pub fn new(fs: f32) -> Lofi {
        let mut l = Lofi {
            fs,
            lines: [Line::new((0.03 * fs) as usize), Line::new((0.03 * fs) as usize)],
            base: libm::roundf(0.008 * fs) as usize,
            t: 0.0,
            rng: Rng::new(0x5eed_1234),
            pop: 0.0,
            hc1: [0.0; 2],
            hc2: [0.0; 2],
            lc: [0.0; 2],
            noise: [0.0; 2],
            wow: 0.35,
            flutter: 0.3,
            saturation: 0.5,
            age: 0.35,
            hiss: 0.0,
            crackle: 0.0,
            mix: 1.0,
            vinyl: false,
            on: false,
            s_wow: Smoother::new(0.35),
            s_flutter: Smoother::new(0.3),
            s_drive: Smoother::new(3.5),
            s_mix: Smoother::new(1.0),
            s_on: Smoother::new(0.0),
            hc_c: 0.5,
            lc_c: 0.0,
            coef: crate::dsp::one_pole_coef(0.03, fs),
        };
        l.update();
        l
    }

    /// Age (0..1) to the high cut in Hz: 18 kHz … 3 kHz.
    pub fn age_hz(age: f32) -> f32 {
        18000.0 * powf(3000.0 / 18000.0, age.clamp(0.0, 1.0))
    }

    pub fn update(&mut self) {
        self.s_wow.target = self.wow.clamp(0.0, 1.0);
        self.s_flutter.target = self.flutter.clamp(0.0, 1.0);
        self.s_drive.target = 1.0 + self.saturation.clamp(0.0, 1.0) * 5.0;
        self.s_mix.target = self.mix.clamp(0.0, 1.0);
        self.s_on.target = if self.on { 1.0 } else { 0.0 };
        self.hc_c = lp_coef(Self::age_hz(self.age), self.fs);
        let low = 20.0 * powf(if self.vinyl { 14.0 } else { 8.0 }, self.age.clamp(0.0, 1.0));
        self.lc_c = lp_coef(low, self.fs);
    }

    /// Lo-fi in place over (l, r). When off (and faded out) it costs almost nothing.
    pub fn process(&mut self, l: &mut [f32], r: &mut [f32]) {
        let fs = self.fs;
        let c = self.coef;
        if !self.on && self.s_on.value == 0.0 {
            // Off: untouched. The lines stay fed so switching on starts from real sound.
            for i in 0..l.len() {
                self.lines[0].push(l[i]);
                self.lines[1].push(r[i]);
            }
            return;
        }
        let noise_c = if self.vinyl { 0.06 } else { 0.5 };
        let noise_amp = if self.vinyl { 0.06 } else { 0.016 };
        let crackle_p = self.crackle * self.crackle * 0.0012 * 48000.0 / fs;
        for i in 0..l.len() {
            self.t += 1.0 / fs;
            if self.t > 1000.0 {
                self.t -= 1000.0; // keep the phase precise (all rates repeat within 1000 s)
            }
            let t = self.t;
            let wow = self.s_wow.next(c);
            let flutter = self.s_flutter.next(c);
            let drive = self.s_drive.next(c);
            let mix = self.s_mix.next(c);
            let on = self.s_on.next(c);
            let m = wow * 0.003 * (sinf(TAU * 0.55 * t) + 0.35 * sinf(TAU * 0.93 * t + 1.0))
                + flutter * 0.00012 * (sinf(TAU * 6.7 * t) + 0.5 * sinf(TAU * 11.3 * t));
            let d = self.base as f32 + m * fs;
            // crackle: a rare impulse that dies away within a few samples
            if self.crackle > 0.0 && ((self.rng.next_u32() >> 8) as f32 / 16_777_216.0) < crackle_p {
                let big = (self.rng.next_u32() & 7) == 0;
                self.pop = self.rng.bipolar() * if big { 0.5 } else { 0.15 } * self.crackle;
            }
            let crack = self.pop;
            self.pop = flush(self.pop * 0.55);
            // level-matched saturation: unchanged at 0.25 (a typical instrument level), within ~2 dB
            // below it, peaks above it squashed gently like tape
            let norm = REF / sat(drive * REF);
            for (k, x) in [&mut l[i], &mut r[i]].into_iter().enumerate() {
                self.lines[k].push(*x);
                let input = *x;
                let dry = self.lines[k].read(self.base + 1); // just pushed = read(1): +1 for `base` samples
                let mut v = self.lines[k].read_frac(d + 1.0);
                v = sat(v * drive) * norm;
                v = one_pole(&mut self.hc1[k], v, self.hc_c);
                v = one_pole(&mut self.hc2[k], v, self.hc_c);
                v -= one_pole(&mut self.lc[k], v, self.lc_c);
                let n = one_pole(&mut self.noise[k], self.rng.bipolar(), noise_c);
                v += n * self.hiss * noise_amp + crack;
                let wet = dry + (v - dry) * mix; // the dry part is delayed too, so Mix never combs
                let out = input + (wet - input) * on;
                *x = if out.is_finite() { out } else { 0.0 };
            }
        }
    }
}
