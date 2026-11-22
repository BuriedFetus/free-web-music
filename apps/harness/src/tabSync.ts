// Collaboration stand-in for the host app: syncs a Yjs doc, awareness and live notes between browser
// tabs on this machine (BroadcastChannel), and keeps the project in localStorage. The real host
// (the friend's app) replaces this with its own provider and channel; the studio doesn't change.
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import type { LiveChannel, LiveMessage } from '@fwm/studio';

const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function connectTabs(room: string) {
  const doc = new Y.Doc();
  const storeKey = `fwm.harness.${room}`;
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
  const bc = new BroadcastChannel(`${room}:doc`);
  doc.on('update', (u: Uint8Array, origin: unknown) => {
    save();
    if (origin !== bc) bc.postMessage({ t: 'update', u });
  });
  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === bc) return;
    bc.postMessage({ t: 'aw', u: encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]) });
  });
  bc.onmessage = (e: MessageEvent) => {
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
  bc.postMessage({ t: 'hello', u: Y.encodeStateAsUpdate(doc) });
  addEventListener('pagehide', () => removeAwarenessStates(awareness, [doc.clientID], 'pagehide'));

  const live = new BroadcastChannel(`${room}:live`);
  const listeners = new Set<(m: LiveMessage) => void>();
  live.onmessage = (e: MessageEvent<LiveMessage>) => listeners.forEach((fn) => fn(e.data));
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

/** One identity per tab (kept across reloads of that tab). */
export function tabUser() {
  try {
    const j = sessionStorage.getItem('fwm.harness.user');
    if (j) return JSON.parse(j) as { id: string; name: string; color: string };
  } catch {
    /* ignore */
  }
  const i = Math.floor(Math.random() * NAMES.length);
  const u = { id: 'u' + Math.random().toString(36).slice(2, 9), name: NAMES[i], color: COLORS[i] };
  try {
    sessionStorage.setItem('fwm.harness.user', JSON.stringify(u));
  } catch {
    /* ignore */
  }
  return u;
}
