// Playing together across computers on the local network (the harness plays the host app here; the studio
// itself still opens no connection). A Vite plugin that adds a WebSocket relay to the dev server: every
// message one computer sends to its room goes to the other computers in that room, as it is. It keeps
// nothing: someone joining asks the others for the song (the same "hello" the tabs use).
//
// The page learns the relay exists from a <meta name="fwm-relay"> tag, with the addresses other computers
// can use. It works with the dev server and with `vite preview` (the built studio, much lighter on a
// Raspberry Pi); `npm run dev:lan` / `npm run lan` listen on the network, over HTTPS so browsers allow the
// audio engine. A plain build never gets the tag, so dist/ served elsewhere keeps syncing tabs only.
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';

export const RELAY_PATH = '/fwm-relay';

export function lanRelay(): Plugin {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  const rooms = new Map<string, Set<WebSocket>>();
  let server: ViteDevServer | PreviewServer | null = null;
  const meta = () => {
    const network = server?.resolvedUrls?.network ?? [];
    return `<meta name="fwm-relay" content="${RELAY_PATH}" data-network="${network.join(' ')}">`;
  };
  const attach = (s: ViteDevServer | PreviewServer) => {
    server = s;
    s.httpServer?.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!req.url?.startsWith(RELAY_PATH)) return; // Vite's own hot-reload socket and others
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
  };

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const room = new URL(req.url ?? '', 'http://x').searchParams.get('room') ?? '';
    let peers = rooms.get(room);
    if (!peers) rooms.set(room, (peers = new Set()));
    peers.add(ws);
    let alive = true;
    ws.on('pong', () => (alive = true));
    // A computer that drops off the network without saying goodbye is noticed within ~30 s.
    const beat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 15000);
    ws.on('message', (data, isBinary) => {
      for (const p of peers!) if (p !== ws && p.readyState === p.OPEN) p.send(data, { binary: isBinary });
    });
    ws.on('close', () => {
      clearInterval(beat);
      peers!.delete(ws);
      if (!peers!.size) rooms.delete(room);
    });
  });

  return {
    name: 'fwm-lan-relay',
    configureServer: attach,
    configurePreviewServer(s) {
      attach(s);
      // The built page, with the tag added (and the same isolation headers as everything else).
      const page = resolve(s.config.root, s.config.build.outDir, 'index.html');
      s.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (req.method !== 'GET' || (path !== '/' && path !== '/index.html')) return next();
        const html = readFileSync(page, 'utf8').replace('<head>', `<head>${meta()}`);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.setHeader('Cache-Control', 'no-store');
        res.end(html);
      });
    },
    transformIndexHtml(html, ctx) {
      return ctx.server ? html.replace('<head>', `<head>${meta()}`) : html; // dev server only, never in a build
    },
  };
}
