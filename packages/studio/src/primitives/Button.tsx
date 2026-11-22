import type { ButtonProps } from './types';

export function Button({ pressed, onPress, label, icon, variant = 'hw', children }: ButtonProps) {
  return (
    <button type="button" className={`fwm-btn fwm-btn--${variant}`} aria-pressed={pressed == null ? undefined : pressed}
      aria-label={icon || children != null ? label : undefined} onClick={onPress}>
      {icon}
      {children ?? (icon ? null : label)}
    </button>
  );
}
