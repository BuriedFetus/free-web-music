//! Opal tests: the manifest matches, a single oscillator is in tune, eight voices stay bounded at
//! every setting and end in silence, voices are reused and stolen, the chorus widens, CPU budget.
//! `cargo test --release --test opal -- --nocapture` prints the numbers.

use fwm_engine::device::Device;
use fwm_engine::devices::opal::{defaults, p, Opal, IDS, VOICES};
use fwm_engine::BLOCK;

fn opal(fs: f32) -> Opal {
    let mut o = Opal::new();
    o.prepare(fs);
    o
}
fn render(o: &mut Opal, n: usize) -> (Vec<f32>, Vec<f32>) {
    let mut l = vec![0.0; n];
    let mut r = vec![0.0; n];
    for (a, b) in l.chunks_mut(BLOCK).zip(r.chunks_mut(BLOCK)) {
        o.render(a, b);
    }
    (l, r)
}
fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
}
/// Plain settings: one sine-like saw, no drift, no motion, no chorus, open filter, quick envelope.
fn plain(o: &mut Opal) {
    for (i, v) in [(p::STACK, 0.0), (p::DETUNE, 0.0), (p::MIX2, 0.0), (p::AIR, 0.0), (p::DRIFT, 0.0), (p::MOVE, 0.0), (p::CHORUS, 0.0),
        (p::FENV, 0.0), (p::CUT, 1.0), (p::RES, 0.0), (p::ATK, 0.0), (p::SUS, 1.0), (p::W1, 3.0)] {
        o.set_param(i, v);
    }
}

#[test]
fn manifest_matches_the_engine() {
    let json = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/devices/opal.json")).unwrap();
    let ids: Vec<String> = json.split("\"id\": \"").skip(2).map(|s| s.split('"').next().unwrap().to_string()).collect();
    assert_eq!(ids, IDS.iter().map(|s| s.to_string()).collect::<Vec<_>>());
    let defs: Vec<f32> = json
        .split("\"default\": ")
        .skip(1)
        .map(|s| s.split(|c: char| c == ' ' || c == '}' || c == ',').next().unwrap().parse().unwrap())
        .collect();
    assert_eq!(defs, defaults().to_vec());
}

#[test]
fn in_tune() {
    for fs in [44_100.0, 48_000.0] {
        for note in [48u8, 60, 69, 81] {
            let mut o = opal(fs);
            plain(&mut o);
            o.note_on(note, 1.0);
            let (l, _) = render(&mut o, (fs * 0.6) as usize);
            let x = &l[(fs * 0.1) as usize..];
            // rising zero crossings, interpolated
            let mut cross = vec![];
            for i in 1..x.len() {
                if x[i - 1] < 0.0 && x[i] >= 0.0 {
                    cross.push(i as f32 - 1.0 + x[i - 1] / (x[i - 1] - x[i]));
                }
            }
            let per = (cross[cross.len() - 1] - cross[0]) / (cross.len() - 1) as f32;
            let want = 440.0 * 2f32.powf((note as f32 - 69.0) / 12.0);
            let cents = 1200.0 * (fs / per / want).log2();
            println!("{fs} note {note}: {cents:+.2} ct");
            assert!(cents.abs() < 1.0, "{fs} {note}: {cents} cents");
        }
    }
}

#[test]
fn bounded_at_every_setting_and_ends_in_silence() {
    for stack in 0..4 {
        for chorus in 0..4 {
            for (res, cut, lvl) in [(1.0, 1.0, 1.0), (0.0, 0.0, 1.0), (1.0, 0.3, 0.7)] {
                let mut o = opal(48_000.0);
                for (i, v) in [(p::STACK, stack as f32), (p::CHORUS, chorus as f32), (p::RES, res), (p::CUT, cut), (p::LVL, lvl), (p::DETUNE, 1.0),
                    (p::MIX2, 1.0), (p::AIR, 1.0), (p::MOVE, 1.0), (p::DRIFT, 1.0), (p::FENV, 1.0), (p::ATK, 0.0), (p::SWELL, 0.0), (p::REL, 0.2)] {
                    o.set_param(i, v);
                }
                for n in 0..VOICES as u8 {
                    o.note_on(36 + n * 5, 1.0);
                }
                let (l, r) = render(&mut o, 48_000);
                assert!(l.iter().chain(&r).all(|v| v.is_finite() && v.abs() <= 1.0));
                for n in 0..VOICES as u8 {
                    o.note_off(36 + n * 5);
                }
                let _ = render(&mut o, 48_000);
                let (l, _) = render(&mut o, 4800);
                assert_eq!(o.active(), 0, "voices left after release");
                assert!(rms(&l) < 1e-4, "stack {stack} chorus {chorus}: tail {}", rms(&l));
            }
        }
    }
}

#[test]
fn voices_reused_and_stolen() {
    let mut o = opal(48_000.0);
    o.note_on(60, 1.0);
    o.note_on(60, 1.0);
    assert_eq!(o.active(), 1, "a re-pressed note takes its own voice back");
    for n in 0..12 {
        o.note_on(40 + n, 1.0);
    }
    assert_eq!(o.active(), VOICES);
    let _ = render(&mut o, 2048);
}

#[test]
fn slow_attack_swells() {
    let mut o = opal(48_000.0);
    o.set_param(p::ATK, 0.6); // ~2.9 s
    o.note_on(60, 1.0);
    let (l, _) = render(&mut o, 96_000);
    let early = rms(&l[0..4800]);
    let late = rms(&l[86_400..]);
    println!("swell: {early:.4} → {late:.4}");
    assert!(late > early * 4.0);
}

#[test]
fn chorus_and_width_make_it_wide() {
    let side = |chorus: f32, width: f32| {
        let mut o = opal(48_000.0);
        plain(&mut o);
        o.set_param(p::W1, 0.0);
        o.set_param(p::CHORUS, chorus);
        o.set_param(p::WIDTH, width);
        o.note_on(57, 1.0);
        let (l, r) = render(&mut o, 48_000);
        let s: Vec<f32> = l.iter().zip(&r).map(|(a, b)| a - b).collect();
        let m: Vec<f32> = l.iter().zip(&r).map(|(a, b)| a + b).collect();
        rms(&s[9600..]) / rms(&m[9600..])
    };
    let (dry, wide, narrow) = (side(0.0, 1.0), side(2.0, 1.0), side(2.0, 0.0));
    println!("side/mid: dry {dry:.3}, chorus II {wide:.3}, width 0 {narrow:.4}");
    assert!(dry < 0.01);
    assert!(wide > 0.15);
    assert!(narrow < 0.01);
}

#[test]
fn eight_voices_of_seven_fit_the_cpu_budget() {
    let mut o = opal(48_000.0);
    o.set_param(p::STACK, 3.0);
    o.set_param(p::CHORUS, 3.0);
    for n in 0..VOICES as u8 {
        o.note_on(48 + n * 3, 1.0);
    }
    let secs = 3.0;
    let t = std::time::Instant::now();
    let _ = render(&mut o, (48_000.0 * secs) as usize);
    let share = t.elapsed().as_secs_f32() / secs;
    println!("8 voices × 7 oscillators + chorus: {:.1}% of a core", share * 100.0);
    assert!(share < 0.15);
}
