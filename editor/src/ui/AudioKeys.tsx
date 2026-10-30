// Volume keyframes on music or a sound (CapCut's volume ◆): put the playhead, set the level,
// and a keyframe is placed there. Stored as `keys: [{t, volume, ease}]` on the sound.
import React from 'react';
import {CaretLeft, CaretRight, Diamond, Trash} from '@phosphor-icons/react';
import {volumeAt} from '../../../reel/src/edit/audioMix';
import * as op from '../model/ops';
import type {Doc, Ref} from '../model/ops';
import {commit, currentDoc, endGroup, fps, groupOrigin, seekTime, usePlayhead} from '../store';
import {SliderField} from './fields';
import {EASES} from './FootageMotion';

export function AudioKeys({doc, ref_}: {doc: Doc; ref_: Ref}) {
  const frame = usePlayhead(p => p.frame);
  const span = op.getSpan(doc, ref_);
  if (!span) return null;
  const len = span.end - span.start;
  const t = op.round(frame / fps() - span.start);
  const inside = t >= -1e-6 && t <= len + 1e-6;
  const keys = op.keysOf(doc, ref_);
  const now = volumeAt(keys as any, Math.max(0, Math.min(len, t)));
  const here = keys.find(k => Math.abs(k.t - t) < 1 / 60);
  const label = op.refLabel(doc, ref_);
  const write = (v: number) => {
    const d = currentDoc();
    if (!d || !inside) return;
    const group = `vol-key:${op.refKey(ref_)}`;
    commit(op.upsertKey(groupOrigin(group, d), ref_, t, {volume: v} as any), 'volume key', {group, change: `${label}: volume keyframe at +${t.toFixed(2)}s = ${v}`});
  };
  const toggle = () => {
    const d = currentDoc();
    if (!d || !inside) return;
    commit(here ? op.removeKey(d, ref_, here.t) : op.upsertKey(d, ref_, t, {volume: op.round(now)} as any), 'volume key',
      {change: `${label}: ${here ? 'removed' : 'added'} volume keyframe at +${t.toFixed(2)}s`});
    endGroup();
  };
  const go = (dir: -1 | 1) => {
    const k = dir < 0 ? [...keys].reverse().find(x => x.t < t - 1 / 60) : keys.find(x => x.t > t + 1 / 60);
    if (k) seekTime(span.start + k.t);
  };
  return (
    <div className="subgroup motion">
      <div className="sub-title motion-head">
        <span>Volume over time</span>
        <span className="key-nav">
          <button className="key small icon" title="Previous keyframe" aria-label="Previous keyframe" onClick={() => go(-1)} disabled={!keys.some(k => k.t < t - 1 / 60)}><CaretLeft size={12} /></button>
          <span className="mono key-count">{keys.length}</span>
          <button className="key small icon" title="Next keyframe" aria-label="Next keyframe" onClick={() => go(1)} disabled={!keys.some(k => k.t > t + 1 / 60)}><CaretRight size={12} /></button>
        </span>
      </div>
      {!inside && <p className="param-desc">Place the playhead inside this sound to raise or lower the volume at a specific moment.</p>}
      <div className="motion-row">
        <SliderField label="Volume here" hint="×" value={now} neutral={1} min={0} max={2} step={0.01} onChange={v => write(v ?? 1)} />
        <button className={`kf-toggle ${here ? 'on' : keys.length ? 'has' : ''}`} disabled={!inside} aria-pressed={!!here} aria-label="Volume keyframe"
          title={here ? 'Remove this keyframe' : 'Add keyframe here'} onClick={toggle}><Diamond size={12} weight={here ? 'fill' : 'regular'} /></button>
      </div>
      {here && (
        <label className="field">
          <span>Easing up to this ◆</span>
          <select value={here.ease ?? 'linear'} onChange={e => { const d = currentDoc(); if (d) commit(op.upsertKey(d, ref_, here.t, {ease: (e.target.value === 'linear' ? undefined : e.target.value) as op.Key['ease']}), 'volume key', {change: `${label}: volume keyframe +${here.t.toFixed(2)}s ease ${e.target.value}`}); }}>
            {EASES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
          </select>
        </label>
      )}
      {keys.length > 0 && <button className="key small" onClick={() => { const d = currentDoc(); if (d) commit(op.replaceItem(d, ref_, (({keys: _k, ...rest}) => rest)(op.getItem(d, ref_))), 'volume key', {change: `${label}: removed all volume keyframes`}); }}><Trash size={12} /> Delete keyframes</button>}
      <p className="param-desc">Like CapCut: the volume is multiplied by this value at each moment (1 = unchanged). The ◆ marks show on the sound in the timeline and can be dragged.</p>
    </div>
  );
}
