// Collaboration stand-in for the host app: syncs a Yjs doc, awareness and live notes between browser
// tabs on this machine (BroadcastChannel), or between computers through the dev server's relay
// (lanRelay.ts, when the page has its <meta name="fwm-relay">; ?tabs forces tabs only), and keeps the
// project in localStorage. The real host (the friend's app) replaces this with its own provider and
// channel; the studio doesn't change.
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import type { LiveChannel, LiveMessage } from '@fwm/studio';

const toB64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** What the sync below talks through: a BroadcastChannel, or one named stream of the relay socket. */
interface Pipe {
  postMessage(m: unknown): void;
  onmessage: ((e: { data: any }) => void) | null; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** The dev server's relay, if this page came from it (and not ?tabs). */
export function relayInfo() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="fwm-relay"]');
  if (!meta || new URLSearchParams(location.search).has('tabs')) return null;
  return { path: meta.content, network: (meta.dataset.network ?? '').split(' ').filter(Boolean) };
}

// Over the socket, Yjs updates (Uint8Array) travel as base64.
const pack = (c: string, m: unknown) => JSON.stringify({ c, m }, (_k, v) => (v instanceof Uint8Array ? { $u: toB64(v) } : v));
const unpack = (s: string) => JSON.parse(s, (_k, v) => (v && typeof v === 'object' && typeof v.$u === 'string' ? fromB64(v.$u) : v)) as { c: string; m: unknown };

/** One socket to the relay for the room, split into named pipes. Messages sent before it first opens
 *  wait for it; ones sent while it is down later are dropped: on every (re)connect `onOpen` says hello
 *  again and the others send the whole song back. */
function relayPipes(path: string, room: string, onOpen: () => void) {
  const pipes = new Map<string, Pipe>();
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}?room=${encodeURIComponent(room)}`;
  let ws: WebSocket | null = null;
  let wait = 500;
  let early: string[] | null = [];
  const connect = () => {
    const s = new WebSocket(url);
    s.onopen = () => {
      ws = s;
      wait = 500;
      early?.forEach((m) => s.send(m));
      early = null;
      onOpen();
    };
    s.onmessage = (e: MessageEvent<string>) => {
      try {
        const { c, m } = unpack(e.data);
        pipes.get(c)?.onmessage?.({ data: m });
      } catch {
        /* not ours */
      }
    };
    s.onclose = () => {
      if (ws === s) ws = null;
      setTimeout(connect, wait);
      wait = Math.min(wait * 2, 8000);
    };
  };
  connect();
  return (name: string): Pipe => {
    const p: Pipe = {
      onmessage: null,
      postMessage: (m) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(pack(name, m));
        else early?.push(pack(name, m));
      },
    };
    pipes.set(name, p);
    return p;
  };
}

/** Tabs of this browser only (BroadcastChannel). */
const tabPipe = (room: string) => (name: string): Pipe => {
  const ch = new BroadcastChannel(`${room}:${name}`);
  const p: Pipe = { postMessage: (m) => ch.postMessage(m), onmessage: null };
  ch.onmessage = (e) => p.onmessage?.({ data: e.data });
  return p;
};

/** A pipe of its own (tests coordinating two browsers): through the relay if there is one, else tabs. */
export function sidePipe(room: string): Pipe {
  const relay = relayInfo();
  return relay ? relayPipes(relay.path, room, () => {})('side') : tabPipe(room)('side');
}

export function connectTabs(room: string) {
  const doc = new Y.Doc();
  const storeKey = `fwm.harness.v2.${room}`; // v2: per-instrument patterns + song rows (older saves are left behind)
  try {
    const saved = localStorage.getItem(storeKey);
    if (saved) Y.applyUpdate(doc, fromB64(saved), 'storage');
  } catch {
    /* corrupt or unavailable storage: start empty */
  }
  let saveTimer = 0;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(storeKey, toB64(Y.encodeStateAsUpdate(doc)));
      } catch {
        /* quota */
      }
    }, 500);
  };

  const awareness = new Awareness(doc);
  const relay = relayInfo();
  const hello = () => {
    bc.postMessage({ t: 'hello', u: Y.encodeStateAsUpdate(doc) });
    bc.postMessage({ t: 'aw', u: encodeAwarenessUpdate(awareness, [doc.clientID]) });
  };
  const pipe = relay ? relayPipes(relay.path, room, () => hello()) : tabPipe(room);
  const bc = pipe('doc');
  doc.on('update', (u: Uint8Array, origin: unknown) => {
    save();
    if (origin !== bc) bc.postMessage({ t: 'update', u });
  });
  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === bc) return;
    bc.postMessage({ t: 'aw', u: encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]) });
  });
  bc.onmessage = (e) => {
    const m = e.data;
    if (m.t === 'update') Y.applyUpdate(doc, m.u, bc);
    else if (m.t === 'aw') applyAwarenessUpdate(awareness, m.u, bc);
    else if (m.t === 'hello') {
      // A tab joined: send it everything we have (it sends us its own in the hello).
      Y.applyUpdate(doc, m.u, bc);
      bc.postMessage({ t: 'update', u: Y.encodeStateAsUpdate(doc) });
      bc.postMessage({ t: 'aw', u: encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()]) });
    }
  };
  if (!relay) hello(); // over the relay: once the socket is open
  addEventListener('pagehide', () => removeAwarenessStates(awareness, [doc.clientID], 'pagehide'));

  const live = pipe('live');
  const listeners = new Set<(m: LiveMessage) => void>();
  live.onmessage = (e: { data: LiveMessage }) => listeners.forEach((fn) => fn(e.data));
  const channel: LiveChannel = {
    send: (m) => live.postMessage(m),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return { doc, awareness, channel };
}

const NAMES = ['Mira', 'Theo', 'Juno', 'Kai', 'Nova', 'Remy', 'Ada', 'Sol'];
const COLORS = ['#ff4fa3', '#ffb23f', '#7dff6b', '#b48cff', '#3fe0ff', '#ff7a59', '#f5e663', '#59ffcb'];

/** One identity per tab (kept across reloads of that tab); `fresh` = a new one, not kept (?newuser). */
export function tabUser(fresh = false) {
  if (!fresh) {
    try {
      const j = sessionStorage.getItem('fwm.harness.user');
      if (j) return JSON.parse(j) as { id: string; name: string; color: string };
    } catch {
      /* ignore */
    }
  }
  const i = Math.floor(Math.random() * NAMES.length);
  const u = { id: 'u' + Math.random().toString(36).slice(2, 9), name: NAMES[i], color: COLORS[i] };
  if (fresh) return u;
  try {
    sessionStorage.setItem('fwm.harness.user', JSON.stringify(u));
  } catch {
    /* ignore */
  }
  return u;
}
