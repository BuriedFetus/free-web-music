//! The master effects chain: Reverb, Delay, Lo-fi and Low-pass, in an order the user chooses.
//!
//! Every effect is a stage the mix passes through, in chain order. Reverb and Delay are fed by the
//! instruments' send knobs (post-fader), and their stage adds their return to the mix at that point:
//! so Reverb before Lo-fi gets worn tails, after it stays clean. Lo-fi and Low-pass process the mix
//! in place. An effect not in the chain is skipped.

pub mod delay;
pub mod line;
pub mod lofi;
pub mod lowpass;
pub mod reverb;

use crate::BLOCK;
use delay::Delay;
use lofi::Lofi;
use lowpass::Lowpass;
use reverb::Reverb;

/// Effect ids (chain entries).
pub const REVERB: u8 = 0;
pub const DELAY: u8 = 1;
pub const LOFI: u8 = 2;
pub const LOWPASS: u8 = 3;
pub const NONE: u8 = 255;

/// Parameter numbers for `fwm_fx` (values are 0..1 unless noted).
pub mod param {
    pub const REV_ON: u32 = 0;
    pub const REV_SIZE: u32 = 1;
    pub const REV_PRE: u32 = 2; // seconds, 0..0.1
    pub const REV_TONE: u32 = 3;
    pub const REV_RETURN: u32 = 4;
    pub const DLY_ON: u32 = 10;
    pub const DLY_TIME: u32 = 11; // seconds, 0.01..2
    pub const DLY_FEEDBACK: u32 = 12;
    pub const DLY_TONE: u32 = 13;
    pub const DLY_PING_PONG: u32 = 14;
    pub const DLY_RETURN: u32 = 15;
    pub const LOFI_ON: u32 = 20;
    pub const LOFI_WOW: u32 = 21;
    pub const LOFI_FLUTTER: u32 = 22;
    pub const LOFI_SATURATION: u32 = 23;
    pub const LOFI_AGE: u32 = 24;
    pub const LOFI_NOISE: u32 = 25;
    pub const LOFI_CRACKLE: u32 = 26;
    pub const LOFI_MIX: u32 = 27;
    pub const LOFI_VINYL: u32 = 28;
    pub const LP_ON: u32 = 30;
    pub const LP_CUTOFF: u32 = 31;
    pub const LP_RESONANCE: u32 = 32;
}

pub struct Fx {
    pub reverb: Reverb,
    pub delay: Delay,
    pub lofi: Lofi,
    pub lowpass: Lowpass,
    chain: [u8; 4],
    /// Send buses, filled by the strips each block: [A left, A right, B left, B right].
    pub sends: [[f32; BLOCK]; 4],
    /// Samples since Reverb / Delay last got input or made sound: past `SLEEP`, they are skipped.
    quiet: [usize; 2],
    fs: f32,
}

/// Reverb and Delay sleep after this long without input once their tail is below -100 dB (cost: zero).
const SLEEP_S: f32 = 1.0;
const SILENT: f32 = 1e-5;

impl Fx {
    pub fn new(fs: f32) -> Fx {
        Fx {
            reverb: Reverb::new(fs),
            delay: Delay::new(fs),
            lofi: Lofi::new(fs),
            lowpass: Lowpass::new(fs),
            chain: [REVERB, DELAY, LOFI, LOWPASS],
            sends: [[0.0; BLOCK]; 4],
            quiet: [0; 2],
            fs,
        }
    }

    /// The order of the chain (unknown ids and repeats are dropped; missing = not in the chain).
    pub fn set_chain(&mut self, ids: &[u8]) {
        let mut c = [NONE; 4];
        let mut n = 0;
        for &id in ids {
            if id <= LOWPASS && !c[..n].contains(&id) && n < 4 {
                c[n] = id;
                n += 1;
            }
        }
        self.chain = c;
    }
    pub fn chain(&self) -> [u8; 4] {
        self.chain
    }

    pub fn set(&mut self, p: u32, v: f32) {
        use param::*;
        let v = if v.is_finite() { v } else { 0.0 };
        let on = v >= 0.5;
        match p {
            REV_ON => self.reverb.on = on,
            REV_SIZE => self.reverb.size = v,
            REV_PRE => self.reverb.pre_s = v,
            REV_TONE => self.reverb.tone = v,
            REV_RETURN => self.reverb.ret = v,
            DLY_ON => self.delay.on = on,
            DLY_TIME => self.delay.time = v,
            DLY_FEEDBACK => self.delay.feedback = v,
            DLY_TONE => self.delay.tone = v,
            DLY_PING_PONG => self.delay.ping_pong = on,
            DLY_RETURN => self.delay.ret = v,
            LOFI_ON => self.lofi.on = on,
            LOFI_WOW => self.lofi.wow = v,
            LOFI_FLUTTER => self.lofi.flutter = v,
            LOFI_SATURATION => self.lofi.saturation = v,
            LOFI_AGE => self.lofi.age = v,
            LOFI_NOISE => self.lofi.hiss = v,
            LOFI_CRACKLE => self.lofi.crackle = v,
            LOFI_MIX => self.lofi.mix = v,
            LOFI_VINYL => self.lofi.vinyl = on,
            LP_ON => self.lowpass.on = on,
            LP_CUTOFF => self.lowpass.cutoff = v,
            LP_RESONANCE => self.lowpass.resonance = v,
            _ => return,
        }
        match p / 10 {
            0 => self.reverb.update(),
            1 => self.delay.update(),
            2 => self.lofi.update(),
            _ => self.lowpass.update(),
        }
    }

    /// Run the chain over the mix (l, r), first `n` samples. Clears the send buses afterwards.
    pub fn process(&mut self, l: &mut [f32], r: &mut [f32], n: usize) {
        let sleep = (SLEEP_S * self.fs) as usize;
        for id in self.chain {
            match id {
                REVERB | DELAY => {
                    let k = id as usize; // 0 reverb, 1 delay
                    let (a, b) = (k * 2, k * 2 + 1);
                    let input = self.sends[a][..n].iter().chain(&self.sends[b][..n]).any(|x| x.abs() > SILENT);
                    // Unused for a while and the tail gone below -100 dB: skip (costs nothing). Input wakes it.
                    if !input && self.quiet[k] > sleep {
                        continue;
                    }
                    let mut wet = [[0f32; BLOCK]; 2];
                    let [wl, wr] = &mut wet;
                    if k == 0 {
                        self.reverb.process(&self.sends[a][..n], &self.sends[b][..n], &mut wl[..n], &mut wr[..n]);
                    } else {
                        self.delay.process(&self.sends[a][..n], &self.sends[b][..n], &mut wl[..n], &mut wr[..n]);
                    }
                    let tail = wl[..n].iter().chain(&wr[..n]).any(|x| x.abs() > SILENT);
                    self.quiet[k] = if input || tail { 0 } else { self.quiet[k] + n };
                    for i in 0..n {
                        l[i] += wl[i];
                        r[i] += wr[i];
                    }
                }
                LOFI => self.lofi.process(&mut l[..n], &mut r[..n]),
                LOWPASS => self.lowpass.process(&mut l[..n], &mut r[..n]),
                _ => {}
            }
        }
        for s in self.sends.iter_mut() {
            s[..n].fill(0.0);
        }
    }
}
