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

/// Delay memory for a new effect or line: from the arena while one is set (see [`with_arena`]),
/// otherwise from the shared pool.
pub fn take_mem(n: usize) -> &'static mut [f32] {
    match arena::take(n) {
        Some(s) => s,
        None => pool::take(n),
    }
}

/// Runs `f` with every delay line it makes carved from `mem` (a device's own block, so a device
/// with big effects of its own, like Geode, does not use up the shared pool). Returns `f`'s result
/// and whether everything fitted (lines that did not fit came from the pool).
pub fn with_arena<R>(mem: &'static mut [f32], f: impl FnOnce() -> R) -> (R, bool) {
    arena::set(mem);
    let r = f();
    (r, arena::clear())
}

mod arena {
    struct Arena {
        ptr: *mut f32,
        len: usize,
        used: usize,
        fits: bool,
    }
    #[cfg(target_arch = "wasm32")]
    mod cell {
        pub static mut A: Option<super::Arena> = None;
        pub fn with<R>(f: impl FnOnce(&mut Option<super::Arena>) -> R) -> R {
            unsafe { f(&mut *core::ptr::addr_of_mut!(A)) }
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    mod cell {
        std::thread_local! { static A: core::cell::RefCell<Option<super::Arena>> = const { core::cell::RefCell::new(None) }; }
        pub fn with<R>(f: impl FnOnce(&mut Option<super::Arena>) -> R) -> R {
            A.with(|a| f(&mut a.borrow_mut()))
        }
    }
    pub fn set(mem: &'static mut [f32]) {
        let (ptr, len) = (mem.as_mut_ptr(), mem.len());
        cell::with(|a| *a = Some(Arena { ptr, len, used: 0, fits: true }));
    }
    pub fn clear() -> bool {
        cell::with(|a| a.take().map_or(true, |x| x.fits))
    }
    pub fn take(n: usize) -> Option<&'static mut [f32]> {
        cell::with(|a| {
            let x = a.as_mut()?;
            if x.used + n > x.len {
                x.fits = false;
                return None;
            }
            // Safety: each carved piece is handed out once; the block belongs to one device.
            let s = unsafe { core::slice::from_raw_parts_mut(x.ptr.add(x.used), n) };
            x.used += n;
            s.fill(0.0);
            Some(s)
        })
    }
}

/// A big block of memory that lives as long as the engine (a sampler's tape, a device's own effects).
/// In WebAssembly it grows the memory (new pages, zeroed); an empty slice when there is no more.
#[cfg(target_arch = "wasm32")]
pub fn take_big(n: usize) -> &'static mut [f32] {
    let pages = (n * 4 + 65535) / 65536;
    let prev = core::arch::wasm32::memory_grow(0, pages);
    if prev == usize::MAX {
        return &mut [];
    }
    unsafe { core::slice::from_raw_parts_mut((prev * 65536) as *mut f32, n) }
}
#[cfg(not(target_arch = "wasm32"))]
pub fn take_big(n: usize) -> &'static mut [f32] {
    std::boxed::Box::leak(std::vec![0.0f32; n].into_boxed_slice())
}

/// A circular delay line. `read(d)` is the sample written `d` samples ago (d ≥ 1).
pub struct Line {
    buf: &'static mut [f32],
    w: usize,
}

impl Line {
    /// Holds delays up to `max` samples.
    pub fn new(max: usize) -> Line {
        Line { buf: take_mem(max.max(2) + 2), w: 0 }
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
