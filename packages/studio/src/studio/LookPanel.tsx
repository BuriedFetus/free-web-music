// "My look": restyle the studio for yourself only. Copy a brief for your AI agent, paste (or load) the
// stylesheet it writes, try it, keep it. It never enters the shared song: everyone keeps their own look.
import { useEffect, useMemo, useRef, useState } from 'react';
import { LOOK_EXAMPLE, LOOK_MAX, lookBrief, prepareLook } from '../model/look';
import { useStudio } from './context';

export function LookPanel({ onClose }: { onClose(): void }) {
  const { look, toast } = useStudio();
  const [draft, setDraft] = useState(look.preview ?? look.css ?? '');
  const [copied, setCopied] = useState<'brief' | 'failed' | null>(null);
  const briefBox = useRef<HTMLTextAreaElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const checked = useMemo(() => prepareLook(draft), [draft]);
  const trying = look.preview != null;

  const close = () => {
    look.setPreview(null);
    onClose();
  };
  useEffect(() => {
    first.current?.focus();
    const kd = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    addEventListener('keydown', kd, true);
    return () => removeEventListener('keydown', kd, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const copyBrief = async () => {
    const text = lookBrief(draft || look.css);
    try {
      await navigator.clipboard.writeText(text);
      setCopied('brief');
    } catch {
      // no clipboard here: show the brief so it can be selected and copied by hand
      setCopied('failed');
      requestAnimationFrame(() => {
        briefBox.current?.focus();
        briefBox.current?.select();
      });
    }
  };
  const load = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > LOOK_MAX) return toast(`That file is over ${LOOK_MAX / 1000} KB: not a look`);
    setDraft(await f.text());
  };
  const keep = () => {
    look.set(draft);
    look.setPreview(null);
    toast(draft.trim() ? 'Your look is kept. Only you see it.' : 'Back to the default look');
    onClose();
  };

  return (
    <div className="fwm-look" role="dialog" aria-modal="true" aria-labelledby="fwm-look-title" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="fwm-look__box">
        <div className="fwm-look__head">
          <h2 id="fwm-look-title">My look</h2>
          <button ref={first} type="button" className="fwm-ib" aria-label="Close" onClick={close}>×</button>
        </div>
        <p className="fwm-look__lead">
          Restyle the studio the way you like it. <b>Only you see your look</b>: everyone else in the session keeps theirs, and
          the song doesn't change. {look.hostKeeps ? 'It is kept with your account.' : 'It is kept in this browser.'}
        </p>
        {look.off && <p className="fwm-look__warn">Looks are switched off on this page (the address has ?nolook). Remove it to see yours.</p>}

        <h3>1. Ask your AI agent</h3>
        <p>Copy the brief, paste it to your agent and write what you want where it says so. It already explains the rules, every colour
          and font setting, and the parts of the screen{look.css || draft ? ', and includes your current look so it can change it' : ''}.</p>
        <div className="fwm-look__row">
          <button type="button" className="fwm-btn-ui" onClick={copyBrief}>Copy the brief</button>
          <button type="button" className="fwm-btn-ui fwm-btn-ui--ghost" onClick={() => setDraft(LOOK_EXAMPLE)}>Try an example (a light look)</button>
          {copied === 'brief' && <span className="fwm-look__ok" role="status">Copied</span>}
        </div>
        {copied === 'failed' && (
          <textarea ref={briefBox} className="fwm-look__css" readOnly rows={6} value={lookBrief(draft || look.css)}
            aria-label="The brief for your AI agent (select it and copy)" />
        )}

        <h3>2. Paste what it gives you</h3>
        <textarea className="fwm-look__css" rows={10} spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder={'& {\n  --fwm-bg: #10131a;\n  --fwm-note: #ff8a00;\n}'} aria-label="Your look (CSS)" />
        <div className="fwm-look__row">
          <label className="fwm-btn-ui fwm-btn-ui--ghost fwm-look__file">
            Load a .css file
            <input type="file" accept=".css,text/css,text/plain" onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <span className="fwm-look__size">{draft.length ? `${(draft.length / 1000).toFixed(1)} KB` : ''}</span>
        </div>
        {checked.removed.length > 0 && (
          <p className="fwm-look__warn">Left out: {checked.removed.join('; ')}.</p>
        )}

        <div className="fwm-look__row fwm-look__actions">
          <button type="button" className="fwm-btn-ui" aria-pressed={trying} disabled={!draft.trim()}
            onClick={() => look.setPreview(trying ? null : draft)}>
            {trying ? 'Stop trying' : 'Try it'}
          </button>
          <button type="button" className="fwm-btn-ui fwm-btn-ui--primary" disabled={!draft.trim() && !look.css} onClick={keep}>
            {draft.trim() ? 'Keep this look' : 'Keep the default'}
          </button>
          <button type="button" className="fwm-btn-ui fwm-btn-ui--ghost" disabled={!look.css && !draft}
            onClick={() => { setDraft(''); look.setPreview(null); look.set(null); toast('Back to the default look'); }}>
            Back to default
          </button>
        </div>
        <p className="fwm-look__tip">If a look ever hides this button, open the studio with <code>?nolook</code> in the address: looks are switched off there and you can fix or remove yours.</p>
      </div>
    </div>
  );
}
