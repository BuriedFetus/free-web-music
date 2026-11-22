//! Parameter smoothing: knob jumps glide over ~10 ms instead of stepping (no zipper noise or clicks).

use super::{flush, one_pole_coef};

#[derive(Clone, Copy)]
pub struct Smoother {
    pub value: f32,
    pub target: f32,
}

impl Smoother {
    pub const fn new(v: f32) -> Smoother {
        Smoother { value: v, target: v }
    }

    #[inline(always)]
    pub fn next(&mut self, coef: f32) -> f32 {
        self.value = flush(self.value + (self.target - self.value) * coef);
        if (self.value - self.target).abs() < 1e-6 {
            self.value = self.target;
        }
        self.value
    }

    pub fn snap(&mut self, v: f32) {
        self.value = v;
        self.target = v;
    }
}

pub fn smoothing_coef(fs: f32) -> f32 {
    one_pole_coef(0.010 / 3.0, fs)
}
