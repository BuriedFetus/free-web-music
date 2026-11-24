// Editable track name. The name shows everywhere: device faceplate, sequencer row, panel tabs.
// Typing is local until Enter or leaving the field, so a remote rename never fights your typing.
import { useEffect, useRef, useState } from 'react';
import { useStudio } from '../context';

export function TrackNameInput({ track, name, autoFocus, onDone, className = '' }: {
  track: string;
  name: string;
  autoFocus?: boolean;
  onDone?: () => void;
  className?: string;
}) {
  const { project } = useStudio();
  const [draft, setDraft] = useState(name);
  const editing = useRef(false);
  const el = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing.current) setDraft(name);
  }, [name]);
  useEffect(() => {
    if (autoFocus) el.current?.select();
  }, [autoFocus]);
  const commit = () => {
    editing.current = false;
    if (draft.trim()) project.renameTrack(track, draft);
    else setDraft(name);
    onDone?.();
  };
  return (
    <input ref={el} className={'fwm-tname ' + className} value={draft} maxLength={40} autoFocus={autoFocus} spellCheck={false}
      aria-label={`Rename ${name}`} title="Type a new name, then Enter"
      onFocus={() => { editing.current = true; }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setDraft(name);
          editing.current = false;
          onDone?.();
          requestAnimationFrame(() => el.current?.blur());
        }
        e.stopPropagation();
      }} />
  );
}
