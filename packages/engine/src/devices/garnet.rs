//! Garnet: a string synth. Six modelled strings, a guitar body, an amp.
//!
//! Each string is a plucked-string model (Karplus–Strong, extended): a pluck fills a tuned loop with a burst
//! of noise (darker for a soft thumb, brighter for a hard pick) minus itself a little later (plucking at a
//! point silences the harmonics with a node there). The loop then loses a little level and brightness on
//! every pass, so the note rings and mellows like a string. The loop's filter delay is subtracted from its
//! length and the length is read with interpolation, so every note is in tune (tests: within a few cents).
//!
//! Body: three resonances and a tone filter per guitar (Nylon, Steel, Hollow), or Electric: a pickup
//! resonance instead of a wooden box. Distortion: a pedal before the amp, warm fuzz at low settings, tight
//! high-gain metal at the top (two clipping stages, 4× oversampled). Amp: Drive (tanh, 2× oversampled, level-matched at a typical level, so it adds grit, not volume),
//! Cab (Direct, Combo, Stack), Presence, Level.
//!
//! Notes are given to strings the way a guitarist's hand would: a note already ringing on a string is
//! re-plucked there; otherwise the highest free string that can play it (lowest fret, frets 0–19) takes it,
//! so a chord sent low to high (a strum) lands on the strings a guitarist would use. With six strings held,
//! the string held longest is taken. Ring sets how long a string keeps sounding after its note ends (in a
//! Piano roll: short notes = damped, Ring at full = let ring). Palm mute plays short, thumpy notes.
//! Slide (off by default): a legato note glides the held string instead of plucking another, for lead
//! lines. Strum is the neck's strum speed (the studio uses it; the engine ignores it).

use crate::device::{Device, ModSource, RouteError};
use crate::dsp::biquad::Biquad;
use crate::dsp::halfband::Decimator;
use crate::dsp::rng::Rng;
use crate::dsp::{clamp01, expf, flush, note_hz, one_pole_coef, powf, sat, sinf, TAU};

pub const STRINGS: usize = 6;
/// Standard tuning, low E to high E (MIDI notes).
pub const TUNING: [u8; STRINGS] = [40, 45, 50, 55, 59, 64];
pub const MAX_FRET: u8 = 19;
const N: usize = 2048;
const M: usize = N - 1;

pub mod p {
    pub const PICK: usize = 0;
    pub const HARD: usize = 1;
    pub const SUSTAIN: usize = 2;
    pub const BRIGHT: usize = 3;
    pub const BODY: usize = 4;
    pub const RESO: usize = 5;
    pub const TONE: usize = 6;
    pub const DRIVE: usize = 7;
    pub const CAB: usize = 8;
    pub const PRES: usize = 9;
    pub const LVL: usize = 10;
    pub const STRUM: usize = 11;
    pub const VIB: usize = 12;
    pub const SLIDE: usize = 13;
    pub const MUTE: usize = 14;
    pub const RING: usize = 15;
    pub const DIST: usize = 16;
    pub const WHAM: usize = 17;
    pub const COUNT: usize = 18;
}

/// Parameter ids, in index order (they match `devices/garnet.json`).
pub const IDS: [&str; p::COUNT] =
    ["pick", "hard", "sustain", "bright", "body", "reso", "tone", "drive", "cab", "pres", "lvl", "strum", "vib", "slide", "mute", "ring", "dist", "wham"];

/// "Clean Electric".
pub fn defaults() -> [f32; p::COUNT] {
    [0.2, 0.6, 0.55, 0.6, 3.0, 0.6, 0.55, 0.12, 1.0, 0.55, 0.75, 0.35, 0.0, 0.0, 0.0, 0.5, 0.0, 0.5]
}

fn discrete_max(i: usize) -> Option<f32> {
    match i {
        p::BODY => Some(3.0),
        p::CAB => Some(2.0),
        p::MUTE => Some(1.0),
        _ => None,
    }
}

/// Whammy bar → loop length multiplier. 0.5 = rest; down to 0 dives 7 semitones, up to 1 raises 2.
pub fn whammy_ratio(v: f32) -> f32 {
    let st = if v < 0.5 { -(0.5 - v) * 14.0 } else { (v - 0.5) * 4.0 };
    powf(2.0, -st / 12.0)
}

/// Seconds a string rings at full Sustain for a note of `hz` (lower notes ring longer).
pub fn sustain_seconds(sustain: f32, hz: f32) -> f32 {
    (0.35 + sustain * sustain * 7.5) * powf(110.0 / hz, 0.35)
}

struct Body {
    hp: f32,
    bells: [(f32, f32, f32); 3], // Hz, dB, Q
    lp: f32,
    q: f32,
}
const BODIES: [Body; 4] = [
    Body { hp: 75.0, bells: [(105.0, 7.0, 1.4), (210.0, 4.0, 1.6), (2800.0, -4.0, 0.8)], lp: 4500.0, q: 0.7 }, // Nylon
    Body { hp: 80.0, bells: [(100.0, 5.0, 1.4), (220.0, 3.0, 1.8), (3200.0, 4.0, 0.9)], lp: 10000.0, q: 0.7 }, // Steel
    Body { hp: 70.0, bells: [(140.0, 6.0, 1.2), (360.0, 3.0, 1.4), (1800.0, -3.0, 1.0)], lp: 2600.0, q: 1.1 }, // Hollow
    Body { hp: 60.0, bells: [(120.0, 0.0, 1.0), (400.0, -1.0, 1.0), (3000.0, 5.0, 2.2)], lp: 5000.0, q: 1.6 }, // Electric
];
struct Cab {
    hp: f32,
    bell: (f32, f32, f32),
    lp: f32,
    q: f32,
}
const CABS: [Cab; 3] = [
    Cab { hp: 40.0, bell: (1000.0, 0.0, 0.7), lp: 16000.0, q: 0.7 }, // Direct
    Cab { hp: 90.0, bell: (1500.0, 2.0, 0.8), lp: 5500.0, q: 0.9 },  // Combo
    Cab { hp: 110.0, bell: (850.0, 3.5, 0.9), lp: 3800.0, q: 1.3 },  // Stack
];

/// Floats of loop memory a Garnet needs (six strings).
pub const MEM: usize = STRINGS * N;

struct Str {
    w: usize,
    per: f32,
    tper: f32,
    lp: f32,
    note: u8,
    live: bool,
    held: bool,
    released: bool,
    kill: bool,
    muted: bool,
    quiet: usize,
    age: u32,
}

impl Str {
    const fn new() -> Str {
        Str { w: 0, per: 100.0, tper: 100.0, lp: 0.0, note: 0, live: false, held: false, released: false, kill: false, muted: false, quiet: 0, age: 0 }
    }
    fn stop(&mut self, b: &mut [f32]) {
        self.live = false;
        self.held = false;
        b.fill(0.0);
        self.lp = 0.0;
    }
}

#[derive(Clone, Copy, Default)]
struct Coef {
    g: f32,
    c: f32,
    comp: f32,
    gl: f32,
    gr: f32,
}

pub struct Garnet {
    fs: f32,
    params: [f32; p::COUNT],
    /// The six strings' loops, `N` floats each (static memory in WebAssembly, see `Garnet::with_memory`).
    mem: &'static mut [f32],
    strs: [Str; STRINGS],
    rng: Rng,
    clock: u32,
    phase: f32,
    /// Whammy: loop length multiplier now (1 = at rest).
    wham: f32,
    dc: [f32; 4],
    hp: [Biquad; 2],
    bells: [[Biquad; 3]; 2],
    tone: [Biquad; 2],
    chp: [Biquad; 2],
    cbell: [Biquad; 2],
    clp: [Biquad; 2],
    pres: [Biquad; 2],
    /// The amp runs at four times the rate: 4× → 2× → 1× through two half-band decimators.
    dec: [Decimator; 2],
    dec2: [Decimator; 2],
    prev: [f32; 2],
    /// Distortion pedal: tightening (low cut, mid push, fizz cut) and the filter between its two stages.
    dhp: [Biquad; 2],
    dmid: [Biquad; 2],
    dlp: [Biquad; 2],
    dz: [f32; 2],
    // block-rate smoothed knobs: reso, tone, drive, pres, lvl, dist
    sm: [f32; 6],
    primed: bool,
}

impl Default for Garnet {
    fn default() -> Self {
        Garnet::new()
    }
}

impl Garnet {
    /// A Garnet with its own loop memory (taken from the engine's pool).
    pub fn new() -> Garnet {
        Garnet::with_memory(crate::fx::line::take_mem(MEM))
    }

    /// A Garnet over `mem` (at least `MEM` floats). The rack keeps one block per slot and reuses it.
    pub fn with_memory(mem: &'static mut [f32]) -> Garnet {
        mem.fill(0.0);
        Garnet {
            fs: 48_000.0,
            params: defaults(),
            mem,
            strs: core::array::from_fn(|_| Str::new()),
            rng: Rng::new(0x6A_12E7),
            clock: 0,
            phase: 0.0,
            wham: 1.0,
            dc: [0.0; 4],
            hp: [Biquad::new(); 2],
            bells: [[Biquad::new(); 3]; 2],
            tone: [Biquad::new(); 2],
            chp: [Biquad::new(); 2],
            cbell: [Biquad::new(); 2],
            clp: [Biquad::new(); 2],
            pres: [Biquad::new(); 2],
            dec: [Decimator::new(), Decimator::new()],
            dec2: [Decimator::new(), Decimator::new()],
            prev: [0.0; 2],
            dhp: [Biquad::new(); 2],
            dmid: [Biquad::new(); 2],
            dlp: [Biquad::new(); 2],
            dz: [0.0; 2],
            sm: [0.0; 6],
            primed: false,
        }
    }

    /// Which string each note is ringing on (`None` = silent), for tests and the studio's neck view.
    pub fn strings(&self) -> [Option<u8>; STRINGS] {
        core::array::from_fn(|s| if self.strs[s].live { Some(self.strs[s].note) } else { None })
    }

    /// Is any string sounding?
    pub fn active(&self) -> bool {
        self.strs.iter().any(|s| s.live)
    }

    fn choose(&self, note: u8) -> usize {
        if let Some(s) = self.strs.iter().position(|s| s.live && s.note == note) {
            return s;
        }
        let can = |s: usize| note >= TUNING[s] && note - TUNING[s] <= MAX_FRET;
        if let Some(s) = (0..STRINGS).rev().find(|&s| can(s) && !self.strs[s].held) {
            return s;
        }
        if let Some(s) = (0..STRINGS).filter(|&s| can(s)).min_by_key(|&s| self.strs[s].age) {
            return s;
        }
        // out of a guitar's range: the nearest string plays it anyway
        if note < TUNING[0] {
            0
        } else {
            STRINGS - 1
        }
    }

    fn pluck(&mut self, s: usize, note: u8, vel: f32) {
        let (fs, hard, pick, mute) = (self.fs, self.params[p::HARD], self.params[p::PICK], self.params[p::MUTE] >= 0.5);
        self.clock = self.clock.wrapping_add(1);
        let rng = &mut self.rng;
        let st = &mut self.strs[s];
        let b = &mut self.mem[s * N..(s + 1) * N];
        let per = (fs / note_hz(note as f32)).clamp(4.0, (N - 8) as f32);
        st.per = per;
        st.tper = per;
        // the burst fills the last `l` samples of the loop (a re-pluck replaces what was ringing)
        let l = ((libm::ceilf(per) as usize) + 2).min(N - 2);
        let base = st.w + N - l;
        let h = (0.05 + hard * 0.9 + vel * 0.05).min(0.98);
        let mut lp = 0.0;
        for i in 0..l {
            lp += h * (rng.bipolar() - lp);
            b[(base + i) & M] = lp;
        }
        let d = (((0.04 + pick * 0.42) * l as f32) as usize).max(1);
        let mut mx = 1e-6f32;
        for i in (0..l).rev() {
            if i >= d {
                b[(base + i) & M] -= b[(base + i - d) & M];
            }
            mx = mx.max(b[(base + i) & M].abs());
        }
        let g = vel.clamp(0.0, 1.0) * 0.5 / mx;
        for i in 0..l {
            b[(base + i) & M] *= g;
        }
        st.lp = 0.0;
        st.note = note;
        st.live = true;
        st.held = true;
        st.released = false;
        st.kill = false;
        st.muted = mute;
        st.quiet = 0;
        st.age = self.clock;
    }

    fn coef(&self, st: &Str, i: usize) -> Coef {
        let (fs, sus, bright, ring) = (self.fs, self.params[p::SUSTAIN], self.params[p::BRIGHT], self.params[p::RING]);
        let hz = fs / st.per;
        let full = sustain_seconds(sus, hz);
        // a held note keeps ringing (an electric guitar sustains as long as it's held): much less loss while
        // held, up to ~16× Sustain at full; the release (Ring) shapes the tail after
        let mut t = if st.muted { 0.14 } else if st.held { full * (1.0 + 15.0 * sus * sus) } else { full };
        if st.released {
            t = t.min(0.05 + ring * ring * full);
        }
        if st.kill {
            t = 0.02;
        }
        let mut c = if st.muted { 0.22 + bright * 0.2 } else { 0.2 + bright * 0.78 };
        // held: the loop's tone filter takes almost nothing from the note (the string sings on, like a guitar
        // into a hot amp); it darkens again when the note is let go
        if st.held && !st.muted && !st.kill {
            c += (1.0 - c) * 0.9 * sus;
        }
        let pan = (i as f32 - 2.5) * 0.12;
        let a = (pan + 1.0) * core::f32::consts::FRAC_PI_4;
        Coef { g: powf(10.0, -3.0 * st.per / (fs * t)), c, comp: (1.0 - c) / c, gl: libm::cosf(a), gr: sinf(a) }
    }

    /// Body, tone, cab and presence filters from the (block-smoothed) knobs.
    fn filters(&mut self) {
        let fs = self.fs;
        let body = &BODIES[self.params[p::BODY] as usize];
        let cab = &CABS[self.params[p::CAB] as usize];
        let (reso, tone, pres, dist) = (self.sm[0], self.sm[1], self.sm[3], self.sm[5]);
        for ch in 0..2 {
            // the pedal tightens as it gains: less boom, more mids, less fizz (all flat at 0)
            self.dhp[ch].highpass(20.0 + dist * 160.0, 0.7, fs);
            self.dmid[ch].peaking(850.0, 0.8, dist * 7.0, fs);
            self.dlp[ch].lowpass(18_000.0 - dist * 11_000.0, 0.7, fs);
            self.hp[ch].highpass(body.hp, 0.7, fs);
            for (k, &(f, db, q)) in body.bells.iter().enumerate() {
                self.bells[ch][k].peaking(f, q, db * reso * 1.6, fs);
            }
            self.tone[ch].lowpass((body.lp * powf(2.0, (tone - 0.5) * 2.5)).min(18_000.0), body.q, fs);
            self.chp[ch].highpass(cab.hp, 0.7, fs);
            self.cbell[ch].peaking(cab.bell.0, cab.bell.2, cab.bell.1, fs);
            self.clp[ch].lowpass(cab.lp, cab.q, fs);
            self.pres[ch].highshelf(3000.0, (pres - 0.5) * 16.0, fs);
        }
    }
}

impl Device for Garnet {
    fn prepare(&mut self, sample_rate: f32) {
        self.fs = sample_rate;
        for (i, s) in self.strs.iter_mut().enumerate() {
            s.stop(&mut self.mem[i * N..(i + 1) * N]);
        }
        self.primed = false;
    }
    fn param_count(&self) -> usize {
        p::COUNT
    }
    fn set_param(&mut self, index: usize, value: f32) {
        if index >= p::COUNT || !value.is_finite() {
            return;
        }
        self.params[index] = match discrete_max(index) {
            Some(max) => libm::roundf(value).clamp(0.0, max),
            None => clamp01(value),
        };
    }
    fn param(&self, index: usize) -> f32 {
        self.params.get(index).copied().unwrap_or(0.0)
    }
    fn effective(&self) -> &[f32] {
        &self.params
    }
    fn set_route(&mut self, _slot: usize, _src: ModSource, _target: usize, _depth: f32) -> Result<(), RouteError> {
        Err(RouteError::NotAllowed)
    }
    fn clear_route(&mut self, _slot: usize) {}
    fn mod_source_value(&self, _src: ModSource) -> f32 {
        0.0
    }
    fn note_on(&mut self, note: u8, velocity: f32) {
        if velocity <= 0.0 {
            self.note_off(note);
            return;
        }
        // Slide: a legato note glides the most recently plucked held string, if it can reach the note.
        if self.params[p::SLIDE] > 0.0 {
            let last = (0..STRINGS).filter(|&s| self.strs[s].held && self.strs[s].live).max_by_key(|&s| self.strs[s].age);
            if let Some(s) = last {
                let st = &self.strs[s];
                if note >= TUNING[s] && note - TUNING[s] <= MAX_FRET && (note as i32 - st.note as i32).abs() <= 12 {
                    let fs = self.fs;
                    let st = &mut self.strs[s];
                    st.tper = (fs / note_hz(note as f32)).clamp(4.0, (N - 8) as f32);
                    st.note = note;
                    return;
                }
            }
        }
        let s = self.choose(note);
        self.pluck(s, note, velocity);
    }
    fn note_off(&mut self, note: u8) {
        for st in self.strs.iter_mut().filter(|s| s.held && s.note == note) {
            st.held = false;
            st.released = true;
        }
    }
    fn all_notes_off(&mut self) {
        for st in self.strs.iter_mut().filter(|s| s.live) {
            st.held = false;
            st.released = true;
            st.kill = true;
        }
    }
    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        let fs = self.fs;
        // knobs glide over ~15 ms at block rate (no zipper noise from the filters)
        let targets = [self.params[p::RESO], self.params[p::TONE], self.params[p::DRIVE], self.params[p::PRES], self.params[p::LVL], self.params[p::DIST]];
        let k = if self.primed { one_pole_coef(0.015, fs / n.max(1) as f32) } else { 1.0 };
        for (s, t) in self.sm.iter_mut().zip(targets) {
            *s += (t - *s) * k;
        }
        self.primed = true;
        self.filters();
        let co: [Coef; STRINGS] = core::array::from_fn(|i| if self.strs[i].live { self.coef(&self.strs[i], i) } else { Coef::default() });
        let slide = self.params[p::SLIDE];
        let gl = 1.0 - expf(-1.0 / (fs * (0.004 + slide * slide * 0.3)));
        let vib = self.params[p::VIB] * 0.006;
        let dphase = 5.2 / fs;
        let drive = 0.5 + self.sm[2] * 12.0;
        let tk = sat(drive);
        // level-matched at a typical level into the amp: driving adds grit and squash, not volume
        const REF: f32 = 0.15;
        let post = REF / (sat(REF * drive) / tk);
        // Distortion pedal: an asymmetric stage (even harmonics: warm, fuzzy), a smoothing filter, a second
        // stage for the high-gain end. Level-matched at a typical level; blended in over the first 1/6 of the
        // knob so it starts from exactly clean.
        let d = self.sm[5];
        let g1 = 1.0 + d * d * 60.0;
        let g2 = 1.0 + d * 6.0;
        const BIAS: f32 = 0.3;
        // `sat` is a fast tanh (Padé), cheap enough for twelve curves per sample
        let tb = sat(BIAS);
        let st1 = move |v: f32| sat(g1 * v + BIAS) - tb;
        let chain = move |v: f32| sat(g2 * st1(v));
        const DREF: f32 = 0.035;
        let dpost = DREF / chain(DREF).abs().max(1e-6);
        let wet = (d * 6.0).min(1.0);
        let zc = 1.0 - expf(-TAU * 6500.0 / (4.0 * fs));
        let lvl = self.sm[4] * self.sm[4] * 1.6;
        let quiet_after = (0.2 * fs) as usize;
        // whammy: the loop length follows the bar (glides over ~12 ms, so a drag never clicks)
        let wham_k = 1.0 - expf(-1.0 / (fs * 0.012));
        let wham_to = whammy_ratio(self.params[p::WHAM]);
        for k in 0..n {
            self.phase += dphase;
            if self.phase >= 1.0 {
                self.phase -= 1.0;
            }
            self.wham += (wham_to - self.wham) * wham_k;
            let wob = (1.0 + vib * sinf(TAU * self.phase)) * self.wham;
            let (mut l, mut r) = (0.0, 0.0);
            for (i, st) in self.strs.iter_mut().enumerate() {
                if !st.live {
                    continue;
                }
                let c = &co[i];
                let b = &mut self.mem[i * N..(i + 1) * N];
                st.per += (st.tper - st.per) * gl;
                let pos = (st.w + N) as f32 - ((st.per * wob).min((N - 8) as f32) - c.comp);
                let i0 = pos as usize;
                let fr = pos - i0 as f32;
                let a = b[i0 & M];
                let y = a + (b[(i0 + 1) & M] - a) * fr;
                st.lp = flush(st.lp + c.c * (y - st.lp));
                let v = flush(st.lp * c.g);
                b[st.w] = v;
                st.w = (st.w + 1) & M;
                l += v * c.gl;
                r += v * c.gr;
                if v.abs() < 2e-5 {
                    st.quiet += 1;
                    if st.quiet > quiet_after + st.per as usize {
                        st.stop(b);
                    }
                } else {
                    st.quiet = 0;
                }
            }
            // DC blockers, then body, amp, cab, presence, level
            let yl = l - self.dc[0] + 0.995 * self.dc[1];
            self.dc[0] = l;
            self.dc[1] = flush(yl);
            let yr = r - self.dc[2] + 0.995 * self.dc[3];
            self.dc[2] = r;
            self.dc[3] = flush(yr);
            let mut out = [0.0f32; 2];
            for (ch, x) in [yl, yr].into_iter().enumerate() {
                let mut x = self.hp[ch].process(x);
                for b in self.bells[ch].iter_mut() {
                    x = b.process(x);
                }
                x = self.tone[ch].process(x);
                x = self.dlp[ch].process(self.dmid[ch].process(self.dhp[ch].process(x)));
                // pedal and amp at four times the rate, then back down
                let p0 = self.prev[ch];
                self.prev[ch] = x;
                let mut sub = [0.0f32; 4];
                for (j, o) in sub.iter_mut().enumerate() {
                    let v = p0 + (x - p0) * (j as f32 + 1.0) * 0.25;
                    let mut y = v;
                    if wet > 0.0 {
                        let a = st1(v);
                        self.dz[ch] = flush(self.dz[ch] + zc * (a - self.dz[ch]));
                        y = v + (sat(g2 * self.dz[ch]) * dpost - v) * wet;
                    }
                    *o = sat(drive * y) / tk;
                }
                let a = self.dec[ch].process(sub[0], sub[1]);
                let b = self.dec[ch].process(sub[2], sub[3]);
                x = self.dec2[ch].process(a, b) * post;
                x = self.chp[ch].process(x);
                x = self.cbell[ch].process(x);
                x = self.clp[ch].process(x);
                x = self.pres[ch].process(x);
                out[ch] = x * lvl;
            }
            // a gentle bus limiter so a hard six-string strum never clips (never above 0.98)
            left[k] = 0.98 * sat(out[0] * 0.92);
            right[k] = 0.98 * sat(out[1] * 0.92);
        }
    }
}
