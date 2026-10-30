// Inspector sections for any clip's look: motion (in / out / loop), style (opacity, blend, corners,
// shadow, outline, glow), shape mask, and "behind the speaker". Writes clip.anim / style / mask / behind.
import React, {useEffect, useState} from 'react';
import {FloppyDisk, Trash} from '@phosphor-icons/react';
import {ANIM_IN, ANIM_LOOP, TEXT_IN, TEXT_LOOP, type ClipAnim, type ClipMask, type ClipStyle} from '../../../reel/src/edit/clipfx';
import {endGroup, pause, play, seekTime, toast} from '../store';
import {CheckField, ColorField, SelectField, SliderField} from './fields';
import {loadPresets, savePreset} from './jobs';

type Update = (clip: any, field: string) => void;
const IN_NAMES: Record<string, string> = {
  fade: 'Fade', pop: 'Pop', 'slide-up': 'Slide up', 'slide-down': 'Slide down', 'slide-left': 'Slide left', 'slide-right': 'Slide right',
  'zoom-in': 'Zoom in', 'zoom-out': 'Zoom out', blur: 'Blur', spin: 'Spin', drop: 'Drop', rise: 'Rise', swing: 'Swing', bounce: 'Bounce', rotate: 'Rotate',
  typewriter: 'Typewriter', 'letter-fade': 'Letters fade', 'blur-letters': 'Letters blur', 'word-pop': 'Words pop', 'word-rise': 'Words rise',
  'word-drop': 'Words drop', 'word-fade': 'Words fade', wipe: 'Wipe', stretch: 'Stretch',
};
const LOOP_NAMES: Record<string, string> = {
  float: 'Float', pulse: 'Pulse', wiggle: 'Wiggle', sway: 'Sway', breathe: 'Breathe', shake: 'Shake', spin: 'Spin', heartbeat: 'Heartbeat',
  wave: 'Wave', 'letters-bounce': 'Bouncing letters', jelly: 'Jelly', flicker: 'Flicker', 'glow-pulse': 'Glow pulse',
};

/** Play the clip from `from` to `to` (seconds) once, then stop: CapCut previews an animation on click. */
let previewTimer = 0;
function previewSpan(from: number, to: number) {
  window.clearTimeout(previewTimer);
  seekTime(Math.max(0, from));
  play();
  previewTimer = window.setTimeout(pause, Math.max(250, (to - from) * 1000));
}

/**
 * CapCut's Animation tab: In / Out / Loop, each a grid of tiles. A click applies the animation and
 * plays that stretch of the clip; the slider sets its length. Text clips also get the per-word and
 * per-letter text animations.
 */
export function AnimSection({clip, update, text = false}: {clip: any; update: Update; text?: boolean}) {
  const a: Partial<ClipAnim> = clip.anim ?? {};
  const [saved, setSaved] = useState<Record<string, ClipAnim>>({});
  const [part, setPart] = useState<'in' | 'out' | 'loop'>('in');
  useEffect(() => { void loadPresets<ClipAnim>('anims').then(setSaved); }, []);
  const set = (patch: Partial<ClipAnim>, field: string) => {
    const next: any = {...a, ...patch};
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    const empty = !next.in && !next.out && !next.loop;
    const {anim: _drop, ...rest} = clip;
    update(empty ? rest : {...clip, anim: next}, `anim.${field}`);
  };
  const len = clip.to - clip.from;
  const pick = (name: string | undefined) => {
    // word / letter animations need more time than a whole-clip move to read well
    const durKey = part === 'in' ? 'inDur' : 'outDur';
    const slow = part !== 'loop' && !!name && (TEXT_IN as readonly string[]).includes(name) && a[durKey] == null;
    set({[part]: name, ...(slow ? {[durKey]: 0.8} : {})} as Partial<ClipAnim>, part);
    endGroup();
    if (!name) return;
    if (part === 'in') previewSpan(clip.from, clip.from + Math.min(len, (slow ? 0.8 : a.inDur ?? 0.35) + 0.4));
    else if (part === 'out') previewSpan(clip.to - Math.min(len, (slow ? 0.8 : a.outDur ?? 0.3) + 0.4), clip.to);
    else previewSpan(clip.from, Math.min(clip.to, clip.from + 2.5));
  };
  const keys: readonly string[] = part === 'loop' ? [...ANIM_LOOP, ...(text ? TEXT_LOOP : [])] : [...ANIM_IN, ...(text ? TEXT_IN : [])];
  const names = part === 'loop' ? LOOP_NAMES : IN_NAMES;
  const current = a[part];
  return (
    <div className="subgroup">
      <div className="seg anim-parts" role="tablist">
        {(['in', 'out', 'loop'] as const).map(k => (
          <button key={k} role="tab" aria-selected={part === k} className={`key small ${part === k ? 'lit' : ''}`} onClick={() => setPart(k)}>
            {k === 'in' ? 'In' : k === 'out' ? 'Out' : 'Loop'}{a[k] && <span className="tab-dot" aria-label="Set" />}
          </button>
        ))}
      </div>
      <div className="anim-grid">
        <button className={`anim-tile ${!current ? 'lit' : ''}`} onClick={() => pick(undefined)}>None</button>
        {keys.map(k => (
          <button key={k} className={`anim-tile ${current === k ? 'lit' : ''} ${(TEXT_IN as readonly string[]).includes(k) || (TEXT_LOOP as readonly string[]).includes(k) ? 'texty' : ''}`}
            title={`${names[k] ?? k}: click to apply and preview`} onClick={() => pick(k)}>{names[k] ?? k}</button>
        ))}
      </div>
      {part === 'in' && a.in && <SliderField label="Duration" hint="s" value={a.inDur ?? 0.35} neutral={0.35} min={0.05} max={Math.max(0.1, Math.min(5, len))} step={0.05} onChange={v => set({inDur: v}, 'inDur')} />}
      {part === 'out' && a.out && <SliderField label="Duration" hint="s" value={a.outDur ?? 0.3} neutral={0.3} min={0.05} max={Math.max(0.1, Math.min(5, len))} step={0.05} onChange={v => set({outDur: v}, 'outDur')} />}
      {part === 'loop' && a.loop && <SliderField label="Speed" value={a.loopSpeed ?? 1} neutral={1} min={0.2} max={4} step={0.1} onChange={v => set({loopSpeed: v}, 'loopSpeed')} />}
      <div className="preset-row">
        {Object.entries(saved).map(([k, p]) => (
          <span key={k} className="saved-preset">
            <button className="key small" onClick={() => { update({...clip, anim: p}, 'anim.preset'); endGroup(); }}>{k}</button>
            <button className="key small icon" aria-label={`Delete ${k}`} onClick={async () => setSaved(await savePreset<ClipAnim>('anims', k, null))}><Trash size={11} /></button>
          </span>
        ))}
        {clip.anim && <button className="key small" onClick={async () => {
          const name = prompt('Name this animation?');
          if (!name?.trim()) return;
          setSaved(await savePreset<ClipAnim>('anims', name.trim(), clip.anim));
          toast(`Saved "${name.trim()}"`);
        }}><FloppyDisk size={13} /> Save animation</button>}
      </div>
    </div>
  );
}

const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'color-dodge', 'lighten', 'darken', 'difference'];
const BLEND_NAMES: Record<string, string> = {normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', 'soft-light': 'Soft light', 'hard-light': 'Hard light', 'color-dodge': 'Color dodge', lighten: 'Lighten', darken: 'Darken', difference: 'Difference'};

export function StyleSection({clip, update}: {clip: any; update: Update}) {
  const s: ClipStyle = clip.style ?? {};
  const set = (patch: Partial<ClipStyle>, field: string) => {
    const next: any = {...s, ...patch};
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    const {style: _drop, ...rest} = clip;
    update(Object.keys(next).length ? {...clip, style: next} : rest, `style.${field}`);
  };
  return (
    <div className="subgroup">
      <div className="sub-title">Look</div>
      <SliderField label="Opacity" hint="opacity" value={s.opacity ?? 1} neutral={1} min={0} max={1} step={0.01} onChange={v => set({opacity: v}, 'opacity')} />
      <SelectField label="Blend" hint="blend" value={s.blend ?? 'normal'} options={BLENDS} labels={BLEND_NAMES} onChange={v => set({blend: v === 'normal' ? undefined : v as ClipStyle['blend']}, 'blend')} />
      <SliderField label="Corner radius" hint="px" value={s.radius ?? 0} min={0} max={200} step={1} onChange={v => set({radius: v}, 'radius')} />
      <CheckField label="Shadow" value={Boolean(s.shadow)} onChange={v => set({shadow: v ? {color: '#000000', blur: 30, y: 12, opacity: 0.5} : undefined}, 'shadow')} />
      {s.shadow && <>
        <SliderField label="Shadow blur" value={s.shadow.blur} neutral={30} min={0} max={120} step={1} onChange={v => set({shadow: {...s.shadow!, blur: v ?? 30}}, 'shadow.blur')} />
        <SliderField label="Shadow offset" value={s.shadow.y} neutral={12} min={-60} max={60} step={1} onChange={v => set({shadow: {...s.shadow!, y: v ?? 12}}, 'shadow.y')} />
        <SliderField label="Shadow opacity" value={s.shadow.opacity} neutral={0.5} min={0} max={1} step={0.01} onChange={v => set({shadow: {...s.shadow!, opacity: v ?? 0.5}}, 'shadow.opacity')} />
      </>}
      <CheckField label="Outline" value={Boolean(s.outline)} onChange={v => set({outline: v ? {color: '#ffffff', width: 6} : undefined}, 'outline')} />
      {s.outline && <div className="pair">
        <ColorField label="Outline color" value={s.outline.color} onChange={c => set({outline: {...s.outline!, color: c}}, 'outline.color')} />
        <SliderField label="Thickness" value={s.outline.width} neutral={6} min={1} max={30} step={1} onChange={v => set({outline: {...s.outline!, width: v ?? 6}}, 'outline.width')} />
      </div>}
      <CheckField label="Glow" value={Boolean(s.glow)} onChange={v => set({glow: v ? {color: '#07BFF1', size: 24} : undefined}, 'glow')} />
      {s.glow && <div className="pair">
        <ColorField label="Glow color" value={s.glow.color} onChange={c => set({glow: {...s.glow!, color: c}}, 'glow.color')} />
        <SliderField label="Size" value={s.glow.size} neutral={24} min={2} max={120} step={1} onChange={v => set({glow: {...s.glow!, size: v ?? 24}}, 'glow.size')} />
      </div>}
      <CheckField label="Behind person (needs matte)" value={Boolean(clip.behind)} onChange={v => { const {behind: _b, ...rest} = clip; update(v ? {...clip, behind: true} : rest, 'behind'); }} />
    </div>
  );
}

const SHAPES = ['rect', 'circle', 'linear', 'mirror'];
const SHAPE_NAMES: Record<string, string> = {rect: 'Rectangle', circle: 'Circle', linear: 'Linear', mirror: 'Mirror'};

export function MaskSection({clip, update}: {clip: any; update: Update}) {
  const m: Partial<ClipMask> | undefined = clip.mask;
  const set = (patch: Partial<ClipMask>, field: string) => update({...clip, mask: {...m, ...patch}}, `mask.${field}`);
  return (
    <div className="subgroup">
      <div className="sub-title" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <span>Mask</span>
        {m && <button className="key small" onClick={() => { const {mask: _m, ...rest} = clip; update(rest, 'mask'); endGroup(); }}>Remove mask</button>}
      </div>
      <div className="preset-row">
        {SHAPES.map(sh => <button key={sh} className={`key small ${m?.shape === sh ? 'lit' : ''}`} onClick={() => { set({shape: sh as ClipMask['shape'], ...(m ? {} : {x: 0.5, y: 0.5, w: 0.6, h: sh === 'linear' ? 0 : 0.6, feather: 0.04})}, 'shape'); endGroup(); }}>{SHAPE_NAMES[sh]}</button>)}
      </div>
      {m && <>
        <div className="pair">
          <SliderField label="Left/right" hint="x" value={m.x ?? 0.5} neutral={0.5} min={0} max={1} onChange={v => set({x: v ?? 0.5}, 'x')} />
          <SliderField label="Up/down" hint="y" value={m.y ?? 0.5} neutral={0.5} min={0} max={1} onChange={v => set({y: v ?? 0.5}, 'y')} />
        </div>
        {m.shape !== 'linear' && <div className="pair">
          {m.shape !== 'mirror' && <SliderField label="Width" hint="w" value={m.w ?? 0.6} neutral={0.6} min={0.02} max={1.5} onChange={v => set({w: v ?? 0.6}, 'w')} />}
          <SliderField label="Height" hint="h" value={m.h ?? 0.6} neutral={0.6} min={0.02} max={1.5} onChange={v => set({h: v ?? 0.6}, 'h')} />
        </div>}
        <SliderField label="Rotation" hint="°" value={m.rotate ?? 0} min={-180} max={180} step={1} onChange={v => set({rotate: v ?? 0}, 'rotate')} />
        <SliderField label="Feather" hint="feather" value={m.feather ?? 0.04} neutral={0.04} min={0} max={1} onChange={v => set({feather: v ?? 0.04}, 'feather')} />
        {m.shape === 'rect' && <SliderField label="Corner rounding" value={m.radius ?? 0} min={0} max={0.5} onChange={v => set({radius: v ?? 0}, 'radius')} />}
        <CheckField label="Invert (hide inside)" value={Boolean(m.invert)} onChange={v => set({invert: v}, 'invert')} />
      </>}
    </div>
  );
}

/** Outline / glow around the speaker cut-out, for the whole video. */
export function SubjectSection({doc, set}: {doc: any; set: (path: (string | number)[], value: unknown, label: string) => void}) {
  const s = doc.subject ?? {};
  const hasMatte = (doc.base ?? []).some((b: any) => b.matte);
  const put = (patch: any, label: string) => {
    const next = {...s, ...patch};
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    set(['subject'], Object.keys(next).length ? next : undefined, label);
  };
  return (
    <div className="subgroup">
      <div className="sub-title">Around the person</div>
      {!hasMatte && <p className="param-desc">Needs a matte for the main video (python tools/edit/matte.py).</p>}
      <CheckField label="Outline around person" value={Boolean(s.outline)} onChange={v => put({outline: v ? {color: '#ffffff', width: 8} : undefined}, 'subject outline')} />
      {s.outline && <div className="pair">
        <ColorField label="Color" value={s.outline.color} onChange={c => put({outline: {...s.outline, color: c}}, 'subject outline color')} />
        <SliderField label="Thickness" value={s.outline.width} neutral={8} min={1} max={40} step={1} onChange={v => put({outline: {...s.outline, width: v ?? 8}}, 'subject outline width')} />
      </div>}
      <CheckField label="Glow around person" value={Boolean(s.glow)} onChange={v => put({glow: v ? {color: doc.theme?.colors?.accent ?? '#07BFF1', size: 30} : undefined}, 'subject glow')} />
      {s.glow && <div className="pair">
        <ColorField label="Color" value={s.glow.color} onChange={c => put({glow: {...s.glow, color: c}}, 'subject glow color')} />
        <SliderField label="Size" value={s.glow.size} neutral={30} min={2} max={140} step={1} onChange={v => put({glow: {...s.glow, size: v ?? 30}}, 'subject glow size')} />
      </div>}
    </div>
  );
}
