//! Garnet tests: every string in tune at 44.1 and 48 kHz, strummed chords land on the strings a guitarist
//! uses, Ring and palm mute shorten notes, Slide glides, every body and cab stays bounded and ends in silence,
//! the manifest matches, a slot reuses its memory, and six strings fit the CPU budget.
//! `cargo test --release --test garnet -- --nocapture` prints the numbers.

use fwm_engine::device::Device;
use fwm_engine::devices::garnet::{defaults, p, Garnet, IDS, TUNING};
use fwm_engine::{DeviceKind, Rack, BLOCK};

fn garnet(fs: f32) -> Garnet {
    let mut g = Garnet::new();
    g.prepare(fs);
    g
}

fn render(g: &mut Garnet, n: usize) -> (Vec<f32>, Vec<f32>) {
    let mut l = vec![0.0; n];
    let mut r = vec![0.0; n];
    for (a, b) in l.chunks_mut(BLOCK).zip(r.chunks_mut(BLOCK)) {
        g.render(a, b);
    }
    (l, r)
}

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
}

/// Fundamental by normalised autocorrelation: the first peak within 90% of the best (no octave errors).
fn pitch(x: &[f32], fs: f32) -> f32 {
    let (lo, hi) = ((fs / 1500.0) as usize, (fs / 50.0) as usize);
    let r = |l: usize| {
        let (mut a, mut b, mut c) = (0.0f64, 0.0f64, 0.0f64);
        for i in 0..x.len() - l {
            a += (x[i] * x[i + l]) as f64;
            b += (x[i] * x[i]) as f64;
            c += (x[i + l] * x[i + l]) as f64;
        }
        a / (b * c).sqrt().max(1e-12)
    };
    let rs: Vec<f64> = (0..=hi + 1).map(|l| if l < lo { 0.0 } else { r(l) }).collect();
    let mx = rs[lo..=hi].iter().cloned().fold(f64::MIN, f64::max);
    let l = (lo + 1..hi).find(|&l| rs[l] > 0.9 * mx && rs[l] >= rs[l - 1] && rs[l] >= rs[l + 1]).unwrap();
    let (a, b, c) = (rs[l - 1], rs[l], rs[l + 1]);
    fs / (l as f64 + (a - c) / (2.0 * (a - 2.0 * b + c))) as f32
}

fn hz(n: u8) -> f32 {
    440.0 * 2f32.powf((n as f32 - 69.0) / 12.0)
}

#[test]
fn manifest_matches_the_engine() {
    let json = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/devices/garnet.json")).unwrap();
    let ids: Vec<String> = json.split("\"id\": \"").skip(2).map(|s| s.split('"').next().unwrap().to_string()).collect();
    assert_eq!(ids, IDS.iter().map(|s| s.to_string()).collect::<Vec<_>>());
    let defs: Vec<f32> = json
        .split("\"default\": ")
        .skip(1)
        .map(|s| s.split(|c: char| c == ' ' || c == '}' || c == ',').next().unwrap().parse().unwrap())
        .collect();
    let d = defaults();
    let g = garnet(48_000.0);
    for i in 0..p::COUNT {
        assert_eq!(defs[i], d[i], "default of {}", IDS[i]);
        assert_eq!(g.param(i), d[i]);
    }
}

#[test]
fn every_string_is_in_tune() {
    for fs in [44_100.0, 48_000.0] {
        for body in [0.0, 3.0] {
            for &open in TUNING.iter() {
                for fret in [0u8, 5, 12] {
                    let note = open + fret;
                    let mut g = garnet(fs);
                    g.set_param(p::BODY, body);
                    g.set_param(p::DRIVE, 0.0);
                    g.note_on(note, 0.8);
                    let (l, _) = render(&mut g, (fs * 0.6) as usize);
                    let at = (fs * 0.25) as usize;
                    let f = pitch(&l[at..at + 8192], fs);
                    let cents = 1200.0 * (f / hz(note)).log2();
                    println!("{fs} Hz body {body}: note {note} -> {f:.2} Hz ({cents:+.2} cents)");
                    assert!(cents.abs() < 3.0, "note {note} at {fs}: {cents} cents");
                }
            }
        }
    }
}

#[test]
fn strummed_chords_land_on_the_right_strings() {
    // (notes low to high, the string each should ring on)
    let chords: [(&str, &[u8], [Option<u8>; 6]); 4] = [
        ("C x32010", &[48, 52, 55, 60, 64], [None, Some(48), Some(52), Some(55), Some(60), Some(64)]),
        ("G 320003", &[43, 47, 50, 55, 59, 67], [Some(43), Some(47), Some(50), Some(55), Some(59), Some(67)]),
        ("E 022100", &[40, 47, 52, 56, 59, 64], [Some(40), Some(47), Some(52), Some(56), Some(59), Some(64)]),
        ("F 133211", &[41, 48, 53, 57, 60, 65], [Some(41), Some(48), Some(53), Some(57), Some(60), Some(65)]),
    ];
    for (name, notes, want) in chords {
        let mut g = garnet(48_000.0);
        for &n in notes {
            g.note_on(n, 0.8);
            render(&mut g, 480); // 10 ms between strings
        }
        assert_eq!(g.strings(), want, "{name}");
        // an up-strum (high to low) lands the same way
        let mut g = garnet(48_000.0);
        for &n in notes.iter().rev() {
            g.note_on(n, 0.8);
            render(&mut g, 480);
        }
        assert_eq!(g.strings(), want, "{name} up");
    }
}

#[test]
fn replucking_a_ringing_note_uses_its_string_and_a_seventh_note_takes_the_oldest() {
    let mut g = garnet(48_000.0);
    g.note_on(55, 0.8);
    render(&mut g, 480);
    g.note_off(55);
    g.note_on(55, 0.8);
    assert_eq!(g.strings().iter().filter(|s| **s == Some(55)).count(), 1);
    let mut g = garnet(48_000.0);
    for n in [40, 45, 50, 55, 59, 64] {
        g.note_on(n, 0.8);
        render(&mut g, 128);
    }
    g.note_on(62, 0.8); // every string held: the oldest that can play D4 is taken (A string, fret 17)
    let s = g.strings();
    assert_eq!(s.iter().filter(|x| x.is_some()).count(), 6);
    assert!(s.contains(&Some(62)));
    assert!(!s.contains(&Some(45)), "{s:?}");
}

#[test]
fn ring_and_palm_mute_shorten_notes() {
    let fs = 48_000.0;
    let tail = |ring: f32, mute: f32| {
        let mut g = garnet(fs);
        g.set_param(p::RING, ring);
        g.set_param(p::MUTE, mute);
        g.note_on(52, 0.8);
        render(&mut g, (fs * 0.1) as usize);
        g.note_off(52);
        let (l, _) = render(&mut g, (fs * 0.6) as usize);
        rms(&l[(fs * 0.4) as usize..])
    };
    let (long, short, muted) = (tail(1.0, 0.0), tail(0.0, 0.0), tail(1.0, 1.0));
    println!("tail 0.5 s after note-off: ring 100% {long:.5}, ring 0 {short:.6}, palm mute {muted:.6}");
    assert!(long > 0.002);
    assert!(short < long * 0.01);
    assert!(muted < long * 0.05);
}

#[test]
fn slide_glides_and_is_off_by_default() {
    let fs = 48_000.0;
    let run = |slide: f32| {
        let mut g = garnet(fs);
        g.set_param(p::SLIDE, slide);
        g.note_on(57, 0.8); // A3
        render(&mut g, (fs * 0.2) as usize);
        g.note_on(59, 0.8); // B3, legato
        g.note_off(57);
        let (l, _) = render(&mut g, (fs * 0.6) as usize);
        (g.strings().iter().filter(|s| s.is_some()).count(), pitch(&l[(fs * 0.3) as usize..(fs * 0.3) as usize + 8192], fs))
    };
    let (n_off, _) = run(0.0);
    let (n_on, f_on) = run(0.3);
    println!("slide off: {n_off} strings ringing; slide on: {n_on} string at {f_on:.1} Hz");
    assert_eq!(n_off, 2, "without slide the new note is plucked on another string");
    assert_eq!(n_on, 1, "with slide the held string glides");
    assert!((1200.0 * (f_on / hz(59)).log2()).abs() < 5.0);
}

#[test]
fn every_body_and_cab_is_bounded_and_ends() {
    let fs = 48_000.0;
    for body in 0..4 {
        for cab in 0..3 {
            for drive in [0.0, 0.6, 1.0] {
                let mut g = garnet(fs);
                g.set_param(p::BODY, body as f32);
                g.set_param(p::CAB, cab as f32);
                g.set_param(p::DRIVE, drive);
                g.set_param(p::SUSTAIN, 1.0);
                g.set_param(p::LVL, 1.0);
                g.set_param(p::RESO, 1.0);
                for n in [40, 47, 52, 56, 59, 64] {
                    g.note_on(n, 1.0);
                    render(&mut g, 240);
                }
                let (l, r) = render(&mut g, fs as usize);
                let pk = l.iter().chain(&r).fold(0f32, |m, v| m.max(v.abs()));
                assert!(l.iter().chain(&r).all(|v| v.is_finite()));
                assert!(pk < 1.0 && pk > 0.05, "body {body} cab {cab} drive {drive}: peak {pk}");
                g.all_notes_off();
                render(&mut g, fs as usize);
                assert!(!g.active(), "body {body} cab {cab}: strings stop after all-notes-off");
                let (l, _) = render(&mut g, 4800);
                assert!(rms(&l) < 1e-4, "silent at the end");
            }
        }
    }
}

#[test]
fn drive_is_level_matched() {
    let fs = 48_000.0;
    let level = |drive: f32| {
        let mut g = garnet(fs);
        g.set_param(p::DRIVE, drive);
        g.set_param(p::CAB, 0.0);
        g.note_on(52, 0.8);
        let (l, _) = render(&mut g, (fs * 0.5) as usize);
        rms(&l)
    };
    let (clean, driven) = (level(0.0), level(1.0));
    let db = 20.0 * (driven / clean).log10();
    println!("drive 100% vs 0%: {db:+.1} dB");
    assert!(db.abs() < 6.0);
}

#[test]
fn a_slot_reuses_its_memory_and_garnet_plays_in_the_rack() {
    let mut r = Rack::new(48_000.0);
    for _ in 0..50 {
        assert!(r.add_device(3, DeviceKind::Garnet));
        r.remove_device(3);
    }
    assert!(r.add_device(3, DeviceKind::Garnet));
    r.push(fwm_engine::events::Event { frame: 0, slot: 3, kind: fwm_engine::events::Kind::NoteOn { note: 52, vel: 0.8 } });
    let mut peak = 0f32;
    for _ in 0..200 {
        r.render(BLOCK);
        peak = r.out_l.iter().fold(peak, |m, v| m.max(v.abs()));
    }
    assert!(peak > 0.02, "peak {peak}");
}

#[test]
fn six_strings_fit_the_cpu_budget() {
    let fs = 48_000.0;
    let mut g = garnet(fs);
    g.set_param(p::SUSTAIN, 1.0);
    g.set_param(p::DRIVE, 0.6);
    for n in [40, 47, 52, 56, 59, 64] {
        g.note_on(n, 1.0);
    }
    let secs = 5.0;
    let t = std::time::Instant::now();
    render(&mut g, (fs * secs) as usize);
    let used = t.elapsed().as_secs_f32() / secs;
    println!("six strings + body + amp: {:.2}% of one core", used * 100.0);
    assert!(used < 0.05, "{used}");
}
