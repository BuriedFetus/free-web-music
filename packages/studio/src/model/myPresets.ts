// A person's own presets ("Mine"): kept by the host's PresetLibrary, or in this browser without one.
// PresetCache loads each instrument's list once, keeps it in memory and tells every panel when it changes.
import type { PresetLibrary, UserPreset } from '../collab/types';

/** Presets in this browser's localStorage, per person and instrument. */
export function browserPresetLibrary(userId: string): PresetLibrary {
  const key = (device: string) => `fwm.presets.${userId}.${device}`;
  const read = (device: string): UserPreset[] => {
    try {
      const j = JSON.parse(localStorage.getItem(key(device)) || '[]');
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  };
  const write = (device: string, list: UserPreset[]) => {
    try {
      localStorage.setItem(key(device), JSON.stringify(list));
    } catch {
      /* full or blocked: the preset lives until the page closes */
    }
  };
  return {
    list: async (device) => read(device),
    save: async (device, preset) => write(device, [...read(device).filter((p) => p.id !== preset.id), preset]),
    remove: async (device, id) => write(device, read(device).filter((p) => p.id !== id)),
  };
}

const byName = (a: UserPreset, b: UserPreset) => a.name.localeCompare(b.name);

export class PresetCache {
  private lists = new Map<string, UserPreset[]>();
  private loading = new Set<string>();
  private gone = new Set<string>(); // deleted here (a list still loading must not bring them back)
  private subs = new Set<() => void>();
  private version = 0;
  /** `host`: kept by the host app (with the person's account); `browser`: in this browser only. */
  constructor(private lib: PresetLibrary, public where: 'host' | 'browser' = 'browser') {}

  subscribe = (fn: () => void) => {
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  };
  getVersion = () => this.version;
  private changed() {
    this.version++;
    for (const f of this.subs) f();
  }
  /** This person's presets for an instrument, sorted by name (empty until loaded). */
  get(device: string): UserPreset[] {
    const l = this.lists.get(device);
    if (!l && !this.loading.has(device)) {
      this.loading.add(device);
      this.lib
        .list(device)
        .then((x) => {
          // a save or delete may have happened while loading: those win
          const now = this.lists.get(device);
          const merged = now ? [...now, ...x.filter((p) => !now.some((q) => q.id === p.id) && !this.gone.has(p.id))] : x.filter((p) => !this.gone.has(p.id));
          this.lists.set(device, [...merged].sort(byName));
          this.changed();
        })
        .catch(() => this.lists.set(device, []))
        .finally(() => this.loading.delete(device));
    }
    return l ?? [];
  }
  async save(device: string, p: Omit<UserPreset, 'id' | 'updated'> & { id?: string }): Promise<UserPreset> {
    const preset: UserPreset = { ...p, id: p.id ?? `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, updated: Date.now() };
    const list = (this.lists.get(device) ?? []).filter((x) => x.id !== preset.id);
    this.lists.set(device, [...list, preset].sort(byName));
    this.changed();
    await this.lib.save(device, preset);
    return preset;
  }
  async remove(device: string, id: string) {
    this.gone.add(id);
    this.lists.set(device, (this.lists.get(device) ?? []).filter((x) => x.id !== id));
    this.changed();
    await this.lib.remove(device, id);
  }
}

let fallback: PresetCache | null = null;
/** For an instrument shown on its own (no studio around it): this browser, one person. */
export function defaultPresetCache() {
  return (fallback ??= new PresetCache(browserPresetLibrary('me')));
}
