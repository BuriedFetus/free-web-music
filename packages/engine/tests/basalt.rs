//! Sound-quality tests for Basalt. Run with `cargo test` (add `-- --nocapture` to see measurements).

use fwm_engine::device::{Device, ModSource};
use fwm_engine::devices::basalt::{p, Basalt, DEFAULTS, PARAM_IDS};
use fwm_engine::events::{Event, Kind};
use fwm_engine::{DeviceKind, Rack, BLOCK};

const FS: f32 = 48_000.0;

fn synth() -> Basalt {
    let mut b = Basalt::new();
    b.prepare(FS);
    b
}

fn render(b: &mut Basalt, n: usize) -> Vec<f32> {
    let mut out = vec![0.0; n];
    let mut r = vec![0.0; n];
    for (l, rr) in out.chunks_mut(BLOCK).zip(r.chunks_mut(BLOCK)) {
        b.render(l, rr);
    }
    out
}

/// A "clean" patch: no LFO route, filter wide open, no drive or sub, sustain full.
fn clean(b: &mut Basalt, wave: f32) {
    b.clear_route(0);
    for (i, v) in [
        (p::WAVE, wave),
        (p::SHAPE, 0.0),
        (p::SUB, 0.0),
        (p::CUT, 1.0),
        (p::RES, 0.0),
        (p::ENVAMT, 0.0),
        (p::DRIVE, 0.0),
        (p::GLIDE, 0.0),
        (p::AMP_A, 0.0),
        (p::AMP_S, 1.0),
    ] {
        b.set_param(i, v);
    }
    render(b, 2048); // let smoothing settle
}

/// Magnitude spectrum of `x` with a Blackman-Harris window (naive DFT at chosen bins).
fn dft_mag(x: &[f32], bin: f64) -> f64 {
    let n = x.len() as f64;
    let (mut re, mut im) = (0.0f64, 0.0f64);
    for (i, &v) in x.iter().enumerate() {
        let t = i as f64 / (n - 1.0);
        let w = 0.35875 - 0.48829 * (2.0 * std::f64::consts::PI * t).cos()
            + 0.14128 * (4.0 * std::f64::consts::PI * t).cos()
            - 0.01168 * (6.0 * std::f64::consts::PI * t).cos();
        let ph = 2.0 * std::f64::consts::PI * bin * i as f64 / n;
        re += v as f64 * w * ph.cos();
        im -= v as f64 * w * ph.sin();
    }
    (re * re + im * im).sqrt()
}

fn db(x: f64) -> f64 {
    20.0 * x.max(1e-30).log10()
}

#[test]
fn param_order_matches_manifest() {
    let json = include_str!("../devices/basalt.json");
    let params = json.split("\"modSources\"").next().unwrap();
    let ids: Vec<&str> = params
        .lines()
        .filter_map(|l| l.trim().strip_prefix("{ \"id\": \""))
        .map(|rest| rest.split('"').next().unwrap())
        .collect();
    assert_eq!(ids, PARAM_IDS.to_vec(), "Rust param order must match devices/basalt.json");
    for (id, d) in PARAM_IDS.iter().zip(DEFAULTS.iter()) {
        let line = json.lines().find(|l| l.contains(&format!("\"id\": \"{id}\""))).unwrap();
        let def: f32 = line.split("\"default\": ").nth(1).unwrap().split([',', ' ']).next().unwrap().parse().unwrap();
        assert!((def - d).abs() < 1e-6, "default of {id}: json {def} vs rust {d}");
    }
}

#[test]
fn silent_without_notes() {
    let mut b = synth();
    let out = render(&mut b, 48_000);
    assert!(out.iter().all(|&x| x == 0.0));
}

#[test]
fn plays_the_right_pitch() {
    for wave in 0..4 {
        let mut b = synth();
        clean(&mut b, wave as f32);
        b.note_on(57, 1.0); // A3 = 220 Hz
        render(&mut b, 4800);
        let x = render(&mut b, 48_000);
        // count rising zero crossings over 1 s
        let crossings = x.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count();
        assert!((219..=221).contains(&crossings), "wave {wave}: {crossings} Hz, expected 220");
        assert!(x.iter().all(|v| v.is_finite()));
    }
}

/// Energy that is not at a harmonic of the note is aliasing. Measured for a high note (≈2.6 kHz)
/// where naive oscillators alias badly.
#[test]
fn alias_rejection() {
    let names = ["Saw", "Square", "Triangle", "Sine"];
    for wave in 0..4 {
        let mut b = synth();
        clean(&mut b, wave as f32);
        b.note_on(100, 1.0); // E7 ≈ 2637 Hz
        render(&mut b, 4800);
        let n = 16384;
        let x = render(&mut b, n);
        let f0 = 440.0 * 2f64.powf((100.0 - 69.0) / 12.0);
        let bin_hz = FS as f64 / n as f64;
        let fund = dft_mag(&x, f0 / bin_hz);
        // Look at every bin up to 20 kHz that is at least 60 Hz from any harmonic.
        let mut worst = 0.0f64;
        let mut worst_hz = 0.0;
        let mut bin = 20.0;
        while bin * bin_hz < 20_000.0 {
            let hz = bin * bin_hz;
            let h = (hz / f0).round();
            if (hz - h * f0).abs() > 60.0 {
                let m = dft_mag(&x, bin);
                if m > worst {
                    worst = m;
                    worst_hz = hz;
                }
            }
            bin += 3.0;
        }
        let rel = db(worst / fund);
        println!("{:8} worst alias {:6.1} dB at {:5.0} Hz", names[wave], rel, worst_hz);
        assert!(rel < -60.0, "{}: alias at {rel:.1} dB", names[wave]);
    }
}

/// Jumping a knob from one end to the other must not produce a click: the biggest
/// sample-to-sample step after the jump stays close to the biggest step before it.
#[test]
fn no_clicks_on_param_jumps() {
    for (param, from, to) in [(p::CUT, 0.2, 0.9), (p::LVL, 0.1, 1.0), (p::TUNE, 0.3, 0.7), (p::RES, 0.0, 0.9)] {
        let mut b = synth();
        clean(&mut b, 3.0); // sine: smallest natural steps, clicks show up clearly
        b.set_param(p::CUT, if param == p::CUT { from } else { 0.6 });
        b.set_param(param, from);
        b.note_on(45, 1.0);
        render(&mut b, 9600);
        let before = render(&mut b, 4800);
        let max_before = before.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max);
        let peak_before = before.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        b.set_param(param, to);
        let after = render(&mut b, 4800);
        let max_after = after.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max);
        let peak_after = after.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        // allow the natural growth from a louder / brighter / higher result
        let allowed = max_before * (peak_after / peak_before).max(1.0) * 2.5 + 1e-3;
        println!("param {param}: step before {max_before:.4}, after {max_after:.4} (allowed {allowed:.4})");
        assert!(max_after < allowed, "param {param} clicked: {max_after} vs {allowed}");
    }
}

#[test]
fn retrigger_does_not_click() {
    let mut b = synth();
    clean(&mut b, 0.0);
    b.set_param(p::CUT, 0.5);
    b.set_param(p::AMP_A, 0.3); // ~8 ms: a deliberately snappy 0.5 ms attack is allowed to be sharp
    render(&mut b, 2048);
    b.note_on(40, 1.0);
    render(&mut b, 4800);
    b.note_off(40);
    render(&mut b, 200); // mid-release
    let before = render(&mut b, 64);
    b.note_on(40, 1.0);
    let after = render(&mut b, 64);
    let jump = (after[0] - before[63]).abs();
    let typical = before.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0, f32::max);
    assert!(jump <= typical * 2.0 + 1e-3, "retrigger jump {jump} vs typical {typical}");
}

#[test]
fn release_decays_to_exact_silence() {
    let mut b = synth();
    b.note_on(36, 1.0);
    render(&mut b, 4800);
    b.note_off(36);
    render(&mut b, 48_000 * 4);
    let tail = render(&mut b, 4800);
    assert!(tail.iter().all(|&x| x == 0.0), "tail should be exactly 0 (no denormal hum)");
}

#[test]
fn no_denormals_in_long_quiet_tail() {
    let mut b = synth();
    b.set_param(p::AMP_R, 1.0); // 10 s release
    b.note_on(36, 1.0);
    render(&mut b, 4800);
    b.note_off(36);
    let tail = render(&mut b, 48_000 * 12);
    for &x in &tail {
        assert!(x == 0.0 || x.abs() > f32::MIN_POSITIVE, "denormal output {x:e}");
    }
}

#[test]
fn legato_glides_and_keeps_envelope() {
    let mut b = synth();
    clean(&mut b, 3.0);
    b.set_param(p::GLIDE, 0.6);
    render(&mut b, 2048);
    b.note_on(48, 1.0);
    render(&mut b, 9600);
    b.note_on(60, 1.0); // legato, one octave up
    let x = render(&mut b, 2400); // first 50 ms of the slide
    let crossings = x.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count() as f32 / 0.05;
    // halfway through the glide the pitch is between 130.8 and 261.6 Hz
    assert!(crossings > 135.0 && crossings < 255.0, "mid-glide pitch {crossings} Hz");
    // amp envelope was not restarted (stays at sustain = 1.0, no dip)
    assert!(b.mod_source_value(ModSource::AmpEnv) > 0.99);
    b.note_off(60);
    render(&mut b, 48_000);
    let y = render(&mut b, 48_000);
    let back = y.windows(2).filter(|w| w[0] <= 0.0 && w[1] > 0.0).count();
    assert!((129..=133).contains(&back), "falls back to the held note: {back} Hz");
}

#[test]
fn lfo_modes() {
    // Retrig: phase restarts on each note. Free: it doesn't.
    for (mode, expect_reset) in [(0.0, false), (1.0, true), (2.0, true)] {
        let mut b = synth();
        b.set_param(p::LMODE, mode);
        render(&mut b, 777);
        b.note_on(40, 1.0);
        render(&mut b, 1);
        let v = b.mod_source_value(ModSource::Lfo);
        if expect_reset {
            assert!(v.abs() < 0.01, "mode {mode}: LFO should restart at 0, got {v}");
        }
    }
}

#[test]
fn modulation_routes() {
    let mut b = synth();
    // default route LFO → Cutoff moves the effective cutoff
    b.note_on(40, 1.0);
    let mut lo = 1.0f32;
    let mut hi = 0.0f32;
    for _ in 0..200 {
        render(&mut b, 128);
        let c = b.effective()[p::CUT];
        lo = lo.min(c);
        hi = hi.max(c);
    }
    assert!(hi - lo > 0.2, "LFO should sweep cutoff, range {lo}..{hi}");
    // envelopes can be targets too: Filter env → Amp decay
    assert!(b.set_route(1, ModSource::FiltEnv, p::AMP_D, 0.5).is_ok());
    // no self-modulation
    assert!(b.set_route(2, ModSource::Lfo, p::LRATE, 0.5).is_err());
    assert!(b.set_route(2, ModSource::AmpEnv, p::AMP_R, 0.5).is_err());
    assert!(b.set_route(2, ModSource::FiltEnv, p::FILT_S, 0.5).is_err());
    assert!(b.set_route(2, ModSource::Lfo, p::WAVE, 0.5).is_err());
}

#[test]
fn rack_events_are_sample_accurate() {
    let mut rack = Rack::new(FS);
    rack.add_device(0, DeviceKind::Basalt);
    rack.push(Event { frame: 300, slot: 0, kind: Kind::NoteOn { note: 48, vel: 1.0 } });
    let mut first = None;
    for blk in 0..4 {
        rack.render(BLOCK);
        if first.is_none() {
            if let Some(i) = rack.out_l.iter().position(|&x| x != 0.0) {
                first = Some(blk * BLOCK + i);
            }
        }
    }
    // decimator latency is ~16 output samples
    let f = first.expect("note should sound");
    assert!((300..300 + 24).contains(&f), "note started at frame {f}, expected ~300");
}

#[test]
fn every_param_extreme_stays_finite_and_bounded() {
    for i in 0..p::COUNT {
        for v in [0.0, 1.0] {
            let mut b = synth();
            b.set_param(p::RES, 1.0);
            b.set_param(p::DRIVE, 1.0);
            b.set_param(i, if i == p::WAVE || i == p::LWAVE { v * 3.0 } else if i == p::LMODE { v * 2.0 } else { v });
            b.note_on(24, 1.0);
            b.note_on(96, 1.0);
            let x = render(&mut b, 9600);
            let peak = x.iter().fold(0.0f32, |m, s| m.max(s.abs()));
            assert!(x.iter().all(|s| s.is_finite()), "param {i}={v}: non-finite");
            assert!(peak < 1.5, "param {i}={v}: peak {peak}");
        }
    }
}

/// CPU: one Basalt voice must be a small fraction of the 2.67 ms block budget.
/// Native speed here; WASM is typically 1.5–2.5× slower.
#[test]
fn cpu_budget() {
    let mut b = synth();
    b.note_on(40, 1.0);
    let blocks = 3000;
    let mut l = [0.0f32; BLOCK];
    let mut r = [0.0f32; BLOCK];
    let t = std::time::Instant::now();
    for _ in 0..blocks {
        b.render(&mut l, &mut r);
    }
    let per_block = t.elapsed().as_secs_f64() / blocks as f64;
    let budget = BLOCK as f64 / FS as f64;
    println!("Basalt: {:.1} µs per block = {:.2}% of real time (native)", per_block * 1e6, 100.0 * per_block / budget);
    assert!(per_block < budget * 0.05, "one voice uses {:.1}% of real time", 100.0 * per_block / budget);
}
