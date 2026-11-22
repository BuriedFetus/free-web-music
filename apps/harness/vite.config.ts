import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cross-origin isolation (COOP/COEP) so the engine can use SharedArrayBuffer, as a host app would.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { headers: isolation, port: 5173 },
  preview: { headers: isolation },
  // The engine finds its worklet and WASM via import.meta.url, so it must not be pre-bundled.
  optimizeDeps: { exclude: ['@fwm/engine'] },
  // Keep the audio worklet a real file (some browsers refuse data: URLs in audioWorklet.addModule).
  build: { assetsInlineLimit: (file) => (file.endsWith('worklet.js') ? false : undefined) },
});
