// Editable names (instruments, patterns). A name shows everywhere it is used.
// Typing is local until Enter or leaving the field, so a remote rename never fights your typing.
import { useEffect, useRef, useState } from 'react';
import { useStudio } from '../context';

export function NameInput({ value, label, onCommit, autoFocus, onDone, className = '', maxLength = 40 }: {
  value: string;
  label: string;
  onCommit(v: string): void;
  autoFocus?: boolean;
  onDone?: () => void;
  className?: string;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const el = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  useEffect(() => {
    if (autoFocus) el.current?.select();
  }, [autoFocus]);
  const commit = () => {
    editing.current = false;
    if (draft.trim() && draft.trim() !== value) onCommit(draft);
    else setDraft(value);
    onDone?.();
  };
  return (
    <input ref={el} className={'fwm-tname ' + className} value={draft} maxLength={maxLength} autoFocus={autoFocus} spellCheck={false}
      aria-label={label} title="Type a new name, then Enter"
      onFocus={() => { editing.current = true; }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          setDraft(value);
          editing.current = false;
          onDone?.();
          requestAnimationFrame(() => el.current?.blur());
        }
        e.stopPropagation();
      }} />
  );
}

export function TrackNameInput({ track, name, ...rest }: { track: string; name: string; autoFocus?: boolean; onDone?: () => void; className?: string }) {
  const { project } = useStudio();
  return <NameInput value={name} label={`Rename ${name}`} onCommit={(v) => project.renameTrack(track, v)} {...rest} />;
}
