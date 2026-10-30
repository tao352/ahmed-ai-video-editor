// Library > Transition (CapCut): the 20 cut transitions as tiles that play on hover. Click one to watch
// it large on two real frames from your footage (the cut nearest the playhead); drag it onto a cut on
// the main track, or press + to put it on the nearest cut. The same style functions draw the render.
import React, {useEffect, useMemo, useState} from 'react';
import {Plus} from '@phosphor-icons/react';
import {CUT_DEFAULT_DURATION, CUT_TRANSITIONS, cutOverlay, cutStyle} from '../../../reel/src/edit/cutTransitions';
import * as op from '../model/ops';
import {commit, currentDoc, endGroup, nowTime, toast, useDoc, useEditor, usePlayhead, fps, type Thumbs} from '../store';

export const TRANS_MIME = 'application/x-studio-transition';

/** Put a transition on the footage cut nearest t (within `within` s); false when there is none. */
export function addTransitionAt(type: string, t: number, within = Infinity): boolean {
  const d = currentDoc();
  if (!d) return false;
  const cut = op.nearestCut(d, t, within);
  if (cut == null) {
    toast(op.cutTimes(d).length ? 'Drop it on a cut between two video pieces.' : 'There is no cut in the video yet: split it first (S).', 'error');
    return false;
  }
  const name = CUT_TRANSITIONS.find(([k]) => k === type)?.[1] ?? type;
  const r = op.setCutTransition(d, cut, type, CUT_DEFAULT_DURATION);
  commit(r.doc, 'transition', {change: `put a ${name} transition on the cut at ${cut.toFixed(2)}s`, selection: [{kind: 'transition', index: r.index}]});
  endGroup();
  return true;
}

// one cycle: the outgoing shot, the transition, the incoming shot
const HOLD = 0.35, RUN = 0.8, CYCLE = HOLD * 2 + RUN;
function useCycle(on: boolean): number {
  const [p, setP] = useState(0);
  useEffect(() => {
    if (!on) { setP(0); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const s = ((now - t0) / 1000) % CYCLE;
      setP(Math.max(0, Math.min(1, (s - HOLD) / RUN)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);
  return p;
}

type Frame = React.CSSProperties;
/** A frame from the timeline thumbnail sprite as a CSS background, or a plain swatch. */
export function frameAt(thumbs: Thumbs | undefined, sec: number, fallback: string): Frame {
  if (!thumbs) return {background: fallback};
  const i = Math.max(0, Math.min(thumbs.count - 1, Math.floor(sec / thumbs.every)));
  const col = i % thumbs.cols, row = Math.floor(i / thumbs.cols);
  const rows = Math.ceil(thumbs.count / thumbs.cols);
  return {
    backgroundImage: `url("${(window as any).remotion_staticBase}/${thumbs.sprite}")`,
    backgroundSize: `${thumbs.cols * 100}% ${rows * 100}%`,
    backgroundPosition: `${thumbs.cols > 1 ? (col / (thumbs.cols - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`,
  };
}

function Stage({type, p, a, b, label}: {type: string; p: number; a: Frame; b: Frame; label?: boolean}) {
  const over = cutOverlay(type, p);
  return (
    <div className="trans-stage">
      <div className="trans-shot" style={{...a, ...cutStyle(type, p, 'out')}}>{label && <span>A</span>}</div>
      <div className="trans-shot" style={{...b, ...cutStyle(type, p, 'in')}}>{label && <span>B</span>}</div>
      {over && <div className="trans-over" style={over} />}
    </div>
  );
}

function Tile({type, name, a, b, picked, onPick}: {type: string; name: string; a: Frame; b: Frame; picked: boolean; onPick: () => void}) {
  const [hover, setHover] = useState(false);
  const p = useCycle(hover);
  return (
    <div className={`tile trans-tile ${picked ? 'lit' : ''}`} draggable role="button" tabIndex={0} title={`${name}: click to preview, drag onto a cut`}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} onClick={onPick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }}
      onDragStart={e => { e.dataTransfer.setData(TRANS_MIME, type); e.dataTransfer.effectAllowed = 'copy'; }}>
      <Stage type={type} p={hover ? p : 0.5} a={a} b={b} />
      <span>{name}</span>
      <button className="key small icon" aria-label={`Add ${name} on the nearest cut`} onClick={e => { e.stopPropagation(); addTransitionAt(type, nowTime()); }}><Plus size={14} /></button>
    </div>
  );
}

export function TransitionsBank() {
  const doc = useDoc('panel');
  const thumbs = useEditor(s => s.thumbs);
  const second = usePlayhead(s => Math.floor(s.frame / fps()));
  const [picked, setPicked] = useState<string>('mix');
  const p = useCycle(true);
  // two real frames around the cut nearest the playhead: the end of the outgoing piece, the start of the next
  const [a, b] = useMemo<[Frame, Frame]>(() => {
    const fallbackA = 'linear-gradient(135deg,#23414a,#0f1d22)', fallbackB = 'linear-gradient(135deg,#6b4a1f,#2b1d0b)';
    if (!doc) return [{background: fallbackA}, {background: fallbackB}];
    const cut = op.nearestCut(doc, second);
    const pieces = op.bases(doc).map((x, i) => ({x, s: op.getSpan(doc, {kind: 'base', index: i})!})).sort((m, n) => m.s.start - n.s.start);
    const j = cut == null ? -1 : pieces.findIndex(q => Math.abs(q.s.start - cut) < 1e-3);
    if (j < 1) return [{background: fallbackA}, {background: fallbackB}];
    const A = pieces[j - 1], B = pieces[j];
    const at = (q: typeof A, local: number) => (q.x.sourceIn ?? 0) + local * (q.x.speed ?? 1);
    return [
      frameAt(thumbs[A.x.src], at(A, Math.max(0, A.s.end - A.s.start - 0.5)), fallbackA),
      frameAt(thumbs[B.x.src], at(B, 0.3), fallbackB),
    ];
  }, [doc, thumbs, second]);
  const name = CUT_TRANSITIONS.find(([k]) => k === picked)?.[1] ?? picked;
  const aspect = doc ? `${doc.settings.width} / ${doc.settings.height}` : '9 / 16';
  return <>
    <div className="trans-preview">
      <div style={{aspectRatio: aspect}} className="trans-preview-box"><Stage type={picked} p={p} a={a} b={b} label /></div>
      <div className="trans-preview-side">
        <b>{name}</b>
        <p className="hint">Drag a tile onto a cut on the main track. Preview uses the cut nearest the playhead.</p>
        <button className="key small" onClick={() => addTransitionAt(picked, nowTime())}><Plus size={13} /> Nearest cut</button>
        <button className="key small" onClick={() => {
          const d = currentDoc();
          if (!d || !op.cutTimes(d).length) { toast('There is no cut in the video yet: split it first (S).', 'error'); return; }
          commit(op.transitionOnAllCuts(d, picked, CUT_DEFAULT_DURATION), 'transition', {change: `put a ${name} transition on all ${op.cutTimes(d).length} cuts`});
          endGroup();
        }}>Apply to all cuts</button>
      </div>
    </div>
    <div className="tile-grid trans-grid">
      {CUT_TRANSITIONS.map(([k, n]) => <Tile key={k} type={k} name={n} a={a} b={b} picked={k === picked} onPick={() => setPicked(k)} />)}
    </div>
  </>;
}
