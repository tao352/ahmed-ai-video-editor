// Colour grade panel: sliders, built-in and saved looks, match to a reference picture, LUT bake.
// Writes `grade` objects (reel/src/edit/grade.ts) wherever the caller points it.
import React, {useEffect, useState} from 'react';
import {FloppyDisk, ImageSquare, Trash} from '@phosphor-icons/react';
import {GRADE_PRESETS, imageStats, isGraded, matchGrade, type Grade, type GradeKey} from '../../../reel/src/edit/grade';
import {endGroup, toast} from '../store';
import {SliderField} from './fields';
import {listFiles, loadPresets, runTool, savePreset} from './jobs';

const ROWS: {key: GradeKey; label: string; min: number; max: number; group: 'light' | 'color' | 'fx'}[] = [
  {key: 'exposure', label: 'Exposure', min: -2, max: 2, group: 'light'},
  {key: 'contrast', label: 'Contrast', min: -1, max: 1, group: 'light'},
  {key: 'highlights', label: 'Highlights', min: -1, max: 1, group: 'light'},
  {key: 'shadows', label: 'Shadows', min: -1, max: 1, group: 'light'},
  {key: 'saturation', label: 'Saturation', min: -1, max: 1, group: 'color'},
  {key: 'temperature', label: 'Temperature', min: -1, max: 1, group: 'color'},
  {key: 'tint', label: 'Green / magenta', min: -1, max: 1, group: 'color'},
  {key: 'fade', label: 'Fade', min: 0, max: 1, group: 'fx'},
  {key: 'vignette', label: 'Vignette', min: 0, max: 1, group: 'fx'},
  {key: 'grain', label: 'Film grain', min: 0, max: 1, group: 'fx'},
  {key: 'sharpen', label: 'Sharpen', min: 0, max: 1, group: 'fx'},
];
const NAMES: Record<string, string> = {natural: 'Natural', punch: 'Punchy', warm: 'Warm', cool: 'Cool', film: 'Film', moody: 'Moody', bright: 'Bright', bw: 'Black & white'};

/**
 * `overlayFx` false hides vignette/grain (they only exist for the whole frame).
 * `frame` returns the current picture's pixels (ungraded) for colour matching.
 */
export function GradePanel({value, onChange, overlayFx = true, frame, title, children}: {
  value: Grade | undefined; onChange: (g: Grade | undefined, field: string) => void; overlayFx?: boolean;
  frame?: () => Uint8ClampedArray | null; title: string; children?: React.ReactNode;
}) {
  const g = value ?? {};
  const [saved, setSaved] = useState<Record<string, Grade>>({});
  useEffect(() => { void loadPresets<Grade>('grades').then(setSaved); }, []);
  const set = (k: GradeKey, v: number | undefined) => {
    const next: Grade = {...g, [k]: v};
    if (v === undefined) delete next[k];
    delete next.preset;
    onChange(isGraded(next) ? next : undefined, k);
  };
  const apply = (name: string, preset: Grade) => { onChange({...preset, preset: name}, 'preset'); endGroup(); };
  const save = async () => {
    const name = prompt('Name this look?');
    if (!name?.trim()) return;
    setSaved(await savePreset('grades', name.trim(), {...g, preset: undefined}));
    toast(`Saved "${name.trim()}"`);
  };
  const match = (file: File) => {
    const cur = frame?.();
    if (!cur) { toast('Cannot find the video frame on screen', 'error'); return; }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 160; c.height = Math.max(1, Math.round(160 * img.height / img.width));
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const ref = imageStats(ctx.getImageData(0, 0, c.width, c.height).data);
      onChange({...g, ...matchGrade(imageStats(cur), ref), preset: undefined}, 'match');
      endGroup();
      URL.revokeObjectURL(img.src);
      toast('Colors matched to the image. Fine-tune with the sliders if needed');
    };
    img.src = URL.createObjectURL(file);
  };
  const rows = ROWS.filter(r => overlayFx || (r.key !== 'vignette' && r.key !== 'grain'));
  return (
    <div className="subgroup">
      <div className="sub-title" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <span>{title}{g.preset ? <span className="mono" style={{marginInlineStart: 6, color: 'var(--text-3)'}}>{NAMES[g.preset] ?? g.preset}</span> : null}</span>
        {isGraded(g) && <button className="key small" onClick={() => { onChange(undefined, 'reset'); endGroup(); }}>Reset</button>}
      </div>
      <div className="preset-row">
        {Object.entries(GRADE_PRESETS).map(([k, p]) => <button key={k} className={`key small ${g.preset === k ? 'lit' : ''}`} onClick={() => apply(k, p)}>{NAMES[k] ?? k}</button>)}
        {Object.entries(saved).map(([k, p]) => (
          <span key={k} className="saved-preset">
            <button className={`key small ${g.preset === k ? 'lit' : ''}`} onClick={() => apply(k, p)}>{k}</button>
            <button className="key small icon" title={`Delete ${k}`} aria-label={`Delete ${k}`} onClick={async () => setSaved(await savePreset<Grade>('grades', k, null))}><Trash size={11} /></button>
          </span>
        ))}
      </div>
      {(['light', 'color', 'fx'] as const).map(group => (
        <div key={group} className="slider-group">
          {rows.filter(r => r.group === group).map(r => (
            <SliderField key={r.key} label={r.label} hint={r.key} value={g[r.key]} min={r.min} max={r.max} step={0.01} onChange={v => set(r.key, v)} />
          ))}
        </div>
      ))}
      <div className="tool-row">
        <button className="key small" disabled={!isGraded(g)} onClick={save}><FloppyDisk size={13} /> Save look</button>
        {frame && <label className="key small" title="Pick a reference image (screenshot) and the colors are matched to it">
          <ImageSquare size={13} /> Match to image
          <input type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) match(f); e.target.value = ''; }} />
        </label>}
        {children}
      </div>
    </div>
  );
}

/** Bake a .cube LUT into the footage file (ffmpeg job); every piece cut from that file switches to the baked copy. */
export function LutControls({doc, src, onDoc}: {doc: any; src: string; onDoc: (next: any, change: string) => void}) {
  const [cubes, setCubes] = useState<string[] | null>(null);
  const [pick, setPick] = useState('');
  const piece = (doc.base ?? []).find((b: any) => b.src === src);
  const baked = piece?.lut as {file: string; from: string} | undefined;
  const swap = (from: string, to: string, lut: unknown) => ({...doc, base: doc.base.map((b: any) => {
    if (b.src !== from) return b;
    const next = {...b, src: to};
    if (lut) next.lut = lut; else delete next.lut;
    return next;
  })});
  if (baked) return <button className="key small" onClick={() => onDoc(swap(src, baked.from, null), `removed LUT ${baked.file} from footage (back to ${baked.from})`)}>Remove LUT ({baked.file.split('/').pop()})</button>;
  if (!cubes) return <button className="key small" onClick={() => void listFiles(['cube']).then(list => { setCubes(list); setPick(list[0] ?? ''); })}>LUT…</button>;
  if (!cubes.length) return <span className="hint" style={{fontSize: 11.5}}>Put .cube files in public/luts and come back</span>;
  return <>
    <select className="lut-pick" value={pick} dir="ltr" onChange={e => setPick(e.target.value)}>{cubes.map(c => <option key={c} value={c}>{c}</option>)}</select>
    <button className="key small" onClick={async () => {
      const r = await runTool<{src: string}>('lut', {video: src, cube: pick}, 'Applying LUT');
      if (r) onDoc(swap(src, r.src, {file: pick, from: src}), `baked LUT ${pick} into footage ${src} -> ${r.src}`);
    }}>Apply</button>
  </>;
}

/** Pixels of the footage under the playhead, read from the monitor's video element (before grading). */
export function footageFrame(): Uint8ClampedArray | null {
  // the biggest playing picture that is not the speaker matte or a blurred backdrop
  const vids = [...document.querySelectorAll<HTMLVideoElement>('.screen video')]
    .filter(x => x.videoWidth && !/matte/i.test(x.currentSrc) && !/blur/.test(x.style.filter));
  const v = vids.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
  if (!v) return null;
  const c = document.createElement('canvas');
  c.width = 160; c.height = Math.max(1, Math.round(160 * v.videoHeight / v.videoWidth));
  const ctx = c.getContext('2d', {willReadFrequently: true});
  if (!ctx) return null;
  try {
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return ctx.getImageData(0, 0, c.width, c.height).data;
  } catch { return null; }
}
