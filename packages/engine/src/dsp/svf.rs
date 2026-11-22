//! State-variable filter, TPT / zero-delay-feedback form (Zavalishin, Simper).
//! Stays stable under fast cutoff modulation, unlike the classic Chamberlin SVF.
//! The band-pass state is softly saturated, so high resonance sings instead of exploding.

use super::{flush, sat, tanf, PI};

#[derive(Clone, Copy)]
pub struct Svf {
    ic1: f32,
    ic2: f32,
}

pub struct SvfOut {
    pub lp: f32,
    pub bp: f32,
    pub hp: f32,
}

impl Svf {
    pub const fn new() -> Svf {
        Svf { ic1: 0.0, ic2: 0.0 }
    }

    pub fn reset(&mut self) {
        self.ic1 = 0.0;
        self.ic2 = 0.0;
    }

    /// `g` = tan(π·fc/fs) (see [`Svf::g`]), `k` = 1/Q (2 = no resonance, → 0 = self-oscillation).
    #[inline]
    pub fn tick(&mut self, x: f32, g: f32, k: f32) -> SvfOut {
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;
        let v3 = x - self.ic2;
        let v1 = a1 * self.ic1 + a2 * v3;
        let v2 = self.ic2 + a2 * self.ic1 + a3 * v3;
        self.ic1 = flush(sat(2.0 * v1 - self.ic1));
        self.ic2 = flush(2.0 * v2 - self.ic2);
        SvfOut { lp: v2, bp: v1, hp: x - k * v1 - v2 }
    }

    /// Cutoff in Hz → `g`, clamped below Nyquist.
    #[inline]
    pub fn g(fc: f32, fs: f32) -> f32 {
        let f = fc.clamp(10.0, 0.49 * fs);
        tanf(PI * f / fs)
    }

    pub fn is_silent(&self) -> bool {
        self.ic1 == 0.0 && self.ic2 == 0.0
    }
}
