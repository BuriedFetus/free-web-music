//! Flint tests: every drum type in every character makes a clean, bounded sound that ends; accent, velocity,
//! choke and re-trigger behave; 8 pads at once fit the CPU budget. `cargo test -- --nocapture` prints levels.

use fwm_engine::device::Device;
use fwm_engine::devices::flint::{defaults, p, param_id, Flint, PADS, PER_PAD};
use fwm_engine::{DeviceKind, Rack, BLOCK};

const FS: f32 = 48_000.0;

fn flint() -> Flint {
    let mut f = Flint::new();
    f.prepare(FS);
    f
}

fn render(f: &mut Flint, n: usize) -> Vec<f32> {
    let mut l = vec![0.0; n];
    let mut r = vec![0.0; n];
    for (a, b) in l.chunks_mut(BLOCK).zip(r.chunks_mut(BLOCK)) {
        f.render(a, b);
    }
    l
}

fn set_pad(f: &mut Flint, pad: usize, ty: usize, model: usize) {
    f.set_param(pad * PER_PAD + p::TYPE, ty as f32);
    f.set_param(pad * PER_PAD + p::MODEL, model as f32);
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len() as f32).sqrt()
}

const TYPES: [&str; 8] = ["Kick", "Snare", "Clap", "Closed hat", "Open hat", "Tom", "Rim", "Perc"];
const MODELS: [&str; 4] = ["Analog", "Digital", "Noise", "Vintage"];

#[test]
fn manifest_matches_the_engine() {
    let json = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/devices/flint.json")).unwrap();
    let ids: Vec<String> = json.split("\"id\": \"").skip(2).map(|s| s.split('"').next().unwrap().to_string()).collect();
    let ours: Vec<String> = (0..p::COUNT).map(|i| {
        let (b, n) = param_id(i);
        String::from_utf8(b[..n].to_vec()).unwrap()
    }).collect();
    assert_eq!(ids, ours);
    let d = defaults();
    let f = flint();
    for i in 0..p::COUNT {
        assert_eq!(f.param(i), d[i]);
    }
}

#[test]
fn every_drum_in_every_character_sounds_and_ends() {
    for (t, tn) in TYPES.iter().enumerate() {
        for (m, mn) in MODELS.iter().enumerate() {
            let mut f = flint();
            set_pad(&mut f, 0, t, m);
            f.note_on(36, 0.9);
            let x = render(&mut f, (FS * 4.0) as usize);
            let peak = x.iter().fold(0.0f32, |a, v| a.max(v.abs()));
            assert!(x.iter().all(|v| v.is_finite()), "{tn} {mn}: not finite");
            assert!(peak > 0.03, "{tn} {mn}: too quiet ({peak})");
            assert!(peak <= 1.0, "{tn} {mn}: too loud ({peak})");
            assert!(!f.active(), "{tn} {mn}: still sounding after 4 s");
            let tail = rms(&x[x.len() - 4800..]);
            assert!(tail < 1e-4, "{tn} {mn}: tail not silent ({tail})");
            println!("{tn:>10} {mn:<8} peak {peak:.3}  rms(100 ms) {:.3}", rms(&x[..4800]));
        }
    }
}

#[test]
fn characters_really_differ() {
    // The same drum in two characters must not be (nearly) the same sound.
    for t in 0..8 {
        let mut sounds = Vec::new();
        for m in 0..4 {
            let mut f = flint();
            set_pad(&mut f, 0, t, m);
            f.note_on(36, 0.9);
            sounds.push(render(&mut f, 9600));
        }
        for a in 0..4 {
            for b in a + 1..4 {
                let diff: Vec<f32> = sounds[a].iter().zip(&sounds[b]).map(|(x, y)| x - y).collect();
                let rel = rms(&diff) / rms(&sounds[a]).max(1e-6);
                assert!(rel > 0.2, "{} {} vs {}: too similar ({rel:.3})", TYPES[t], MODELS[a], MODELS[b]);
            }
        }
    }
}

#[test]
fn accent_and_velocity_change_the_level() {
    let hit = |note: u8, vel: f32| {
        let mut f = flint();
        f.note_on(note, vel);
        rms(&render(&mut f, 4800))
    };
    let soft = hit(36 + 1, 0.3);
    let normal = hit(36 + 1, 0.9);
    let accent = hit(48 + 1, 0.9);
    println!("snare rms soft {soft:.3} normal {normal:.3} accent {accent:.3}");
    assert!(normal > soft * 1.5);
    assert!(accent > normal * 1.2);
    // notes outside the pads do nothing
    let mut f = flint();
    f.note_on(60, 1.0);
    assert!(!f.active());
}

#[test]
fn closed_hat_chokes_the_open_hat() {
    let mut f = flint(); // pad 4 = Open hat, pad 3 = Closed hat
    f.note_on(36 + 4, 1.0);
    render(&mut f, 2400);
    f.note_on(36 + 3, 1.0);
    let x = render(&mut f, 9600); // 200 ms
    // Only the short closed hat should remain: after 120 ms everything is quiet.
    let late = rms(&x[5760..]);
    let mut g = flint();
    g.note_on(36 + 4, 1.0);
    render(&mut g, 2400);
    let ringing = rms(&render(&mut g, 9600)[5760..]);
    println!("open hat after a closed hat {late:.5}, left alone {ringing:.5}");
    assert!(ringing > 0.01);
    assert!(late < ringing * 0.05);
}

#[test]
fn retrigger_and_all_off_are_clean() {
    let mut f = flint();
    let mut prev = 0.0f32;
    let mut jump = 0.0f32;
    for k in 0..40 {
        f.note_on(36, 1.0); // kick every 5 ms: must not click or blow up
        for v in render(&mut f, 240) {
            jump = jump.max((v - prev).abs());
            prev = v;
        }
        let _ = k;
    }
    assert!(jump < 0.5, "jump {jump}");
    f.all_notes_off();
    render(&mut f, 2400);
    assert!(!f.active());
}

#[test]
fn eight_pads_at_once_fit_the_budget() {
    let mut f = flint();
    for (i, m) in [0usize, 1, 2, 3, 0, 1, 2, 3].iter().enumerate() {
        set_pad(&mut f, i, i, *m);
    }
    let blocks = (FS * 10.0) as usize / BLOCK;
    let mut l = [0.0f32; BLOCK];
    let mut r = [0.0f32; BLOCK];
    let t0 = std::time::Instant::now();
    for b in 0..blocks {
        if b % 94 == 0 {
            for i in 0..PADS {
                f.note_on(36 + i as u8, 1.0); // all 8 pads every ~250 ms
            }
        }
        f.render(&mut l, &mut r);
    }
    let per_block = t0.elapsed().as_secs_f64() / blocks as f64 * 1000.0;
    println!("8 pads: {per_block:.4} ms per block (budget 2.67 ms for everything)");
    assert!(per_block < 0.3);
}

#[test]
fn the_rack_can_host_flint() {
    let mut rack = Rack::new(FS);
    assert!(rack.add_device(0, DeviceKind::Flint));
    assert!(rack.add_device(1, DeviceKind::Basalt));
    assert_eq!(rack.device(0).unwrap().param_count(), p::COUNT);
}
