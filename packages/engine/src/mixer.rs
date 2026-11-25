//! The mixer: one strip per slot (level, pan, mute, and send amounts for the shared effects) and the
//! master bus. Every gain glides (no clicks when a fader jumps), and each strip and the master keep a
//! peak level for the meters, which the host reads and clears ~60 times a second.
//!
//! Solo is decided by the host (it knows every track): a strip that is soloed out is simply muted here.

use crate::dsp::smooth::{smoothing_coef, Smoother};
use crate::{BLOCK, MAX_SLOTS};

/// Strip parameters, as numbered in the C interface (`fwm_mix`).
pub const MIX_LEVEL: u32 = 0;
pub const MIX_PAN: u32 = 1;
pub const MIX_MUTE: u32 = 2;
pub const MIX_SEND_A: u32 = 3;
pub const MIX_SEND_B: u32 = 4;
/// Master parameters (`fwm_master`).
pub const MASTER_LEVEL: u32 = 0;

/// Default fader position: 0 dB.
pub const UNITY: f32 = 0.8;

/// Fader position (0..1) to gain: 0 = silent, 0.8 = 0 dB, 1 = +5.8 dB. A cubic curve gives the
/// fader a natural feel: most of its travel is in the useful range around 0 dB.
#[inline]
pub fn fader_gain(v: f32) -> f32 {
    if v <= 0.0 {
        0.0
    } else {
        let x = v.min(1.0) / UNITY;
        x * x * x
    }
}

/// Stereo balance (-1 = left … 1 = right): the far side fades out, the centre leaves both at full.
#[inline]
fn balance(pan: f32) -> (f32, f32) {
    let p = pan.clamp(-1.0, 1.0);
    (if p > 0.0 { 1.0 - p } else { 1.0 }, if p < 0.0 { 1.0 + p } else { 1.0 })
}

#[derive(Clone, Copy)]
pub struct Strip {
    level: f32,
    pan: f32,
    mute: bool,
    gl: Smoother,
    gr: Smoother,
    sa: Smoother,
    sb: Smoother,
    /// Post-fader send amounts (0..1) to the shared effects A (reverb) and B (delay).
    pub send: [f32; 2],
    /// Peak |sample| per side since the meters were last read.
    pub peak: [f32; 2],
}

impl Strip {
    const fn new() -> Strip {
        // fader_gain(UNITY) = 1
        Strip { level: UNITY, pan: 0.0, mute: false, gl: Smoother::new(1.0), gr: Smoother::new(1.0), sa: Smoother::new(0.0), sb: Smoother::new(0.0), send: [0.0; 2], peak: [0.0; 2] }
    }
    fn update(&mut self) {
        let g = if self.mute { 0.0 } else { fader_gain(self.level) };
        let (l, r) = balance(self.pan);
        self.gl.target = g * l;
        self.gr.target = g * r;
        self.sa.target = self.send[0];
        self.sb.target = self.send[1];
    }
}

pub struct Mixer {
    pub strips: [Strip; MAX_SLOTS],
    master_level: f32,
    master: Smoother,
    coef: f32,
    pub master_peak: [f32; 2],
}

impl Mixer {
    pub fn new(sample_rate: f32) -> Mixer {
        Mixer { strips: [Strip::new(); MAX_SLOTS], master_level: UNITY, master: Smoother::new(1.0), coef: smoothing_coef(sample_rate), master_peak: [0.0; 2] }
    }

    /// Back to defaults (a new device in the slot starts at 0 dB, centre, unmuted, no sends).
    pub fn reset(&mut self, slot: usize) {
        if let Some(s) = self.strips.get_mut(slot) {
            *s = Strip::new();
        }
    }

    pub fn set(&mut self, slot: usize, param: u32, value: f32) {
        let Some(s) = self.strips.get_mut(slot) else { return };
        let v = if value.is_finite() { value } else { 0.0 };
        match param {
            MIX_LEVEL => s.level = v.clamp(0.0, 1.0),
            MIX_PAN => s.pan = v.clamp(-1.0, 1.0),
            MIX_MUTE => s.mute = v >= 0.5,
            MIX_SEND_A => s.send[0] = v.clamp(0.0, 1.0),
            MIX_SEND_B => s.send[1] = v.clamp(0.0, 1.0),
            _ => return,
        }
        s.update();
    }

    pub fn set_master(&mut self, param: u32, value: f32) {
        if param == MASTER_LEVEL && value.is_finite() {
            self.master_level = value.clamp(0.0, 1.0);
            self.master.target = fader_gain(self.master_level);
        }
    }

    /// Apply a strip (gain, balance) to one device's output, in place, and meter it. With `sends`
    /// (the effect send buses and where this span starts in the block), the post-fader sound is
    /// added to send A (reverb) and B (delay) by the strip's send amounts.
    pub fn strip(&mut self, slot: usize, left: &mut [f32], right: &mut [f32], sends: Option<(&mut [[f32; BLOCK]; 4], usize)>) {
        let c = self.coef;
        let s = &mut self.strips[slot];
        let (mut pl, mut pr) = (s.peak[0], s.peak[1]);
        match sends {
            Some((bus, from)) => {
                for (k, (l, r)) in left.iter_mut().zip(right.iter_mut()).enumerate() {
                    *l *= s.gl.next(c);
                    *r *= s.gr.next(c);
                    let (a, b) = (s.sa.next(c), s.sb.next(c));
                    bus[0][from + k] += *l * a;
                    bus[1][from + k] += *r * a;
                    bus[2][from + k] += *l * b;
                    bus[3][from + k] += *r * b;
                    pl = pl.max(l.abs());
                    pr = pr.max(r.abs());
                }
            }
            None => {
                for (l, r) in left.iter_mut().zip(right.iter_mut()) {
                    *l *= s.gl.next(c);
                    *r *= s.gr.next(c);
                    pl = pl.max(l.abs());
                    pr = pr.max(r.abs());
                }
            }
        }
        s.peak = [pl, pr];
    }

    /// The master fader, in place, and its meter.
    pub fn master(&mut self, left: &mut [f32], right: &mut [f32]) {
        let c = self.coef;
        let (mut pl, mut pr) = (self.master_peak[0], self.master_peak[1]);
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let g = self.master.next(c);
            *l *= g;
            *r *= g;
            pl = pl.max(l.abs());
            pr = pr.max(r.abs());
        }
        self.master_peak = [pl, pr];
    }

    /// Copy every meter into `out` ([slot0 L, slot0 R, slot1 L, … , master L, master R]) and clear them.
    pub fn take_meters(&mut self, out: &mut [f32; (MAX_SLOTS + 1) * 2]) {
        for (i, s) in self.strips.iter_mut().enumerate() {
            out[i * 2] = s.peak[0];
            out[i * 2 + 1] = s.peak[1];
            s.peak = [0.0; 2];
        }
        out[MAX_SLOTS * 2] = self.master_peak[0];
        out[MAX_SLOTS * 2 + 1] = self.master_peak[1];
        self.master_peak = [0.0; 2];
    }
}
