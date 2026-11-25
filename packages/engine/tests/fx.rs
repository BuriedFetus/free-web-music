// Master effects: Reverb, Delay, Lo-fi, Low-pass and the chain. Measured, not just "it runs".
use fwm_engine::events::{Event, Kind};
use fwm_engine::fx::{param::*, *};
use fwm_engine::mixer::*;
use fwm_engine::*;

const FS: f32 = 48000.0;

/// Run the chain over `secs` of input from `f(sample index) -> (send A, send B, dry)`; returns (L, R).
fn run(fx: &mut Fx, secs: f32, mut f: impl FnMut(usize) -> (f32, f32, f32)) -> (Vec<f32>, Vec<f32>) {
    let n = (secs * FS) as usize;
    let (mut ol, mut or) = (Vec::with_capacity(n), Vec::with_capacity(n));
    let mut i = 0;
    while i < n {
        let (mut l, mut r) = ([0f32; BLOCK], [0f32; BLOCK]);
        for k in 0..BLOCK {
            let (a, b, d) = f(i + k);
            fx.sends[0][k] = a;
            fx.sends[1][k] = a;
            fx.sends[2][k] = b;
            fx.sends[3][k] = b;
            l[k] = d;
            r[k] = d;
        }
        fx.process(&mut l, &mut r, BLOCK);
        ol.extend_from_slice(&l);
        or.extend_from_slice(&r);
        i += BLOCK;
    }
    (ol, or)
}
fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|v| v * v).sum::<f32>() / x.len().max(1) as f32).sqrt()
}
fn db(a: f32, b: f32) -> f32 {
    20.0 * (a / b).log10()
}
fn only(fx: &mut Fx, id: u8) {
    fx.set_chain(&[id]);
}
/// RT60 estimate, measured as usual around 1 kHz: time for the tail (band-passed 500 Hz – 2 kHz) to
/// fall 30 dB from 50 ms after an impulse, ×2.
fn rt60(size: f32) -> f32 {
    let mut fx = Fx::new(FS);
    only(&mut fx, REVERB);
    fx.set(REV_SIZE, size);
    fx.set(REV_PRE, 0.0);
    let (l, r) = run(&mut fx, 8.0, |i| (if i == 0 { 1.0 } else { 0.0 }, 0.0, 0.0));
    let band = |x: &[f32]| {
        let (a, b) = (1.0 - (-std::f32::consts::TAU * 2000.0 / FS).exp(), 1.0 - (-std::f32::consts::TAU * 500.0 / FS).exp());
        let (mut lp, mut lo) = (0f32, 0f32);
        x.iter().map(|&v| { lp += a * (v - lp); lo += b * (lp - lo); lp - lo }).collect::<Vec<_>>()
    };
    let (l, r) = (band(&l), band(&r));
    let win = (0.05 * FS) as usize;
    let level = |t: f32| {
        let s = (t * FS) as usize;
        rms(&l[s..s + win]).max(rms(&r[s..s + win]))
    };
    let ref_level = level(0.05);
    let mut t = 0.05;
    while t < 7.9 && db(level(t), ref_level) > -30.0 {
        t += 0.01;
    }
    (t - 0.05) * 2.0
}

#[test]
fn reverb_decay_follows_size() {
    let short = rt60(0.1); // ~0.96 s
    let long = rt60(0.6); // ~3.8 s
    eprintln!("RT60 short {short:.2} s, long {long:.2} s");
    assert!(short > 0.4 && short < 2.0, "short {short}");
    assert!(long > 2.5 && long < 6.5, "long {long}");
    assert!(long > short * 2.5);
}

#[test]
fn reverb_is_stereo_bounded_and_off_lets_the_tail_ring() {
    let mut fx = Fx::new(FS);
    only(&mut fx, REVERB);
    let (l, r) = run(&mut fx, 2.0, |i| ((i as f32 * 0.031).sin() * 0.5, 0.0, 0.0));
    let diff: f32 = l.iter().zip(&r).map(|(a, b)| (a - b).abs()).sum::<f32>() / l.len() as f32;
    assert!(diff > 0.01, "left and right differ (stereo): {diff}");
    assert!(l.iter().chain(&r).all(|x| x.is_finite() && x.abs() < 2.0));
    // Off: no new input, but the tail is not cut
    fx.set(REV_ON, 0.0);
    let (l, _) = run(&mut fx, 0.3, |i| ((i as f32 * 0.031).sin() * 0.5, 0.0, 0.0));
    assert!(rms(&l[..2000]) > 0.01, "tail still there right after Off");
    let (l, _) = run(&mut fx, 8.0, |_| (0.5, 0.0, 0.0));
    assert!(rms(&l[l.len() - 4800..]) < 1e-4, "then it dies away: {}", rms(&l[l.len() - 4800..]));
}

#[test]
fn delay_echoes_on_time_and_ping_pongs() {
    let mut fx = Fx::new(FS);
    only(&mut fx, DELAY);
    fx.set(DLY_TIME, 0.25);
    fx.set(DLY_FEEDBACK, 0.5);
    fx.set(DLY_TONE, 1.0);
    run(&mut fx, 0.6, |_| (0.0, 0.0, 0.0)); // let the time glide to 250 ms first
    let (l, r) = run(&mut fx, 1.2, |i| (0.0, if i == 0 { 1.0 } else { 0.0 }, 0.0));
    let peak_at = |x: &[f32], from: usize, to: usize| (from..to).max_by(|&a, &b| x[a].abs().total_cmp(&x[b].abs())).unwrap();
    let e = (0.25 * FS) as usize;
    let first = peak_at(&l, e - 200, e + 200);
    assert!((first as i64 - e as i64).abs() <= 3, "first echo at {first}, expected {e}");
    assert!(l[first].abs() > 0.2 && r[first].abs() < 1e-3, "ping-pong: first echo left only ({} / {})", l[first], r[first]);
    let second = peak_at(&r, 2 * e - 200, 2 * e + 200);
    // the repeat's low cut and tone filters shift it by a few samples (< 0.2 ms)
    assert!((second as i64 - 2 * e as i64).abs() <= 8, "second echo on the right at {second}");
    assert!(r[second].abs() < l[first].abs(), "each repeat is quieter");
}

#[test]
fn delay_feedback_at_max_stays_bounded() {
    let mut fx = Fx::new(FS);
    only(&mut fx, DELAY);
    fx.set(DLY_FEEDBACK, 1.0);
    fx.set(DLY_TIME, 0.05);
    let mut seed = 1u32;
    let (l, r) = run(&mut fx, 10.0, |_| {
        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
        (0.0, (seed >> 8) as f32 / 8_388_608.0 - 1.0, 0.0)
    });
    let peak = l.iter().chain(&r).fold(0f32, |m, x| m.max(x.abs()));
    assert!(peak.is_finite() && peak < 4.0, "peak {peak}");
}

#[test]
fn lofi_off_is_untouched_and_on_keeps_the_level() {
    for fs in [44100.0f32, 48000.0] {
        let mut fx = Fx::new(fs);
        only(&mut fx, LOFI);
        let sine = |i: usize| 0.25 * (std::f32::consts::TAU * 440.0 * i as f32 / fs).sin(); // a typical level
        let n = (fs * 1.0) as usize;
        let mut out = Vec::new();
        let mut i = 0;
        while i < n {
            let (mut l, mut r) = ([0f32; BLOCK], [0f32; BLOCK]);
            for k in 0..BLOCK {
                l[k] = sine(i + k);
                r[k] = sine(i + k);
            }
            fx.process(&mut l, &mut r, BLOCK);
            out.extend_from_slice(&l);
            i += BLOCK;
        }
        assert!((0..n).all(|k| (out[k] - sine(k)).abs() < 1e-7), "off at {fs}: exactly the input, no delay");
        // On (tape): same level within 2 dB, never NaN, even with everything at maximum
        for (p, v) in [(LOFI_ON, 1.0), (LOFI_WOW, 0.35), (LOFI_FLUTTER, 0.3), (LOFI_SATURATION, 0.5), (LOFI_AGE, 0.35)] {
            fx.set(p, v);
        }
        let mut out = Vec::new();
        let mut i = 0;
        while i < n {
            let (mut l, mut r) = ([0f32; BLOCK], [0f32; BLOCK]);
            for k in 0..BLOCK {
                l[k] = sine(i + k);
                r[k] = sine(i + k);
            }
            fx.process(&mut l, &mut r, BLOCK);
            out.extend_from_slice(&l);
            i += BLOCK;
        }
        let change = db(rms(&out[n / 2..]), 0.25 / 2f32.sqrt());
        assert!(change.abs() < 2.0, "tape at {fs}: level change {change:.2} dB");
        for p in [LOFI_WOW, LOFI_FLUTTER, LOFI_SATURATION, LOFI_AGE, LOFI_NOISE, LOFI_CRACKLE, LOFI_VINYL] {
            fx.set(p, 1.0);
        }
        let (l, r) = run(&mut fx, 2.0, |i| (0.0, 0.0, 0.9 * (i as f32 * 0.05).sin()));
        assert!(l.iter().chain(&r).all(|x| x.is_finite() && x.abs() < 2.0), "all at max stays finite at {fs}");
    }
}

#[test]
fn lowpass_cuts_and_off_is_transparent() {
    let tone = |f: f32| move |i: usize| (0.0, 0.0, 0.5 * (std::f32::consts::TAU * f * i as f32 / FS).sin());
    let mut fx = Fx::new(FS);
    only(&mut fx, LOWPASS);
    fx.set(LP_CUTOFF, 1.0);
    let (l, _) = run(&mut fx, 0.5, tone(1000.0));
    assert!(db(rms(&l[12000..]), 0.5 / 2f32.sqrt()).abs() < 0.5, "fully open: 1 kHz passes");
    fx.set(LP_CUTOFF, 0.0); // 60 Hz
    run(&mut fx, 0.2, tone(5000.0));
    let (l, _) = run(&mut fx, 0.5, tone(5000.0));
    assert!(db(rms(&l), 0.5 / 2f32.sqrt()) < -60.0, "closed: 5 kHz is gone ({:.1} dB)", db(rms(&l), 0.5 / 2f32.sqrt()));
    fx.set(LP_ON, 0.0);
    run(&mut fx, 0.2, tone(5000.0));
    let (l, _) = run(&mut fx, 0.2, tone(5000.0));
    assert!(db(rms(&l), 0.5 / 2f32.sqrt()).abs() < 0.01, "off: untouched");
}

#[test]
fn chain_order_and_membership() {
    let mut fx = Fx::new(FS);
    fx.set_chain(&[LOWPASS, LOWPASS, 9, DELAY]);
    assert_eq!(fx.chain(), [LOWPASS, DELAY, NONE, NONE], "repeats and unknown ids dropped");
    // Reverb not in the chain: its send does nothing
    let (l, _) = run(&mut fx, 0.5, |i| (if i < 100 { 1.0 } else { 0.0 }, 0.0, 0.0));
    assert!(rms(&l) < 1e-6);
    // Order matters: Low-pass (closed) before Reverb leaves the reverb bright; after it, dark
    let bright = |order: &[u8]| {
        let mut fx = Fx::new(FS);
        fx.set_chain(order);
        fx.set(LP_CUTOFF, 0.2);
        let (l, _) = run(&mut fx, 1.0, |i| (if i < 2 { 1.0 } else { 0.0 }, 0.0, 0.0));
        l.windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f32>() / rms(&l).max(1e-9) // rough brightness
    };
    assert!(bright(&[LOWPASS, REVERB]) > bright(&[REVERB, LOWPASS]) * 2.0);
}

#[test]
fn sends_feed_the_reverb_from_a_playing_instrument() {
    let mut r = Rack::new(FS);
    r.fx.set_chain(&[REVERB]);
    assert!(r.add_device(0, DeviceKind::Basalt));
    let tail = |r: &mut Rack| {
        r.push(Event { frame: 0, slot: 0, kind: Kind::NoteOn { note: 48, vel: 0.9 } });
        for _ in 0..80 { r.render(128); }
        r.push(Event { frame: 0, slot: 0, kind: Kind::NoteOff { note: 48 } });
        for _ in 0..150 { r.render(128); } // the note's own release is over
        let mut e = 0f32;
        for _ in 0..40 { r.render(128); e = e.max(r.out_l.iter().fold(0f32, |m, x| m.max(x.abs()))); }
        e
    };
    let dry = tail(&mut r);
    r.mixer.set(0, MIX_SEND_A, 0.8);
    let wet = tail(&mut r);
    assert!(dry < 1e-3 && wet > 0.005, "reverb tail only with the send up: dry {dry}, wet {wet}");
}

#[test]
fn all_effects_fit_the_budget() {
    let mut fx = Fx::new(FS);
    for (p, v) in [(LOFI_ON, 1.0), (LOFI_NOISE, 0.5), (LOFI_CRACKLE, 0.5)] {
        fx.set(p, v);
    }
    let t = std::time::Instant::now();
    run(&mut fx, 10.0, |i| ((i as f32 * 0.01).sin() * 0.3, (i as f32 * 0.013).sin() * 0.3, (i as f32 * 0.02).sin() * 0.3));
    let pct = t.elapsed().as_secs_f32() / 10.0 * 100.0;
    eprintln!("all four effects: {pct:.2}% of real time (native)");
    assert!(pct < 10.0, "{pct}% of real time");
}

#[test]
fn unused_reverb_and_delay_sleep_and_wake_on_input() {
    let mut fx = Fx::new(FS);
    fx.set_chain(&[REVERB, DELAY]);
    // a click, then silence: the tails ring out, then both effects sleep (output exactly 0)
    let (l, _) = run(&mut fx, 12.0, |i| (if i == 0 { 1.0 } else { 0.0 }, if i == 0 { 1.0 } else { 0.0 }, 0.0));
    assert!(l[(0.3 * FS) as usize..(0.5 * FS) as usize].iter().any(|x| x.abs() > 1e-3), "tails first");
    assert!(l[l.len() - 4800..].iter().all(|&x| x == 0.0), "then asleep: nothing at all");
    // input wakes them at once
    let (l, _) = run(&mut fx, 0.6, |i| (if i == 0 { 1.0 } else { 0.0 }, 0.0, 0.0));
    assert!(l.iter().any(|x| x.abs() > 1e-3), "awake again on input");
}
