// The mixer: strips (level, pan, mute), master, meters. Gains glide, so a fader jump never clicks.
use fwm_engine::events::{Event, Kind};
use fwm_engine::mixer::*;
use fwm_engine::*;

fn rack_with_note() -> Rack {
    let mut r = Rack::new(48000.0);
    assert!(r.add_device(0, DeviceKind::Basalt));
    r.push(Event { frame: 0, slot: 0, kind: Kind::NoteOn { note: 48, vel: 0.9 } });
    for _ in 0..40 {
        r.render(128); // let the note settle
    }
    r
}
fn peaks(r: &mut Rack, blocks: usize) -> (f32, f32) {
    let (mut l, mut rr) = (0f32, 0f32);
    for _ in 0..blocks {
        r.render(128);
        for x in r.out_l.iter() { l = l.max(x.abs()); }
        for x in r.out_r.iter() { rr = rr.max(x.abs()); }
    }
    (l, rr)
}

#[test]
fn fader_curve() {
    assert_eq!(fader_gain(0.0), 0.0);
    assert!((fader_gain(UNITY) - 1.0).abs() < 1e-6);
    let top_db = 20.0 * fader_gain(1.0).log10();
    assert!(top_db > 5.5 && top_db < 6.0, "{top_db}");
}

#[test]
fn defaults_leave_the_sound_alone_and_level_scales_it() {
    let mut r = rack_with_note();
    let (a, _) = peaks(&mut r, 50);
    r.mixer.set(0, MIX_LEVEL, 0.4); // half of unity on the fader = 1/8 gain (-18 dB)
    peaks(&mut r, 20); // glide
    let (b, _) = peaks(&mut r, 50);
    assert!((b / a - 0.125).abs() < 0.02, "a={a} b={b} ratio={}", b / a);
}

#[test]
fn pan_and_mute() {
    let mut r = rack_with_note();
    r.mixer.set(0, MIX_PAN, -1.0);
    peaks(&mut r, 20);
    let (l, rr) = peaks(&mut r, 40);
    assert!(l > 0.05 && rr < 1e-4, "hard left: l={l} r={rr}");
    r.mixer.set(0, MIX_MUTE, 1.0);
    peaks(&mut r, 20);
    let (l, rr) = peaks(&mut r, 40);
    assert!(l < 1e-5 && rr < 1e-5, "muted: l={l} r={rr}");
}

#[test]
fn a_fader_jump_glides_instead_of_clicking() {
    // A steady signal through strip 0; slam the fader from 0 dB to silence.
    let mut m = Mixer::new(48000.0);
    let run = |m: &mut Mixer| {
        let (mut l, mut r) = ([1f32; 128], [1f32; 128]);
        m.strip(0, &mut l, &mut r);
        l
    };
    assert!(run(&mut m).iter().all(|&x| (x - 1.0).abs() < 1e-6), "unity by default");
    m.set(0, MIX_LEVEL, 0.0);
    let mut out = Vec::new();
    for _ in 0..12 { out.extend_from_slice(&run(&mut m)); }
    assert!(out[0] > 0.9, "no jump on the first sample: {}", out[0]);
    assert!(out.windows(2).all(|w| w[1] <= w[0] + 1e-7), "falls smoothly, never back up");
    let after_10ms = out[480];
    assert!(after_10ms < 0.06, "mostly gone after 10 ms: {after_10ms}");
    assert!(out[out.len() - 1] < 1e-4, "silent after 30 ms: {}", out[out.len() - 1]);
}

#[test]
fn master_level_and_meters() {
    let mut r = rack_with_note();
    peaks(&mut r, 10);
    r.mixer.take_meters(&mut r.meters); // clear
    let (a, _) = peaks(&mut r, 30);
    let mut m = [0f32; (MAX_SLOTS + 1) * 2];
    r.mixer.take_meters(&mut m);
    assert!((m[MAX_SLOTS * 2] - a).abs() < 1e-6, "master meter = output peak ({} vs {a})", m[MAX_SLOTS * 2]);
    assert!(m[0] > 0.05 && m[2] == 0.0, "slot 0 metered, slot 1 silent");
    r.mixer.take_meters(&mut m);
    assert_eq!(m[0], 0.0, "reading clears the meters");
    r.mixer.set_master(MASTER_LEVEL, 0.0);
    peaks(&mut r, 20);
    let (b, _) = peaks(&mut r, 20);
    assert!(b < 1e-5, "master down: {b}");
}

#[test]
fn a_new_device_in_a_slot_starts_at_unity() {
    let mut r = rack_with_note();
    r.mixer.set(0, MIX_MUTE, 1.0);
    assert!(r.add_device(0, DeviceKind::Basalt));
    r.push(Event { frame: 0, slot: 0, kind: Kind::NoteOn { note: 48, vel: 0.9 } });
    let (a, _) = peaks(&mut r, 40);
    assert!(a > 0.05, "not muted any more: {a}");
}
