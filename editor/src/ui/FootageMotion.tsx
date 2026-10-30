// Zoom, pan and rotate on a footage piece, edited the CapCut way: put the playhead somewhere,
// change a value, and a keyframe (◆) is set there. The values are base[i].keys in edit.json.
import React from 'react';
import {CaretLeft, CaretRight, Diamond, Trash} from '@phosphor-icons/react';
import {keyedBox} from '../../../reel/src/edit/clipfx';
import * as op from '../model/ops';
import * as ed from '../model/edits';
import type {Doc, Ref} from '../model/ops';
import {commit, currentDoc, endGroup, fps, groupOrigin, seekTime, usePlayhead} from '../store';
import {NumberField, SliderField} from './fields';

const STILL = {x: 0, y: 0, scale: 1, rotate: 0, opacity: 1};
type Field = 'scale' | 'x' | 'y' | 'rotate';
const ROWS: {f: Field; label: string; hint?: string; min: number; max: number; step: number; neutral: number}[] = [
  {f: 'scale', label: 'Zoom', hint: '×', min: 0.5, max: 3, step: 0.01, neutral: 1},
  {f: 'x', label: 'Left/right', min: -0.5, max: 0.5, step: 0.005, neutral: 0},
  {f: 'y', label: 'Up/down', min: -0.5, max: 0.5, step: 0.005, neutral: 0},
  {f: 'rotate', label: 'Rotation', hint: 'deg', min: -30, max: 30, step: 0.5, neutral: 0},
];
export const EASES: [string, string][] = [['linear', 'Linear'], ['in', 'Ease in'], ['out', 'Ease out'], ['inOut', 'Ease in and out'], ['hold', 'Hold']];

/** One-click moves like CapCut's zoom animations; each writes ordinary keyframes you can then adjust. */
const PRESETS: {label: string; hint: string; make: (t: number, len: number, z: number) => op.Key[]}[] = [
  {label: 'Quick zoom', hint: 'Punches in on the face in 0.3 s and holds', make: (t, len, z) => [{t, scale: z}, {t: Math.min(len, t + 0.3), scale: z * 1.15, ease: 'out'}]},
  {label: 'Slow zoom', hint: 'Slowly pushes in until the end of this clip', make: (t, len, z) => [{t, scale: z}, {t: len, scale: z * 1.08}]},
  {label: 'Zoom out', hint: 'Starts close and pulls back in 0.4 s', make: (t, len, z) => [{t, scale: z * 1.15}, {t: Math.min(len, t + 0.4), scale: z, ease: 'out'}]},
];

// A clip's place on screen is relative to the frame (x 1 = one frame width); it can go further.
const CLIP_ROWS: typeof ROWS = [
  {f: 'scale', label: 'Scale', hint: '×', min: 0.1, max: 4, step: 0.01, neutral: 1},
  {f: 'x', label: 'Left/right', min: -1, max: 1, step: 0.005, neutral: 0},
  {f: 'y', label: 'Up/down', min: -1, max: 1, step: 0.005, neutral: 0},
  {f: 'rotate', label: 'Rotation', hint: 'deg', min: -180, max: 180, step: 0.5, neutral: 0},
];

export const FootageMotion = ({doc, index}: {doc: Doc; index: number}) => <MotionPanel doc={doc} ref_={{kind: 'base', index}} />;

/**
 * Motion of a footage piece (zoom, pan, tilt) or a clip (place, size, tilt), one CapCut-style panel
 * for both: sliders show the value at the playhead; changing one writes a ◆ there. A clip without
 * keyframes just moves (its box), like dragging it on the monitor.
 */
export function MotionPanel({doc, ref_}: {doc: Doc; ref_: Ref}) {
  const ref = ref_;
  const piece = op.getItem(doc, ref);
  const span = op.getSpan(doc, ref);
  const frame = usePlayhead(p => p.frame);
  if (!piece || !span) return null;
  const isClip = ref.kind === 'clip';
  const rows = isClip ? CLIP_ROWS : ROWS;
  const still = isClip ? {...STILL, ...piece.box} : STILL;
  const len = span.end - span.start;
  const t = op.round(frame / fps() - span.start);
  const inside = t >= -1e-6 && t <= len + 1e-6;
  const keys: op.Key[] = piece.keys ?? [];
  const now = keyedBox(still, keys as any, Math.max(0, Math.min(len, t)));
  const here = keys.find(k => Math.abs(k.t - t) < 1 / 60);
  const label = op.refLabel(doc, ref);
  const index = ref.kind === 'base' ? ref.index : -1;

  const write = (values: Partial<op.Key>, field: string) => {
    const d = currentDoc();
    if (!d) return;
    const group = `motion:${op.refKey(ref)}:${field}`;
    const start = groupOrigin(group, d);
    if (isClip && !keys.length) {
      const item = op.getItem(start, ref);
      commit(op.replaceItem(start, ref, {...item, box: {x: 0, y: 0, scale: 1, rotate: 0, ...item.box, ...values}}), 'move', {group, change: `${label}: ${field} on screen set to ${Object.values(values)[0]}`});
      return;
    }
    if (!inside) return;
    commit(op.upsertKey(start, ref, t, values), 'keyframe', {group, change: `${label}: ${field} keyframe at +${t.toFixed(2)}s`});
  };
  const toggle = (f: Field) => {
    const d = currentDoc();
    if (!d || !inside) return;
    if (here && here[f] !== undefined) {
      const rest = Object.fromEntries(Object.entries(here).filter(([k]) => k !== f && k !== 't'));
      let next = op.removeKey(d, ref, here.t);
      if (Object.keys(rest).some(k => k !== 'ease')) next = op.upsertKey(next, ref, here.t, rest);
      commit(next, 'keyframe', {change: `${label}: removed ${f} keyframe at +${here.t.toFixed(2)}s`});
    } else {
      commit(op.upsertKey(d, ref, t, {[f]: now[f]}), 'keyframe', {change: `${label}: ${f} keyframe at +${t.toFixed(2)}s = ${now[f].toFixed(3)}`});
    }
  };
  const go = (dir: -1 | 1) => {
    const k = dir < 0 ? [...keys].reverse().find(x => x.t < t - 1 / 60) : keys.find(x => x.t > t + 1 / 60);
    if (k) seekTime(span.start + k.t);
  };
  const preset = (p: (typeof PRESETS)[number]) => {
    const d = currentDoc();
    if (!d || !inside) return;
    let next = d;
    for (const k of p.make(t, len, now.scale)) next = op.upsertKey(next, ref, k.t, {scale: k.scale, ease: k.ease as op.Key['ease']});
    commit(next, 'keyframe', {change: `${label}: "${p.label}" at +${t.toFixed(2)}s`});
  };

  return (
    <div className="subgroup motion">
      <div className="sub-title motion-head">
        <span>{isClip ? 'Position & motion' : 'Motion & zoom'}</span>
        <span className="key-nav">
          <button className="key small icon" title="Previous keyframe" aria-label="Previous keyframe" onClick={() => go(-1)} disabled={!keys.some(k => k.t < t - 1 / 60)}><CaretLeft size={12} /></button>
          <span className="mono key-count" title="Keyframe count">{keys.length}</span>
          <button className="key small icon" title="Next keyframe" aria-label="Next keyframe" onClick={() => go(1)} disabled={!keys.some(k => k.t > t + 1 / 60)}><CaretRight size={12} /></button>
        </span>
      </div>
      {!inside && <div className="outside-note"><span>Playhead is outside this {isClip ? 'clip' : 'segment'}.</span><button className="key small" onClick={() => seekTime(span.start + Math.min(0.5, len / 2))}>Go to it</button></div>}
      {rows.map(r => (
        <div key={r.f} className="motion-row">
          <SliderField label={r.label} hint={r.hint} value={now[r.f]} neutral={r.neutral} min={r.min} max={r.max} step={r.step}
            onChange={v => write({[r.f]: v ?? r.neutral}, r.f)} />
          <button className={`kf-toggle ${here?.[r.f] !== undefined ? 'on' : keys.some(k => k[r.f] !== undefined) ? 'has' : ''}`} disabled={!inside}
            title={here?.[r.f] !== undefined ? 'Remove this keyframe' : 'Add keyframe here'} aria-label={`keyframe ${r.label}`} aria-pressed={here?.[r.f] !== undefined}
            onClick={() => { toggle(r.f); endGroup(); }}><Diamond size={12} weight={here?.[r.f] !== undefined ? 'fill' : 'regular'} /></button>
        </div>
      ))}
      {here && (
        <label className="field">
          <span>Easing up to this ◆</span>
          <select value={here.ease ?? 'linear'} onChange={e => { const d = currentDoc(); if (d) commit(op.upsertKey(d, ref, here.t, {ease: (e.target.value === 'linear' ? undefined : e.target.value) as op.Key['ease']}), 'keyframe', {change: `${label}: keyframe +${here.t.toFixed(2)}s ease ${e.target.value}`}); }}>
            {EASES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
          </select>
        </label>
      )}
      {!isClip && <SmoothZoomBox disabled={!inside} onApply={z => { const d = currentDoc(); if (d && inside) commit(ed.smoothZoom(d, index, t, z), 'keyframe', {change: `${label}: smooth zoom ${z.amount}x at +${t.toFixed(2)}s (in ${z.inDur}s, hold ${z.hold}s, out ${z.outDur}s)`}); }} />}
      <div className="preset-row">
        {!isClip && PRESETS.map(p => <button key={p.label} className="key small" title={p.hint} disabled={!inside} onClick={() => preset(p)}>{p.label}</button>)}
        {keys.length > 0 && <button className="key small" title="Delete all motion of this segment" onClick={() => { const d = currentDoc(); if (d) commit(op.replaceItem(d, ref, (({keys: _k, ...rest}) => rest)(piece)), 'keyframe', {change: `${label}: removed all motion keyframes`}); }}><Trash size={12} /> Delete motion</button>}
      </div>
      <p className="param-desc">{isClip && !keys.length ? 'Change the position here or drag the clip on screen. To animate over time, press ◆, then move the playhead and change it.' : 'Place the playhead and change any value; a ◆ is added automatically. On the timeline, drag a ◆ to change its time.'}</p>
    </div>
  );
}

const ZOOM_KEY = 'studio-editor:smooth-zoom';
/** The owner's last smooth-zoom settings (used by the timeline's right-click too). */
export const savedSmoothZoom = (): ed.SmoothZoom => { try { return {...ed.SMOOTH_ZOOM, ...JSON.parse(localStorage.getItem(ZOOM_KEY) ?? '{}')}; } catch { return ed.SMOOTH_ZOOM; } };
const SHAPES: [ed.SmoothZoom['ease'], string][] = [['inOut', 'Smooth'], ['out', 'Quick then settle'], ['linear', 'Linear']];

/** The smooth zoom: glides in, holds, glides back out. The last settings are remembered. */
function SmoothZoomBox({disabled, onApply}: {disabled: boolean; onApply: (z: ed.SmoothZoom) => void}) {
  const [z, setZ] = React.useState<ed.SmoothZoom>(savedSmoothZoom);
  const set = (patch: Partial<ed.SmoothZoom>) => setZ(cur => { const n = {...cur, ...patch}; try { localStorage.setItem(ZOOM_KEY, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  return (
    <div className="smooth-zoom">
      <div className="sz-head">
        <b>Smooth zoom in and out</b>
        <button className="key small lit" disabled={disabled} onClick={() => onApply(z)} title="From the playhead">Place here</button>
      </div>
      <SliderField label="Zoom amount" hint="×" value={z.amount} neutral={1} min={1.02} max={1.6} step={0.01} onChange={v => set({amount: v ?? 1.15})} />
      <div className="pair three">
        <NumberField label="Zoom in over" hint="s" value={z.inDur} min={0.05} max={5} step={0.05} onChange={v => v != null && set({inDur: v})} />
        <NumberField label="Hold" hint="s" value={z.hold} min={0} max={30} step={0.1} onChange={v => v != null && set({hold: v})} />
        <NumberField label="Zoom out over" hint="s" value={z.outDur} min={0.05} max={5} step={0.05} onChange={v => v != null && set({outDur: v})} />
      </div>
      <div className="seg sz-shape" role="group" aria-label="Easing">
        {SHAPES.map(([k, n]) => <button key={k} className={`key small ${z.ease === k ? 'lit' : ''}`} aria-pressed={z.ease === k} onClick={() => set({ease: k})}>{n}</button>)}
      </div>
    </div>
  );
}
