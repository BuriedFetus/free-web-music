//! Reverb: a plate after Jon Dattorro's "Effect Design, Part 1" (JAES 1997). The input is pre-delayed,
//! band-limited and smeared by four allpasses; a figure-eight tank of two delay/allpass halves feeds
//! back into itself, damped on every pass, with slowly moving allpasses so the tail never rings
//! metallically. Stereo comes from taps spread around the tank.
//!
//! Size sets the decay time (0.4 – 6 s), Tone the damping and brightness, Pre-delay up to 100 ms.

use super::line::{lp_coef, one_pole, Line};
use crate::dsp::{flush, sinf, smooth::Smoother, TAU};

/// The design's sample rate: all lengths below are in samples at this rate.
const BASE: f32 = 29761.0;
const IN_DIFF: [(f32, f32); 4] = [(142.0, 0.75), (107.0, 0.75), (379.0, 0.625), (277.0, 0.625)];
const MOD_DEPTH: f32 = 16.0; // samples at BASE
/// Seconds one pass through a tank half takes (for the decay time).
const HALF_LOOP: f32 = (672.0 + 4453.0 + 1800.0 + 3720.0) / BASE;

pub struct Reverb {
    fs: f32,
    s: f32, // fs / BASE
    pre: Line,
    diff: [Line; 4],
    ap_l1: Line,
    d_l1: Line,
    ap_l2: Line,
    d_l2: Line,
    ap_r1: Line,
    d_r1: Line,
    ap_r2: Line,
    d_r2: Line,
    bw: f32,
    damp: [f32; 2],
    out_lp: [f32; 2],
    last: [f32; 2],
    phase: f32,
    // settings
    pub size: f32,
    pub pre_s: f32,
    pub tone: f32,
    pub ret: f32,
    pub on: bool,
    /// Decay time in seconds instead of Size's (0 = use Size). Geode's room sets it directly.
    pub t60: f32,
    decay: Smoother,
    pre_n: Smoother,
    gain: Smoother,
    input: Smoother,
    damp_c: f32,
    out_c: f32,
    coef: f32,
}

impl Reverb {
    pub fn new(fs: f32) -> Reverb {
        let s = fs / BASE;
        let n = |x: f32| (x * s) as usize + 4;
        let mut r = Reverb {
            fs,
            s,
            pre: Line::new((0.1 * fs) as usize + 4),
            diff: [Line::new(n(142.0)), Line::new(n(107.0)), Line::new(n(379.0)), Line::new(n(277.0))],
            ap_l1: Line::new(n(672.0 + MOD_DEPTH + 2.0)),
            d_l1: Line::new(n(4453.0)),
            ap_l2: Line::new(n(1800.0)),
            d_l2: Line::new(n(3720.0)),
            ap_r1: Line::new(n(908.0 + MOD_DEPTH + 2.0)),
            d_r1: Line::new(n(4217.0)),
            ap_r2: Line::new(n(2656.0)),
            d_r2: Line::new(n(3163.0)),
            bw: 0.0,
            damp: [0.0; 2],
            out_lp: [0.0; 2],
            last: [0.0; 2],
            phase: 0.0,
            size: 0.45,
            pre_s: 0.02,
            tone: 0.6,
            ret: 0.7,
            on: true,
            t60: 0.0,
            decay: Smoother::new(0.5),
            pre_n: Smoother::new(0.02 * fs),
            gain: Smoother::new(0.7),
            input: Smoother::new(1.0),
            damp_c: 0.5,
            out_c: 0.5,
            coef: crate::dsp::one_pole_coef(0.05, fs),
        };
        r.update();
        r
    }

    /// Decay time in seconds for a Size setting (0..1).
    pub fn seconds(size: f32) -> f32 {
        0.4 + size.clamp(0.0, 1.0) * 5.6
    }
    /// Tone (0..1) to a cutoff in Hz: 800 Hz … 16 kHz.
    pub fn tone_hz(tone: f32) -> f32 {
        800.0 * crate::dsp::powf(20.0, tone.clamp(0.0, 1.0))
    }

    /// Apply the settings (call after changing them).
    pub fn update(&mut self) {
        let t60 = if self.t60 > 0.0 { self.t60.clamp(0.1, 12.0) } else { Self::seconds(self.size) };
        // The decay gain is applied twice per half loop (inside the half, and where it crosses to the
        // other half), so each half loop loses decay²: 60 dB over t60 seconds.
        self.decay.target = crate::dsp::powf(10.0, -1.5 * HALF_LOOP / t60).min(0.93);
        self.pre_n.target = (self.pre_s.clamp(0.0, 0.1) * self.fs).max(1.0);
        self.gain.target = self.ret.clamp(0.0, 1.0);
        self.input.target = if self.on { 1.0 } else { 0.0 };
        let fc = Self::tone_hz(self.tone);
        self.damp_c = lp_coef(fc, self.fs);
        self.out_c = lp_coef((fc * 1.5).min(18000.0), self.fs);
    }

    pub fn clear(&mut self) {
        for l in [&mut self.pre, &mut self.ap_l1, &mut self.d_l1, &mut self.ap_l2, &mut self.d_l2, &mut self.ap_r1, &mut self.d_r1, &mut self.ap_r2, &mut self.d_r2] {
            l.clear();
        }
        for l in self.diff.iter_mut() {
            l.clear();
        }
        self.damp = [0.0; 2];
        self.out_lp = [0.0; 2];
        self.last = [0.0; 2];
        self.bw = 0.0;
    }

    /// Adds the reverb of (in_l, in_r) to (out_l, out_r).
    pub fn process(&mut self, in_l: &[f32], in_r: &[f32], out_l: &mut [f32], out_r: &mut [f32]) {
        let s = self.s;
        let c = self.coef;
        let dphase = 0.7 / self.fs; // tank modulation, 0.7 Hz
        let bw_c = lp_coef(14000.0, self.fs);
        for i in 0..out_l.len() {
            let decay = self.decay.next(c);
            let gain = self.gain.next(c);
            let x = 0.5 * (in_l[i] + in_r[i]) * self.input.next(c);
            // input: pre-delay, band limit, four diffusers
            self.pre.push(x);
            let mut d = self.pre.read_frac(self.pre_n.next(c));
            d = one_pole(&mut self.bw, d, bw_c);
            for (k, (len, g)) in IN_DIFF.iter().enumerate() {
                d = self.diff[k].allpass(d, libm::roundf(len * s), *g);
            }
            // tank
            self.phase += dphase;
            if self.phase >= 1.0 {
                self.phase -= 1.0;
            }
            let m = sinf(TAU * self.phase) * MOD_DEPTH * s;
            let a = self.ap_l1.allpass(d + decay * self.last[1], 672.0 * s + m, -0.7);
            let t = self.d_l1.read((4453.0 * s) as usize);
            self.d_l1.push(a);
            let t = one_pole(&mut self.damp[0], t, self.damp_c) * decay;
            let b = self.ap_l2.allpass(t, libm::roundf(1800.0 * s), 0.5);
            let end_l = self.d_l2.read((3720.0 * s) as usize);
            self.d_l2.push(b);

            let a = self.ap_r1.allpass(d + decay * self.last[0], 908.0 * s - m, -0.7);
            let t = self.d_r1.read((4217.0 * s) as usize);
            self.d_r1.push(a);
            let t = one_pole(&mut self.damp[1], t, self.damp_c) * decay;
            let b = self.ap_r2.allpass(t, libm::roundf(2656.0 * s), 0.5);
            let end_r = self.d_r2.read((3163.0 * s) as usize);
            self.d_r2.push(b);
            self.last = [flush(end_l), flush(end_r)];

            // stereo taps (Dattorro, table 2)
            let tap = |l: &Line, n: f32| l.read(((n * s) as usize).max(1));
            let yl = tap(&self.d_r1, 266.0) + tap(&self.d_r1, 2974.0) - tap(&self.ap_r2, 1913.0) + tap(&self.d_r2, 1996.0)
                - tap(&self.d_l1, 1990.0) - tap(&self.ap_l2, 187.0) - tap(&self.d_l2, 1066.0);
            let yr = tap(&self.d_l1, 353.0) + tap(&self.d_l1, 3627.0) - tap(&self.ap_l2, 1228.0) + tap(&self.d_l2, 2673.0)
                - tap(&self.d_r1, 2111.0) - tap(&self.ap_r2, 335.0) - tap(&self.d_r2, 121.0);
            let yl = one_pole(&mut self.out_lp[0], yl * 0.6, self.out_c);
            let yr = one_pole(&mut self.out_lp[1], yr * 0.6, self.out_c);
            out_l[i] += yl * gain;
            out_r[i] += yr * gain;
        }
    }
}
