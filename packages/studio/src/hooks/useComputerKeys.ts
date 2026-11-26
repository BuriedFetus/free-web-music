// Play notes from the computer keyboard (two rows like a piano: A W S E D F T G Y H U J K O L P ;).
// Z / X shift the octave. Ignored while typing in a field or adjusting a slider with the arrows.
import { useEffect, useRef } from 'react';
import { SCALE_ROW, SCALE_ROW_UP, SCALES, scaleStep, type SongKey } from '../model/scales';

export const KEY_MAP = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';'];
/** Pads (drum machines): one row, A S D F G H J K = pads 1–8 (base + 0…7). */
export const PAD_MAP = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k'];

export function useComputerKeys(opts: {
  enabled: boolean;
  base: number;
  onNoteOn(note: number, velocity: number): void;
  onNoteOff(note: number): void;
  onOctave?(delta: number): void;
  /** 'pads': A S D F G H J K play base + 0…7 and Z/X do nothing. */
  layout?: 'piano' | 'pads';
  /** The song's key: with one, the keys play only its notes (A = the root, see SCALE_ROW). */
  songKey?: SongKey;
}) {
  const ref = useRef(opts);
  ref.current = opts;
  useEffect(() => {
    if (!opts.enabled) return;
    const down = new Map<string, number>(); // key → note (so octave changes don't leave notes hanging)
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t?.closest?.('input, textarea, select, [contenteditable=true]');
    };
    const kd = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
      const k = e.key.toLowerCase();
      const pads = ref.current.layout === 'pads';
      if (!pads && (k === 'z' || k === 'x')) {
        ref.current.onOctave?.(k === 'z' ? -1 : 1);
        return;
      }
      const key = ref.current.songKey;
      let note: number;
      if (!pads && key && key.scale !== 'chromatic') {
        const lo = SCALE_ROW.indexOf(k);
        const hi = SCALE_ROW_UP.indexOf(k);
        if ((lo < 0 && hi < 0) || down.has(k)) return;
        const n = (SCALES[key.scale] ?? SCALES.major).steps.length;
        note = scaleStep(ref.current.base, lo >= 0 ? lo : hi + n, key);
      } else {
        const i = (pads ? PAD_MAP : KEY_MAP).indexOf(k);
        if (i < 0 || down.has(k)) return;
        note = ref.current.base + i;
      }
      down.set(k, note);
      ref.current.onNoteOn(note, 0.85);
    };
    const ku = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const note = down.get(k);
      if (note == null) return;
      down.delete(k);
      ref.current.onNoteOff(note);
    };
    const blur = () => {
      for (const n of down.values()) ref.current.onNoteOff(n);
      down.clear();
    };
    addEventListener('keydown', kd);
    addEventListener('keyup', ku);
    addEventListener('blur', blur);
    return () => {
      blur();
      removeEventListener('keydown', kd);
      removeEventListener('keyup', ku);
      removeEventListener('blur', blur);
    };
  }, [opts.enabled]);
}
