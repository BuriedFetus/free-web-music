//! DSP building blocks shared by all devices.
//! Rules: no allocation, no locking, no unbounded loops. Everything here runs on the audio thread.

pub mod env;
pub mod halfband;
pub mod lfo;
pub mod osc;
pub mod rng;
pub mod smooth;
pub mod svf;

pub use libm::{cosf, expf, powf, sinf, tanf};

pub const PI: f32 = core::f32::consts::PI;
pub const TAU: f32 = core::f32::consts::TAU;

/// Values this small are flushed to zero so filter and envelope tails never
/// fall into denormal numbers (WebAssembly has no flush-to-zero mode).
pub const TINY: f32 = 1e-20;

#[inline(always)]
pub fn flush(x: f32) -> f32 {
    if x.abs() < TINY {
        0.0
    } else {
        x
    }
}

#[inline(always)]
pub fn clamp01(x: f32) -> f32 {
    x.clamp(0.0, 1.0)
}

/// Smooth saturator: a Padé approximation of tanh, exact enough for audio
/// and monotonic. Clamped beyond |x| = 3, where it reaches ±1.
#[inline(always)]
pub fn sat(x: f32) -> f32 {
    let x = x.clamp(-3.0, 3.0);
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}

/// MIDI note number (may be fractional) to frequency in Hz.
#[inline(always)]
pub fn note_hz(note: f32) -> f32 {
    440.0 * powf(2.0, (note - 69.0) / 12.0)
}

/// One-pole coefficient that covers ~63% of the distance in `seconds`.
#[inline(always)]
pub fn one_pole_coef(seconds: f32, sample_rate: f32) -> f32 {
    if seconds <= 0.0 {
        1.0
    } else {
        1.0 - expf(-1.0 / (seconds * sample_rate))
    }
}

/// Fast 2^x: polynomial on [-0.5, 0.5] plus exponent bits. Relative error < 2e-7
/// (0.0003 cents as pitch), several times cheaper than `powf`.
#[inline(always)]
pub fn exp2(x: f32) -> f32 {
    let x = x.clamp(-126.0, 126.0);
    let i = libm::floorf(x + 0.5);
    let f = x - i; // -0.5..0.5
    const L: f32 = core::f32::consts::LN_2;
    let p = 1.0
        + f * (L
            + f * (L * L / 2.0
                + f * (L * L * L / 6.0
                    + f * (L * L * L * L / 24.0 + f * (L * L * L * L * L / 120.0 + f * (L * L * L * L * L * L / 720.0))))));
    p * f32::from_bits(((i as i32 + 127) as u32) << 23)
}
