//! Delay memory for the effects and a delay line over it.
//!
//! The effects need a few MiB of delay memory. The engine never allocates while running, and arrays
//! that big can't be built on the stack, so in WebAssembly there is one static pool that the rack
//! carves up once when it is created. Native builds (tests) just allocate.

#[cfg(target_arch = "wasm32")]
mod pool {
    /// 2^20 floats = 4 MiB: room for every effect at sample rates up to 96 kHz, plus the string loops of
    /// a Garnet in every slot (each slot keeps its block, see `Rack::add_device`).
    pub const SIZE: usize = 1 << 20;
    static mut MEM: [f32; SIZE] = [0.0; SIZE];
    static mut USED: usize = 0;
    /// Start carving from the beginning again (a new rack).
    pub fn reset() {
        unsafe { USED = 0 }
    }
    pub fn take(n: usize) -> &'static mut [f32] {
        unsafe {
            let n = n.min(SIZE - USED);
            let p = core::ptr::addr_of_mut!(MEM) as *mut f32;
            let s = core::slice::from_raw_parts_mut(p.add(USED), n);
            USED += n;
            s.fill(0.0);
            s
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
mod pool {
    pub fn reset() {}
    pub fn take(n: usize) -> &'static mut [f32] {
        std::boxed::Box::leak(std::vec![0.0f32; n].into_boxed_slice())
    }
}

pub use pool::reset as reset_pool;
pub use pool::take as take_mem;

/// A circular delay line. `read(d)` is the sample written `d` samples ago (d ≥ 1).
pub struct Line {
    buf: &'static mut [f32],
    w: usize,
}

impl Line {
    /// Holds delays up to `max` samples.
    pub fn new(max: usize) -> Line {
        Line { buf: pool::take(max.max(2) + 2), w: 0 }
    }
    #[inline(always)]
    pub fn len(&self) -> usize {
        self.buf.len()
    }
    #[inline(always)]
    pub fn push(&mut self, x: f32) {
        self.buf[self.w] = x;
        self.w += 1;
        if self.w == self.buf.len() {
            self.w = 0;
        }
    }
    #[inline(always)]
    pub fn read(&self, d: usize) -> f32 {
        let n = self.buf.len();
        let d = d.clamp(1, n - 1);
        self.buf[(self.w + n - d) % n]
    }
    /// Fractional delay, linear interpolation.
    #[inline(always)]
    pub fn read_frac(&self, d: f32) -> f32 {
        let d = d.clamp(1.0, (self.buf.len() - 2) as f32);
        let i = d as usize;
        let f = d - i as f32;
        let a = self.read(i);
        let b = self.read(i + 1);
        a + (b - a) * f
    }
    pub fn clear(&mut self) {
        self.buf.fill(0.0);
    }
    /// Schroeder allpass with this line as its memory: y = z⁻ᴺ·u − g·u, u = x + g·z⁻ᴺ·u.
    #[inline(always)]
    pub fn allpass(&mut self, x: f32, n: f32, g: f32) -> f32 {
        let v = if n == libm::floorf(n) { self.read(n as usize) } else { self.read_frac(n) };
        let u = x + g * v;
        self.push(crate::dsp::flush(u));
        v - g * u
    }
}

/// One-pole low-pass: `c` from [`lp_coef`].
#[inline(always)]
pub fn one_pole(state: &mut f32, x: f32, c: f32) -> f32 {
    *state = crate::dsp::flush(*state + c * (x - *state));
    *state
}

/// One-pole coefficient for a cutoff in Hz.
#[inline]
pub fn lp_coef(fc: f32, fs: f32) -> f32 {
    1.0 - crate::dsp::expf(-crate::dsp::TAU * fc.min(0.45 * fs) / fs)
}
