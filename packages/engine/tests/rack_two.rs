use fwm_engine::*;
use fwm_engine::events::{Event, Kind};

fn peak(r: &mut Rack, blocks: usize) -> f32 {
    let mut p = 0f32;
    for _ in 0..blocks { r.render(128); for x in r.out_l.iter() { p = p.max(x.abs()); } }
    p
}

#[test]
fn two_basalts_both_sound() {
    let mut r = Rack::new(48000.0);
    assert!(r.add_device(0, DeviceKind::Basalt));
    r.push(Event { frame: 0, slot: 0, kind: Kind::NoteOn { note: 48, vel: 0.8 } });
    let a = peak(&mut r, 100);
    assert!(r.add_device(1, DeviceKind::Basalt));
    let a2 = peak(&mut r, 100);
    r.push(Event { frame: 0, slot: 1, kind: Kind::NoteOn { note: 55, vel: 0.8 } });
    let b = peak(&mut r, 100);
    eprintln!("sizeof Slot = {}", core::mem::size_of::<Slot>());
    eprintln!("a={a} a_after_add={a2} both={b}");
    assert!(a > 0.05 && a2 > 0.05 && b > a2);
}
