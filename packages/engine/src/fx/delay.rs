//! Delay: stereo echoes that follow the tempo (the host sends the time in seconds).
//! Each repeat passes a low cut (80 Hz), the Tone low-pass and a soft saturator, so the echoes
//! darken and blur like an analog delay and high feedback can never run away. Ping-pong feeds the
//! input to the left side and crosses every repeat to the other side. A time change glides.

use super::line::{lp_coef, one_pole, Line};
use crate::dsp::{sat, smooth::Smoother};

pub const MAX_SECONDS: f32 = 2.0;

pub struct Delay {
    fs: f32,
    l: Line,
    r: Line,
    lp: [f32; 2],
    hp: [f32; 2],
    pub time: f32,
    pub feedback: f32,
    pub tone: f32,
    pub ping_pong: bool,
    pub ret: f32,
    pub on: bool,
    t: Smoother,
    fb: Smoother,
    gain: Smoother,
    input: Smoother,
    tone_c: f32,
    hp_c: f32,
    coef: f32,
    glide: f32,
}

impl Delay {
    pub fn new(fs: f32) -> Delay {
        let max = (MAX_SECONDS * fs) as usize + 4;
        let mut d = Delay {
            fs,
            l: Line::new(max),
            r: Line::new(max),
            lp: [0.0; 2],
            hp: [0.0; 2],
            time: 0.4,
            feedback: 0.45,
            tone: 0.55,
            ping_pong: true,
            ret: 0.6,
            on: true,
            t: Smoother::new(0.4 * fs),
            fb: Smoother::new(0.4),
            gain: Smoother::new(0.6),
            input: Smoother::new(1.0),
            tone_c: 0.5,
            hp_c: lp_coef(80.0, fs),
            coef: crate::dsp::one_pole_coef(0.01, fs),
            glide: crate::dsp::one_pole_coef(0.08, fs),
        };
        d.update();
        d
    }

    /// Tone (0..1) to the repeats' cutoff in Hz: 500 Hz … 14 kHz.
    pub fn tone_hz(tone: f32) -> f32 {
        500.0 * crate::dsp::powf(28.0, tone.clamp(0.0, 1.0))
    }

    pub fn update(&mut self) {
        self.t.target = (self.time.clamp(0.01, MAX_SECONDS) * self.fs).min((self.l.len() - 4) as f32);
        self.fb.target = self.feedback.clamp(0.0, 1.0) * 0.92;
        self.gain.target = self.ret.clamp(0.0, 1.0);
        self.input.target = if self.on { 1.0 } else { 0.0 };
        self.tone_c = lp_coef(Self::tone_hz(self.tone), self.fs);
    }

    pub fn clear(&mut self) {
        self.l.clear();
        self.r.clear();
        self.lp = [0.0; 2];
        self.hp = [0.0; 2];
    }

    /// Adds the echoes of (in_l, in_r) to (out_l, out_r).
    pub fn process(&mut self, in_l: &[f32], in_r: &[f32], out_l: &mut [f32], out_r: &mut [f32]) {
        let c = self.coef;
        for i in 0..out_l.len() {
            let t = self.t.next(self.glide);
            let fb = self.fb.next(c);
            let gain = self.gain.next(c);
            let g_in = self.input.next(c);
            let el = self.l.read_frac(t);
            let er = self.r.read_frac(t);
            // repeats: low cut (one-pole high-pass), tone, soft saturation
            let mut shape = |k: usize, x: f32| {
                let low = one_pole(&mut self.hp[k], x, self.hp_c);
                sat(one_pole(&mut self.lp[k], x - low, self.tone_c) * fb)
            };
            let fl = shape(0, el);
            let fr = shape(1, er);
            if self.ping_pong {
                self.l.push(0.5 * (in_l[i] + in_r[i]) * g_in + fr);
                self.r.push(fl);
            } else {
                self.l.push(in_l[i] * g_in + fl);
                self.r.push(in_r[i] * g_in + fr);
            }
            out_l[i] += el * gain;
            out_r[i] += er * gain;
        }
    }
}
