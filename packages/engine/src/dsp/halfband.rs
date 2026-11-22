//! 2:1 decimator: a linear-phase half-band FIR (windowed sinc, Blackman-Harris).
//! Every other tap is zero, so a 127-tap filter costs 64 multiply-adds per output sample.
//! Passband flat to ~21 kHz, stopband from ~27 kHz. Latency: 63 input samples (~0.66 ms at 96 kHz).

use super::{cosf, sinf, PI};

pub const TAPS: usize = 127;
const HALF: usize = TAPS / 2; // the centre tap
const NZ: usize = (HALF + 1) / 2; // non-zero taps on one side

pub struct Decimator {
    /// Non-zero side coefficients h[centre ± (2i+1)], i = 0..NZ.
    coefs: [f32; NZ],
    /// Input history, written twice so a window is always contiguous.
    buf: [f32; 2 * TAPS],
    pos: usize,
}

impl Decimator {
    pub fn new() -> Decimator {
        let mut coefs = [0.0f32; NZ];
        for (i, c) in coefs.iter_mut().enumerate() {
            let n = (2 * i + 1) as f32; // odd offset from centre
            let sinc = sinf(0.5 * PI * n) / (PI * n); // cutoff = quarter of the input rate
            let x = (HALF as f32 + n) / (TAPS - 1) as f32; // 0..1 position in the window
            let w = 0.35875 - 0.48829 * cosf(2.0 * PI * x) + 0.14128 * cosf(4.0 * PI * x)
                - 0.01168 * cosf(6.0 * PI * x);
            *c = sinc * w;
        }
        // Normalise so DC gain is exactly 1 (centre tap is 0.5).
        let sum: f32 = coefs.iter().sum::<f32>() * 2.0;
        for c in coefs.iter_mut() {
            *c *= 0.5 / sum;
        }
        Decimator { coefs, buf: [0.0; 2 * TAPS], pos: 0 }
    }

    pub fn reset(&mut self) {
        self.buf = [0.0; 2 * TAPS];
    }

    #[inline(always)]
    fn push(&mut self, x: f32) {
        self.buf[self.pos] = x;
        self.buf[self.pos + TAPS] = x;
        self.pos += 1;
        if self.pos == TAPS {
            self.pos = 0;
        }
    }

    /// Feed two input samples (at 2× rate), get one output sample.
    #[inline]
    pub fn process(&mut self, a: f32, b: f32) -> f32 {
        self.push(a);
        self.push(b);
        // Window: buf[pos .. pos+TAPS], oldest first. Centre is at pos + HALF.
        let w = &self.buf[self.pos..self.pos + TAPS];
        let mut acc = 0.5 * w[HALF];
        for i in 0..NZ {
            let o = 2 * i + 1;
            acc += self.coefs[i] * (w[HALF - o] + w[HALF + o]);
        }
        acc
    }
}

impl Default for Decimator {
    fn default() -> Self {
        Self::new()
    }
}
