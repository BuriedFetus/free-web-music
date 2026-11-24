// Song menu: name, Save, Save as copy, New song from INIT, and the host's saved songs.
// Opening a song or INIT replaces the song for everyone in the session, so it asks first when there are
// unsaved changes, and it can be undone. Saving goes through the host's SongLibrary (the core stores nothing).
import { useEffect, useRef, useState } from 'react';
import type { SongSummary } from '../collab/types';
import { LIBRARY } from '../devices/registry';
import type { DeviceManifest } from '@fwm/engine';
import { useStudio } from './context';
import { NameInput } from './views/TrackName';

type Pending = { kind: 'init' } | { kind: 'open'; id: string; name: string } | null;

const manifests = (): Record<string, DeviceManifest> =>
  Object.fromEntries(LIBRARY.filter((d) => d.manifest).map((d) => [d.id, d.manifest!]));

export function SongMenu() {
  const { project, songs, toast } = useStudio();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<SongSummary[] | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const unsaved = project.unsaved;

  const refresh = () => {
    if (!songs) return;
    songs.list().then(setList, () => setList([]));
  };
  useEffect(() => {
    if (!open) return;
    refresh();
    setPending(null);
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (copy = false) => {
    if (!songs || busy) return;
    setBusy(true);
    try {
      const file = project.toFile();
      if (copy) file.name = `${file.name} copy`;
      const id = await songs.save(file, copy ? null : project.songId);
      if (copy) project.renameSong(file.name);
      project.markSaved(id, file);
      toast(`Saved "${file.name}"`);
      refresh();
    } catch (e) {
      toast(`Could not save: ${String((e as Error)?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };
  const run = async (p: NonNullable<Pending>) => {
    setPending(null);
    setOpen(false);
    const before = project.songName;
    try {
      if (p.kind === 'init') {
        const basalt = LIBRARY.find((d) => d.id === 'basalt')!.manifest!;
        project.initSong(basalt);
        toast('New song from INIT', { label: 'Undo', run: () => project.undo() });
      } else {
        const file = await songs!.load(p.id);
        project.loadFile(file, manifests(), p.id);
        toast(`Opened "${project.songName}"`, { label: `Back to "${before}"`, run: () => project.undo() });
      }
    } catch (e) {
      toast(`Could not open: ${String((e as Error)?.message ?? e)}`);
    }
  };
  const ask = (p: NonNullable<Pending>) => (unsaved ? setPending(p) : void run(p));

  return (
    <div className="fwm-song" ref={box}>
      <button type="button" className="fwm-songbtn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}
        title="Song: name, save, open, new">
        <span className="fwm-songbtn__lab">Song</span>
        <b>{project.songName}</b>
        {unsaved && <span className="fwm-songbtn__dirty">• not saved</span>}
        <span aria-hidden>▾</span>
      </button>
      <button type="button" className="fwm-tb fwm-tb--sm" disabled={!songs || busy}
        title={songs ? 'Save this song (for everyone in the session)' : 'The app has no song storage'}
        onClick={() => void save()}>
        Save
      </button>
      {open && (
        <div className="fwm-songmenu" role="dialog" aria-label="Song">
          <label className="fwm-songmenu__name">
            Name
            <NameInput value={project.songName} label="Song name" maxLength={60} onCommit={(v) => project.renameSong(v)} />
          </label>
          {pending ? (
            <div className="fwm-confirm" role="alertdialog" aria-label="Replace the song?">
              <p>
                {pending.kind === 'init' ? 'Start a new song' : `Open "${pending.name}"`} for everyone in the session?
                {' '}"{project.songName}" has changes that are not saved (Undo can bring it back).
              </p>
              <span className="fwm-grp">
                <button type="button" className="fwm-tb fwm-tb--sm" onClick={() => void run(pending)}>
                  {pending.kind === 'init' ? 'New song' : 'Open'}
                </button>
                {songs && <button type="button" className="fwm-tb fwm-tb--sm" onClick={async () => { await save(); void run(pending); }}>Save, then go</button>}
                <button type="button" className="fwm-tb fwm-tb--sm" onClick={() => setPending(null)}>Cancel</button>
              </span>
            </div>
          ) : (
            <>
              <button type="button" className="fwm-mi" onClick={() => ask({ kind: 'init' })}>
                <span>New song from INIT</span><small>one Basalt, 120 BPM</small>
              </button>
              <button type="button" className="fwm-mi" disabled={!songs || busy} onClick={() => void save(true)}>
                <span>Save as copy</span>
              </button>
              <div className="fwm-songmenu__sep" />
              <h4>Saved songs</h4>
              {!songs && <p className="fwm-songmenu__note">This app has no song storage yet.</p>}
              {songs && list == null && <p className="fwm-songmenu__note">Loading…</p>}
              {songs && list?.length === 0 && <p className="fwm-songmenu__note">Nothing saved yet. Press Save.</p>}
              {list?.map((s) => (
                <div key={s.id} className={'fwm-mirow' + (s.id === project.songId ? ' is-on' : '')}>
                  <button type="button" className="fwm-mi" onClick={() => ask({ kind: 'open', id: s.id, name: s.name })}
                    aria-label={`Open ${s.name}`}>
                    <span>{s.name}</span>
                    <small>{new Date(s.updated).toLocaleDateString()}</small>
                  </button>
                  {songs?.remove && s.id !== project.songId && (
                    <button type="button" className="fwm-ib" aria-label={`Delete ${s.name}`} title="Delete this saved song"
                      onClick={async () => {
                        await songs.remove!(s.id);
                        toast(`Deleted "${s.name}"`);
                        refresh();
                      }}>×</button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
