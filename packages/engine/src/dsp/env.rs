//! Analog-style ADSR envelope.
//! Attack aims past 1.0 (at 1.3) for the familiar convex RC curve; decay and
//! release are exponential. Retriggering starts from the current level, so
//! re-pressing a key never clicks. Times may change at any moment (modulation).

use super::{expf, flush};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Stage {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}

#[derive(Clone, Copy)]
pub struct Adsr {
    pub stage: Stage,
    pub level: f32,
}

/// Times in seconds, sustain 0..1.
#[derive(Clone, Copy)]
pub struct AdsrTimes {
    pub a: f32,
    pub d: f32,
    pub s: f32,
    pub r: f32,
}

/// Per-sample coefficients, computed from `AdsrTimes` at control rate (exp is costly).
#[derive(Clone, Copy)]
pub struct AdsrCoefs {
    pub a: f32,
    pub d: f32,
    pub s: f32,
    pub r: f32,
}

impl AdsrCoefs {
    pub fn new(t: &AdsrTimes, fs: f32) -> AdsrCoefs {
        AdsrCoefs {
            a: Adsr::coef(t.a, ATTACK_TCS, fs),
            d: Adsr::coef(t.d, DR_TCS, fs),
            s: t.s,
            r: Adsr::coef(t.r, DR_TCS, fs),
        }
    }
}

const ATTACK_TARGET: f32 = 1.3;
/// ln(1.3 / 0.3): number of time constants to reach 1.0 when aiming at 1.3.
const ATTACK_TCS: f32 = 1.466_337;
/// Decay and release count as done at ~1% of the distance (4.6 time constants).
const DR_TCS: f32 = 4.6;
const OFF: f32 = 1e-5; // -100 dB

impl Adsr {
    pub const fn new() -> Adsr {
        Adsr { stage: Stage::Idle, level: 0.0 }
    }

    pub fn gate_on(&mut self) {
        self.stage = Stage::Attack;
    }

    pub fn gate_off(&mut self) {
        if self.stage != Stage::Idle {
            self.stage = Stage::Release;
        }
    }

    pub fn is_idle(&self) -> bool {
        self.stage == Stage::Idle
    }

    #[inline]
    pub fn coef(seconds: f32, tcs: f32, fs: f32) -> f32 {
        let tau = (seconds / tcs).max(1e-5);
        1.0 - expf(-1.0 / (tau * fs))
    }

    #[inline]
    pub fn next(&mut self, c: &AdsrCoefs) -> f32 {
        match self.stage {
            Stage::Idle => return 0.0,
            Stage::Attack => {
                self.level += (ATTACK_TARGET - self.level) * c.a;
                if self.level >= 1.0 {
                    self.level = 1.0;
                    self.stage = Stage::Decay;
                }
            }
            Stage::Decay | Stage::Sustain => {
                // Sustain keeps following its (possibly modulated) target smoothly.
                self.level += (c.s - self.level) * c.d;
                if self.stage == Stage::Decay && (self.level - c.s).abs() < 1e-4 {
                    self.stage = Stage::Sustain;
                }
                if c.s <= 0.0 && self.level < OFF {
                    self.level = 0.0;
                    self.stage = Stage::Idle;
                }
            }
            Stage::Release => {
                self.level -= self.level * c.r;
                if self.level < OFF {
                    self.level = 0.0;
                    self.stage = Stage::Idle;
                }
            }
        }
        self.level = flush(self.level);
        self.level
    }
}
