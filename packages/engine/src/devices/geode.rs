//! Geode: a sampler with a little room in it (for people who have never made music).
//!
//! It starts empty. The page records a few seconds of any instrument in the session (up to 30 s) and
//! loads it into this device's tape (`attach_bank` + `set_sample`). Eight voices play the tape:
//!   Classic (pitched by the key, looping the trimmed part), Reverse, or Slices (eight slices, one per
//!   scale degree, at the tape's own pitch), blended with Grains (tiny Hann-windowed slices read
//!   around a moving head: size, density, spread, pitch).
//! Then: Crunch (bit / rate crush) → Drive (tape saturation) → Body (low shelf) → Thin (high-pass) →
//!   Tone (low-pass) → the Window filter (a resonant low-pass that sways with the blinds, plus wind
//!   noise coloured by the temperature) → Chorus → Echo (tempo-synced) → Room (its own plate reverb
//!   and early reflections) → a glue compressor + make-up + a safety limiter → where Mica stands
//!   (distance and pan, walking or not) → the Light (a master low-pass dimmer) → Level.
//!
//! The front controls are macros. Each wishes values for the knobs behind it; when several pull on
//! the same knob the result is the weighted average of the knob and the wishes, never their sum
//! (`macro_mix`), and every Temperature link has its own scale. The thermometer and the window ease
//! toward where they were set (a critically damped spring), so the sound moves slowly and everyone
//! hears the same thing. Motion is one LFO in time with the song (it is also the LFO mod source).
//!
//! Memory: the tape and the room / echo lines live in blocks the rack gives this slot (see
//! `Rack::add_device`, `Rack::sample_alloc`), never in the shared effects pool.

use crate::device::{Device, ModSource, RouteError, MAX_ROUTES};
use crate::dsp::biquad::Biquad;
use crate::dsp::env::{Adsr, AdsrCoefs, AdsrTimes};
use crate::dsp::rng::Rng;
use crate::dsp::svf::Svf;
use crate::dsp::{clamp01, exp2, flush, one_pole_coef, sinf, TAU};
use crate::fx::delay::Delay;
use crate::fx::line::{self, Line};
use crate::fx::reverb::Reverb;

pub const VOICES: usize = 8;
pub const GRAINS: usize = 64;
/// Longest tape, seconds (the bank holds a little more, for rounding).
pub const MAX_SECONDS: f32 = 30.0;
pub const SLICES: usize = 8;
const CTL: usize = 32;
const HANN_N: usize = 512;
const EVENTS: usize = 32;
/// The panel's numbers (see `viz`): 3 + 8 voices × 2 + 1 + EVENTS × 2.
pub const VIZ_LEN: usize = 3 + VOICES * 2 + 1 + EVENTS * 2;

pub mod p {
    // front: the dock's controls
    pub const TEMP: usize = 0;
    pub const AIR: usize = 1;
    pub const ROOM: usize = 2;
    pub const WET: usize = 3;
    pub const DIV: usize = 4;
    pub const FB: usize = 5;
    pub const EWET: usize = 6;
    pub const BREATH: usize = 7;
    pub const LIGHT: usize = 8;
    pub const GRAINS: usize = 9;
    pub const GSIZE: usize = 10;
    pub const GDENS: usize = 11;
    pub const CRUNCH: usize = 12;
    pub const MODE: usize = 13;
    pub const SPEED: usize = 14;
    pub const POS: usize = 15;
    pub const START: usize = 16;
    pub const END: usize = 17;
    pub const LVL: usize = 18;
    pub const PX: usize = 19;
    pub const PZ: usize = 20;
    pub const WALK: usize = 21;
    pub const WBARS: usize = 22;
    pub const MSHAPE: usize = 23;
    pub const MRATE: usize = 24;
    pub const MDEPTH: usize = 25;
    pub const MTO: usize = 26;
    // back: the knobs the macros move
    pub const DRIVE: usize = 27;
    pub const TONE: usize = 28;
    pub const BODY: usize = 29;
    pub const THIN: usize = 30;
    pub const GPITCH: usize = 31;
    pub const GSPEED: usize = 32;
    pub const SPREAD: usize = 33;
    pub const CHORUS: usize = 34;
    pub const DAMP: usize = 35;
    pub const CUT: usize = 36;
    pub const RES: usize = 37;
    pub const SWAY: usize = 38;
    pub const AIRN: usize = 39;
    pub const ATK: usize = 40;
    pub const DEC: usize = 41;
    pub const SUS: usize = 42;
    pub const REL: usize = 43;
    pub const DECAY: usize = 44;
    pub const PRE: usize = 45;
    pub const ER: usize = 46;
    /// Temperature → knob scales, one per TEMP_WISH row (DRIVE..=DAMP).
    pub const S_DRIVE: usize = 47;
    pub const CTH: usize = 56;
    pub const CRATIO: usize = 57;
    pub const CMAKE: usize = 58;
    pub const COUNT: usize = 59;
}

/// Parameter ids, in index order (they match `devices/geode.json`).
pub const IDS: [&str; p::COUNT] = [
    "temp", "air", "room", "wet", "div", "fb", "ewet", "breath", "light", "grains", "gsize", "gdens", "crunch", "mode", "speed", "pos",
    "start", "end", "lvl", "px", "pz", "walk", "wbars", "mshape", "mrate", "mdepth", "mto", "drive", "tone", "body", "thin", "gpitch",
    "gspeed", "spread", "chorus", "damp", "cut", "res", "sway", "airn", "atk", "dec", "sus", "rel", "decay", "pre", "er", "s_drive",
    "s_tone", "s_body", "s_thin", "s_gpitch", "s_gspeed", "s_spread", "s_chorus", "s_damp", "cth", "cratio", "cmake",
];

pub fn defaults() -> [f32; p::COUNT] {
    [
        0.62, 0.15, 0.35, 0.35, 2.0, 0.45, 0.3, 0.4, 1.0, 0.8, 0.35, 0.5, 0.0, 0.0, 2.0 / 3.0, 0.0, //
        0.0, 1.0, 0.7, 0.5, 0.154, 0.0, 1.0, 0.0, 3.0, 0.0, 1.0, 0.15, 0.7, 0.5, 0.05, 0.5, //
        0.5, 0.3, 0.3, 0.5, 0.35, 0.15, 0.0, 0.0, 0.15, 0.4, 0.75, 0.4, 0.3, 0.2, 0.5, 1.0, //
        1.0, 1.0, 1.0, 1.0, 0.7, 1.0, 1.0, 1.0, 0.5, 3.0 / 19.0, 5.0 / 18.0,
    ]
}

/// Echo times, in whole notes (1/16, 1/8, 3/16, 1/4, 1/2).
pub const DIVS: [f32; 5] = [1.0 / 16.0, 1.0 / 8.0, 3.0 / 16.0, 1.0 / 4.0, 1.0 / 2.0];
/// Motion speeds: beats per cycle (1/8, 1/4, 1/2, 1 bar, 2 bars, 4 bars).
pub const MRATES: [f32; 6] = [0.5, 1.0, 2.0, 4.0, 8.0, 16.0];
/// Walk speeds: bars per loop.
pub const WBARS: [f32; 4] = [1.0, 2.0, 4.0, 8.0];
/// What Motion moves (bits of `mto`).
pub mod mt {
    pub const WIN: u32 = 1;
    pub const PITCH: u32 = 2;
    pub const PAN: u32 = 4;
    pub const POS: u32 = 8;
    pub const ECHO: u32 = 16;
    pub const ROOM: u32 = 32;
    pub const CRUNCH: u32 = 64;
}

/// The thermometer's wishes for DRIVE..=DAMP at FREEZING, CHILL, WARM and HOT (knob values 0..1).
pub const TEMP_WISH: [[f32; 4]; 9] = [
    [0.0, 0.0, 0.3, 0.75],    // drive
    [0.95, 0.85, 0.55, 0.8],  // tone (low-pass)
    [0.2, 0.42, 0.75, 0.6],   // body
    [0.55, 0.25, 0.02, 0.0],  // thin (high-pass)
    [0.85, 0.62, 0.5, 0.25],  // grain pitch: up when frozen, down when hot
    [0.05, 0.35, 0.5, 0.3],   // grain speed: near still when frozen, heavier when hot
    [0.05, 0.15, 0.35, 0.75], // grain spread
    [0.85, 0.65, 0.4, 0.15],  // chorus: a wide shiver when cold
    [0.95, 0.8, 0.3, 0.2],    // reverb tail: bright when cold, dark when warm
];

fn discrete_max(i: usize) -> Option<f32> {
    match i {
        p::DIV => Some(4.0),
        p::MODE => Some(2.0),
        p::WALK => Some(4.0),
        p::WBARS | p::MSHAPE => Some(3.0),
        p::MRATE => Some(5.0),
        p::MTO => Some(127.0),
        _ => None,
    }
}

#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}
#[inline]
fn sstep(a: f32, b: f32, x: f32) -> f32 {
    let t = clamp01((x - a) / (b - a));
    t * t * (3.0 - 2.0 * t)
}
/// A smooth path through four points spread over 0..1.
pub fn curve(pts: &[f32; 4], t: f32) -> f32 {
    let x = clamp01(t) * 3.0;
    let i = (x as usize).min(2);
    lerp(pts[i], pts[i + 1], sstep(0.0, 1.0, x - i as f32))
}

/// How macros combine on one knob: the knob's own value, pulled toward each wish by its weight. Alone at
/// full weight a macro reaches its wish; two opposite ones at full weight meet in the middle; weight 0
/// does nothing. The result is never a sum, so stacking macros cannot pin a knob at its end.
pub fn macro_mix(base: f32, wishes: &[(f32, f32)]) -> f32 {
    let mut sw = 0.0;
    let mut pull = 0.0;
    for &(w, x) in wishes {
        let w = w.max(0.0);
        sw += w;
        pull += w * (x - base);
    }
    clamp01(base + pull / sw.max(1.0))
}

/// Tape speed: 0.25× … 2× (exp), 1× at 2/3.
pub fn speed_x(v: f32) -> f32 {
    0.25 * exp2(clamp01(v) * 3.0)
}
/// Grain length, seconds.
pub fn grain_s(v: f32) -> f32 {
    lerp(0.02, 0.3, libm::powf(clamp01(v), 1.3))
}
/// Grains per second, per voice.
pub fn density(v: f32) -> f32 {
    lerp(4.0, 60.0, clamp01(v))
}
pub fn attack_s(v: f32) -> f32 {
    lerp(0.003, 3.0, v * v)
}
pub fn decay_s(v: f32) -> f32 {
    lerp(0.05, 3.0, v * v)
}
pub fn release_s(v: f32) -> f32 {
    lerp(0.03, 5.0, v * v)
}
/// The room's decay time, seconds.
pub fn room_s(v: f32) -> f32 {
    lerp(0.3, 8.0, libm::powf(clamp01(v), 1.3))
}
/// How deep the room looks (the panel draws the same): 1.3 … 9 room units.
pub fn room_depth(room: f32) -> f32 {
    lerp(1.3, 9.0, libm::powf(clamp01(room), 1.4))
}
/// Mica's place: x -0.85..0.85 (left … right), z 0.25..2.2 (front … back).
pub fn place_x(v: f32) -> f32 {
    (clamp01(v) * 2.0 - 1.0) * 0.85
}
pub fn place_z(v: f32) -> f32 {
    0.25 + clamp01(v) * 1.95
}

fn route_allowed(src: ModSource, target: usize) -> bool {
    if target >= p::COUNT || discrete_max(target).is_some() {
        return false;
    }
    match src {
        ModSource::Lfo => !matches!(target, p::MDEPTH),
        ModSource::AmpEnv => !matches!(target, p::ATK | p::DEC | p::SUS | p::REL | p::BREATH),
        ModSource::FiltEnv => false,
    }
}

/// A stereo balance like the web's StereoPanner: at -1 everything is on the left, at 1 on the right.
fn pan_gains(pan: f32) -> (f32, f32, bool) {
    let p = pan.clamp(-1.0, 1.0);
    let x = if p <= 0.0 { p + 1.0 } else { p } * core::f32::consts::FRAC_PI_2;
    if p <= 0.0 { (libm::cosf(x), sinf(x), true) } else { (libm::cosf(x), sinf(x), false) }
}

/// x mod 1, always ≥ 0.
#[inline]
fn frac(x: f64) -> f32 {
    (x - libm::floor(x)) as f32
}
/// x mod span, always ≥ 0.
#[inline]
fn wrap(x: f32, span: f32) -> f32 {
    let r = x % span;
    if r < 0.0 { r + span } else { r }
}

/// Deterministic -1..1 from a counter (the Random motion and walk are the same for everyone).
fn hash11(n: i64, k: u32) -> f32 {
    let mut h = (n as u32).wrapping_mul(2_654_435_761) ^ k.wrapping_mul(40_503);
    h ^= h >> 15;
    h = h.wrapping_mul(2_246_822_519);
    h ^= h >> 13;
    (h >> 8) as f32 / 8_388_608.0 - 1.0
}

#[derive(Clone, Copy)]
struct Route {
    src: ModSource,
    target: usize,
    depth: f32,
}

#[derive(Clone, Copy)]
struct Voice {
    note: u8,
    vel: f32,
    held: bool,
    live: bool,
    age: u32,
    amp: Adsr,
    /// Samples played since the note started (Classic / Reverse / Slices), at the tape's rate.
    pos: f32,
    /// The grain head, samples into the trimmed part.
    head: f32,
    /// Samples until the next grain.
    gt: f32,
    slice: u8,
    level: f32,
}

impl Voice {
    const fn new() -> Voice {
        Voice { note: 0, vel: 0.0, held: false, live: false, age: 0, amp: Adsr::new(), pos: 0.0, head: 0.0, gt: 0.0, slice: 0, level: 0.0 }
    }
}

#[derive(Clone, Copy)]
struct Grain {
    live: bool,
    /// Samples into the trimmed part.
    x: f32,
    rate: f32,
    t: u32,
    len: u32,
    gl: f32,
    gr: f32,
}

impl Grain {
    const fn new() -> Grain {
        Grain { live: false, x: 0.0, rate: 1.0, t: 0, len: 1, gl: 0.0, gr: 0.0 }
    }
}

/// Values worked out every CTL samples.
#[derive(Clone, Copy, Default)]
struct Ctl {
    mix_dry: f32,
    mix_gr: f32,
    rate: f32, // tape samples per output sample at 1× speed
    spd: f32,
    bend: f32,
    pos0: f32,
    s0: f32,
    span: f32,
    gsp: f32,
    dens_t: f32,
    glen: f32,
    spray: f32,
    gp: f32,
    jit: f32,
    /// 1 / the loop seam's fade length, in samples.
    seam: f32,
    crush: f32,
    drive: f32,
    drive_n: f32,
    drive_out: f32,
    g_hp: f32,
    g_lp: f32,
    g_win: f32,
    k_win: f32,
    g_lamp: f32,
    noise: [f32; 4],
    chorus_d: f32,
    chorus_w: f32,
    echo_w: f32,
    room_w: f32,
    er: f32,
    dist: f32,
    /// Place pan then motion pan: (left gain, right gain, true when panning left), see `pan_gains`.
    pan: [(f32, f32, bool); 2],
    /// Chorus LFOs (sin of each), this control period.
    ch_s: [f32; 2],
    out: f32,
    c_th: f32,
    c_ratio: f32,
    c_make: f32,
}

pub struct Geode {
    /// Every line fitted in the slot's block (tests check it at 44.1 / 48 / 96 kHz).
    pub mem_ok: bool,
    fs: f32,
    params: [f32; p::COUNT],
    sm: [f32; p::COUNT],
    eff: [f32; p::COUNT],
    routes: [Option<Route>; MAX_ROUTES],
    primed: bool,
    v: [Voice; VOICES],
    g: [Grain; GRAINS],
    last: usize,
    clock: u32,
    rng: Rng,
    // the tape
    bank: &'static mut [f32],
    len: usize,
    chans: usize,
    // springs (the thermometer and the window ease toward where they were set)
    temp: f32,
    temp_v: f32,
    air: f32,
    air_v: f32,
    room: f32,
    // tempo and motion
    bpm: f32,
    song_pos: f64,
    playing: bool,
    since: u32,
    free_beats: f64,
    mot: f32,
    mot_s: f32,
    sway_ph: f32,
    // Mica's place (after walking)
    wx: f32,
    wz: f32,
    ctl_n: usize,
    c: Ctl,
    amp_c: AdsrCoefs,
    // effects
    hold: [f32; 2],
    hold_n: u32,
    body: [Biquad; 2],
    body_db: f32,
    hp: [Svf; 2],
    lp: [Svf; 2],
    win: [Svf; 2],
    lamp: [Svf; 2],
    pink: [f32; 3],
    brown: f32,
    noise_s: [f32; 4],
    ch: [Line; 2],
    ch_ph: f32,
    er_l: [Line; 2],
    echo: Delay,
    reverb: Reverb,
    comp_env: f32,
    lim_env: f32,
    gr_db: f32,
    hann: [f32; HANN_N + 1],
    // the panel's numbers
    aud: Option<f32>,
    ev: [(f32, f32); EVENTS],
    ev_n: usize,
    vz: [f32; VIZ_LEN],
    wet_l: [f32; 128],
    wet_r: [f32; 128],
    buf_l: [f32; 128],
    buf_r: [f32; 128],
}

/// Floats of the slot block a Geode needs at this sample rate (room, echo, chorus and reflections).
pub fn mem_size(fs: f32) -> usize {
    (5.3 * fs) as usize + 8192
}

/// Floats of tape a slot keeps (two channels, a little over 30 s).
pub fn bank_size(fs: f32) -> usize {
    2 * ((MAX_SECONDS + 0.5) * fs) as usize
}

impl Geode {
    /// For tests and native use: takes its own memory.
    pub fn new(fs: f32) -> Geode {
        let mut g = Geode::with_memory(line::take_big(mem_size(fs)), fs);
        g.attach_bank(line::take_big(bank_size(fs)));
        g
    }

    /// `mem`: this slot's block (`mem_size(fs)` floats).
    pub fn with_memory(mem: &'static mut [f32], fs: f32) -> Geode {
        let ((ch, er_l, mut echo, mut reverb), mem_ok) = line::with_arena(mem, || {
            let ch = [Line::new((0.04 * fs) as usize + 8), Line::new((0.04 * fs) as usize + 8)];
            let er = [Line::new((0.05 * fs) as usize + 8), Line::new((0.05 * fs) as usize + 8)];
            (ch, er, Delay::new(fs), Reverb::new(fs))
        });
        echo.ping_pong = false;
        echo.ret = 1.0;
        reverb.ret = 1.0;
        let mut hann = [0.0f32; HANN_N + 1];
        for (i, h) in hann.iter_mut().enumerate() {
            *h = 0.5 - 0.5 * libm::cosf(TAU * i as f32 / HANN_N as f32);
        }
        let d = defaults();
        Geode {
            mem_ok,
            fs,
            params: d,
            sm: d,
            eff: d,
            routes: [None; MAX_ROUTES],
            primed: false,
            v: [Voice::new(); VOICES],
            g: [Grain::new(); GRAINS],
            last: 0,
            clock: 0,
            rng: Rng::new(0x6E0D),
            bank: &mut [],
            len: 0,
            chans: 1,
            temp: d[p::TEMP],
            temp_v: 0.0,
            air: d[p::AIR],
            air_v: 0.0,
            room: d[p::ROOM],
            bpm: 120.0,
            song_pos: 0.0,
            playing: false,
            since: 0,
            free_beats: 0.0,
            mot: 0.0,
            mot_s: 0.0,
            sway_ph: 0.0,
            wx: place_x(d[p::PX]),
            wz: place_z(d[p::PZ]),
            ctl_n: 0,
            c: Ctl::default(),
            amp_c: AdsrCoefs::new(&AdsrTimes { a: 0.01, d: 0.1, s: 1.0, r: 0.1 }, fs),
            hold: [0.0; 2],
            hold_n: 0,
            body: [Biquad::new(); 2],
            body_db: 99.0,
            hp: [Svf::new(); 2],
            lp: [Svf::new(); 2],
            win: [Svf::new(); 2],
            lamp: [Svf::new(); 2],
            pink: [0.0; 3],
            brown: 0.0,
            noise_s: [0.0; 4],
            ch,
            ch_ph: 0.0,
            er_l,
            echo,
            reverb,
            comp_env: 0.0,
            lim_env: 0.0,
            gr_db: 0.0,
            hann,
            aud: None,
            ev: [(0.0, 0.0); EVENTS],
            ev_n: 0,
            vz: [0.0; VIZ_LEN],
            wet_l: [0.0; 128],
            wet_r: [0.0; 128],
            buf_l: [0.0; 128],
            buf_r: [0.0; 128],
        }
    }

    /// Hand over the slot's tape memory (planar: left channel, then right). Stops the old tape.
    pub fn attach_bank(&mut self, bank: &'static mut [f32]) {
        self.stop_tape();
        self.bank = bank;
    }

    /// Frames each channel can hold.
    pub fn capacity(&self, chans: usize) -> usize {
        self.bank.len() / chans.clamp(1, 2)
    }

    /// Where the page writes a tape of `frames` × `chans` (planar), or None if it does not fit.
    pub fn bank_ptr(&mut self, frames: usize, chans: usize) -> Option<*mut f32> {
        if frames == 0 || frames * chans.clamp(1, 2) > self.bank.len() {
            return None;
        }
        self.stop_tape();
        Some(self.bank.as_mut_ptr())
    }

    /// The page has written the tape: play it from now on.
    pub fn set_sample(&mut self, frames: usize, chans: usize) {
        let chans = chans.clamp(1, 2);
        self.stop_tape();
        if frames * chans <= self.bank.len() && frames >= 2 {
            self.len = frames;
            self.chans = chans;
        }
    }

    /// Write a tape directly (tests, native hosts).
    pub fn load(&mut self, left: &[f32], right: Option<&[f32]>) {
        let n = left.len();
        let chans = if right.is_some() { 2 } else { 1 };
        if let Some(ptr) = self.bank_ptr(n, chans) {
            let b = unsafe { core::slice::from_raw_parts_mut(ptr, n * chans) };
            b[..n].copy_from_slice(left);
            if let Some(r) = right {
                b[n..2 * n].copy_from_slice(&r[..n]);
            }
            self.set_sample(n, chans);
        }
    }

    pub fn tape_len(&self) -> usize {
        self.len
    }

    fn stop_tape(&mut self) {
        self.len = 0;
        self.aud = None;
        for g in self.g.iter_mut() {
            g.live = false;
        }
    }

    /// Voices sounding now.
    pub fn active(&self) -> usize {
        self.v.iter().filter(|v| v.live).count()
    }

    /// Mica's place after walking: (x -0.85..0.85, z 0.25..2.2).
    pub fn place(&self) -> (f32, f32) {
        (self.wx, self.wz)
    }

    /// The thermometer, window and room after easing.
    pub fn eased(&self) -> (f32, f32, f32) {
        (self.temp, self.air, self.room)
    }

    /// Compressor gain reduction now, dB (≤ 0).
    pub fn reduction_db(&self) -> f32 {
        self.gr_db
    }

    fn choose(&self, note: u8) -> usize {
        if let Some(i) = (0..VOICES).find(|&i| self.v[i].live && self.v[i].note == note) {
            return i;
        }
        if let Some(i) = (0..VOICES).find(|&i| !self.v[i].live) {
            return i;
        }
        let oldest = |held: bool| (0..VOICES).filter(|&i| self.v[i].held == held).min_by_key(|&i| self.v[i].age);
        oldest(false).or_else(|| oldest(true)).unwrap_or(0)
    }

    /// Both channels at `x` samples into the trimmed part (4-point Hermite, wrapping at its ends).
    #[inline]
    fn read2(&self, x: f32) -> (f32, f32) {
        let s0 = self.c.s0 as usize;
        let span = (self.c.span as usize).max(4);
        let xi = libm::floorf(x);
        let f = x - xi;
        let mut j = (xi as i64 - 1).rem_euclid(span as i64) as usize;
        let mut idx = [0usize; 4];
        for k in idx.iter_mut() {
            *k = s0 + j;
            j += 1;
            if j == span {
                j = 0;
            }
        }
        let b = &self.bank;
        let h = |o: usize| {
            let (y0, y1, y2, y3) = (b[o + idx[0]], b[o + idx[1]], b[o + idx[2]], b[o + idx[3]]);
            let c1 = 0.5 * (y2 - y0);
            let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
            let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
            ((c3 * f + c2) * f + c1) * f + y1
        };
        let l = h(0);
        (l, if self.chans == 2 { h(self.len) } else { l })
    }

    #[inline]
    fn hann_at(&self, t: f32) -> f32 {
        let x = t.clamp(0.0, 1.0) * HANN_N as f32;
        let i = (x as usize).min(HANN_N - 1);
        let f = x - i as f32;
        self.hann[i] + (self.hann[i + 1] - self.hann[i]) * f
    }

    /// Beats (quarter notes) of the song's clock now, `k` samples into the block.
    fn beats(&self, k: u32) -> f64 {
        let dt = (self.since + k) as f64 / self.fs as f64;
        if self.playing {
            self.song_pos / 4.0 + dt * self.bpm as f64 / 60.0
        } else {
            self.free_beats + dt * self.bpm as f64 / 60.0
        }
    }

    fn control(&mut self, k: u32) {
        let fs = self.fs;
        let dt = CTL as f32 / fs;
        let beats = self.beats(k);
        // routes: depth × source
        let lv = &self.v[self.last];
        let amp_l = if lv.live { lv.amp.level } else { 0.0 };
        let mut rm = [0.0f32; p::COUNT];
        for r in self.routes.iter().flatten() {
            let src = match r.src {
                ModSource::Lfo => self.mot,
                ModSource::AmpEnv => amp_l,
                ModSource::FiltEnv => 0.0,
            };
            rm[r.target] += r.depth * src;
        }
        let at = |sm: &[f32; p::COUNT], i: usize| clamp01(sm[i] + rm[i]);
        // the springs: critically damped, about a second (the thermometer is slow on purpose)
        let (tt, ta, tr) = (at(&self.sm, p::TEMP), at(&self.sm, p::AIR), at(&self.sm, p::ROOM));
        if !self.primed {
            (self.temp, self.air, self.room) = (tt, ta, tr);
        } else {
            let spring = |x: &mut f32, v: &mut f32, target: f32, w: f32| {
                let a = w * w * (target - *x) - 2.0 * w * *v;
                *v += a * dt;
                *x += *v * dt;
            };
            spring(&mut self.temp, &mut self.temp_v, tt, 4.2);
            spring(&mut self.air, &mut self.air_v, ta, 5.0);
            self.room += (tr - self.room) * (dt * 4.0).min(1.0);
        }
        let (t, a, room) = (clamp01(self.temp), clamp01(self.air), clamp01(self.room));

        // Motion: one LFO in time with the song
        let cyc = MRATES[self.params[p::MRATE] as usize] as f64;
        let ph = frac(beats / cyc);
        let raw = match self.params[p::MSHAPE] as u32 {
            1 => 1.0 - 4.0 * libm::fabsf(ph - 0.5),
            2 => if ph < 0.5 { 1.0 } else { -1.0 },
            3 => hash11(libm::floor(beats / cyc) as i64, 7),
            _ => sinf(ph * TAU),
        };
        let depth = at(&self.sm, p::MDEPTH);
        let mk = one_pole_coef(0.02, fs / CTL as f32);
        self.mot_s += (raw - self.mot_s) * mk;
        self.mot = self.mot_s * depth;
        let mto = self.params[p::MTO] as u32;
        let on = |b: u32| mto & b != 0 && depth > 0.01;
        let m = self.mot;

        // the macros
        let tw = libm::powf((libm::fabsf(t - 0.5) * 2.4).min(1.0), 0.8);
        let aw = sstep(0.0, 0.6, a);
        let breath = at(&self.sm, p::BREATH);
        let bw = libm::fabsf(breath - 0.5) * 2.0;
        for i in 0..p::COUNT {
            if i < p::DRIVE || i > p::ER {
                self.eff[i] = if discrete_max(i).is_some() { self.params[i] } else { at(&self.sm, i) };
                continue;
            }
            let mut w = [(0.0f32, 0.0f32); 4];
            let mut n = 0;
            let mut wish = |weight: f32, x: f32| {
                w[n] = (weight, x);
                n += 1;
            };
            if i <= p::DAMP {
                let k = i - p::DRIVE;
                wish(tw * self.sm[p::S_DRIVE + k], curve(&TEMP_WISH[k], t));
            }
            match i {
                p::CUT => wish(aw, lerp(0.1, 1.0, a)),
                p::RES => wish(aw, lerp(0.15, 0.55, a)),
                p::SWAY => wish(aw, a),
                p::AIRN => wish(aw, a * 0.7),
                p::TONE => wish(aw * 0.5, 1.0), // an open window brightens a little: HOT + open = in between
                p::DECAY => wish(0.9, room),
                p::PRE => wish(0.9, room * 0.9),
                p::ER => wish(0.9, lerp(0.85, 0.25, room)),
                p::ATK => wish(bw, lerp(0.02, 0.75, breath)),
                p::DEC => wish(bw, lerp(0.25, 0.7, breath)),
                p::SUS => wish(bw, lerp(0.1, 1.0, breath)),
                p::REL => wish(bw, lerp(0.12, 0.85, breath)),
                _ => {}
            }
            self.eff[i] = clamp01(macro_mix(self.sm[i], &w[..n]) + rm[i]);
        }
        self.eff[p::TEMP] = t;
        self.eff[p::AIR] = a;
        self.eff[p::ROOM] = room;

        // Mica walks around where she was put
        let wcyc = WBARS[self.params[p::WBARS] as usize] as f64 * 4.0;
        let wp = frac(beats / wcyc);
        let (bx, bz) = (place_x(self.eff[p::PX]), place_z(self.eff[p::PZ]));
        let amp = 0.6;
        let (tx, tz) = match self.params[p::WALK] as u32 {
            1 => (bx + amp * (1.0 - 4.0 * libm::fabsf(wp - 0.5)), bz),
            2 => {
                let s = sinf(core::f32::consts::PI * wp);
                (bx + amp * sinf(TAU * wp), bz + 0.9 * s * s)
            }
            3 => (bx + 0.5 * libm::cosf(TAU * wp), bz + 0.4 + 0.4 * sinf(TAU * wp)),
            4 => {
                let q = libm::floor(beats / wcyc * 4.0) as i64;
                (bx + hash11(q, 1) * amp, bz + (hash11(q, 2) * 0.5 + 0.5) * 0.8)
            }
            _ => (bx, bz),
        };
        let lz = (room_depth(room) - 0.35).min(2.2).max(0.3);
        let (tx, tz) = (tx.clamp(-0.85, 0.85), tz.clamp(0.25, lz));
        if !self.primed {
            (self.wx, self.wz) = (tx, tz);
        } else {
            let k = (dt * 3.2).min(1.0);
            self.wx += (tx - self.wx) * k;
            self.wz += (tz - self.wz) * k;
        }
        self.eff[p::PX] = clamp01((self.wx / 0.85 + 1.0) * 0.5);
        self.eff[p::PZ] = clamp01((self.wz - 0.25) / 1.95);

        // what the voices read
        let e = self.eff;
        let c = &mut self.c;
        let len = self.len as f32;
        if self.len < 4 {
            (c.s0, c.span) = (0.0, 4.0);
        } else {
            let s0 = libm::floorf(e[p::START].min(0.98) * len).min(len - 4.0);
            let s1 = libm::floorf(e[p::END] * len).max(s0 + 64.0).min(len).max(s0 + 4.0);
            (c.s0, c.span) = (s0, s1 - s0);
        }
        c.mix_gr = e[p::GRAINS];
        c.mix_dry = 1.0 - c.mix_gr;
        c.rate = 1.0; // the tape is always at the engine's rate (the page resamples it)
        c.spd = speed_x(e[p::SPEED]);
        c.bend = if on(mt::PITCH) { m * 2.0 } else { 0.0 };
        let pos = if on(mt::POS) { wrap(e[p::POS] + m * 0.25, 1.0) } else { e[p::POS] };
        c.pos0 = pos * c.span;
        c.glen = (grain_s(e[p::GSIZE]) * fs).max(64.0);
        c.dens_t = fs / density(e[p::GDENS]);
        c.spray = lerp(0.01, 0.5, e[p::SPREAD]);
        c.jit = lerp(0.02, 0.4, e[p::SPREAD]);
        c.seam = 1.0 / (0.004 * fs).min(c.span * 0.25).max(1.0);
        c.gp = lerp(-7.0, 9.0, e[p::GPITCH]);
        c.gsp = lerp(0.0, 2.0, e[p::GSPEED]);
        c.crush = if on(mt::CRUNCH) { clamp01(e[p::CRUNCH] + (raw * 0.5 + 0.5) * depth * 0.7) } else { e[p::CRUNCH] };
        c.drive = e[p::DRIVE];
        let dr = e[p::DRIVE] * e[p::DRIVE] * 12.0 + 0.01;
        c.drive_n = 1.0 + dr;
        c.drive_out = 1.0 / (libm::tanhf(1.0 + dr) * (1.0 + e[p::DRIVE] * 0.8));
        c.g_hp = Svf::g(lerp(20.0, 1200.0, e[p::THIN] * e[p::THIN]), fs);
        c.g_lp = Svf::g(lerp(900.0, 18000.0, libm::powf(e[p::TONE], 1.6)), fs);
        // the window: warm air rounds the sweep (lower, more resonant), cold air is glassy
        let warmth = clamp01(1.0 - libm::fabsf(t - 0.66) / 0.34);
        let fwin = lerp(160.0, 70.0, warmth) * exp2(e[p::CUT] * lerp(6.6, 7.6, warmth));
        self.sway_ph = wrap(self.sway_ph + lerp(0.15, 0.9, a) * dt, 1.0);
        let cents = sinf(self.sway_ph * TAU) * e[p::SWAY] * 1400.0 * (1.0 + warmth * 0.8) + if on(mt::WIN) { m * 2400.0 } else { 0.0 };
        c.g_win = Svf::g((fwin * exp2(cents / 1200.0)).clamp(20.0, fs * 0.45), fs);
        let qdb = lerp(0.7, 9.0, libm::powf(e[p::RES], 1.5)) * (1.0 + warmth * 0.9);
        c.k_win = 1.0 / libm::powf(10.0, qdb / 20.0).max(0.707);
        // wind noise: white when freezing … grey, pink … brown when hot
        for (j, n) in c.noise.iter_mut().enumerate() {
            *n = (1.0 - libm::fabsf(t * 3.0 - j as f32)).max(0.0) * e[p::AIRN] * 0.09;
        }
        c.chorus_d = lerp(0.0004, 0.006, e[p::CHORUS]) * fs;
        c.chorus_w = if e[p::CHORUS] > 0.01 { lerp(0.1, 0.75, e[p::CHORUS]) } else { 0.0 };
        // echo, room, place
        let ew = e[p::EWET];
        c.echo_w = if on(mt::ECHO) { clamp01(ew * (1.0 + m)) } else { ew };
        let d = clamp01((self.wz - 0.35) / 1.6);
        c.dist = 1.0 - d * 0.4;
        c.room_w = e[p::WET] * 0.8 * (1.0 + d * 0.9) * if on(mt::ROOM) { 1.0 + m } else { 1.0 };
        c.er = e[p::ER];
        c.pan = [pan_gains(self.wx / 0.85 * 0.9), pan_gains(if on(mt::PAN) { m * 0.9 } else { 0.0 })];
        self.ch_ph = wrap(self.ch_ph + dt, 100.0);
        c.ch_s = [sinf(TAU * self.ch_ph * 0.35), sinf(TAU * self.ch_ph * 0.62)];
        let light = e[p::LIGHT];
        c.g_lamp = Svf::g(120.0 * exp2(light * 7.4), fs);
        c.out = lerp(0.6875, 1.0, light) * e[p::LVL] * e[p::LVL] * 1.63;
        c.c_th = lerp(-40.0, 0.0, e[p::CTH]);
        c.c_ratio = lerp(1.0, 20.0, e[p::CRATIO]);
        c.c_make = lerp(0.0, 18.0, e[p::CMAKE]);
        self.amp_c = AdsrCoefs::new(&AdsrTimes { a: attack_s(e[p::ATK]), d: decay_s(e[p::DEC]), s: e[p::SUS], r: release_s(e[p::REL]) }, fs);
        let db = lerp(-6.0, 6.0, e[p::BODY]);
        if libm::fabsf(db - self.body_db) > 0.05 {
            self.body_db = db;
            for b in self.body.iter_mut() {
                b.lowshelf(220.0, db, fs);
            }
        }
    }

    /// The effects that work on whole blocks: echo and room (slow to set, so only when they change).
    fn update_fx(&mut self) {
        let e = &self.eff;
        let time = DIVS[self.params[p::DIV] as usize] * 4.0 * 60.0 / self.bpm.clamp(20.0, 300.0);
        let tone_hz = lerp(2500.0, 9000.0, 1.0 - self.temp);
        let tone = libm::logf(tone_hz / 500.0) / libm::logf(28.0);
        let (fb, dl) = (e[p::FB], &mut self.echo);
        if libm::fabsf(dl.time - time) > 1e-4 || libm::fabsf(dl.feedback - fb) > 1e-4 || libm::fabsf(dl.tone - tone) > 2e-3 {
            dl.time = time.min(crate::fx::delay::MAX_SECONDS);
            dl.feedback = fb;
            dl.tone = tone;
            dl.update();
        }
        let t60 = room_s(e[p::DECAY]);
        let pre = e[p::PRE] * 0.06;
        let damp_hz = lerp(1800.0, 14000.0, e[p::DAMP]);
        let rtone = libm::logf(damp_hz / 800.0) / libm::logf(20.0);
        let rv = &mut self.reverb;
        if libm::fabsf(rv.t60 - t60) > 0.01 || libm::fabsf(rv.pre_s - pre) > 2e-4 || libm::fabsf(rv.tone - rtone) > 2e-3 {
            rv.t60 = t60;
            rv.pre_s = pre;
            rv.tone = rtone;
            rv.update();
        }
    }

    fn push_event(&mut self, pos: f32, note: f32) {
        if self.ev_n < EVENTS {
            self.ev[self.ev_n] = (pos, note);
            self.ev_n += 1;
        }
    }

    /// Voices, crush, drive and the filters into buf_l/buf_r (n ≤ 128).
    fn voices(&mut self, n: usize) {
        let fs = self.fs;
        let has = self.len >= 4;
        for i in 0..n {
            if self.ctl_n == 0 {
                self.control(i as u32);
            }
            self.ctl_n = (self.ctl_n + 1) % CTL;
            let c = self.c;
            let (mut l, mut r) = (0.0f32, 0.0f32);
            for vi in 0..VOICES {
                if !self.v[vi].live {
                    continue;
                }
                let env = self.v[vi].amp.next(&self.amp_c);
                let v = self.v[vi];
                let amp = env * v.vel;
                self.v[vi].level = amp;
                if !v.held && self.v[vi].amp.is_idle() {
                    self.v[vi].live = false;
                    continue;
                }
                if !has {
                    continue;
                }
                let mode = self.params[p::MODE] as u32;
                let key = if mode == 2 { 1.0 } else { exp2((v.note as f32 - 60.0) / 12.0) };
                let rate = key * exp2(c.bend / 12.0) * c.rate * c.spd;
                if c.mix_dry > 0.001 {
                    let x = match mode {
                        1 => c.pos0 - v.pos,
                        2 => {
                            let w = c.span / SLICES as f32;
                            if v.pos >= w - 1.0 && v.held {
                                self.v[vi].held = false;
                                self.v[vi].amp.gate_off();
                            }
                            v.slice as f32 * w + v.pos.min(w - 1.0)
                        }
                        _ => c.pos0 + v.pos,
                    };
                    // Classic / Reverse loop the trimmed part: a 4 ms fade at its ends so the seam never clicks
                    let edge = if mode == 2 { 1.0 } else {
                        let u = wrap(x, c.span);
                        (u.min(c.span - u) * c.seam).min(1.0)
                    };
                    let g = amp * c.mix_dry * edge;
                    let (a, b) = self.read2(x);
                    l += a * g;
                    r += b * g;
                    self.v[vi].pos += rate;
                }
                if c.mix_gr > 0.001 {
                    let span = c.span;
                    let vv = &mut self.v[vi];
                    vv.head = wrap(vv.head + c.gsp * c.rate * c.spd, span);
                    vv.gt -= 1.0;
                    if vv.gt <= 0.0 {
                        vv.gt += c.dens_t;
                        let head = vv.head;
                        let note = vv.note as f32;
                        let st = self.rng.bipolar();
                        let pr = exp2((c.gp + self.rng.bipolar() * c.jit * 3.0) / 12.0) * key * exp2(c.bend / 12.0) * c.rate;
                        let x = wrap(c.pos0 + head + st * c.spray * span, span);
                        let pan = (self.rng.bipolar() * 0.5 + 0.5) * 0.8 + 0.1;
                        if let Some(g) = self.g.iter_mut().find(|g| !g.live) {
                            // louder grains when they overlap less, so size and density keep the level
                            let overlap = (c.glen / c.dens_t).max(1.0);
                            let a = amp * 0.77 / libm::sqrtf(overlap);
                            *g = Grain { live: true, x, rate: pr, t: 0, len: c.glen as u32, gl: (1.0 - pan) * a * 1.4, gr: pan * a * 1.4 };
                        }
                        self.push_event(x / span, note + c.gp);
                    }
                }
            }
            if has && c.mix_gr > 0.001 {
                let gw = c.mix_gr;
                for gi in 0..GRAINS {
                    let g = self.g[gi];
                    if !g.live {
                        continue;
                    }
                    let w = self.hann_at(g.t as f32 / g.len as f32) * gw;
                    let (a, b) = self.read2(g.x);
                    l += a * w * g.gl;
                    r += b * w * g.gr;
                    let gg = &mut self.g[gi];
                    gg.x += g.rate;
                    gg.t += 1;
                    if gg.t >= gg.len {
                        gg.live = false;
                    }
                }
            }
            if let Some(ap) = self.aud {
                if has {
                    let x = ap;
                    let (a, b) = self.read2(x);
                    l += a * 0.8;
                    r += b * 0.8;
                    let nx = ap + c.spd * c.rate;
                    self.aud = if nx >= c.span { None } else { Some(nx) };
                } else {
                    self.aud = None;
                }
            }
            // crunch: fewer bits and a held (lower) sample rate
            if c.crush > 0.01 {
                let bits = exp2(libm::roundf(16.0 - c.crush * 13.0));
                let hold = 1 + (c.crush * c.crush * 24.0) as u32;
                if self.hold_n % hold == 0 {
                    self.hold = [libm::roundf(l * bits) / bits, libm::roundf(r * bits) / bits];
                }
                self.hold_n = self.hold_n.wrapping_add(1);
                let mx = (c.crush * 1.6).min(1.0);
                l += (self.hold[0] - l) * mx;
                r += (self.hold[1] - r) * mx;
            }
            // tape drive
            if c.drive > 0.003 {
                l = libm::tanhf(l * c.drive_n) * c.drive_out;
                r = libm::tanhf(r * c.drive_n) * c.drive_out;
            }
            // body, thin, tone
            l = self.body[0].process(l);
            r = self.body[1].process(r);
            l = self.hp[0].tick(l, c.g_hp, 1.3).hp;
            r = self.hp[1].tick(r, c.g_hp, 1.3).hp;
            l = self.lp[0].tick(l, c.g_lp, 1.3).lp;
            r = self.lp[1].tick(r, c.g_lp, 1.3).lp;
            // the window, with the wind coming in
            let w = self.rng.bipolar();
            let pk = &mut self.pink;
            pk[0] = 0.99765 * pk[0] + w * 0.099046;
            pk[1] = 0.963 * pk[1] + w * 0.2965164;
            pk[2] = 0.57 * pk[2] + w * 1.0526913;
            let pink = (pk[0] + pk[1] + pk[2] + w * 0.1848) * 0.2;
            self.brown = flush((self.brown + w * 0.02) / 1.02);
            let colours = [w * 0.5, w * 0.25 + pink * 0.6, pink, self.brown * 3.2];
            // the wind only blows while Mica sings (no hiss in the song's quiet parts)
            let nk = one_pole_coef(0.2, fs);
            let mut nz = 0.0;
            let gate = if has { self.v.iter().map(|v| v.level).sum::<f32>().min(1.0) } else { 0.0 };
            for j in 0..4 {
                self.noise_s[j] += (c.noise[j] * gate - self.noise_s[j]) * nk;
                nz += colours[j] * self.noise_s[j];
            }
            self.pink = [flush(self.pink[0]), flush(self.pink[1]), flush(self.pink[2])];
            l = self.win[0].tick(l + nz, c.g_win, c.k_win).lp;
            r = self.win[1].tick(r + nz, c.g_win, c.k_win).lp;
            // chorus: two short moving delays per side, the sides moving in opposite directions
            self.ch[0].push(l);
            self.ch[1].push(r);
            let ms = fs * 0.001;
            let [sa, sb] = c.ch_s;
            let cw = c.chorus_w * 0.5;
            let wl = self.ch[0].read_frac(12.0 * ms + c.chorus_d * sa) + self.ch[0].read_frac(18.0 * ms + c.chorus_d * sb);
            let wr = self.ch[1].read_frac(12.0 * ms - c.chorus_d * sa) + self.ch[1].read_frac(18.0 * ms - c.chorus_d * sb);
            self.buf_l[i] = l + wl * cw;
            self.buf_r[i] = r + wr * cw;
        }
    }
}

impl Device for Geode {
    fn prepare(&mut self, sample_rate: f32) {
        // lines were sized for the rate given to `with_memory`; the rack always passes the same one
        self.fs = sample_rate;
        for v in self.v.iter_mut() {
            *v = Voice::new();
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
        &self.eff
    }
    fn set_route(&mut self, slot: usize, src: ModSource, target: usize, depth: f32) -> Result<(), RouteError> {
        if slot >= MAX_ROUTES {
            return Err(RouteError::NoSlot);
        }
        if !route_allowed(src, target) {
            return Err(RouteError::NotAllowed);
        }
        self.routes[slot] = Some(Route { src, target, depth: depth.clamp(-1.0, 1.0) });
        Ok(())
    }
    fn clear_route(&mut self, slot: usize) {
        if slot < MAX_ROUTES {
            self.routes[slot] = None;
        }
    }
    fn mod_source_value(&self, src: ModSource) -> f32 {
        let v = &self.v[self.last];
        match src {
            ModSource::Lfo => self.mot,
            ModSource::AmpEnv => if v.live { v.amp.level } else { 0.0 },
            ModSource::FiltEnv => 0.0,
        }
    }
    fn note_on(&mut self, note: u8, velocity: f32) {
        if velocity <= 0.0 {
            self.note_off(note);
            return;
        }
        let i = self.choose(note);
        self.clock = self.clock.wrapping_add(1);
        let fresh = !self.v[i].live;
        // Slices: one per scale degree (C D E F G A B, then the next octave), so the white keys walk the tape
        let deg = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][(note % 12) as usize] + 7 * (note / 12) as usize;
        let v = &mut self.v[i];
        if fresh {
            *v = Voice::new();
        }
        v.note = note;
        v.vel = 0.3 + 0.7 * velocity.min(1.0);
        v.held = true;
        v.live = true;
        v.age = self.clock;
        v.pos = 0.0;
        v.head = 0.0;
        v.gt = 0.0;
        v.slice = (deg % SLICES) as u8;
        v.amp.gate_on();
        self.last = i;
    }
    fn note_off(&mut self, note: u8) {
        for v in self.v.iter_mut().filter(|v| v.held && v.note == note) {
            v.held = false;
            v.amp.gate_off();
        }
    }
    fn all_notes_off(&mut self) {
        for v in self.v.iter_mut().filter(|v| v.live) {
            v.held = false;
            v.amp.gate_off();
        }
        self.aud = None;
    }
    fn tempo(&mut self, bpm: f32, pos: f64, playing: bool) {
        if !self.playing || !playing {
            // free-running between plays: keep counting where we were
            self.free_beats = self.beats(0);
        }
        self.bpm = if bpm.is_finite() && bpm > 1.0 { bpm } else { 120.0 };
        self.song_pos = pos;
        self.playing = playing;
        self.since = 0;
    }
    fn viz(&mut self) -> &[f32] {
        let z = &mut self.vz;
        z[0] = match self.aud {
            Some(a) => a / self.c.span.max(1.0),
            None => -1.0,
        };
        z[1] = self.mot;
        z[2] = self.gr_db;
        for (k, v) in self.v.iter().enumerate() {
            z[3 + k * 2] = if v.live { v.note as f32 } else { -1.0 };
            z[4 + k * 2] = if v.live { v.level } else { 0.0 };
        }
        let b = 3 + VOICES * 2;
        z[b] = self.ev_n as f32;
        for k in 0..EVENTS {
            let (x, m) = if k < self.ev_n { self.ev[k] } else { (0.0, 0.0) };
            z[b + 1 + k * 2] = x;
            z[b + 2 + k * 2] = m;
        }
        self.ev_n = 0;
        &self.vz
    }
    fn viz_len(&self) -> usize {
        VIZ_LEN
    }
    fn command(&mut self, cmd: u32, value: f32) {
        match cmd {
            // play the trimmed tape once (Mica's ▶), or stop it
            1 => self.aud = if value > 0.5 && self.len >= 4 { Some(0.0) } else { None },
            // the position moved: grain heads start over there
            2 => {
                for v in self.v.iter_mut() {
                    v.head = 0.0;
                }
            }
            // the tape was removed
            3 => self.stop_tape(),
            _ => {}
        }
    }
    fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        let fs = self.fs;
        let k = if self.primed { one_pole_coef(0.015, fs / n.max(1) as f32) } else { 1.0 };
        for i in 0..p::COUNT {
            self.sm[i] = if discrete_max(i).is_some() { self.params[i] } else { self.sm[i] + (self.params[i] - self.sm[i]) * k };
        }
        let mut done = 0;
        while done < n {
            let m = (n - done).min(128);
            self.ctl_n = 0;
            self.voices(m);
            self.primed = true;
            self.update_fx();
            // echo: Mica's voice bouncing off the back wall
            self.wet_l[..m].fill(0.0);
            self.wet_r[..m].fill(0.0);
            self.echo.process(&self.buf_l[..m], &self.buf_r[..m], &mut self.wet_l[..m], &mut self.wet_r[..m]);
            let ew = self.c.echo_w;
            for i in 0..m {
                self.buf_l[i] += self.wet_l[i] * ew;
                self.buf_r[i] += self.wet_r[i] * ew;
            }
            // the room: its own plate, plus early reflections off the near walls
            self.wet_l[..m].fill(0.0);
            self.wet_r[..m].fill(0.0);
            self.reverb.process(&self.buf_l[..m], &self.buf_r[..m], &mut self.wet_l[..m], &mut self.wet_r[..m]);
            let ms = fs * 0.001;
            let (ca, cr, lk) = (one_pole_coef(0.008, fs), one_pole_coef(0.22, fs), one_pole_coef(0.08, fs));
            const TAPS: [f32; 5] = [7.0, 13.0, 21.0, 31.0, 43.0];
            let er = self.c.er * 0.35;
            let rw = self.c.room_w;
            let c = self.c;
            for i in 0..m {
                let (x, y) = (self.buf_l[i], self.buf_r[i]);
                self.er_l[0].push(x);
                self.er_l[1].push(y);
                let (mut el, mut erv) = (0.0, 0.0);
                for (j, t) in TAPS.iter().enumerate() {
                    let g = er * (0.9 - j as f32 * 0.14) * if j % 2 == 1 { -1.0 } else { 1.0 };
                    el += self.er_l[0].read((t * ms) as usize) * g;
                    erv += self.er_l[1].read(((t + 2.0) * ms) as usize) * g;
                }
                let mut l = x + (self.wet_l[i] + el) * rw;
                let mut r = y + (self.wet_r[i] + erv) * rw;
                // glue compressor (linked, soft knee) + make-up, then a fast safety limiter
                let det = libm::fabsf(l).max(libm::fabsf(r));
                let lvl = 20.0 * libm::log10f(det + 1e-9);
                let over = lvl - c.c_th;
                let slope = 1.0 / c.c_ratio - 1.0;
                let want = if over <= -5.0 { 0.0 } else if over < 5.0 { slope * (over + 5.0) * (over + 5.0) / 20.0 } else { slope * over };
                let ck = if want < self.comp_env { ca } else { cr };
                self.comp_env = flush(self.comp_env + (want - self.comp_env) * ck);
                let g = exp2((self.comp_env + c.c_make) / 6.0206);
                l *= g;
                r *= g;
                let pk = libm::fabsf(l).max(libm::fabsf(r));
                self.lim_env = if pk > self.lim_env { pk } else { flush(self.lim_env + (pk - self.lim_env) * lk) };
                const CEIL: f32 = 0.794;
                if self.lim_env > CEIL {
                    let lg = CEIL / self.lim_env;
                    l *= lg;
                    r *= lg;
                }
                // where Mica stands: farther = quieter (and more room, above); then place pan and motion pan
                l *= c.dist;
                r *= c.dist;
                for (gl, gr, left) in c.pan {
                    (l, r) = if left { (l + r * gl, r * gr) } else { (l * gl, r + l * gr) };
                }
                // the light: a master low-pass dimmer
                l = self.lamp[0].tick(l, c.g_lamp, 2.0).lp;
                r = self.lamp[1].tick(r, c.g_lamp, 2.0).lp;
                left[done + i] = (l * c.out).clamp(-1.0, 1.0);
                right[done + i] = (r * c.out).clamp(-1.0, 1.0);
            }
            self.gr_db = self.comp_env;
            self.since += m as u32;
            done += m;
        }
    }
}
