//! Main low-pass: a resonant state-variable filter on the whole mix, to sweep the song.
//! The cutoff glides (in pitch, so a sweep sounds even), and On / Off crossfades. Fully open, the
//! filter is bypassed exactly, so the default leaves the mix untouched.

use crate::dsp::{exp2, smooth::Smoother, svf::Svf};

pub struct Lowpass {
    fs: f32,
    f: [Svf; 2],
    pub cutoff: f32,
    pub resonance: f32,
    pub on: bool,
    oct: Smoother, // cutoff in octaves above 20 Hz
    k: Smoother,
    wet: Smoother,
    coef: f32,
}

impl Lowpass {
    pub fn new(fs: f32) -> Lowpass {
        let mut l = Lowpass {
            fs,
            f: [Svf::new(), Svf::new()],
            cutoff: 1.0,
            resonance: 0.2,
            on: true,
            oct: Smoother::new(10.0),
            k: Smoother::new(1.4),
            wet: Smoother::new(1.0),
            coef: crate::dsp::one_pole_coef(0.02, fs),
        };
        l.update();
        l
    }

    /// Cutoff (0..1) in Hz: 60 Hz … 20 kHz, even in pitch.
    pub fn cutoff_hz(v: f32) -> f32 {
        60.0 * crate::dsp::powf(20000.0 / 60.0, v.clamp(0.0, 1.0))
    }
    /// Resonance (0..1) as Q: 0.7 … 14.7.
    pub fn q(v: f32) -> f32 {
        0.7 + v.clamp(0.0, 1.0) * 14.0
    }

    pub fn update(&mut self) {
        self.oct.target = libm::log2f(Self::cutoff_hz(self.cutoff) / 20.0);
        self.k.target = 1.0 / Self::q(self.resonance);
        // Fully open = untouched (an exact bypass, not a filter at 20 kHz).
        self.wet.target = if self.on && self.cutoff < 0.999 { 1.0 } else { 0.0 };
    }

    pub fn process(&mut self, l: &mut [f32], r: &mut [f32]) {
        let c = self.coef;
        if self.wet.target == 0.0 && self.wet.value == 0.0 {
            return;
        }
        for i in 0..l.len() {
            let g = Svf::g(20.0 * exp2(self.oct.next(c)), self.fs);
            let k = self.k.next(c);
            let w = self.wet.next(c);
            let yl = self.f[0].tick(l[i], g, k).lp;
            let yr = self.f[1].tick(r[i], g, k).lp;
            l[i] += (yl - l[i]) * w;
            r[i] += (yr - r[i]) * w;
        }
    }
}
