// Owns the audio engine for the studio. Browsers only allow audio after a user gesture,
// so the engine starts when `start()` is called from a click or key press.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { createEngine, type Engine } from '@fwm/engine';

export type EngineStatus = 'off' | 'loading' | 'on' | 'error';

interface EngineContextValue {
  engine: Engine | null;
  status: EngineStatus;
  error: string | null;
  start(): Promise<void>;
  stop(): Promise<void>;
}

const EngineContext = createContext<EngineContextValue | null>(null);

export function EngineProvider({ children }: { children: ReactNode }) {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [status, setStatus] = useState<EngineStatus>('off');
  const [error, setError] = useState<string | null>(null);
  const loading = useRef<Promise<Engine> | null>(null);

  const start = useCallback(async () => {
    try {
      setStatus('loading');
      loading.current ??= createEngine();
      const e = await loading.current;
      await e.resume();
      setEngine(e);
      setStatus('on');
    } catch (err) {
      console.error(err);
      loading.current = null;
      setError(String(err));
      setStatus('error');
    }
  }, []);

  const stop = useCallback(async () => {
    const e = await loading.current;
    if (!e) return;
    for (const slot of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) e.allOff(slot);
    await e.suspend();
    setStatus('off');
  }, []);

  const value = useMemo(() => ({ engine, status, error, start, stop }), [engine, status, error, start, stop]);
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineContext);
  if (!ctx) throw new Error('useEngine must be used inside <EngineProvider>');
  return ctx;
}
