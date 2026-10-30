// CapCut's timeline commands on top of the core ops: delete left / right of the playhead (Q / W),
// jump between edit points (up / down), copy and paste at the playhead, enable / disable a clip,
// move clips between tracks, and ripple-trim the main (footage) track from its edges.
import * as op from './ops';
import type {Doc, Ref} from './ops';

const clone = <T,>(v: T): T => structuredClone(v);

/** Every cut on the timeline the playhead can jump to: footage pieces, clips and sounds. */
export function editPoints(doc: Doc): number[] {
  const pts = [0, op.duration(doc)];
  op.bases(doc).forEach((_, i) => { const s = op.getSpan(doc, {kind: 'base', index: i}); if (s) pts.push(s.start, s.end); });
  for (const c of op.clips(doc)) pts.push(c.from, c.to);
  op.sfxList(doc).forEach((_, i) => { const s = op.getSpan(doc, {kind: 'sfx', index: i}); if (s) pts.push(s.start, s.end); });
  return [...new Set(pts.map(op.round))].sort((a, b) => a - b);
}

export function nextEditPoint(doc: Doc, t: number, dir: -1 | 1): number | null {
  const pts = editPoints(doc);
  const hit = dir > 0 ? pts.find(p => p > t + 1e-3) : [...pts].reverse().find(p => p < t - 1e-3);
  return hit ?? null;
}

/** The footage piece under time t. */
export function baseAt(doc: Doc, t: number): number {
  return op.bases(doc).findIndex((_, i) => { const s = op.getSpan(doc, {kind: 'base', index: i}); return !!s && t >= s.start - 1e-6 && t < s.end - 1e-6; });
}

/**
 * CapCut "delete left / right" (Q / W): remove what lies before or after the playhead.
 * On the footage this is a ripple cut (the rest of the video closes up, like the main track);
 * on clips and sounds it trims the item's edge to the playhead. With nothing selected it acts on
 * the footage piece under the playhead. Returns where the playhead should go.
 */
export function deleteSide(doc: Doc, refs: Ref[], t: number, side: 'left' | 'right'): {doc: Doc; playhead: number} {
  const targets = refs.length ? refs : (() => { const i = baseAt(doc, t); return i >= 0 ? [{kind: 'base', index: i} as Ref] : []; })();
  let next = doc;
  let playhead = t;
  // trims first (they do not move time), then at most one ripple cut on the footage
  for (const r of targets) {
    if (r.kind === 'base' || !op.isTrimmable(r) || op.isLocked(next, r)) continue;
    const s = op.getSpan(next, r);
    if (!s || t <= s.start + op.MIN_LEN || t >= s.end - op.MIN_LEN) continue;
    next = op.trimItem(next, r, side === 'left' ? 'start' : 'end', t);
  }
  const base = targets.find(r => r.kind === 'base');
  if (base && !op.isLocked(next, base)) {
    const s = op.getSpan(next, base);
    if (s && t > s.start + op.MIN_LEN && t < s.end - op.MIN_LEN) {
      next = side === 'left' ? op.rippleDelete(next, s.start, t) : op.rippleDelete(next, t, s.end);
      playhead = side === 'left' ? s.start : t;
    }
  }
  return {doc: next, playhead};
}

/** Items copied with Ctrl+C: their data and where they sat, so a paste keeps their spacing. */
export type Clip = {kind: 'clip' | 'sfx' | 'zoom'; item: any; start: number};

export function copyItems(doc: Doc, refs: Ref[]): Clip[] {
  const out: Clip[] = [];
  for (const r of refs) {
    if (r.kind !== 'clip' && r.kind !== 'sfx' && r.kind !== 'zoom') continue;
    const s = op.getSpan(doc, r);
    if (s) out.push({kind: r.kind, item: clone(op.getItem(doc, r)), start: s.start});
  }
  return out;
}

/** Paste at the playhead (CapCut Ctrl+V): the earliest copied item lands on t; clips take a free track. */
export function pasteItems(doc: Doc, board: Clip[], t: number): {doc: Doc; created: Ref[]} {
  if (!board.length) return {doc, created: []};
  const next = clone(doc);
  const dt = t - Math.min(...board.map(b => b.start));
  const created: Ref[] = [];
  for (const b of board) {
    const item = clone(b.item);
    if (b.kind === 'clip') {
      item.id = op.uniqueId(next, item.id);
      item.from = op.round(item.from + dt); item.to = op.round(item.to + dt);
      item.track = op.freeTrack(next, item.from, item.to, item.track ?? 5);
      (next.clips ??= []).push(item);
      created.push({kind: 'clip', id: item.id});
    } else if (b.kind === 'sfx') {
      item.at = op.round(item.at + dt);
      ((next.audio ??= {}).sfx ??= []).push(item);
      created.push({kind: 'sfx', index: next.audio.sfx.length - 1});
    } else {
      op.shiftZoom(item, dt);
      (next.zooms ??= []).push(item);
      created.push({kind: 'zoom', index: next.zooms.length - 1});
    }
  }
  return {doc: next, created};
}

/** CapCut "enable / disable clip" (V): a disabled clip or sound stays on the timeline but does not render. */
export function toggleDisabled(doc: Doc, refs: Ref[]): Doc {
  const own = refs.filter(r => r.kind === 'clip' || r.kind === 'sfx');
  if (!own.length) return doc;
  const off = !own.every(r => op.getItem(doc, r)?.disabled);
  let next = doc;
  for (const r of own) {
    const item = {...op.getItem(next, r)};
    if (off) item.disabled = true; else delete item.disabled;
    next = op.replaceItem(next, r, item);
  }
  return next;
}

/** Drag clips up or down to another track (stacking order). */
export function moveToTrack(doc: Doc, ids: string[], dTrack: number): Doc {
  if (!dTrack || !ids.length) return doc;
  const next = clone(doc);
  for (const c of op.clips(next)) if (ids.includes(c.id)) c.track = Math.max(1, (c.track ?? 5) + dTrack);
  return next;
}

/**
 * Pull a footage piece's edge in, CapCut main-track style: the trimmed stretch is ripple-cut, so the
 * video never has a gap and everything after it (voice, captions, clips) moves with it. Pulling an
 * edge outwards is not offered; undo or the text cut brings removed footage back.
 */
export function rippleTrimBase(doc: Doc, index: number, edge: op.Edge, t: number): Doc {
  const s = op.getSpan(doc, {kind: 'base', index});
  if (!s) return doc;
  if (edge === 'end') { const to = Math.max(s.start + op.MIN_LEN, Math.min(s.end, t)); return to < s.end - 1e-3 ? op.rippleDelete(doc, to, s.end) : doc; }
  const from = Math.min(s.end - op.MIN_LEN, Math.max(s.start, t));
  return from > s.start + 1e-3 ? op.rippleDelete(doc, s.start, from) : doc;
}

/**
 * Two clips never overlap on one track (CapCut): a moved clip that lands on another one goes to
 * the nearest free track above it. Only the clips that moved are touched.
 */
export function settleTracks(doc: Doc, ids: string[]): Doc {
  if (!ids.length) return doc;
  let next = doc;
  for (const id of ids) {
    const c = op.clips(next).find(x => x.id === id);
    if (!c) continue;
    const track = c.track ?? 5;
    const hit = op.clips(next).some(o => o.id !== id && (o.track ?? 5) === track && o.from < c.to - 1e-3 && o.to > c.from + 1e-3);
    if (!hit) continue;
    const others = {...next, clips: op.clips(next).filter(o => o.id !== id)};
    const free = op.freeTrack(others, c.from, c.to, track);
    if (free !== track) next = op.replaceItem(next, {kind: 'clip', id}, {...c, track: free});
  }
  return next;
}

export type SmoothZoom = {amount: number; inDur: number; hold: number; outDur: number; ease: 'inOut' | 'out' | 'linear'};
export const SMOOTH_ZOOM: SmoothZoom = {amount: 1.15, inDur: 0.6, hold: 1.5, outDur: 0.6, ease: 'inOut'};

/**
 * Zoom in gradually, hold, and glide back out (the smooth CapCut move, not a cut): four keyframes
 * on the footage piece from item time t. Keys already inside that stretch are replaced; the zoom
 * level before it is kept as the resting value, and the move is cut short at the piece's end.
 */
export function smoothZoom(doc: Doc, index: number, t: number, z: SmoothZoom): Doc {
  const ref: Ref = {kind: 'base', index};
  const span = op.getSpan(doc, ref);
  if (!span) return doc;
  const len = span.end - span.start;
  const rest = (op.keysOf(doc, ref).filter(k => k.t <= t + 1e-3 && k.scale !== undefined).at(-1)?.scale) ?? 1;
  const a = t, b = Math.min(len, a + z.inDur), c = Math.min(len, b + z.hold), d = Math.min(len, c + z.outDur);
  let next = doc;
  for (const k of op.keysOf(doc, ref)) if (k.t >= a - 1e-3 && k.t <= d + 1e-3) next = op.removeKey(next, ref, k.t);
  const ease = z.ease === 'linear' ? undefined : z.ease;
  const peak = op.round(rest * z.amount);
  next = op.upsertKey(next, ref, a, {scale: rest});
  next = op.upsertKey(next, ref, b, {scale: peak, ease});
  if (c > b + 1e-3) next = op.upsertKey(next, ref, c, {scale: peak, ease: undefined});
  if (d > c + 1e-3) next = op.upsertKey(next, ref, d, {scale: rest, ease});
  return next;
}

/** CapCut "group" (Ctrl+G): clips that share `group` select and move together. */
export function groupClips(doc: Doc, ids: string[]): Doc {
  if (ids.length < 2) return doc;
  const used = new Set(op.clips(doc).map(c => c.group).filter(Boolean));
  let n = 1;
  while (used.has(`g${n}`)) n++;
  const next = clone(doc);
  for (const c of op.clips(next)) if (ids.includes(c.id)) c.group = `g${n}`;
  return next;
}
export function ungroupClips(doc: Doc, ids: string[]): Doc {
  const next = clone(doc);
  const groups = new Set(op.clips(next).filter(c => ids.includes(c.id)).map(c => c.group).filter(Boolean));
  if (!groups.size) return doc;
  for (const c of op.clips(next)) if (groups.has(c.group)) delete c.group;
  return next;
}
/** A selection grows to whole groups. */
export function withGroups(doc: Doc, refs: Ref[]): Ref[] {
  const groups = new Set(refs.filter(r => r.kind === 'clip').map(r => op.clips(doc).find(c => c.id === (r as {id: string}).id)?.group).filter(Boolean));
  if (!groups.size) return refs;
  const extra = op.clips(doc).filter(c => groups.has(c.group) && !refs.some(r => r.kind === 'clip' && r.id === c.id)).map(c => ({kind: 'clip', id: c.id}) as Ref);
  return [...refs, ...extra];
}

/** CapCut's speed curves, as speeds at evenly spaced points across the piece's source. */
export const SPEED_CURVES: {name: string; label: string; points: number[]}[] = [
  {name: 'montage', label: 'Montage', points: [2, 2, 1, 0.5, 0.5, 1, 2, 2]},
  {name: 'hero', label: 'Hero moment', points: [1, 1, 1, 0.3, 0.3, 1, 1, 1]},
  {name: 'bullet', label: 'Bullet', points: [1, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 1]},
  {name: 'jump', label: 'Jump', points: [1, 1, 4, 4, 4, 4, 1, 1]},
  {name: 'flash-in', label: 'Flash in', points: [4, 3, 2, 1.5, 1, 1, 1, 1]},
  {name: 'flash-out', label: 'Flash out', points: [1, 1, 1, 1, 1.5, 2, 3, 4]},
];

/**
 * A speed curve on a footage piece: the piece becomes `steps` short pieces whose constant speeds
 * follow the curve (each covers an equal share of the source), so the render and Claude still
 * see plain speeds. The rest of the edit closes up or waits; the voice is not retimed (B-roll).
 */
export function speedCurve(doc: Doc, index: number, points: number[], steps = 12): Doc {
  const b = op.bases(doc)[index];
  const span = op.getSpan(doc, {kind: 'base', index});
  if (!b || !span || b.freeze || points.length < 2) return doc;
  const at = (u: number) => { const x = u * (points.length - 1), i = Math.min(points.length - 2, Math.floor(x)); return points[i] + (points[i + 1] - points[i]) * (x - i); };
  const speeds = Array.from({length: steps}, (_, i) => op.round(at((i + 0.5) / steps)));
  const oldLen = span.end - span.start, source = oldLen * (b.speed ?? 1), chunk = source / steps;
  const lens = speeds.map(s => op.round(Math.max(op.MIN_LEN, chunk / s)));
  const newLen = op.round(lens.reduce((a, c) => a + c, 0));
  const delta = op.round(newLen - oldLen);
  let next = delta > 0 ? op.rippleInsert(doc, span.end, delta) : delta < 0 ? op.rippleDelete(doc, op.round(span.end + delta), span.end) : doc;
  // where each source second lands on the new timeline, to carry zoom keyframes across
  const local = (src: number) => { const i = Math.min(steps - 1, Math.floor(src / chunk)); return lens.slice(0, i).reduce((a, c) => a + c, 0) + (src - i * chunk) / speeds[i]; };
  const keys = b.keys?.map((k: op.Key) => ({...k, t: op.round(local(k.t * (b.speed ?? 1)))}));
  const {speed: _s, keys: _k, duration: _d, ...rest} = b;
  let t = span.start;
  const pieces = speeds.map((s, i) => {
    const p: any = {...rest, start: op.round(t), sourceIn: op.round((b.sourceIn ?? 0) + i * chunk), duration: lens[i]};
    if (Math.abs(s - 1) > 1e-6) p.speed = s;
    const w = op.windowKeys(keys, t - span.start, t - span.start + lens[i]);
    if (w) p.keys = w;
    t += lens[i];
    return p;
  });
  next = clone(next);
  const j = next.base.findIndex((x: any) => Math.abs((x.start ?? 0) - span.start) < 1e-3 && x.src === b.src);
  if (j < 0) return doc;
  next.base.splice(j, 1, ...pieces);
  return next;
}

// ---------- media the owner imports (CapCut's Import) ----------

export type Media = {path: string; kind: 'video' | 'image' | 'audio'; duration?: number; width?: number; height?: number};
/** Images that usually carry transparency are stickers/elements: shown whole, smaller, over the picture. */
export const isElement = (path: string) => /\.(png|gif|svg|webp)$/i.test(path);
/** Sounds up to this long go on the sound-effect track; longer ones are music. */
export const SFX_MAX = 15;

/**
 * Put an imported file on the timeline at t: a video or image becomes a clip on a free track, a short
 * sound a sound effect, a long one the music (or a long sound when the edit already has music).
 */
export function addMedia(doc: Doc, m: Media, t: number): {doc: Doc; ref: Ref; change: string} {
  const name = m.path.split('/').pop() ?? m.path;
  const room = Math.max(0.5, op.duration(doc) - t);
  if (m.kind === 'audio') {
    const len = m.duration ?? 1;
    if (len > SFX_MAX && !doc.audio?.music) {
      const next = op.setPath(doc, ['audio', 'music'], {src: m.path, volume: 0.25, fadeIn: 0.5, fadeOut: 1.5});
      return {doc: next, ref: {kind: 'music'}, change: `set music to ${m.path} (volume 0.25)`};
    }
    const sfx = [...(doc.audio?.sfx ?? [])];
    const at = op.round(Math.max(0, t));
    sfx.push({at, file: m.path, volume: len > SFX_MAX ? 0.5 : 1, ...(m.duration ? {duration: op.round(Math.min(len, room))} : {})});
    sfx.sort((a: any, b: any) => a.at - b.at);
    const next = op.setPath(doc, ['audio', 'sfx'], sfx);
    const index = sfx.findIndex((s: any) => s.at === at && s.file === m.path);
    return {doc: next, ref: {kind: 'sfx', index}, change: `added sound ${name} at ${at.toFixed(2)}s`};
  }
  if (m.kind === 'video') {
    const len = Math.min(room, m.duration ?? 3);
    // plain b-roll: no whip, sound off so it never fights the voice (raise Volume in Properties)
    const {doc: next, id} = op.addClip(doc, 'VideoLayer', t, {src: m.path, volume: 0, whip: false}, len);
    return {doc: next, ref: {kind: 'clip', id}, change: `added video ${name} as clip ${id} at ${t.toFixed(2)}s`};
  }
  const element = isElement(m.path);
  const {doc: added, id} = op.addClip(doc, 'ImageLayer', t, element ? {image: m.path, fit: 'contain', startScale: 1, endScale: 1} : {image: m.path, startScale: 1, endScale: 1.06}, Math.min(room, 3));
  // an element starts as a sticker in the middle, at under half the frame
  const next = element ? op.replaceItem(added, {kind: 'clip', id}, {...op.getItem(added, {kind: 'clip', id}), box: {x: 0, y: 0, scale: 0.45, rotate: 0}}) : added;
  return {doc: next, ref: {kind: 'clip', id}, change: `added ${element ? 'element' : 'image'} ${name} as clip ${id} at ${t.toFixed(2)}s`};
}

/**
 * Replace (CapCut): a file from the bin takes the place of an item on the timeline. The item keeps its
 * time, length, track, position, look and animation; only what it plays changes. A video or picture
 * swaps into footage, video and picture clips (a clip changes between VideoLayer and ImageLayer when the
 * kind differs); a sound swaps into a sound effect or the music. Returns null when the pair can't swap.
 */
export function replaceMedia(doc: Doc, ref: Ref, m: Media): {doc: Doc; ref: Ref; change: string} | null {
  const item = op.getItem(doc, ref);
  if (!item) return null;
  const name = m.path.split('/').pop() ?? m.path;
  const short = (len: number) => m.duration != null && m.duration + 1e-3 < len;
  if (ref.kind === 'base') {
    if (m.kind !== 'video' || short(item.duration)) return null;
    return {doc: op.replaceItem(doc, ref, {...item, src: m.path, sourceIn: 0}), ref, change: `replaced footage piece #${ref.index} with ${name}`};
  }
  if (ref.kind === 'sfx' || ref.kind === 'music') {
    if (m.kind !== 'audio') return null;
    const next = ref.kind === 'sfx' ? {...item, file: m.path, ...(m.duration ? {duration: op.round(Math.min(item.duration ?? m.duration, m.duration))} : {})} : {...item, src: m.path};
    return {doc: op.replaceItem(doc, ref, next), ref, change: `replaced ${ref.kind === 'sfx' ? `sound #${ref.index}` : 'the music'} with ${name}`};
  }
  if (ref.kind !== 'clip' || !['VideoLayer', 'ImageLayer'].includes(item.component) || m.kind === 'audio') return null;
  const {src: _s, image: _i, sourceIn: _si, ...keep} = item.props ?? {};
  const props = m.kind === 'video'
    ? {...keep, src: m.path, sourceIn: 0, volume: keep.volume ?? 0, whip: keep.whip ?? false}
    : {...keep, image: m.path};
  if (m.kind === 'video' && short(item.to - item.from)) return null;
  const component = m.kind === 'video' ? 'VideoLayer' : 'ImageLayer';
  return {doc: op.replaceItem(doc, ref, {...item, component, props}), ref, change: `replaced clip ${ref.id} with ${name}`};
}
