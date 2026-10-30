// Output formats on the monitor: the master edit plus any extra sizes (9:16, 16:9, 1:1, 4:5).
import React, {useEffect, useRef, useState} from 'react';
import {Plus} from '@phosphor-icons/react';
import {addFormat, formatIds, formatLabel, MAIN, PRESETS} from '../model/formats';
import {commit, currentDoc, editor, useDoc, useEditor} from '../store';

export function FormatBar() {
  const doc = useDoc('panel');
  const format = useEditor(s => s.format);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  if (!doc) return null;
  const ids = formatIds(doc);
  const master = `${doc.settings.width}x${doc.settings.height}`;
  const missing = PRESETS.filter(p => !ids.includes(p.id) && `${p.width}x${p.height}` !== master);
  const pick = (id: string) => editor.set(s => ({...s, format: id, selection: s.selection}));
  return (
    <div className="seg formats" role="tablist" aria-label="Size" ref={ref} style={{position: 'relative'}}>
      <button role="tab" aria-selected={format === MAIN} className={`key small ${format === MAIN ? 'lit' : ''}`} title="Main edit" onClick={() => pick(MAIN)}>
        <span className="mono">{doc.settings.width}×{doc.settings.height}</span>
      </button>
      {ids.map(id => (
        <button key={id} role="tab" aria-selected={format === id} className={`key small ${format === id ? 'lit' : ''}`} title={formatLabel(doc, id)} onClick={() => pick(id)}>
          <span className="mono">{doc.formats[id].width}×{doc.formats[id].height}</span>
        </button>
      ))}
      {missing.length > 0 && <button className="key small icon" title="Add size" aria-label="Add size" aria-expanded={open} onClick={() => setOpen(o => !o)}><Plus size={12} /></button>}
      {open && (
        <div className="menu" role="menu" style={{top: 32, right: 'auto', left: 0}}>
          {missing.map(p => (
            <button key={p.id} role="menuitem" onClick={() => {
              setOpen(false);
              const d = currentDoc();
              if (!d) return;
              commit(addFormat(d, p), 'add format', {change: `added output format ${p.id} (${p.width}x${p.height})`});
              pick(p.id);
            }}>{p.label}<small className="mono">{p.width}×{p.height}</small></button>
          ))}
        </div>
      )}
    </div>
  );
}
