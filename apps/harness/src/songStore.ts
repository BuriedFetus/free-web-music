// Song storage for the dev harness: the browser's localStorage. The real host (the friend's app) passes
// its own SongLibrary (server, database…); the studio only calls list/load/save/remove.
import type { SongFile, SongLibrary, SongSummary } from '@fwm/studio';

const INDEX = 'fwm.songs';
const KEY = (id: string) => `fwm.song.${id}`;

function index(): SongSummary[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX) || '[]');
  } catch {
    return [];
  }
}

export const localSongs: SongLibrary = {
  async list() {
    return index().sort((a, b) => b.updated - a.updated);
  },
  async load(id) {
    const raw = localStorage.getItem(KEY(id));
    if (!raw) throw new Error('song not found');
    return JSON.parse(raw) as SongFile;
  },
  async save(file, id) {
    const sid = id || 's' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(KEY(sid), JSON.stringify(file));
    const rest = index().filter((s) => s.id !== sid);
    localStorage.setItem(INDEX, JSON.stringify([...rest, { id: sid, name: file.name, updated: Date.now() }]));
    return sid;
  },
  async remove(id) {
    localStorage.removeItem(KEY(id));
    localStorage.setItem(INDEX, JSON.stringify(index().filter((s) => s.id !== id)));
  },
};
