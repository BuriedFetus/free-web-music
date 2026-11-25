//! free-web-music audio engine.
//!
//! A `Rack` holds device slots (one per track instrument for now). Each slot's sound goes through
//! its mixer strip, then the master. The host (the AudioWorklet) queues timestamped events, calls
//! `fwm_render` once per 128-frame block, and reads the master output, the scope ring, the meters
//! and each device's modulated parameter values from memory.
//!
//! Built as `no_std` for wasm32 (no allocator, nothing can allocate on the audio thread).
//! Native builds use std so `cargo test` works.
#![cfg_attr(target_arch = "wasm32", no_std)]
#![allow(static_mut_refs)]

pub mod device;
pub mod devices;
pub mod dsp;
pub mod events;
pub mod fx;
pub mod mixer;

use device::{Device, ModSource, RouteError};
use devices::basalt::Basalt;
use devices::flint::Flint;
use devices::garnet::Garnet;
use events::{Event, Kind, Queue};
use fx::Fx;
use mixer::Mixer;

#[cfg(all(target_arch = "wasm32", not(test)))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

pub const BLOCK: usize = 128;
pub const MAX_SLOTS: usize = 16;
pub const SCOPE_LEN: usize = 2048;
/// The Scope panel's probe: the master or one slot (post-fader), longer for slow zooms and the spectrum.
pub const PROBE_LEN: usize = 4096;
/// Probe source: off, or the master (after effects and master fader); 0.. = a slot.
pub const PROBE_OFF: i32 = -2;
pub const PROBE_MASTER: i32 = -1;

/// Device kinds the host can create. New devices get a new number here and a new arm in `Slot`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DeviceKind {
    Basalt = 1,
    Flint = 2,
    Garnet = 3,
}

impl DeviceKind {
    pub fn from_index(i: u32) -> Option<DeviceKind> {
        match i {
            1 => Some(DeviceKind::Basalt),
            2 => Some(DeviceKind::Flint),
            3 => Some(DeviceKind::Garnet),
            _ => None,
        }
    }
}

pub enum Slot {
    Empty,
    Basalt(Basalt),
    Flint(Flint),
    Garnet(Garnet),
}

impl Slot {
    fn device(&mut self) -> Option<&mut dyn Device> {
        match self {
            Slot::Empty => None,
            Slot::Basalt(d) => Some(d),
            Slot::Flint(d) => Some(d),
            Slot::Garnet(d) => Some(d),
        }
    }

    fn device_ref(&self) -> Option<&dyn Device> {
        match self {
            Slot::Empty => None,
            Slot::Basalt(d) => Some(d),
            Slot::Flint(d) => Some(d),
            Slot::Garnet(d) => Some(d),
        }
    }
}

pub struct Rack {
    pub sample_rate: f32,
    slots: [Slot; MAX_SLOTS],
    queue: Queue,
    carry: Queue,
    pub out_l: [f32; BLOCK],
    pub out_r: [f32; BLOCK],
    tmp_l: [f32; BLOCK],
    tmp_r: [f32; BLOCK],
    pub scope: [f32; SCOPE_LEN],
    pub scope_pos: usize,
    pub mixer: Mixer,
    /// The master effects chain (Reverb, Delay, Lo-fi, Low-pass), after the strips, before the master fader.
    pub fx: Fx,
    pub probe: [f32; PROBE_LEN],
    pub probe_pos: usize,
    pub probe_src: i32,
    /// Meter snapshot for the host (see `Mixer::take_meters`).
    pub meters: [f32; (MAX_SLOTS + 1) * 2],
    /// Each slot's Garnet string memory, taken from the pool the first time and reused after.
    garnet_mem: [Option<(*mut f32, usize)>; MAX_SLOTS],
}

impl Rack {
    pub fn new(sample_rate: f32) -> Rack {
        Rack {
            sample_rate,
            slots: core::array::from_fn(|_| Slot::Empty),
            queue: Queue::new(),
            carry: Queue::new(),
            out_l: [0.0; BLOCK],
            out_r: [0.0; BLOCK],
            tmp_l: [0.0; BLOCK],
            tmp_r: [0.0; BLOCK],
            scope: [0.0; SCOPE_LEN],
            scope_pos: 0,
            mixer: Mixer::new(sample_rate),
            fx: Fx::new(sample_rate),
            probe: [0.0; PROBE_LEN],
            probe_pos: 0,
            probe_src: PROBE_OFF,
            meters: [0.0; (MAX_SLOTS + 1) * 2],
            garnet_mem: [None; MAX_SLOTS],
        }
    }

    pub fn add_device(&mut self, slot: usize, kind: DeviceKind) -> bool {
        if slot >= MAX_SLOTS {
            return false;
        }
        let mut s = match kind {
            DeviceKind::Basalt => Slot::Basalt(Basalt::new()),
            DeviceKind::Flint => Slot::Flint(Flint::new()),
            DeviceKind::Garnet => {
                // the old device in this slot (if any) goes first: its memory is about to be reused
                self.slots[slot] = Slot::Empty;
                let (ptr, len) = *self.garnet_mem[slot].get_or_insert_with(|| {
                    let m = fx::line::take_mem(devices::garnet::MEM);
                    (m.as_mut_ptr(), m.len())
                });
                // Safety: the block belongs to this slot only, and the device that used it was just dropped.
                Slot::Garnet(Garnet::with_memory(unsafe { core::slice::from_raw_parts_mut(ptr, len) }))
            }
        };
        if let Some(d) = s.device() {
            d.prepare(self.sample_rate);
        }
        self.slots[slot] = s;
        self.mixer.reset(slot);
        true
    }

    pub fn remove_device(&mut self, slot: usize) {
        if slot < MAX_SLOTS {
            self.slots[slot] = Slot::Empty;
        }
    }

    pub fn device(&mut self, slot: usize) -> Option<&mut dyn Device> {
        self.slots.get_mut(slot).and_then(|s| s.device())
    }

    pub fn device_ref(&self, slot: usize) -> Option<&dyn Device> {
        self.slots.get(slot).and_then(|s| s.device_ref())
    }

    /// Queue an event `frame` samples into the next render call. Later frames carry over.
    pub fn push(&mut self, e: Event) -> bool {
        self.queue.push(e)
    }

    fn apply(&mut self, e: &Event) {
        if let Some(d) = self.device(e.slot as usize) {
            match e.kind {
                Kind::NoteOn { note, vel } => d.note_on(note, vel),
                Kind::NoteOff { note } => d.note_off(note),
                Kind::Param { index, value } => d.set_param(index as usize, value),
                Kind::AllOff => d.all_notes_off(),
            }
        }
    }

    fn render_span(&mut self, from: usize, to: usize) {
        if from >= to {
            return;
        }
        for i in 0..MAX_SLOTS {
            let (l, r) = (&mut self.tmp_l[from..to], &mut self.tmp_r[from..to]);
            if let Some(d) = self.slots[i].device() {
                d.render(l, r);
                self.mixer.strip(i, l, r, Some((&mut self.fx.sends, from)));
                if self.probe_src == i as i32 {
                    for (a, b) in l.iter().zip(r.iter()) {
                        self.probe[self.probe_pos] = 0.5 * (a + b);
                        self.probe_pos = (self.probe_pos + 1) % PROBE_LEN;
                    }
                }
                for (o, x) in self.out_l[from..to].iter_mut().zip(l.iter()) {
                    *o += *x;
                }
                for (o, x) in self.out_r[from..to].iter_mut().zip(r.iter()) {
                    *o += *x;
                }
            }
        }
    }

    /// Renders `frames` (≤ 128) samples into `out_l`/`out_r`, applying queued events on time.
    pub fn render(&mut self, frames: usize) {
        let n = frames.min(BLOCK);
        self.out_l[..n].fill(0.0);
        self.out_r[..n].fill(0.0);
        let mut pos = 0;
        let mut i = 0;
        while i < self.queue.len() {
            let e = self.queue.as_slice()[i];
            let at = e.frame as usize;
            if at >= n {
                break;
            }
            self.render_span(pos, at);
            pos = pos.max(at);
            self.apply(&e);
            i += 1;
        }
        self.render_span(pos, n);
        // Carry later events into the next block.
        self.carry.clear();
        for e in &self.queue.as_slice()[i..] {
            let mut e = *e;
            e.frame -= n as u32;
            self.carry.push(e);
        }
        core::mem::swap(&mut self.queue, &mut self.carry);

        self.fx.process(&mut self.out_l, &mut self.out_r, n);
        self.mixer.master(&mut self.out_l[..n], &mut self.out_r[..n]);
        if self.probe_src == PROBE_MASTER {
            for k in 0..n {
                self.probe[self.probe_pos] = 0.5 * (self.out_l[k] + self.out_r[k]);
                self.probe_pos = (self.probe_pos + 1) % PROBE_LEN;
            }
        } else if self.probe_src >= 0 && self.slots.get(self.probe_src as usize).map_or(true, |s| matches!(s, Slot::Empty)) {
            // the probed slot is empty: keep the picture moving (silence), not frozen
            for _ in 0..n {
                self.probe[self.probe_pos] = 0.0;
                self.probe_pos = (self.probe_pos + 1) % PROBE_LEN;
            }
        }
        for k in 0..n {
            self.scope[self.scope_pos] = 0.5 * (self.out_l[k] + self.out_r[k]);
            self.scope_pos = (self.scope_pos + 1) % SCOPE_LEN;
        }
    }
}

// ---------------------------------------------------------------------------------------------
// WebAssembly interface (C ABI). One rack per worklet instance.

static mut RACK: Option<Rack> = None;

fn rack() -> Option<&'static mut Rack> {
    unsafe { RACK.as_mut() }
}

#[no_mangle]
pub extern "C" fn fwm_init(sample_rate: f32) {
    unsafe {
        RACK = None;
        fx::line::reset_pool();
        RACK = Some(Rack::new(sample_rate));
    }
}

/// Returns 1 on success.
#[no_mangle]
pub extern "C" fn fwm_add_device(slot: u32, kind: u32) -> i32 {
    match (rack(), DeviceKind::from_index(kind)) {
        (Some(r), Some(k)) => r.add_device(slot as usize, k) as i32,
        _ => 0,
    }
}

#[no_mangle]
pub extern "C" fn fwm_remove_device(slot: u32) {
    if let Some(r) = rack() {
        r.remove_device(slot as usize);
    }
}

fn push(slot: u32, frame: u32, kind: Kind) -> i32 {
    match rack() {
        Some(r) => r.push(Event { frame, slot: slot as u8, kind }) as i32,
        None => 0,
    }
}

#[no_mangle]
pub extern "C" fn fwm_note_on(slot: u32, frame: u32, note: u32, vel: f32) -> i32 {
    push(slot, frame, Kind::NoteOn { note: note.min(127) as u8, vel })
}

#[no_mangle]
pub extern "C" fn fwm_note_off(slot: u32, frame: u32, note: u32) -> i32 {
    push(slot, frame, Kind::NoteOff { note: note.min(127) as u8 })
}

#[no_mangle]
pub extern "C" fn fwm_param(slot: u32, frame: u32, index: u32, value: f32) -> i32 {
    push(slot, frame, Kind::Param { index: index as u16, value })
}

#[no_mangle]
pub extern "C" fn fwm_all_off(slot: u32) -> i32 {
    push(slot, 0, Kind::AllOff)
}

/// 0 = ok, -1 = no such route slot or device, -2 = not allowed (self-modulation or enum target).
#[no_mangle]
pub extern "C" fn fwm_set_route(slot: u32, route: u32, src: u32, target: u32, depth: f32) -> i32 {
    let (Some(r), Some(s)) = (rack(), ModSource::from_index(src)) else { return -1 };
    match r.device(slot as usize) {
        Some(d) => match d.set_route(route as usize, s, target as usize, depth) {
            Ok(()) => 0,
            Err(RouteError::NoSlot) => -1,
            Err(RouteError::NotAllowed) => -2,
        },
        None => -1,
    }
}

#[no_mangle]
pub extern "C" fn fwm_clear_route(slot: u32, route: u32) {
    if let Some(d) = rack().and_then(|r| r.device(slot as usize)) {
        d.clear_route(route as usize);
    }
}

#[no_mangle]
pub extern "C" fn fwm_render(frames: u32) {
    if let Some(r) = rack() {
        r.render(frames as usize);
    }
}

#[no_mangle]
pub extern "C" fn fwm_out_l() -> *const f32 {
    rack().map_or(core::ptr::null(), |r| r.out_l.as_ptr())
}

#[no_mangle]
pub extern "C" fn fwm_out_r() -> *const f32 {
    rack().map_or(core::ptr::null(), |r| r.out_r.as_ptr())
}

#[no_mangle]
pub extern "C" fn fwm_scope() -> *const f32 {
    rack().map_or(core::ptr::null(), |r| r.scope.as_ptr())
}

#[no_mangle]
pub extern "C" fn fwm_scope_pos() -> u32 {
    rack().map_or(0, |r| r.scope_pos as u32)
}

#[no_mangle]
pub extern "C" fn fwm_scope_len() -> u32 {
    SCOPE_LEN as u32
}

/// Pointer to the device's modulated parameter values (`fwm_param_count` floats).
#[no_mangle]
pub extern "C" fn fwm_effective(slot: u32) -> *const f32 {
    rack()
        .and_then(|r| r.device_ref(slot as usize))
        .map_or(core::ptr::null(), |d| d.effective().as_ptr())
}

#[no_mangle]
pub extern "C" fn fwm_param_count(slot: u32) -> u32 {
    rack().and_then(|r| r.device_ref(slot as usize)).map_or(0, |d| d.param_count() as u32)
}

#[no_mangle]
pub extern "C" fn fwm_mod_source(slot: u32, src: u32) -> f32 {
    match (rack().and_then(|r| r.device_ref(slot as usize)), ModSource::from_index(src)) {
        (Some(d), Some(s)) => d.mod_source_value(s),
        _ => 0.0,
    }
}

// ---- mixer ----

/// A strip setting: param 0 level (0..1, 0.8 = 0 dB), 1 pan (-1..1), 2 mute (0/1), 3 send A, 4 send B.
#[no_mangle]
pub extern "C" fn fwm_mix(slot: u32, param: u32, value: f32) {
    if let Some(r) = rack() {
        r.mixer.set(slot as usize, param, value);
    }
}

/// A master setting: param 0 level (0..1, 0.8 = 0 dB).
#[no_mangle]
pub extern "C" fn fwm_master(param: u32, value: f32) {
    if let Some(r) = rack() {
        r.mixer.set_master(param, value);
    }
}

/// Peak levels since the last call, `(MAX_SLOTS + 1) * 2` floats: [slot0 L, slot0 R, …, master L, master R].
#[no_mangle]
pub extern "C" fn fwm_meters() -> *const f32 {
    match rack() {
        Some(r) => {
            r.mixer.take_meters(&mut r.meters);
            r.meters.as_ptr()
        }
        None => core::ptr::null(),
    }
}

#[no_mangle]
pub extern "C" fn fwm_meters_len() -> u32 {
    ((MAX_SLOTS + 1) * 2) as u32
}

// ---- master effects ----

/// An effect setting (see `fx::param`: 0–4 Reverb, 10–15 Delay, 20–28 Lo-fi, 30–32 Low-pass).
#[no_mangle]
pub extern "C" fn fwm_fx(param: u32, value: f32) {
    if let Some(r) = rack() {
        r.fx.set(param, value);
    }
}

/// The chain order: up to four effect ids (0 Reverb, 1 Delay, 2 Lo-fi, 3 Low-pass; 255 = none).
#[no_mangle]
pub extern "C" fn fwm_fx_chain(a: u32, b: u32, c: u32, d: u32) {
    if let Some(r) = rack() {
        r.fx.set_chain(&[a as u8, b as u8, c as u8, d as u8]);
    }
}

// ---- scope probe ----

/// What the Scope panel watches: -2 off, -1 the master (after effects), 0.. a slot (after its fader).
#[no_mangle]
pub extern "C" fn fwm_probe(src: i32) {
    if let Some(r) = rack() {
        if r.probe_src != src {
            r.probe.fill(0.0);
        }
        r.probe_src = src;
    }
}

#[no_mangle]
pub extern "C" fn fwm_probe_ptr() -> *const f32 {
    rack().map_or(core::ptr::null(), |r| r.probe.as_ptr())
}

#[no_mangle]
pub extern "C" fn fwm_probe_pos() -> u32 {
    rack().map_or(0, |r| r.probe_pos as u32)
}

#[no_mangle]
pub extern "C" fn fwm_probe_len() -> u32 {
    PROBE_LEN as u32
}
