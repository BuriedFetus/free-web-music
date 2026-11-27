//! The contract every device implements. The rack, scheduler and host only talk to devices through this.
//! Future kinds (sequencers, effects, recorders) extend it with ports; instruments use notes in, audio out.

pub const MAX_ROUTES: usize = 16;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ModSource {
    Lfo = 0,
    AmpEnv = 1,
    FiltEnv = 2,
}

impl ModSource {
    pub fn from_index(i: u32) -> Option<ModSource> {
        match i {
            0 => Some(ModSource::Lfo),
            1 => Some(ModSource::AmpEnv),
            2 => Some(ModSource::FiltEnv),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RouteError {
    NoSlot,
    NotAllowed,
}

pub trait Device {
    fn prepare(&mut self, sample_rate: f32);
    fn param_count(&self) -> usize;
    /// Normalised 0..1 (enums: their index). Continuous params are smoothed.
    fn set_param(&mut self, index: usize, value: f32);
    fn param(&self, index: usize) -> f32;
    /// Current values after modulation, for the UI (knob arcs, fader mod bars).
    fn effective(&self) -> &[f32];
    fn set_route(&mut self, slot: usize, src: ModSource, target: usize, depth: f32) -> Result<(), RouteError>;
    fn clear_route(&mut self, slot: usize);
    fn mod_source_value(&self, src: ModSource) -> f32;
    fn note_on(&mut self, note: u8, velocity: f32);
    fn note_off(&mut self, note: u8);
    fn all_notes_off(&mut self);
    /// Adds nothing: overwrites `left`/`right` with this device's output.
    fn render(&mut self, left: &mut [f32], right: &mut [f32]);
    /// The song's tempo and place, before every block: `pos` in 16th-note steps since Play (it keeps
    /// counting when a row loops). Devices that move in time with the song use it.
    fn tempo(&mut self, _bpm: f32, _pos: f64, _playing: bool) {}
    /// A few numbers for the panel's pictures, read ~60 times a second (drains event queues: call once per read).
    fn viz(&mut self) -> &[f32] {
        &[]
    }
    /// How many numbers `viz` gives (asking must not drain anything).
    fn viz_len(&self) -> usize {
        0
    }
    /// A device-specific action that is not a param (Geode: play the tape, seek, clear).
    fn command(&mut self, _cmd: u32, _value: f32) {}
}
