# free-web-music

A collaborative, device-based music studio for the browser. This repo is the **core**, an embeddable React component that will run inside a host web app.

> **Status: planning.** There's no code yet. The first milestone is a clickable UI prototype (Phase 0).

## Idea

- **A big library of devices.** Instruments, sequencers and later effects and recorders. Bringing an instrument into a project creates a **track**, and you can use several copies of the same instrument.
- **External sequencer.** A main sequencer and clock drive the tracks. Each instrument's window shows and edits the sequencer lane that feeds it. Some instruments also have their own built-in sequencer, synced to the clock.
- **Built to be played together.**
  - Several people work on one project at the same time.
  - Each person arranges their own windows.
  - People on the same window see each other's knob turns and note edits.
  - Everyone can jam on their computer keyboard and hear each other.
- **Ready to scale.** Effects, tape/recording output and time/pitch control (global or per track) plug into the same device and track chain later.

## Architecture in short

| Layer | What | Sync |
|---|---|---|
| Project | devices, tracks, wiring, notes, parameters | Yjs document (provided by the host app) |
| Workspace | my windows, layout, zoom | local, per user |
| Presence / live | what I'm touching, live notes | ephemeral channel |

- **Audio:** an AudioWorklet with DSP in Rust compiled to WebAssembly, scheduled sample-accurately.
- **Host API (planned):**

  ```tsx
  <Studio doc={ydoc} awareness={awareness} channel={ephemeralChannel} user={{ id, name, color }} />
  ```

The full plan is in [docs/PLAN.md](docs/PLAN.md).

## License

[MIT](LICENSE)
