//! Band-limited oscillators.
//!
//! Naive waveforms are corrected at every discontinuity with 4-point residuals derived from the
//! cubic B-spline: a step residual (BLEP) for jumps in value (saw, square edges) and a ramp
//! residual (BLAMP) for jumps in slope (triangle corners). The correction spans 2 samples before
//! and 2 after each edge, so the oscillator output is delayed by 2 samples.
//! Compared with the common 2-point PolyBLEP this rejects aliasing ~25 dB better.
//! Basalt runs these at 2× the output rate and decimates, which removes most of what remains.

use super::{sinf, PI, TAU};

/// Step residual of a band-limited unit step, at signed distance `x` (in samples) from the edge.
/// Non-zero for -2 < x < 2.
#[inline(always)]
pub fn blep4(x: f32) -> f32 {
    let neg = |x: f32| -> f32 {
        // x in [-2, 0]: integral of the cubic B-spline from -2 to x
        if x <= -1.0 {
            let y = 2.0 + x;
            let y2 = y * y;
            y2 * y2 * (1.0 / 24.0)
        } else {
            let x2 = x * x;
            0.5 + x * (2.0 / 3.0) - x2 * x * (1.0 / 3.0) - x2 * x2 * 0.125
        }
    };
    if x <= -2.0 || x >= 2.0 {
        0.0
    } else if x < 0.0 {
        neg(x)
    } else {
        -neg(-x)
    }
}

/// Ramp residual for a unit change of slope (1 per sample), at distance `x` samples. Even in x.
#[inline(always)]
pub fn blamp4(x: f32) -> f32 {
    let x = -x.abs();
    if x <= -2.0 {
        0.0
    } else if x <= -1.0 {
        let y = 2.0 + x;
        let y2 = y * y;
        y2 * y2 * y * (1.0 / 120.0)
    } else {
        let x2 = x * x;
        28.0 / 120.0 + x * 0.5 + x2 * (1.0 / 3.0) - x2 * x2 * (1.0 / 12.0) - x2 * x2 * x * (1.0 / 40.0)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Wave {
    Saw = 0,
    Square = 1,
    Triangle = 2,
    Sine = 3,
}

impl Wave {
    pub fn from_index(i: u32) -> Wave {
        match i {
            1 => Wave::Square,
            2 => Wave::Triangle,
            3 => Wave::Sine,
            _ => Wave::Saw,
        }
    }
}

/// If the phase passed `edge` while stepping from `t_prev` by `dt`, returns how many samples
/// ago (0..1) that happened.
#[inline(always)]
fn crossed(edge: f32, t_prev: f32, dt: f32) -> Option<f32> {
    let mut u = edge - t_prev;
    if u <= 0.0 {
        u += 1.0;
    }
    if u <= dt {
        Some((dt - u) / dt)
    } else {
        None
    }
}

/// Gentle sine wavefolder used by the Shape control on Triangle and Sine.
/// shape = 0 leaves the wave untouched.
#[inline]
fn fold(x: f32, shape: f32) -> f32 {
    if shape <= 0.0 {
        return x;
    }
    let folded = sinf(0.5 * PI * x * (1.0 + 3.0 * shape));
    x + (folded - x) * shape
}

/// Main oscillator with a Shape control:
/// - Saw: blends in a second saw half a cycle away (saw → hollow, square-like)
/// - Square: pulse width 50% → 5%
/// - Triangle / Sine: wavefold
#[derive(Clone, Copy)]
pub struct Osc {
    pub phase: f32,
    d1: f32,
    d2: f32,
    carry: f32,
}

impl Osc {
    pub const fn new() -> Osc {
        Osc { phase: 0.0, d1: 0.0, d2: 0.0, carry: 0.0 }
    }

    pub fn reset(&mut self) {
        *self = Osc::new();
    }

    /// Adds a correction of `h × residual` around an edge that happened `frac` samples ago.
    #[inline(always)]
    fn edge(&mut self, y: &mut f32, frac: f32, h: f32, ramp: bool) {
        let r = if ramp { blamp4 } else { blep4 };
        self.d2 += h * r(frac - 2.0);
        self.d1 += h * r(frac - 1.0);
        *y += h * r(frac);
        self.carry += h * r(frac + 1.0);
    }

    /// Returns one sample (2 samples late) and advances. `dt` = frequency / sample rate, < 0.5.
    #[inline]
    pub fn next(&mut self, wave: Wave, dt: f32, shape: f32) -> f32 {
        let t_prev = self.phase;
        let mut t = t_prev + dt;
        if t >= 1.0 {
            t -= 1.0;
        }
        self.phase = t;
        let mut y = self.carry;
        self.carry = 0.0;
        match wave {
            Wave::Saw => {
                let g = 1.0 / (1.0 + 0.35 * shape);
                y += (2.0 * t - 1.0) * g;
                if let Some(f) = crossed(0.0, t_prev, dt) {
                    self.edge(&mut y, f, -2.0 * g, false);
                }
                if shape > 0.0 {
                    let t2 = if t >= 0.5 { t - 0.5 } else { t + 0.5 };
                    y -= shape * (2.0 * t2 - 1.0) * g;
                    if let Some(f) = crossed(0.5, t_prev, dt) {
                        self.edge(&mut y, f, 2.0 * shape * g, false);
                    }
                }
            }
            Wave::Square => {
                let pw = 0.5 - 0.45 * shape;
                y += if t < pw { 1.0 } else { -1.0 } - (2.0 * pw - 1.0);
                if let Some(f) = crossed(0.0, t_prev, dt) {
                    self.edge(&mut y, f, 2.0, false);
                }
                if let Some(f) = crossed(pw, t_prev, dt) {
                    self.edge(&mut y, f, -2.0, false);
                }
            }
            Wave::Triangle => {
                y += 4.0 * (t - 0.5).abs() - 1.0;
                if let Some(f) = crossed(0.0, t_prev, dt) {
                    self.edge(&mut y, f, -8.0 * dt, true);
                }
                if let Some(f) = crossed(0.5, t_prev, dt) {
                    self.edge(&mut y, f, 8.0 * dt, true);
                }
            }
            Wave::Sine => y += sinf(TAU * t),
        }
        // Delay line: corrections may still land on d1/d2, so output the oldest.
        let out = self.d2;
        self.d2 = self.d1;
        self.d1 = y;
        // The folder runs after correction (on the delayed sample).
        match wave {
            Wave::Triangle | Wave::Sine => fold(out, shape),
            _ => out,
        }
    }
}

/// Square sub-oscillator one octave below the main oscillator.
#[derive(Clone, Copy)]
pub struct Sub {
    osc: Osc,
}

impl Sub {
    pub const fn new() -> Sub {
        Sub { osc: Osc::new() }
    }

    pub fn reset(&mut self) {
        self.osc.reset();
    }

    /// `dt` is the main oscillator's increment; the sub runs at half of it.
    #[inline]
    pub fn next(&mut self, dt: f32) -> f32 {
        self.osc.next(Wave::Square, 0.5 * dt, 0.0)
    }
}
