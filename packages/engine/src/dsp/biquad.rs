//! Second-order filters (the "Audio EQ Cookbook" by Robert Bristow-Johnson), transposed direct form II.
//! Coefficients are set per block; `process` runs per sample.

use super::{cosf, flush, powf, sinf, TAU};

#[derive(Clone, Copy)]
pub struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    /// Passes everything unchanged.
    pub const fn new() -> Biquad {
        Biquad { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0, z1: 0.0, z2: 0.0 }
    }

    pub fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }

    fn set(&mut self, b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) {
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    fn w(f: f32, q: f32, fs: f32) -> (f32, f32, f32) {
        let w0 = TAU * f.clamp(10.0, 0.45 * fs) / fs;
        let (c, s) = (cosf(w0), sinf(w0));
        (c, s, s / (2.0 * q.max(0.05)))
    }

    pub fn lowpass(&mut self, f: f32, q: f32, fs: f32) {
        let (c, _, a) = Self::w(f, q, fs);
        self.set((1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0, 1.0 + a, -2.0 * c, 1.0 - a);
    }

    pub fn highpass(&mut self, f: f32, q: f32, fs: f32) {
        let (c, _, a) = Self::w(f, q, fs);
        self.set((1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0, 1.0 + a, -2.0 * c, 1.0 - a);
    }

    /// A bell: `db` up or down around `f`.
    pub fn peaking(&mut self, f: f32, q: f32, db: f32, fs: f32) {
        let (c, _, a) = Self::w(f, q, fs);
        let g = powf(10.0, db / 40.0);
        self.set(1.0 + a * g, -2.0 * c, 1.0 - a * g, 1.0 + a / g, -2.0 * c, 1.0 - a / g);
    }

    /// Raises or lowers everything above `f` by `db` (shelf slope 1).
    pub fn highshelf(&mut self, f: f32, db: f32, fs: f32) {
        let (c, s, _) = Self::w(f, 0.707, fs);
        let g = powf(10.0, db / 40.0);
        let a = s / 2.0 * core::f32::consts::SQRT_2;
        let sq = 2.0 * libm::sqrtf(g) * a;
        self.set(
            g * ((g + 1.0) + (g - 1.0) * c + sq),
            -2.0 * g * ((g - 1.0) + (g + 1.0) * c),
            g * ((g + 1.0) + (g - 1.0) * c - sq),
            (g + 1.0) - (g - 1.0) * c + sq,
            2.0 * ((g - 1.0) - (g + 1.0) * c),
            (g + 1.0) - (g - 1.0) * c - sq,
        );
    }

    #[inline(always)]
    pub fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = flush(self.b1 * x - self.a1 * y + self.z2);
        self.z2 = flush(self.b2 * x - self.a2 * y);
        y
    }
}

impl Default for Biquad {
    fn default() -> Self {
        Biquad::new()
    }
}
