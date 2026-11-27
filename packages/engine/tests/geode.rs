//! Geode tests: the manifest matches, macros blend (never add), the tape plays in tune, Slices pick
//! their part, everything stays bounded and ends in silence, Temperature moves the tone the right
//! way, the echo repeats on the beat, Motion and walks follow the song, memory fits, CPU budget.
//! `cargo test --release --test geode -- --nocapture` prints the numbers.

use fwm_engine::device::{Device, ModSource};
use fwm_engine::devices::geode::{defaults, macro_mix, mem_size, p, Geode, IDS, SLICES, VIZ_LEN};
use fwm_engine::BLOCK;

fn geode(fs: f32) -> Geode {
    let mut g = Geode::new(fs);
    g.prepare(fs);
    g
}
fn render(g: &mut Geode, n: usize) -> (Vec<f32>, Vec<f32>) {
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
fn sine(fs: f32, hz: f32, secs: f32) -> Vec<f32> {
    (0..(fs * secs) as usize).map(|i| (std::f32::consts::TAU * hz * i as f32 / fs).sin() * 0.5).collect()
}
/// Plain playback: no grains, no echo, no room, no motion, macros at rest, quick envelope.
fn plain(g: &mut Geode) {
    for (i, v) in [(p::GRAINS, 0.0), (p::EWET, 0.0), (p::WET, 0.0), (p::TEMP, 0.5), (p::AIR, 0.0), (p::BREATH, 0.5), (p::DRIVE, 0.0),
        (p::CHORUS, 0.0), (p::CUT, 1.0), (p::RES, 0.0), (p::TONE, 1.0), (p::THIN, 0.0), (p::ATK, 0.0), (p::SUS, 1.0), (p::CRUNCH, 0.0)] {
        g.set_param(i, v);
    }
}
fn freq(x: &[f32], fs: f32) -> f32 {
    let mut cross = vec![];
    for i in 1..x.len() {
        if x[i - 1] < 0.0 && x[i] >= 0.0 {
            cross.push(i as f32 - 1.0 + x[i - 1] / (x[i - 1] - x[i]));
        }
    }
    let n = cross.len() - 1;
    fs * n as f32 / (cross[n] - cross[0])
}

#[test]
fn manifest_matches_the_engine() {
    let json = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/devices/geode.json")).unwrap();
    let json = json.split("\"modSources\"").next().unwrap().to_string();
    let ids: Vec<String> = json.split("\"id\": \"").skip(2).map(|s| s.split('"').next().unwrap().to_string()).collect();
    assert_eq!(ids, IDS.iter().map(|s| s.to_string()).collect::<Vec<_>>());
    let defs: Vec<f32> = json
        .split("\"default\": ")
        .skip(1)
        .map(|s| s.split(|c: char| c == ' ' || c == '}' || c == ',' || c == '\n').next().unwrap().parse().unwrap())
        .collect();
    assert_eq!(defs.len(), defaults().len());
    for (i, (a, b)) in defs.iter().zip(defaults().iter()).enumerate() {
        assert!((a - b).abs() < 1e-4, "{}: manifest {a}, engine {b}", IDS[i]);
    }
}

#[test]
fn macros_blend_never_add() {
    // one macro alone at full pull reaches its wish
    assert!((macro_mix(0.3, &[(1.0, 0.9)]) - 0.9).abs() < 1e-6);
    // two opposite macros meet in the middle, whatever the knob says
    assert!((macro_mix(0.3, &[(1.0, 1.0), (1.0, 0.0)]) - 0.5).abs() < 1e-6);
    assert!((macro_mix(0.5, &[(1.0, 1.0), (1.0, 0.0)]) - 0.5).abs() < 1e-6);
    // a scale of 0 does nothing; half a pull goes half way
    assert_eq!(macro_mix(0.4, &[(0.0, 1.0)]), 0.4);
    assert!((macro_mix(0.4, &[(0.5, 1.0)]) - 0.7).abs() < 1e-6);
    // many macros wishing the top never push past it (no cap reached by stacking)
    let v = macro_mix(0.9, &[(1.0, 1.0), (1.0, 1.0), (1.0, 1.0)]);
    assert!(v <= 1.0 && v >= 0.9);
}

#[test]
fn empty_tape_is_silent_and_safe() {
    let mut g = geode(48_000.0);
    g.note_on(60, 1.0);
    let (l, r) = render(&mut g, 24_000);
    assert!(l.iter().chain(r.iter()).all(|x| x.is_finite() && x.abs() < 1e-3), "an empty Geode makes no sound");
    g.note_off(60);
    render(&mut g, 48_000 * 6);
    assert_eq!(g.active(), 0);
}

#[test]
fn classic_plays_in_tune() {
    for fs in [44_100.0, 48_000.0] {
        for (note, want) in [(60u8, 261.63f32), (72, 523.25), (55, 196.0)] {
            let mut g = geode(fs);
            plain(&mut g);
            g.load(&sine(fs, 261.63, 2.0), None);
            g.note_on(note, 1.0);
            let (l, _) = render(&mut g, (fs * 0.5) as usize);
            let f = freq(&l[(fs * 0.1) as usize..], fs);
            let cents = 1200.0 * (f / want).log2();
            println!("{fs} Hz, note {note}: {f:.2} Hz ({cents:+.2} ct)");
            assert!(cents.abs() < 3.0, "note {note} at {fs}: {f} Hz");
        }
    }
}

#[test]
fn speed_follows_the_tape_speed() {
    let fs = 48_000.0;
    let mut g = geode(fs);
    plain(&mut g);
    g.set_param(p::SPEED, 1.0 / 3.0); // 0.25 × 8^(1/3) = 0.5×
    g.load(&sine(fs, 400.0, 2.0), None);
    g.note_on(60, 1.0);
    let (l, _) = render(&mut g, 24_000);
    let f = freq(&l[4800..], fs);
    assert!((f - 200.0).abs() < 2.0, "half speed: {f}");
}

#[test]
fn slices_pick_their_part_of_the_tape() {
    let fs = 48_000.0;
    let secs = 2.0;
    let per = (fs * secs) as usize / SLICES;
    let tape: Vec<f32> = (0..per * SLICES)
        .map(|i| {
            let k = i / per;
            (std::f32::consts::TAU * 200.0 * (k + 1) as f32 * i as f32 / fs).sin() * 0.5
        })
        .collect();
    for note in [60u8, 62, 64, 71] {
        let deg = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6][(note % 12) as usize] + 7 * (note / 12) as usize;
        let k = deg % SLICES;
        let mut g = geode(fs);
        plain(&mut g);
        g.set_param(p::MODE, 2.0);
        g.load(&tape, None);
        g.note_on(note, 1.0);
        let (l, _) = render(&mut g, per / 2);
        let f = freq(&l[2400..], fs);
        let want = 200.0 * (k + 1) as f32;
        println!("note {note} → slice {k}: {f:.1} Hz");
        assert!((f - want).abs() < 4.0, "note {note}: slice {k} should be {want} Hz, got {f}");
    }
}

#[test]
fn bounded_everywhere_and_silent_after() {
    let mut seed = 0x1234_5678u32;
    let mut rnd = move || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        (seed >> 8) as f32 / 16_777_216.0
    };
    for fs in [44_100.0, 48_000.0] {
        for round in 0..10 {
            let mut g = geode(fs);
            let noise: Vec<f32> = (0..(fs * 1.5) as usize).map(|i| ((i as f32 * 0.37).sin() + (rnd() * 2.0 - 1.0) * 0.5) * 0.9).collect();
            g.load(&noise, Some(&noise.iter().rev().cloned().collect::<Vec<_>>()));
            for i in 0..p::COUNT {
                let v = match i {
                    p::DIV => (rnd() * 4.99).floor(),
                    p::MODE => (round % 3) as f32,
                    p::WALK => (rnd() * 4.99).floor(),
                    p::WBARS | p::MSHAPE => (rnd() * 3.99).floor(),
                    p::MRATE => (rnd() * 5.99).floor(),
                    p::MTO => (rnd() * 127.0).floor(),
                    p::LVL => 1.0,
                    p::CMAKE => 1.0,
                    p::SUS => 1.0,
                    _ => rnd(),
                };
                g.set_param(i, v);
            }
            g.tempo(60.0 + rnd() * 120.0, 0.0, round % 2 == 0);
            for n in [36u8, 48, 55, 60, 64, 67, 72, 84] {
                g.note_on(n, 1.0);
            }
            let (l, r) = render(&mut g, (fs * 1.5) as usize);
            let pk = l.iter().chain(r.iter()).fold(0.0f32, |m, x| m.max(x.abs()));
            assert!(l.iter().chain(r.iter()).all(|x| x.is_finite()), "round {round}: not finite");
            assert!(pk <= 1.0, "round {round}: peak {pk}");
            g.all_notes_off();
            for i in [p::FB, p::DECAY, p::ROOM] {
                g.set_param(i, 0.2);
            }
            render(&mut g, (fs * 12.0) as usize);
            let (l, _) = render(&mut g, (fs * 0.5) as usize);
            assert_eq!(g.active(), 0, "round {round}: voices left");
            assert!(rms(&l) < 1e-3, "round {round}: tail {}", rms(&l));
        }
    }
}

#[test]
fn temperature_moves_the_tone_the_right_way() {
    // FREEZING is thin and glassy (the high-pass comes up), WARM is round and full (more low end)
    let fs = 48_000.0;
    let tape: Vec<f32> = (0..96_000).map(|i| { let t = i as f32 / fs * std::f32::consts::TAU; (100.0 * t).sin() * 0.3 + (2000.0 * t).sin() * 0.3 }).collect();
    let low_share = |temp: f32| {
        let mut g = geode(fs);
        plain(&mut g);
        g.set_param(p::TEMP, temp);
        g.load(&tape, None);
        g.note_on(60, 1.0);
        render(&mut g, 48_000); // the thermometer eases in
        let (l, _) = render(&mut g, 24_000);
        let mut lp = 0.0f32;
        let mut lo = 0.0f32;
        for x in &l {
            lp += (x - lp) * 0.02; // ~150 Hz one-pole
            lo += lp * lp;
        }
        lo / l.iter().map(|x| x * x).sum::<f32>()
    };
    let (cold, warm) = (low_share(0.0), low_share(0.66));
    println!("low-end share: FREEZING {cold:.3}, WARM {warm:.3}");
    assert!(cold < warm * 0.8, "FREEZING should be thinner than WARM");
}

#[test]
fn the_thermometer_eases_in() {
    let mut g = geode(48_000.0);
    render(&mut g, 4800);
    g.set_param(p::TEMP, 1.0);
    render(&mut g, 4800); // 0.1 s later: on its way, not there
    let t = g.eased().0;
    assert!(t > 0.62 && t < 0.9, "after 0.1 s: {t}");
    render(&mut g, 96_000);
    assert!((g.eased().0 - 1.0).abs() < 0.01);
}

#[test]
fn echo_repeats_on_the_beat() {
    let fs = 48_000.0;
    let mut g = geode(fs);
    plain(&mut g);
    for (i, v) in [(p::EWET, 1.0), (p::FB, 0.4), (p::DIV, 3.0), (p::ATK, 0.0), (p::DEC, 0.0), (p::SUS, 0.0), (p::REL, 0.0)] {
        g.set_param(i, v);
    }
    g.tempo(120.0, 0.0, false); // 1/4 note = 0.5 s
    let mut click = vec![0.0f32; 48_000];
    for (i, x) in click.iter_mut().take(240).enumerate() {
        *x = (i as f32 * 0.3).sin() * (1.0 - i as f32 / 240.0);
    }
    g.load(&click, None);
    g.note_on(60, 1.0);
    render(&mut g, 64);
    g.note_off(60);
    let (l, _) = render(&mut g, 48_000);
    let env = |a: usize, b: usize| l[a..b].iter().fold(0.0f32, |m, x| m.max(x.abs()));
    let first = env(0, 2400);
    let gap = env(4800, 21_000);
    let echo = env(23_000, 26_000);
    println!("first {first:.3}, between {gap:.4}, echo at 0.5 s {echo:.3}");
    assert!(echo > first * 0.1 && gap < echo * 0.2, "one repeat half a second later");
}

#[test]
fn motion_follows_the_song_not_the_start_time() {
    // two people, one opened Geode later: at the same song position, Motion is at the same place
    let fs = 48_000.0;
    let mut a = geode(fs);
    let mut b = geode(fs);
    for g in [&mut a, &mut b] {
        g.set_param(p::MDEPTH, 1.0);
        g.set_param(p::MRATE, 3.0); // one bar
    }
    render(&mut a, 30_000); // a has been running longer
    for pos in [8.0f64, 8.5, 13.25] {
        a.tempo(100.0, pos, true);
        b.tempo(100.0, pos, true);
        render(&mut a, 4096);
        render(&mut b, 4096);
        let (x, y) = (a.mod_source_value(ModSource::Lfo), b.mod_source_value(ModSource::Lfo));
        assert!((x - y).abs() < 0.02, "pos {pos}: {x} vs {y}");
    }
}

#[test]
fn mica_walks_and_stays() {
    let fs = 48_000.0;
    let mut g = geode(fs);
    g.tempo(120.0, 0.0, true);
    let x0 = g.place().0;
    render(&mut g, 48_000);
    assert!((g.place().0 - x0).abs() < 1e-3, "Stay stays");
    g.set_param(p::WALK, 1.0); // left ↔ right
    g.set_param(p::WBARS, 0.0);
    let mut xs = vec![];
    for k in 0..8 {
        g.tempo(120.0, k as f64 * 2.0, true);
        render(&mut g, 12_000);
        xs.push(g.place().0);
    }
    let (lo, hi) = xs.iter().fold((9.0f32, -9.0f32), |(a, b), &x| (a.min(x), b.max(x)));
    println!("walk x: {xs:?}");
    assert!(hi - lo > 0.3, "she walks: {lo}..{hi}");
}

#[test]
fn grains_and_tape_show_on_the_panel() {
    let fs = 48_000.0;
    let mut g = geode(fs);
    g.load(&sine(fs, 300.0, 1.0), None);
    g.set_param(p::GRAINS, 1.0);
    g.note_on(60, 1.0);
    render(&mut g, 4800);
    assert_eq!(g.viz_len(), VIZ_LEN, "asking the length drains nothing");
    let z = g.viz().to_vec();
    assert_eq!(z.len(), VIZ_LEN);
    assert_eq!(z[0], -1.0, "the tape is not playing on its own");
    assert_eq!(z[3], 60.0, "voice 1 plays note 60");
    assert!(z[4] > 0.1, "and is sounding");
    assert!(z[3 + 16] > 0.0, "grain events");
    g.command(1, 1.0);
    render(&mut g, 4800);
    let z = g.viz().to_vec();
    assert!(z[0] > 0.0 && z[0] < 1.0, "the tape plays: {}", z[0]);
    render(&mut g, 60_000);
    assert_eq!(g.viz()[0], -1.0, "and stops at its end");
}

#[test]
fn memory_fits_its_block() {
    for fs in [44_100.0, 48_000.0, 96_000.0] {
        assert!(Geode::new(fs).mem_ok, "{fs}: {} floats were not enough", mem_size(fs));
    }
}

#[test]
fn cpu_budget() {
    let fs = 48_000.0;
    let mut g = geode(fs);
    g.load(&sine(fs, 220.0, 3.0), Some(&sine(fs, 330.0, 3.0)));
    for (i, v) in [(p::GRAINS, 0.6), (p::GDENS, 1.0), (p::GSIZE, 1.0), (p::EWET, 0.5), (p::WET, 0.6), (p::DRIVE, 0.5), (p::CRUNCH, 0.3), (p::MDEPTH, 0.5), (p::MTO, 127.0)] {
        g.set_param(i, v);
    }
    for n in [48u8, 52, 55, 60, 64, 67, 71, 72] {
        g.note_on(n, 1.0);
    }
    render(&mut g, 4800);
    let t = std::time::Instant::now();
    render(&mut g, 48_000);
    let s = t.elapsed().as_secs_f32();
    println!("1 s of 8 granular voices + everything: {:.1} ms ({:.1}% of one core)", s * 1000.0, s * 100.0);
    assert!(s < 0.25, "too slow: {s} s");
}


#[test]
fn a_classic_loop_never_clicks_at_its_seam() {
    // a tape that ends far from where it starts: looping it would jump, the seam fade hides the jump
    let fs = 48_000.0;
    let mut g = geode(fs);
    plain(&mut g);
    let tape: Vec<f32> = (0..4800).map(|i| 0.8 * (i as f32 / 4800.0)).collect(); // a ramp: 0 → 0.8, then back to 0
    g.load(&tape, None);
    g.note_on(60, 1.0);
    let (l, _) = render(&mut g, 48_000);
    let jump = l[2000..].windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
    println!("biggest step between samples: {jump:.4}");
    assert!(jump < 0.05, "the loop seam clicks: {jump}");
}
