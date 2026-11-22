// Wave icons (own artwork). Stroke colour comes from CSS.
const P = {
  saw: 'M2 16 L14 2 L14 16 L26 2',
  square: 'M2 16 V3 H14 V16 H26 V3',
  triangle: 'M2 16 L8 2 L20 16 L26 6',
  sine: 'M2 9 C6 -2 10 -2 14 9 S22 20 26 9',
  sh: 'M2 12 H8 V4 H14 V14 H20 V7 H26',
};
export const WaveIcon = ({ kind }: { kind: keyof typeof P }) => (
  <svg viewBox="0 0 28 18" aria-hidden="true">
    <path d={P[kind]} />
  </svg>
);
export const OSC_ICONS = ['saw', 'square', 'triangle', 'sine'] as const;
export const LFO_ICONS = ['sine', 'triangle', 'square', 'sh'] as const;
