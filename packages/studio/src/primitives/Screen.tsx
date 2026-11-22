import type { ScreenProps } from './types';

export function Screen({ variant, label, children }: ScreenProps) {
  return (
    <div className={`fwm-lcd fwm-lcd--${variant}`}>
      {label && <small className="fwm-lcd__label">{label}</small>}
      {children}
    </div>
  );
}
