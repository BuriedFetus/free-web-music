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
}
