//! Phase 0 spike, not production code.
//! A minimal voice bank to measure WASM DSP cost inside an AudioWorklet:
//! band-limited saw (PolyBLEP) -> TPT/ZDF state-variable low-pass (Simper) -> simple envelope.
//! No allocation, no std, no transcendental math in the audio loop
//! (the host computes filter coefficients and phase increments).
#![no_std]
#![allow(static_mut_refs)]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_: &PanicInfo) -> ! {
    loop {}
}

const MAX_VOICES: usize = 64;
const BLOCK: usize = 128;

#[derive(Clone, Copy)]
struct Voice {
    phase: f32,
    inc: f32,
    ic1: f32,
    ic2: f32,
    env: f32,
    gate: bool,
}

const SILENT: Voice = Voice { phase: 0.0, inc: 0.0, ic1: 0.0, ic2: 0.0, env: 0.0, gate: false };

static mut VOICES: [Voice; MAX_VOICES] = [SILENT; MAX_VOICES];
static mut OUT: [f32; BLOCK] = [0.0; BLOCK];
static mut G: f32 = 0.1; // tan(pi * fc / fs)
static mut K: f32 = 1.0; // 2 - 2 * resonance
static mut ATTACK: f32 = 0.02;
static mut RELEASE: f32 = 0.0008;

#[no_mangle]
pub extern "C" fn out_ptr() -> *const f32 {
    unsafe { OUT.as_ptr() }
}

#[no_mangle]
pub extern "C" fn set_filter(g: f32, k: f32) {
    unsafe {
        G = g;
        K = k;
    }
}

#[no_mangle]
pub extern "C" fn set_env(attack: f32, release: f32) {
    unsafe {
        ATTACK = attack;
        RELEASE = release;
    }
}

#[no_mangle]
pub extern "C" fn note_on(voice: u32, inc: f32) {
    unsafe {
        let v = &mut VOICES[voice as usize % MAX_VOICES];
        v.inc = inc;
        v.gate = true;
    }
}

#[no_mangle]
pub extern "C" fn note_off(voice: u32) {
    unsafe {
        VOICES[voice as usize % MAX_VOICES].gate = false;
    }
}

#[inline(always)]
fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + x + x + 1.0
    } else {
        0.0
    }
}

/// Render `frames` (<= 128) samples of the first `voices` voices into OUT.
#[no_mangle]
pub extern "C" fn render(frames: u32, voices: u32) {
    unsafe {
        let n = (frames as usize).min(BLOCK);
        let nv = (voices as usize).min(MAX_VOICES);
        let (g, k, atk, rel) = (G, K, ATTACK, RELEASE);
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;
        for s in OUT[..n].iter_mut() {
            *s = 0.0;
        }
        for v in VOICES[..nv].iter_mut() {
            if !v.gate && v.env < 1e-5 {
                continue;
            }
            for s in OUT[..n].iter_mut() {
                if v.gate {
                    v.env += (1.0 - v.env) * atk;
                } else {
                    v.env -= v.env * rel;
                }
                let saw = 2.0 * v.phase - 1.0 - poly_blep(v.phase, v.inc);
                v.phase += v.inc;
                if v.phase >= 1.0 {
                    v.phase -= 1.0;
                }
                let v3 = saw - v.ic2;
                let v1 = a1 * v.ic1 + a2 * v3;
                let v2 = v.ic2 + a2 * v.ic1 + a3 * v3;
                v.ic1 = 2.0 * v1 - v.ic1;
                v.ic2 = 2.0 * v2 - v.ic2;
                *s += v2 * v.env * 0.15;
            }
        }
    }
}
