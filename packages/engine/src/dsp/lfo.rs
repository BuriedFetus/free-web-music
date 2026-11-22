//! Low-frequency oscillator with four shapes and three trigger modes.
//! Square and sample-and-hold are slewed by ~1 ms so jumps never click.

use super::rng::Rng;
use super::{one_pole_coef, sinf, TAU};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LfoWave {
    Sine = 0,
    Triangle = 1,
    Square = 2,
    SampleHold = 3,
}

impl LfoWave {
    pub fn from_index(i: u32) -> LfoWave {
        match i {
            1 => LfoWave::Triangle,
            2 => LfoWave::Square,
            3 => LfoWave::SampleHold,
            _ => LfoWave::Sine,
        }
    }
}

/// Free: runs on its own. Retrig: restarts at each new note.
/// Poly: one LFO per voice, each starting with its note (on a mono device this behaves like Retrig).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LfoMode {
    Free = 0,
    Retrig = 1,
    Poly = 2,
}

impl LfoMode {
    pub fn from_index(i: u32) -> LfoMode {
        match i {
            1 => LfoMode::Retrig,
            2 => LfoMode::Poly,
            _ => LfoMode::Free,
        }
    }
}

#[derive(Clone, Copy)]
pub struct Lfo {
    pub phase: f32,
    held: f32,
    out: f32,
    slew: f32,
}

impl Lfo {
    pub const fn new() -> Lfo {
        Lfo { phase: 0.0, held: 0.0, out: 0.0, slew: 1.0 }
    }

    pub fn prepare(&mut self, fs: f32) {
        self.slew = one_pole_coef(0.001, fs);
    }

    pub fn retrigger(&mut self, rng: &mut Rng) {
        self.phase = 0.0;
        self.held = rng.bipolar();
    }

    /// Advances by one sample; `inc` = rate in Hz / sample rate. Returns -1..1.
    #[inline]
    pub fn next(&mut self, wave: LfoWave, inc: f32, rng: &mut Rng) -> f32 {
        let p = self.phase;
        let raw = match wave {
            LfoWave::Sine => sinf(TAU * p),
            LfoWave::Triangle => 1.0 - 4.0 * (p - 0.25).abs().min((p - 1.25).abs()),
            LfoWave::Square => {
                if p < 0.5 {
                    1.0
                } else {
                    -1.0
                }
            }
            LfoWave::SampleHold => self.held,
        };
        self.phase += inc;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
            self.held = rng.bipolar();
        }
        self.out = match wave {
            LfoWave::Sine | LfoWave::Triangle => raw,
            _ => self.out + (raw - self.out) * self.slew,
        };
        self.out
    }
}
