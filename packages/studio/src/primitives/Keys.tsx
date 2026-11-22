import { useRef, type PointerEvent } from 'react';
import type { KeysProps } from './types';

const BLACK = new Set([1, 3, 6, 8, 10]);
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (n: number) => NAMES[n % 12] + (Math.floor(n / 12) - 1);

/** Piano keys. Press and slide across keys to play; velocity from how low on the key you press. */
export function Keys({ low, high, held, peerHeld = [], onNoteOn, onNoteOff }: KeysProps) {
  const notes: number[] = [];
  for (let n = low; n <= high; n++) notes.push(n);
  const whites = notes.filter((n) => !BLACK.has(n % 12));
  const bw = (0.62 / whites.length) * 100;
  const current = useRef<Map<number, number>>(new Map()); // pointerId → note
  const heldSet = new Set(held);
  const peerOf = (n: number) => peerHeld.find((p) => p.note === n)?.color;

  const noteAt = (e: PointerEvent): { note: number; vel: number } | null => {
    const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-note]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { note: Number(el.dataset.note), vel: Math.min(1, Math.max(0.35, 0.35 + 0.75 * ((e.clientY - r.top) / r.height))) };
  };
  const press = (e: PointerEvent) => {
    const hit = noteAt(e);
    const prev = current.current.get(e.pointerId);
    if (hit?.note === prev) return;
    if (prev != null) onNoteOff(prev);
    if (hit) {
      current.current.set(e.pointerId, hit.note);
      onNoteOn(hit.note, hit.vel);
    } else current.current.delete(e.pointerId);
  };
  const release = (e: PointerEvent) => {
    const prev = current.current.get(e.pointerId);
    if (prev != null) onNoteOff(prev);
    current.current.delete(e.pointerId);
  };

  let wi = -1;
  return (
    <div className="fwm-keys" role="group" aria-label="Keyboard"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); press(e); }}
      onPointerMove={(e) => { if (current.current.has(e.pointerId)) press(e); }}
      onPointerUp={release} onPointerCancel={release}>
      {notes.map((n) => {
        const black = BLACK.has(n % 12);
        if (!black) wi++;
        const peer = peerOf(n);
        const cls = (black ? 'fwm-keys__b' : 'fwm-keys__w') + (heldSet.has(n) ? ' is-on' : '') + (peer ? ' is-peer' : '');
        const style = { ...(black ? { left: `calc(${((wi + 1) / whites.length) * 100}% - ${bw / 2}%)`, width: bw + '%' } : {}), ...(peer ? { '--fwm-who': peer } : {}) } as React.CSSProperties;
        return (
          <div key={n} data-note={n} className={cls} style={style} aria-label={noteName(n)}>
            {!black && n % 12 === 0 && <small>{noteName(n)}</small>}
          </div>
        );
      })}
    </div>
  );
}
