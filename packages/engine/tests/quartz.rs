//! Quartz tests: the manifest matches, a single oscillator is in tune, eight voices stay bounded at
//! every setting and end in silence, voices are reused and stolen, the chorus widens, CPU budget.
//! `cargo test --release --test opal -- --nocapture` prints the numbers.

use fwm_engine::device::Device;
use fwm_engine::devices::quartz::{defaults, p, Quartz, IDS, VOICES};
use fwm_engine::BLOCK;

fn quartz(fs: f32) -> Quartz {
    let mut o = Quartz::new();
    o.prepare(fs);
    o
}
fn render(o: &mut Quartz, n: usize) -> (Vec<f32>, Vec<f32>) {
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
/// Plain settings: row 1 a pure sine (no push), row 2 off, filter open, held.
fn plain(o: &mut Quartz) {
    for (i, v) in [(p::DEPTH1, 0.0), (p::LVL2, 0.0), (p::CUT, 1.0), (p::RES, 0.0), (p::SUS, 1.0), (p::TREM, 0.0), (p::DRIVE, 0.0)] {
        o.set_param(i, v);
    }
}

#[test]
fn manifest_matches_the_engine() {
    let json = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/devices/quartz.json")).unwrap();
    let json = json.split("\"modSources\"").next().unwrap().to_string();
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
            let mut o = quartz(fs);
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
    for w in 0..4 {
        for h in [0.0, 8.0] {
            for (res, cut, depth) in [(1.0, 1.0, 1.0), (0.0, 0.0, 1.0), (1.0, 0.4, 0.5)] {
                let mut o = quartz(48_000.0);
                for (i, v) in [(p::W1, w as f32), (p::W2, w as f32), (p::HARM1, h), (p::HARM2, 8.0 - h), (p::RES, res), (p::CUT, cut), (p::DEPTH1, depth),
                    (p::DEPTH2, depth), (p::LVL1, 1.0), (p::LVL2, 1.0), (p::LVL, 1.0), (p::DRIVE, 1.0), (p::TREM, 1.0), (p::TOUCH, 1.0), (p::REL, 0.2), (p::PITCH2, 5.0)] {
                    o.set_param(i, v);
                }
                for n in 0..VOICES as u8 {
                    o.note_on(36 + n * 6, 1.0);
                }
                let (l, r) = render(&mut o, 48_000);
                assert!(l.iter().chain(&r).all(|v| v.is_finite() && v.abs() <= 1.0));
                for n in 0..VOICES as u8 {
                    o.note_off(36 + n * 6);
                }
                let _ = render(&mut o, 48_000);
                let (l, _) = render(&mut o, 4800);
                assert_eq!(o.active(), 0);
                assert!(rms(&l) < 1e-4, "wave {w}: tail {}", rms(&l));
            }
        }
    }
}

#[test]
fn voices_reused_and_stolen() {
    let mut o = quartz(48_000.0);
    o.note_on(60, 1.0);
    o.note_on(60, 1.0);
    assert_eq!(o.active(), 1);
    for n in 0..12 {
        o.note_on(40 + n, 1.0);
    }
    assert_eq!(o.active(), VOICES);
}

/// Spectral brightness: share of energy in the first difference (a rough high-frequency measure).
fn bright(x: &[f32]) -> f32 {
    let d: Vec<f32> = x.windows(2).map(|w| w[1] - w[0]).collect();
    rms(&d) / rms(x).max(1e-9)
}

#[test]
fn a_struck_key_barks_then_mellows_and_touch_brightens() {
    let mut o = quartz(48_000.0);
    o.set_param(p::TREM, 0.0);
    o.note_on(60, 1.0);
    let (l, _) = render(&mut o, 48_000);
    let (attack, later) = (bright(&l[200..2600]), bright(&l[36_000..40_800]));
    println!("brightness: attack {attack:.3}, 0.75 s later {later:.3}");
    assert!(attack > later * 1.3);
    let at = |vel: f32| {
        let mut o = quartz(48_000.0);
        o.set_param(p::TREM, 0.0);
        o.note_on(60, vel);
        let (l, _) = render(&mut o, 4800);
        bright(&l[200..4800])
    };
    let (soft, hard) = (at(0.3), at(1.0));
    println!("touch: soft {soft:.3}, hard {hard:.3}");
    assert!(hard > soft * 1.15);
}

#[test]
fn tremolo_swings_left_and_right() {
    let mut o = quartz(48_000.0);
    plain(&mut o);
    o.set_param(p::TREM, 1.0);
    o.note_on(57, 1.0);
    let (l, r) = render(&mut o, 48_000);
    let s: Vec<f32> = l.iter().zip(&r).map(|(a, b)| a - b).collect();
    assert!(rms(&s) > 0.2 * rms(&l));
}

#[test]
fn eight_voices_fit_the_cpu_budget() {
    let mut o = quartz(48_000.0);
    for n in 0..VOICES as u8 {
        o.note_on(48 + n * 3, 1.0);
    }
    o.set_param(p::SUS, 1.0);
    let secs = 3.0;
    let t = std::time::Instant::now();
    let _ = render(&mut o, (48_000.0 * secs) as usize);
    let share = t.elapsed().as_secs_f32() / secs;
    println!("8 voices: {:.1}% of a core", share * 100.0);
    assert!(share < 0.12);
}

#[test]
fn routes_move_the_knobs() {
    use fwm_engine::device::ModSource;
    let mut o = quartz(48_000.0);
    o.set_param(p::LRATE, 1.0);
    assert!(o.set_route(0, ModSource::Lfo, p::CUT, 0.5).is_ok());
    assert!(o.set_route(1, ModSource::Lfo, p::LRATE, 0.5).is_err());
    assert!(o.set_route(1, ModSource::FiltEnv, p::ENV1, 0.5).is_err());
    assert!(o.set_route(1, ModSource::AmpEnv, p::DEPTH2, 0.5).is_ok());
    o.note_on(60, 1.0);
    let mut cuts = vec![];
    for _ in 0..40 {
        let _ = render(&mut o, 1200);
        cuts.push(o.effective()[p::CUT]);
    }
    let (lo, hi) = cuts.iter().fold((1.0f32, 0.0f32), |(a, b), &c| (a.min(c), b.max(c)));
    assert!(hi - lo > 0.3, "the LFO sweeps the cutoff ({lo} … {hi})");
    o.clear_route(0);
    let _ = render(&mut o, 1200);
    assert!((o.effective()[p::CUT] - 0.85).abs() < 0.02);
}
