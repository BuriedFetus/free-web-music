import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { lanRelay } from './lanRelay';

// Cross-origin isolation (COOP/COEP) so the engine can use SharedArrayBuffer, as a host app would.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// `--mode lan` (npm run dev:lan, npm run lan): other computers on the network can join. Browsers only run the audio
// engine on a secure page, so it serves HTTPS with a self-signed certificate (accept it once per computer).
export default defineConfig(({ mode }) => {
  const lan = mode === 'lan';
  return {
    plugins: [react(), lanRelay(), ...(lan ? [basicSsl({ name: 'free-web-music-lan' })] : [])],
    base: './',
    server: { headers: isolation, port: 5173, host: lan ? true : undefined },
    preview: { headers: isolation, port: 5173, host: lan ? true : undefined },
    // The engine finds its worklet and WASM via import.meta.url, so it must not be pre-bundled.
    optimizeDeps: { exclude: ['@fwm/engine'] },
    // Keep the audio worklet a real file (some browsers refuse data: URLs in audioWorklet.addModule).
    build: { assetsInlineLimit: (file: string) => (file.endsWith('worklet.js') ? false : undefined) },
  };
});
