// CapCut's Text tab for a Text clip: what it says, the font (any font on this machine), size, colour,
// B / I / U / caps, alignment, spacing, then stroke, background and shadow. Writes clip.props.
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {TextAlignCenter, TextAlignLeft, TextAlignRight, TextB, TextItalic, TextUnderline} from '@phosphor-icons/react';
import {CheckField, ColorField, SliderField} from './fields';

type Update = (clip: any, field: string) => void;
type Family = {family: string; styles: string[]; arabic: boolean};

let fontsCache: Promise<Family[]> | null = null;
const loadFonts = () => (fontsCache ??= fetch('/api/fonts').then(r => (r.ok ? r.json() : [])).catch(() => { fontsCache = null; return []; }));

/** Searchable list of the machine's fonts, each name drawn in its own face. */
function FontPicker({value, onChange}: {value: string; onChange: (family: string) => void}) {
  const [fonts, setFonts] = useState<Family[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [arabicOnly, setArabicOnly] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { void loadFonts().then(setFonts); }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return fonts.filter(f => (!arabicOnly || f.arabic) && (!needle || f.family.toLowerCase().includes(needle))).slice(0, 300);
  }, [fonts, q, arabicOnly]);
  return (
    <div className="font-pick" ref={box}>
      <label className="field">
        <span>Font</span>
        <input type="search" value={open ? q : value || 'Theme font'} placeholder="Search fonts…" style={{fontFamily: value ? `"${value}"` : undefined}}
          onFocus={() => { setOpen(true); setQ(''); }} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && shown[0]) { onChange(shown[0].family); setOpen(false); } }} />
      </label>
      {open && (
        <div className="font-list" role="listbox">
          <label className="check" style={{padding: '6px 8px'}}><input type="checkbox" checked={arabicOnly} onChange={e => setArabicOnly(e.target.checked)} />Arabic fonts only</label>
          <button className={!value ? 'lit' : ''} onClick={() => { onChange(''); setOpen(false); }}>Theme font <small>default</small></button>
          {shown.map(f => (
            <button key={f.family} role="option" aria-selected={f.family === value} className={f.family === value ? 'lit' : ''} style={{fontFamily: `"${f.family}"`}}
              onClick={() => { onChange(f.family); setOpen(false); }}>
              {f.family}<small>{f.arabic ? 'عربي · ' : ''}{f.styles.length} style{f.styles.length === 1 ? '' : 's'}</small>
            </button>
          ))}
          {!shown.length && <p className="empty" style={{margin: 8}}>{fonts.length ? 'No font with that name.' : 'Reading the fonts on this computer…'}</p>}
        </div>
      )}
    </div>
  );
}

export function TextFields({clip, update}: {clip: any; update: Update}) {
  const p = clip.props ?? {};
  const set = (patch: Record<string, unknown>, field: string) => {
    const next: Record<string, unknown> = {...p, ...patch};
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    update({...clip, props: next}, `props.${field}`);
  };
  const caps = p.caps ?? 'none';
  const stroke = p.stroke, bg = p.background, sh = p.shadow;
  return <>
    <div className="subgroup">
      <textarea className="text-box" dir="auto" value={p.text ?? 'Default text'} placeholder="Type your text" aria-label="Text"
        onChange={e => set({text: e.target.value}, 'text')} />
      <FontPicker value={p.font ?? ''} onChange={f => set({font: f || undefined}, 'font')} />
      <div className="pair">
        <SliderField label="Size" hint="px" value={p.size ?? 80} neutral={80} min={12} max={400} step={1} onChange={v => set({size: v ?? 80}, 'size')} />
        <ColorField label="Color" value={p.color ?? '#ffffff'} onChange={c => set({color: c}, 'color')} />
      </div>
      <div className="toggle-row" role="group" aria-label="Text style">
        <button className={`key small icon ${(p.weight ?? 700) >= 600 ? 'lit' : ''}`} title="Bold" aria-pressed={(p.weight ?? 700) >= 600} onClick={() => set({weight: (p.weight ?? 700) >= 600 ? 400 : 700}, 'weight')}><TextB size={15} /></button>
        <button className={`key small icon ${p.italic ? 'lit' : ''}`} title="Italic" aria-pressed={!!p.italic} onClick={() => set({italic: !p.italic || undefined}, 'italic')}><TextItalic size={15} /></button>
        <button className={`key small icon ${p.underline ? 'lit' : ''}`} title="Underline" aria-pressed={!!p.underline} onClick={() => set({underline: !p.underline || undefined}, 'underline')}><TextUnderline size={15} /></button>
        <button className={`key small ${caps !== 'none' ? 'lit' : ''}`} title="Letter case: as typed, UPPER, lower" onClick={() => set({caps: caps === 'none' ? 'upper' : caps === 'upper' ? 'lower' : undefined}, 'caps')}>{caps === 'upper' ? 'AA' : caps === 'lower' ? 'aa' : 'Aa'}</button>
        <span style={{flex: 1}} />
        {(['left', 'center', 'right'] as const).map(al => {
          const Icon = al === 'left' ? TextAlignLeft : al === 'center' ? TextAlignCenter : TextAlignRight;
          return <button key={al} className={`key small icon ${(p.align ?? 'center') === al ? 'lit' : ''}`} title={`Align ${al}`} onClick={() => set({align: al === 'center' ? undefined : al}, 'align')}><Icon size={15} /></button>;
        })}
      </div>
      <SliderField label="Weight" value={p.weight ?? 700} neutral={700} min={100} max={900} step={100} onChange={v => set({weight: v ?? 700}, 'weight')} />
      <div className="pair">
        <SliderField label="Letter spacing" hint="px" value={p.spacing ?? 0} min={-20} max={80} step={1} onChange={v => set({spacing: v || undefined}, 'spacing')} />
        <SliderField label="Line height" value={p.lineHeight ?? 1.2} neutral={1.2} min={0.7} max={3} step={0.05} onChange={v => set({lineHeight: v ?? 1.2}, 'lineHeight')} />
      </div>
      <SliderField label="Wrap width" hint="of frame" value={p.wrap ?? 0.86} neutral={0.86} min={0.1} max={1} step={0.01} onChange={v => set({wrap: v ?? 0.86}, 'wrap')} />
    </div>
    <div className="subgroup">
      <CheckField label="Stroke" value={!!stroke} onChange={v => set({stroke: v ? {color: '#000000', width: 6} : undefined}, 'stroke')} />
      {stroke && <div className="pair">
        <ColorField label="Stroke color" value={stroke.color} onChange={c => set({stroke: {...stroke, color: c}}, 'stroke.color')} />
        <SliderField label="Thickness" value={stroke.width} neutral={6} min={0} max={40} step={1} onChange={v => set({stroke: {...stroke, width: v ?? 6}}, 'stroke.width')} />
      </div>}
      <CheckField label="Background" value={!!bg} onChange={v => set({background: v ? {color: '#000000', opacity: 0.7, radius: 16, padX: 28, padY: 14} : undefined}, 'background')} />
      {bg && <>
        <div className="pair">
          <ColorField label="Box color" value={bg.color} onChange={c => set({background: {...bg, color: c}}, 'background.color')} />
          <SliderField label="Opacity" value={bg.opacity} neutral={0.7} min={0} max={1} onChange={v => set({background: {...bg, opacity: v ?? 0.7}}, 'background.opacity')} />
        </div>
        <div className="pair">
          <SliderField label="Corners" hint="px" value={bg.radius} neutral={16} min={0} max={120} step={1} onChange={v => set({background: {...bg, radius: v ?? 16}}, 'background.radius')} />
          <SliderField label="Padding" hint="px" value={bg.padX} neutral={28} min={0} max={160} step={1} onChange={v => set({background: {...bg, padX: v ?? 28, padY: Math.round((v ?? 28) / 2)}}, 'background.pad')} />
        </div>
      </>}
      <CheckField label="Shadow" value={!!sh} onChange={v => set({shadow: v ? {color: '#000000', opacity: 0.6, blur: 12, x: 0, y: 6} : undefined}, 'shadow')} />
      {sh && <>
        <div className="pair">
          <ColorField label="Shadow color" value={sh.color} onChange={c => set({shadow: {...sh, color: c}}, 'shadow.color')} />
          <SliderField label="Opacity" value={sh.opacity} neutral={0.6} min={0} max={1} onChange={v => set({shadow: {...sh, opacity: v ?? 0.6}}, 'shadow.opacity')} />
        </div>
        <div className="pair">
          <SliderField label="Blur" value={sh.blur} neutral={12} min={0} max={80} step={1} onChange={v => set({shadow: {...sh, blur: v ?? 12}}, 'shadow.blur')} />
          <SliderField label="Distance" value={sh.y} neutral={6} min={-60} max={60} step={1} onChange={v => set({shadow: {...sh, y: v ?? 6}}, 'shadow.y')} />
        </div>
      </>}
    </div>
  </>;
}
