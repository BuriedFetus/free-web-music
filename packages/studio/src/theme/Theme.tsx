// Theming, three levels (docs/THEMING.md):
//   1. tokens:     --fwm-* custom properties for the whole studio
//   2. devices:    --dev-* custom properties per device id
//   3. components: replacement React components for the primitives
import { createContext, useContext, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import { defaultPrimitives, type Primitives } from '../primitives';

export interface StudioTheme {
  tokens?: Record<string, string | number>;
  devices?: Record<string, Record<string, string | number>>;
  components?: Partial<Primitives>;
  /** Load the default web fonts (Google Fonts). Set false if the host provides its own. */
  loadFonts?: boolean;
}

interface ThemeContextValue {
  primitives: Primitives;
  deviceTokens(device: string): CSSProperties | undefined;
}

const ThemeContext = createContext<ThemeContextValue>({
  primitives: defaultPrimitives,
  deviceTokens: () => undefined,
});

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Michroma&family=Figtree:wght@400;600;800&family=VT323&family=Big+Shoulders+Display:wght@800;900&display=swap';

function useFonts(load: boolean) {
  useEffect(() => {
    if (!load || document.querySelector(`link[data-fwm-fonts]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    // Requested with CORS so it also loads on cross-origin-isolated pages (COEP: require-corp).
    link.crossOrigin = 'anonymous';
    link.href = FONT_HREF;
    link.dataset.fwmFonts = '';
    document.head.appendChild(link);
  }, [load]);
}

export function ThemeRoot({ theme, children, className }: { theme?: StudioTheme; children: ReactNode; className?: string }) {
  useFonts(theme?.loadFonts !== false);
  const value = useMemo<ThemeContextValue>(
    () => ({
      primitives: { ...defaultPrimitives, ...theme?.components },
      deviceTokens: (device) => theme?.devices?.[device] as CSSProperties | undefined,
    }),
    [theme?.components, theme?.devices],
  );
  return (
    <ThemeContext.Provider value={value}>
      <div className={'fwm-root' + (className ? ' ' + className : '')} style={theme?.tokens as CSSProperties}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export const usePrimitives = () => useContext(ThemeContext).primitives;
export const useDeviceTokens = (device: string) => useContext(ThemeContext).deviceTokens(device);
