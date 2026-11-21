#!/usr/bin/env python3
"""Local static server that sends the cross-origin isolation headers.

SharedArrayBuffer (used for the fast audio-thread event ring) only works when the page is
"cross-origin isolated", which needs these two response headers:
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp   (or: credentialless)

Usage:  python3 spikes/serve.py [port]      then open http://localhost:8765/spikes/
Serves the repository root, bound to localhost only.
"""
import functools, http.server, os, sys

class IsolatedHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(IsolatedHandler, directory=root)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"Serving {root} with COOP/COEP on http://localhost:{port}/spikes/")
        httpd.serve_forever()
