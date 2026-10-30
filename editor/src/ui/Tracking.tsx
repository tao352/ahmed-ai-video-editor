// CapCut's Tracking and Stabilize, done offline by tools/track/track.py (SAM2 outlines, plane / object /
// face tracking, stabilization) and played back by reel/src/edit/tracking.ts.
// Footage piece > Tracking: pick a target on the player (drag a box, or click a face), check the outline,
// Track; then put a highlight or a label on the track in one click. Clip > Tracking: follow a track.
// Footage piece > Video > Stabilize: Light / Normal / Max, or lock on a tracked target.
import React, {useEffect, useState, useSyncExternalStore} from 'react';
import {Crosshair, Polygon, Smiley, Cube, Tag, Stop, Trash, Play} from '@phosphor-icons/react';
import * as op from '../model/ops';
import type {Doc} from '../model/ops';
import {apply, inv, pieceFor, shapeAtAnchor, sourceToComp, forgetTrack, type TrackFile} from '../../../reel/src/edit/tracking';
import {commit, createStore, currentDoc, editor, endGroup, nowTime, pause, seekTime, toast, useEditor} from '../store';

const enc = encodeURIComponent;
const project = () => editor.get().projectId ?? '';
type Pt = [number, number];

export type TrackInfo = {file: string; kind: string; src: string; anchor: number; start: number; end: number; shape: Pt[]; width: number; height: number;
  zoom?: number; meanConf: number; preview?: string};
export type TargetKind = 'plane' | 'object' | 'face';
const KIND_NAMES: Record<string, string> = {plane: 'Surface', object: 'Object', face: 'Face', stabilize: 'Stabilize'};
const KIND_HINT: Record<TargetKind, string> = {
  plane: 'A flat surface seen in perspective: roof, plot of land, wall, screen, sign. Best for drone and real estate shots.',
  object: 'Anything that moves or changes shape: a person, a car, a product. Follows its outline every frame.',
  face: 'A face: position, size and head tilt. Click the face to pick one when there are several.',
};

// ---------- shared state: tracks of the project, the running job, the pick on the player ----------
type JobState = {tool: string; label: string; progress: number; running: boolean} | null;
type Pick = {kind: TargetKind; base: number; t: number; box?: [number, number, number, number]; point?: Pt; shape?: Pt[]; score?: number; busy?: boolean} | null;
const state = createStore<{tracks: TrackInfo[]; job: JobState; pick: Pick; loaded: string}>({tracks: [], job: null, pick: null, loaded: ''});
const useTrackState = <T,>(f: (s: ReturnType<typeof state.get>) => T) => useSyncExternalStore(state.subscribe, () => f(state.get()));

export async function refreshTracks() {
  const id = project();
  if (!id) return;
  const r = await fetch(`/api/tracks?id=${enc(id)}`);
  state.set(s => ({...s, loaded: id}));
  if (r.ok) { const tracks = await r.json() as TrackInfo[]; state.set(s => ({...s, tracks})); }
}
export function useProjectTracks(): TrackInfo[] {
  const id = useEditor(s => s.projectId);
  const tracks = useTrackState(s => s.tracks), loaded = useTrackState(s => s.loaded);
  useEffect(() => { if (id && loaded !== id) void refreshTracks(); }, [id, loaded]);
  return tracks;
}

/** Run a tracking job on the server, showing its progress in the panel. Returns its RESULT or null. */
async function runJob<T = any>(tool: string, body: Record<string, unknown>, label: string): Promise<T | null> {
  const r = await fetch(`/api/tool?id=${enc(project())}&tool=${tool}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  if (!r.ok) { toast((await r.json().catch(() => ({}))).error ?? `${label}: failed`, 'error', 5000); return null; }
  state.set(s => ({...s, job: {tool, label, progress: 0, running: true}}));
  try {
    for (;;) {
      await new Promise(res => setTimeout(res, 500));
      const j = await (await fetch('/api/tool')).json();
      if (!j || j.status === 'running') { state.set(s => ({...s, job: s.job && {...s.job, progress: j?.progress ?? s.job.progress}})); continue; }
      if (j.status === 'done') return j.result as T;
      const last = String(j.log?.at(-1) ?? 'failed');
      if (last !== 'stopped') toast(`${label}: ${last.slice(0, 180)}`, 'error', 8000);
      return null;
    }
  } finally {
    state.set(s => ({...s, job: null}));
  }
}
const stopJob = () => fetch('/api/tool', {method: 'DELETE'});

// ---------- coordinates: composition px <-> normalized source of a footage piece ----------
const media = new Map<string, Promise<{width: number; height: number} | null>>();
function sourceSize(src: string) {
  let p = media.get(src);
  if (!p) {
    p = fetch(`/api/media?id=${enc(project())}`).then(r => r.json()).then((list: any[]) => {
      const m = list.find(x => x.path === src);
      return m?.width ? {width: m.width, height: m.height} : null;
    }).catch(() => null);
    media.set(src, p);
  }
  return p;
}
const asData = (doc: Doc) => ({...doc, zooms: doc.zooms ?? [], layout: {...(doc.layout ?? {})}}) as any;
function compToSource(doc: Doc, base: number, t: number, size: {width: number; height: number}): (p: Pt) => Pt {
  const W = doc.settings.width, H = doc.settings.height, b = doc.base[base];
  const m = inv(sourceToComp(asData(doc), b, t, W, H, size.width, size.height));
  return p => { const [x, y] = apply(m, p); return [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))]; };
}
function sourceToCompFn(doc: Doc, base: number, t: number, size: {width: number; height: number}): (p: Pt) => Pt {
  const W = doc.settings.width, H = doc.settings.height;
  const m = sourceToComp(asData(doc), doc.base[base], t, W, H, size.width, size.height);
  return p => apply(m, p);
}
/** Source time the piece shows at composition time t. */
const sourceAt = (doc: Doc, base: number, t: number) => { const b = doc.base[base]; return (b.sourceIn ?? 0) + Math.max(0, t - (b.start ?? 0)) * (b.speed ?? 1); };
/** Composition time a piece shows a source time (clamped to the piece). */
function compAt(doc: Doc, src: string, s: number): number {
  const b = pieceFor(asData(doc), src, 0);
  if (!b) return 0;
  const len = b.duration ?? Math.max(0, doc.settings.duration - b.start);
  return Math.max(b.start, Math.min(b.start + len, b.start + (s - (b.sourceIn ?? 0)) / (b.speed ?? 1)));
}

// ---------- the pick on the player (rendered inside Stage) ----------
export function TrackPicker({screenRef}: {screenRef: React.RefObject<HTMLDivElement | null>}) {
  const pick = useTrackState(s => s.pick);
  const [drag, setDrag] = useState<{x0: number; y0: number; x1: number; y1: number} | null>(null);
  const [, bump] = useState(0);
  useEffect(() => {
    const el = screenRef.current;
    if (!el || !pick) return;
    const ro = new ResizeObserver(() => bump(n => n + 1));
    ro.observe(el);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); state.set(s => ({...s, pick: null})); } };
    window.addEventListener('keydown', key, true);
    return () => { ro.disconnect(); window.removeEventListener('keydown', key, true); };
  }, [pick, screenRef]);
  const doc = currentDoc();
  if (!pick || !doc) return null;
  const el = screenRef.current, box = el?.getBoundingClientRect();
  if (!box) return null;
  const k = box.width / doc.settings.width;
  const local = (e: React.PointerEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as Pt; };
  const toComp = ([x, y]: Pt): Pt => [x / k, y / k];
  const finish = async (b: {x0: number; y0: number; x1: number; y1: number}) => {
    setDrag(null);
    const size = await sourceSize(doc.base[pick.base].src);
    if (!size) { toast('Could not read the video size.', 'error'); return; }
    const toSrc = compToSource(doc, pick.base, pick.t, size);
    const small = Math.abs(b.x1 - b.x0) < 6 && Math.abs(b.y1 - b.y0) < 6;
    const a = toSrc(toComp([Math.min(b.x0, b.x1), Math.min(b.y0, b.y1)])), c = toSrc(toComp([Math.max(b.x0, b.x1), Math.max(b.y0, b.y1)]));
    const point = toSrc(toComp([b.x0, b.y0]));
    if (pick.kind === 'face') { state.set(s => ({...s, pick: s.pick && {...s.pick, point, shape: undefined}})); return; }
    const at = sourceAt(doc, pick.base, pick.t);
    state.set(s => ({...s, pick: s.pick && {...s.pick, busy: true, box: small ? undefined : [a[0], a[1], c[0], c[1]], point: small ? point : undefined}}));
    const res = await runJob<{shape: Pt[]; score: number; box: [number, number, number, number]}>('track-segment',
      {video: doc.base[pick.base].src, at, ...(small ? {point} : {box: [a, c]})}, 'Finding the outline');
    state.set(s => ({...s, pick: s.pick && {...s.pick, busy: false, ...(res ? {shape: res.shape, score: res.score, box: res.box} : {})}}));
  };
  // outline found by SAM2 -> screen
  const size = media.get(doc.base[pick.base].src);
  return <div className="track-pick" onPointerDown={e => { e.stopPropagation(); e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); const [x, y] = local(e); setDrag({x0: x, y0: y, x1: x, y1: y}); }}
    onPointerMove={e => { if (!drag) return; const [x, y] = local(e); setDrag({...drag, x1: x, y1: y}); }}
    onPointerUp={e => { e.stopPropagation(); if (drag) void finish(drag); }} onDoubleClick={e => e.stopPropagation()}>
    {drag && <div className="track-pick-box" style={{left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0)}} />}
    <PickOutline pick={pick} doc={doc} k={k} size={size} />
    <div className="track-pick-hint">{pick.busy ? 'Finding the outline…' : pick.kind === 'face' ? (pick.point ? 'Face picked. Press Track in Properties.' : 'Click the face to follow (or press Track for the biggest face)') : pick.shape ? 'Outline found. Press Track, or drag again to redo.' : 'Drag a box around what to follow, or click on it'} · Esc to cancel</div>
  </div>;
}

function PickOutline({pick, doc, k, size}: {pick: NonNullable<Pick>; doc: Doc; k: number; size?: Promise<{width: number; height: number} | null>}) {
  const [dims, setDims] = useState<{width: number; height: number} | null>(null);
  useEffect(() => { let live = true; void size?.then(d => { if (live) setDims(d); }); return () => { live = false; }; }, [size]);
  if (!dims) return null;
  const toComp = sourceToCompFn(doc, pick.base, pick.t, dims);
  const pts = pick.shape?.map(p => toComp(p).map(v => v * k).join(',')).join(' ');
  const pt = pick.kind === 'face' && pick.point ? toComp(pick.point).map(v => v * k) : null;
  return <svg className="track-pick-svg">
    {pts && <polygon points={pts} />}
    {pt && <circle cx={pt[0]} cy={pt[1]} r={10} />}
  </svg>;
}

// ---------- footage piece > Tracking ----------
export function TrackingSection({doc, index}: {doc: Doc; index: number}) {
  const tracks = useProjectTracks();
  const job = useTrackState(s => s.job), pick = useTrackState(s => s.pick);
  const piece = doc.base[index];
  const [kind, setKind] = useState<TargetKind>('plane');
  const mine = tracks.filter(t => t.src === piece.src && t.kind !== 'stabilize');
  const picking = pick?.base === index;
  const startPick = (k: TargetKind) => { pause(); setKind(k); state.set(s => ({...s, pick: {kind: k, base: index, t: nowTime()}})); };
  const track = async () => {
    const p = state.get().pick;
    if (!p) return;
    const at = sourceAt(doc, index, p.t);
    const len = piece.duration ?? doc.settings.duration - piece.start;
    const from = piece.sourceIn ?? 0, to = from + len * (piece.speed ?? 1);
    const name = `${p.kind}-${String(piece.src).split('/').pop()?.replace(/\.\w+$/, '')}`;
    const body: Record<string, unknown> = {video: piece.src, at, from, to, name};
    if (p.kind === 'plane') { if (!p.shape && !p.box) return toast('Drag a box around the surface first.', 'error'); body.shape = p.shape ?? boxShape(p.box!); }
    if (p.kind === 'object') { if (!p.box) return toast('Drag a box around the object first.', 'error'); body.box = [[p.box[0], p.box[1]], [p.box[2], p.box[3]]]; }
    if (p.kind === 'face' && p.point) body.point = p.point;
    state.set(s => ({...s, pick: null}));
    const res = await runJob<{track: string; meanConf: number; lost: [number, number][]}>(`track-${p.kind}`, body, `Tracking the ${KIND_NAMES[p.kind].toLowerCase()}`);
    if (!res) return;
    forgetTrack(res.track);
    await refreshTracks();
    toast(res.lost.length ? `Tracked. Lost for a moment at ${res.lost.map(([a]) => `${a.toFixed(1)}s`).join(', ')}: the overlay holds still there.` : 'Tracked through the whole piece.', 'info', 5000);
  };
  return <div className="subgroup tracking">
    <div className="sub-title">Follow something in this video</div>
    <div className="chip-grid track-kinds">
      {(['plane', 'object', 'face'] as TargetKind[]).map(k => <button key={k} className={`key small ${kind === k ? 'lit' : ''}`} aria-pressed={kind === k} onClick={() => { setKind(k); if (picking) startPick(k); }}>
        {k === 'plane' ? <Polygon size={14} /> : k === 'object' ? <Cube size={14} /> : <Smiley size={14} />} {KIND_NAMES[k]}</button>)}
    </div>
    <p className="param-desc">{KIND_HINT[kind]}</p>
    {job ? <JobBar job={job} />
      : picking
        ? <div className="preset-row">
            <button className="key small lit" onClick={() => void track()} disabled={pick?.busy || (kind !== 'face' && !pick?.shape && !pick?.box)}><Crosshair size={14} /> Track</button>
            <button className="key small" onClick={() => state.set(s => ({...s, pick: null}))}>Cancel</button>
            {pick?.score != null && <span className="hint">outline {Math.round(pick.score * 100)}%</span>}
          </div>
        : <button className="key small" onClick={() => startPick(kind)}><Crosshair size={14} /> Pick on the player</button>}
    {mine.length > 0 && <>
      <div className="sub-title">Tracks</div>
      <ul className="track-list">{mine.map(t => <TrackRow key={t.file} t={t} doc={doc} />)}</ul>
    </>}
  </div>;
}
const boxShape = ([x0, y0, x1, y1]: [number, number, number, number]): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function JobBar({job}: {job: NonNullable<JobState>}) {
  return <div className="job-bar" role="status">
    <div className="job-bar-text"><span>{job.label}…</span><span>{Math.round(job.progress * 100)}%</span></div>
    <div className="job-bar-track"><div className="job-bar-fill" style={{width: `${Math.max(3, job.progress * 100)}%`}} /></div>
    <button className="key small" onClick={() => void stopJob()}><Stop size={13} /> Stop</button>
  </div>;
}

/** Where the track's shape sits in the composition at its anchor, as fractions of the frame. */
function anchorShape(doc: Doc, t: TrackInfo): Pt[] {
  const tf = {...t, frames: [], version: 1, fps: 30} as unknown as TrackFile;
  return shapeAtAnchor(asData(doc), tf, doc.settings.width, doc.settings.height).map(([x, y]) => [op.round(x / doc.settings.width), op.round(y / doc.settings.height)] as Pt);
}
const trackSpan = (doc: Doc, t: TrackInfo) => [compAt(doc, t.src, t.start), compAt(doc, t.src, t.end)] as const;

function TrackRow({t, doc}: {t: TrackInfo; doc: Doc}) {
  const [a, b] = trackSpan(doc, t);
  const anchorT = compAt(doc, t.src, t.anchor);
  const followers = op.clips(doc).filter(c => c.follow?.track === t.file).length;
  const add = (what: 'highlight' | 'label') => {
    const d = currentDoc();
    if (!d) return;
    const shape = anchorShape(d, t);
    const top = shape.reduce((m, p) => (p[1] < m[1] ? p : m), shape[0]);
    const cx = shape.reduce((s, p) => s + p[0], 0) / shape.length;
    const r = what === 'highlight'
      ? op.addTrackedClip(d, 'Highlight', a, b, {points: shape, smooth: shape.length > 6}, {track: t.file, mode: t.kind === 'plane' ? 'perspective' : 'transform'})
      : op.addTrackedClip(d, 'Callout', Math.min(b, a + 0.3), b, {text: 'Label', point: [op.round(cx), top[1]], lift: 0.1, size: Math.round(d.settings.height * 0.04)},
        {track: t.file, mode: 'position', point: [cx * d.settings.width, top[1] * d.settings.height]});
    commit(r.doc, 'add', {change: `added ${what} ${r.id} on track ${t.file}`, selection: [{kind: 'clip', id: r.id}]});
    endGroup();
  };
  return <li className="track-row">
    <div className="track-row-head">
      <b>{KIND_NAMES[t.kind] ?? t.kind}</b>
      <span className="hint">{a.toFixed(1)}–{b.toFixed(1)}s · {Math.round(t.meanConf * 100)}% sure{followers ? ` · ${followers} following` : ''}</span>
    </div>
    <div className="preset-row">
      <button className="key small" onClick={() => add('highlight')}><Polygon size={13} /> Highlight</button>
      <button className="key small" onClick={() => add('label')}><Tag size={13} /> Label</button>
      <button className="key small icon" title="Go to the frame it was picked on" aria-label="Go to the anchor frame" onClick={() => seekTime(anchorT)}><Crosshair size={13} /></button>
      {t.preview && <a className="key small icon" title="Watch the tracking check video" aria-label="Watch the tracking check video" target="_blank" rel="noreferrer"
        href={`/api/file?id=${enc(project())}&path=${enc(t.preview)}`}><Play size={13} /></a>}
    </div>
  </li>;
}

// ---------- clip > Tracking: follow a track ----------
const MODES: [NonNullable<op.Follow['mode']>, string, string][] = [
  ['perspective', 'Pin to surface', 'Sticks on the surface with its perspective (outlines, logos on walls, screens)'],
  ['transform', 'Move, scale, turn', 'Moves, grows and turns with the target, stays flat'],
  ['position', 'Move only', 'Only moves with the target: labels stay upright and the same size'],
];
export function FollowSection({doc, clip}: {doc: Doc; clip: any}) {
  const tracks = useProjectTracks().filter(t => t.kind !== 'stabilize');
  const f = clip.follow as op.Follow | undefined;
  const set = (next: op.Follow | null, change: string) => { const d = currentDoc(); if (d) { commit(op.setFollow(d, clip.id, next), 'follow', {change}); endGroup(); } };
  const current = tracks.find(t => t.file === f?.track);
  return <div className="subgroup">
    <div className="sub-title">Follow a track</div>
    {!tracks.length && <p className="param-desc">No tracks yet. Select the video on the main track, open Tracking and pick what to follow.</p>}
    {tracks.length > 0 && <>
      <div className="track-list">
        {tracks.map(t => <button key={t.file} className={`key small track-pick-row ${f?.track === t.file ? 'lit' : ''}`} aria-pressed={f?.track === t.file}
          onClick={() => set(f?.track === t.file ? null : {track: t.file, mode: f?.mode ?? (t.kind === 'plane' ? 'perspective' : 'transform')}, f?.track === t.file ? `${clip.id} stops following` : `${clip.id} follows ${t.file}`)}>
          {KIND_NAMES[t.kind] ?? t.kind} · {trackSpan(doc, t)[0].toFixed(1)}–{trackSpan(doc, t)[1].toFixed(1)}s</button>)}
      </div>
      {f && <>
        <div className="chip-grid">{MODES.map(([m, n, tip]) => <button key={m} title={tip} className={`key small ${(f.mode ?? 'perspective') === m ? 'lit' : ''}`} aria-pressed={(f.mode ?? 'perspective') === m}
          onClick={() => set({...f, mode: m}, `${clip.id} follow mode ${m}`)}>{n}</button>)}</div>
        <p className="param-desc">Place the clip while the playhead is on the frame the target was picked on; from there it rides along.</p>
        <div className="preset-row">
          {current && <button className="key small" onClick={() => seekTime(compAt(doc, current.src, current.anchor))}><Crosshair size={13} /> Go to that frame</button>}
          <button className="key small" onClick={() => set(null, `${clip.id} stops following`)}><Trash size={13} /> Stop following</button>
        </div>
      </>}
    </>}
  </div>;
}

// ---------- footage piece > Stabilize ----------
const LEVELS: [string, string, number][] = [['light', 'Light', 0.25], ['normal', 'Normal', 0.6], ['max', 'Max', 1]];
export function StabilizeSection({doc, index}: {doc: Doc; index: number}) {
  const tracks = useProjectTracks();
  const job = useTrackState(s => s.job);
  const piece = doc.base[index];
  const on = piece.stabilize as {track: string; level?: string} | undefined;
  const lockable = tracks.filter(t => t.src === piece.src && t.kind !== 'stabilize');
  const zoom = tracks.find(t => t.file === on?.track)?.zoom;
  const run = async (level: string, strength: number, lock?: string) => {
    const len = piece.duration ?? doc.settings.duration - piece.start;
    const from = piece.sourceIn ?? 0;
    const res = await runJob<{track: string; zoom: number}>('track-stabilize', {video: piece.src, strength, lock, from, to: from + len * (piece.speed ?? 1)}, 'Stabilizing');
    if (!res) return;
    forgetTrack(res.track);
    await refreshTracks();
    const d = currentDoc();
    if (d) { commit(op.setStabilize(d, index, {track: res.track, level}), 'stabilize', {change: `footage piece #${index} stabilized (${level}, zoom ${res.zoom}x)`}); endGroup(); }
  };
  const off = () => { const d = currentDoc(); if (d) { commit(op.setStabilize(d, index, null), 'stabilize', {change: `footage piece #${index} stabilization off`}); endGroup(); } };
  return <div className="subgroup">
    <div className="sub-title">Stabilize</div>
    {job ? <JobBar job={job} /> : <>
      <div className="chip-grid">
        <button className={`key small ${!on ? 'lit' : ''}`} aria-pressed={!on} onClick={off}>Off</button>
        {LEVELS.map(([k, n, s]) => <button key={k} className={`key small ${on?.level === k ? 'lit' : ''}`} aria-pressed={on?.level === k} onClick={() => void run(k, s)}>{n}</button>)}
      </div>
      {lockable.length > 0 && <div className="chip-grid">{lockable.map(t => <button key={t.file} className={`key small ${on?.level === 'lock' ? 'lit' : ''}`}
        title="Keep this target still in the frame" onClick={() => void run('lock', 1, t.file)}>Lock on {KIND_NAMES[t.kind].toLowerCase()}</button>)}</div>}
    </>}
    {on && zoom && <p className="param-desc">Zoomed in {Math.round((zoom - 1) * 100)}% to hide the moving edges. Lighter levels zoom less.</p>}
  </div>;
}
