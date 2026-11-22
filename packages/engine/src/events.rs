//! Sample-accurate event queue. The host stamps each event with a frame offset inside the next
//! render call; the rack splits the block at those offsets. Fixed capacity, no allocation.

pub const QUEUE: usize = 512;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    NoteOn { note: u8, vel: f32 },
    NoteOff { note: u8 },
    Param { index: u16, value: f32 },
    AllOff,
}

#[derive(Clone, Copy, Debug)]
pub struct Event {
    pub frame: u32,
    pub slot: u8,
    pub kind: Kind,
}

pub struct Queue {
    items: [Event; QUEUE],
    len: usize,
}

impl Queue {
    pub const fn new() -> Queue {
        Queue { items: [Event { frame: 0, slot: 0, kind: Kind::AllOff }; QUEUE], len: 0 }
    }

    /// Inserts keeping frame order (stable for equal frames). Returns false if full.
    pub fn push(&mut self, e: Event) -> bool {
        if self.len == QUEUE {
            return false;
        }
        let mut i = self.len;
        while i > 0 && self.items[i - 1].frame > e.frame {
            self.items[i] = self.items[i - 1];
            i -= 1;
        }
        self.items[i] = e;
        self.len += 1;
        true
    }

    pub fn as_slice(&self) -> &[Event] {
        &self.items[..self.len]
    }

    pub fn clear(&mut self) {
        self.len = 0;
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}
