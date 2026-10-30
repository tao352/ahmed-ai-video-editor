// Pure edit operations over the raw edit.json document. No React here.
import {keyedBox} from '../../../reel/src/edit/clipfx';
// Every op returns a NEW document and leaves fields it does not own untouched
// (formats, notes, meta, unknown props), so Claude's data always survives a human edit.

export type Doc = Record<string, any>;
export type Ref =
  | {kind: 'clip'; id: string}
  | {kind: 'word'; index: number}
  | {kind: 'zoom'; index: number}
  | {kind: 'sfx'; index: number}
  | {kind: 'transition'; index: number}
  | {kind: 'note'; id: string}
  | {kind: 'base'; index: number}
  | {kind: 'music'}
  | {kind: 'voice'};
export type Span = {start: number; end: number};
export type Edge = 'start' | 'end';

export const MIN_LEN = 1 / 30;
export const round = (t: number) => Math.round(t * 1000) / 1000;
const clone = <T,>(v: T): T => structuredClone(v);

export const refKey = (r: Ref): string =>
  r.kind === 'clip' || r.kind === 'note' ? `${r.kind}:${r.id}` : r.kind === 'music' || r.kind === 'voice' ? r.kind : `${r.kind}:${r.index}`;
export const sameRef = (a: Ref, b: Ref) => refKey(a) === refKey(b);

export const duration = (doc: Doc): number => Number(doc.settings?.duration ?? 0);
export const words = (doc: Doc): [number, number, string][] => doc.captions?.words ?? [];
export const clips = (doc: Doc): any[] => doc.clips ?? [];
export const zooms = (doc: Doc): any[] => doc.zooms ?? [];
export const sfxList = (doc: Doc): any[] => doc.audio?.sfx ?? [];
export const transitions = (doc: Doc): any[] => doc.transitions ?? [];
export const notes = (doc: Doc): any[] => doc.notes ?? [];
export const bases = (doc: Doc): any[] => doc.base ?? [];

export const SFX_DEFAULT = 0.65;
const zoomDefaults = {punch: 0.5, drop: 0.5, ratchet: 0.45, ramp: 0.4};

// ---------- reading ----------

export function getItem(doc: Doc, ref: Ref): any {
  switch (ref.kind) {
    case 'clip': return clips(doc).find(c => c.id === ref.id);
    case 'note': return notes(doc).find(n => n.id === ref.id);
    case 'word': return words(doc)[ref.index];
    case 'zoom': return zooms(doc)[ref.index];
    case 'sfx': return sfxList(doc)[ref.index];
    case 'transition': return transitions(doc)[ref.index];
    case 'base': return bases(doc)[ref.index];
    case 'music': return doc.audio?.music;
    case 'voice': return doc.audio?.voice;
  }
}

export function zoomSpan(z: any): Span {
  switch (z.type) {
    case 'punch': return {start: z.t, end: z.t + (z.hold ?? zoomDefaults.punch)};
    case 'drop': return {start: z.t, end: z.t + (z.dur ?? zoomDefaults.drop)};
    case 'ratchet': {
      const steps: [number, number][] = z.steps ?? [];
      const first = steps[0]?.[0] ?? 0, last = steps.at(-1)?.[0] ?? first;
      return {start: first, end: last + (z.hold ?? zoomDefaults.ratchet)};
    }
    case 'ramp': return {start: z.t0, end: z.t1 + (z.hold ?? zoomDefaults.ramp)};
    default: return {start: z.t0, end: z.t1};
  }
}

export function getSpan(doc: Doc, ref: Ref): Span | null {
  const item = getItem(doc, ref);
  if (!item) return null;
  switch (ref.kind) {
    case 'clip': return {start: item.from, end: item.to};
    case 'word': return {start: item[0], end: item[1]};
    case 'zoom': return zoomSpan(item);
    case 'sfx': return {start: item.at, end: item.at + (item.duration ?? SFX_DEFAULT)};
    case 'transition': return {start: item.at, end: item.at + item.duration};
    case 'note': return {start: item.at, end: item.at};
    case 'base': return {start: item.start ?? 0, end: (item.start ?? 0) + (item.duration ?? Math.max(0, duration(doc) - (item.start ?? 0)))};
    case 'music': case 'voice': return {start: 0, end: duration(doc)};
  }
}

/** Items that always span the whole video and are never deleted or duplicated from the timeline. */
export const isFixed = (ref: Ref) => ref.kind === 'music' || ref.kind === 'voice' || ref.kind === 'base';
export const isMovable = (ref: Ref) => ref.kind !== 'music' && ref.kind !== 'voice' && ref.kind !== 'base';
export const isTrimmable = (ref: Ref): boolean => ref.kind !== 'note' && ref.kind !== 'music' && ref.kind !== 'voice';

// ---------- moving ----------

export function shiftZoom(z: any, dt: number) {
  if ('t' in z) z.t = round(z.t + dt);
  if ('t0' in z) z.t0 = round(z.t0 + dt);
  if ('t1' in z) z.t1 = round(z.t1 + dt);
  if (Array.isArray(z.steps)) z.steps = z.steps.map(([t, p]: [number, number]) => [round(t + dt), p]);
}

function shiftItem(doc: Doc, ref: Ref, dt: number) {
  const item = getItem(doc, ref);
  if (!item) return;
  switch (ref.kind) {
    case 'clip': item.from = round(item.from + dt); item.to = round(item.to + dt); break;
    case 'word': item[0] = round(item[0] + dt); item[1] = round(item[1] + dt); break;
    case 'zoom': shiftZoom(item, dt); break;
    case 'sfx': case 'transition': case 'note': item.at = round(item.at + dt); break;
  }
}

/** Move a group by dt seconds; the group stays inside [0, duration] as a whole. */
export function moveItems(doc: Doc, refs: Ref[], dt: number): Doc {
  const movable = refs.filter(isMovable);
  if (!movable.length || !dt) return doc;
  const spans = movable.map(r => getSpan(doc, r)).filter((s): s is Span => !!s);
  const lo = Math.min(...spans.map(s => s.start)), hi = Math.max(...spans.map(s => s.end));
  const d = Math.max(-lo, Math.min(duration(doc) - hi, dt));
  if (!d) return doc;
  const next = clone(doc);
  for (const r of movable) shiftItem(next, r, d);
  if (movable.some(r => r.kind === 'word')) next.captions.words.sort((a: any, b: any) => a[0] - b[0]);
  return next;
}

/** Remap selection refs after moveItems re-sorted words (index refs only change for words). */
export function remapWordRefs(before: Doc, after: Doc, refs: Ref[]): Ref[] {
  return refs.map(r => {
    if (r.kind !== 'word') return r;
    const w = words(before)[r.index];
    const idx = words(after).findIndex(x => x[2] === w?.[2] && Math.abs(x[0] - w[0]) < 60);
    return idx >= 0 ? {kind: 'word', index: idx} : r;
  });
}

// ---------- trimming ----------

export function trimItem(doc: Doc, ref: Ref, edge: Edge, time: number): Doc {
  if (!isTrimmable(ref)) return doc;
  const span = getSpan(doc, ref);
  if (!span) return doc;
  const total = duration(doc);
  const t = round(Math.max(0, Math.min(total, time)));
  const start = edge === 'start' ? Math.min(t, span.end - MIN_LEN) : span.start;
  const end = edge === 'end' ? Math.max(t, span.start + MIN_LEN) : span.end;
  const next = clone(doc);
  const item = getItem(next, ref);
  switch (ref.kind) {
    case 'clip':
      // a clip that plays a file (VideoLayer) keeps its picture in place when its start moves
      if (edge === 'start') shiftSource(item, start - item.from);
      item.from = round(start); item.to = round(end); break;
    case 'word': item[0] = round(start); item[1] = round(end); break;
    case 'sfx': item.at = round(start); item.duration = round(end - start); break;
    case 'transition': item.at = round(start); item.duration = round(end - start); break;
    case 'base': {
      const oldStart = item.start ?? 0;
      const oldLen = span.end - span.start;
      if (edge === 'start') item.sourceIn = round((item.sourceIn ?? 0) + (start - oldStart));
      if (item.keys) { const k = windowKeys(item.keys, start - oldStart, Math.min(oldLen, end - oldStart)); if (k) item.keys = k; else delete item.keys; }
      item.start = round(start); item.duration = round(end - start);
      break;
    }
    case 'zoom': {
      if (item.type === 'punch') { item.t = round(start); item.hold = round(end - start); }
      else if (item.type === 'drop') { item.t = round(start); item.dur = round(end - start); }
      else if (item.type === 'kenburns') { item.t0 = round(start); item.t1 = round(end); }
      else if (item.type === 'ramp') { const hold = item.hold ?? zoomDefaults.ramp; item.t0 = round(start); item.t1 = round(Math.max(start + MIN_LEN, end - hold)); }
      else if (item.type === 'ratchet') {
        // The end edge sets the hold after the last step; the start edge moves only the first step.
        if (edge === 'end') item.hold = round(Math.max(MIN_LEN, end - item.steps.at(-1)[0]));
        else item.steps = item.steps.map(([s, p]: [number, number], i: number) => [i === 0 ? round(Math.min(start, item.steps[1]?.[0] ?? start)) : s, p]);
      }
      break;
    }
  }
  return next;
}

// ---------- structural edits ----------

export function uniqueId(doc: Doc, base: string): string {
  const taken = new Set(clips(doc).map(c => c.id));
  const stem = base.replace(/-\d+$/, '').replace(/-b$/, '') || 'clip';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${stem}-${i}`)) return `${stem}-${i}`;
}

/** Clips that play a media file (props.sourceIn) start that far later in the file. */
function shiftSource(clip: any, by: number) {
  if (typeof clip.props?.sourceIn === 'number' || clip.component === 'VideoLayer') clip.props = {...clip.props, sourceIn: round(Math.max(0, (clip.props?.sourceIn ?? 0) + by))};
}

export function splitClip(doc: Doc, id: string, t: number): {doc: Doc; newId: string | null} {
  const clip = clips(doc).find(c => c.id === id);
  if (!clip || t <= clip.from + MIN_LEN || t >= clip.to - MIN_LEN) return {doc, newId: null};
  const next = clone(doc);
  const idx = next.clips.findIndex((c: any) => c.id === id);
  const left = next.clips[idx];
  const right = clone(left);
  right.id = uniqueId(next, `${id}-b`);
  shiftSource(right, t - right.from);
  right.from = round(t);
  left.to = round(t);
  next.clips.splice(idx + 1, 0, right);
  return {doc: next, newId: right.id};
}

export function deleteItems(doc: Doc, refs: Ref[]): Doc {
  if (!refs.length) return doc;
  const next = clone(doc);
  const byKind = (k: Ref['kind']) => refs.filter(r => r.kind === k);
  const ids = (k: 'clip' | 'note') => new Set(byKind(k).map(r => (r as any).id));
  const idx = (k: Ref['kind']) => new Set(byKind(k).map(r => (r as any).index as number));
  if (byKind('clip').length) next.clips = clips(next).filter(c => !ids('clip').has(c.id));
  if (byKind('note').length) next.notes = notes(next).filter(n => !ids('note').has(n.id));
  if (byKind('word').length) next.captions.words = words(next).filter((_, i) => !idx('word').has(i));
  if (byKind('zoom').length) next.zooms = zooms(next).filter((_, i) => !idx('zoom').has(i));
  if (byKind('sfx').length) next.audio.sfx = sfxList(next).filter((_, i) => !idx('sfx').has(i));
  if (byKind('transition').length) next.transitions = transitions(next).filter((_, i) => !idx('transition').has(i));
  return next;
}

/** Duplicate clips, sfx, zooms and notes, placing each copy right after its original. */
export function duplicateItems(doc: Doc, refs: Ref[]): {doc: Doc; created: Ref[]} {
  let next = clone(doc);
  const created: Ref[] = [];
  for (const r of refs) {
    const span = getSpan(doc, r);
    if (!span) continue;
    const len = Math.max(span.end - span.start, 0.5);
    const dt = Math.min(len, duration(doc) - span.end);
    if (r.kind === 'clip') {
      const copy = clone(getItem(doc, r));
      copy.id = uniqueId(next, `${copy.id}-2`);
      copy.from = round(copy.from + dt); copy.to = round(copy.to + dt);
      next.clips.push(copy);
      created.push({kind: 'clip', id: copy.id});
    } else if (r.kind === 'sfx') {
      const copy = {...getItem(doc, r), at: round(getItem(doc, r).at + dt)};
      next.audio.sfx.push(copy);
      created.push({kind: 'sfx', index: next.audio.sfx.length - 1});
    } else if (r.kind === 'zoom') {
      const copy = clone(getItem(doc, r));
      shiftZoom(copy, dt);
      next.zooms.push(copy);
      created.push({kind: 'zoom', index: next.zooms.length - 1});
    } else if (r.kind === 'note') {
      const n = getItem(doc, r);
      const copy = {...n, id: newNoteId(next), at: round(Math.min(duration(doc), n.at + 1))};
      next.notes.push(copy);
      created.push({kind: 'note', id: copy.id});
    }
  }
  if (!created.length) next = doc;
  return {doc: next, created};
}

export function freeTrack(doc: Doc, from: number, to: number, preferred = 5): number {
  const busy = (track: number) => clips(doc).some(c => (c.track ?? 5) === track && c.from < to && c.to > from);
  for (let t = preferred; t < preferred + 20; t++) if (!busy(t)) return t;
  return preferred;
}

export function addClip(doc: Doc, component: string, t: number, props: Record<string, unknown> = {}, length = 3): {doc: Doc; id: string} {
  const next = clone(doc);
  next.clips ??= [];
  const from = round(Math.max(0, Math.min(t, duration(doc) - MIN_LEN)));
  const to = round(Math.min(duration(doc), from + length));
  const id = uniqueId(next, `${component.replace(/[A-Z]/g, (m, i) => (i ? '-' : '') + m.toLowerCase())}-1`);
  next.clips.push({id, component, from, to, track: freeTrack(doc, from, to), props});
  return {doc: next, id};
}

export function newNoteId(doc: Doc): string {
  const taken = new Set(notes(doc).map(n => n.id));
  for (let i = notes(doc).length + 1; ; i++) if (!taken.has(`n${i}`)) return `n${i}`;
}

export function addNote(doc: Doc, at: number, text = ''): {doc: Doc; id: string} {
  const next = clone(doc);
  next.notes ??= [];
  const id = newNoteId(next);
  next.notes.push({id, at: round(at), text, status: 'open'});
  next.notes.sort((a: any, b: any) => a.at - b.at);
  return {doc: next, id};
}

// ---------- captions ----------

export function editWord(doc: Doc, index: number, text: string): Doc {
  const w = words(doc)[index];
  if (!w || w[2] === text) return doc;
  const next = clone(doc);
  next.captions.words[index][2] = text;
  return next;
}

/** Split a word in two; time is shared in proportion to the character count of each half. */
export function splitWord(doc: Doc, index: number, at?: number): Doc {
  const w = words(doc)[index];
  if (!w) return doc;
  const parts = w[2].trim().split(/\s+/);
  const [a, b] = parts.length > 1 ? [parts[0], parts.slice(1).join(' ')] : [w[2], w[2]];
  const ratio = at ?? (parts.length > 1 ? a.length / (a.length + b.length) : 0.5);
  const mid = round(w[0] + (w[1] - w[0]) * ratio);
  const next = clone(doc);
  next.captions.words.splice(index, 1, [w[0], mid, a], [mid, w[1], b]);
  return next;
}

export function mergeWords(doc: Doc, index: number): Doc {
  const ws = words(doc);
  if (!ws[index] || !ws[index + 1]) return doc;
  const next = clone(doc);
  const [a, b] = [ws[index], ws[index + 1]];
  next.captions.words.splice(index, 2, [a[0], b[1], `${a[2]} ${b[2]}`]);
  return next;
}

/** Group word indices into readable lines: break on silence or every `max` words. */
export function wordLines(doc: Doc, max = 8): number[][] {
  const gap = Math.max(0.35, Number(doc.captions?.style?.gapBreak ?? 0.25) * 2);
  const lines: number[][] = [];
  words(doc).forEach((w, i, all) => {
    const prev = all[i - 1];
    if (!lines.length || (prev && w[0] - prev[1] > gap) || lines.at(-1)!.length >= max) lines.push([]);
    lines.at(-1)!.push(i);
  });
  return lines;
}

// ---------- generic field edits (inspector) ----------

/** Replace one item with a new value (the inspector builds the value, zod validates before). */
export function replaceItem(doc: Doc, ref: Ref, value: any): Doc {
  const next = clone(doc);
  switch (ref.kind) {
    case 'clip': { const i = next.clips.findIndex((c: any) => c.id === ref.id); if (i >= 0) next.clips[i] = value; break; }
    case 'note': { const i = next.notes.findIndex((n: any) => n.id === ref.id); if (i >= 0) next.notes[i] = value; break; }
    case 'word': next.captions.words[ref.index] = value; break;
    case 'zoom': next.zooms[ref.index] = value; break;
    case 'sfx': next.audio.sfx[ref.index] = value; break;
    case 'transition': next.transitions[ref.index] = value; break;
    case 'base': next.base[ref.index] = value; break;
    case 'music': next.audio.music = value; break;
    case 'voice': next.audio.voice = value; break;
  }
  return next;
}

export function setPath(doc: Doc, path: (string | number)[], value: unknown): Doc {
  const next = clone(doc);
  let cur: any = next;
  for (const key of path.slice(0, -1)) { cur[key] ??= typeof key === 'number' ? [] : {}; cur = cur[key]; }
  const last = path.at(-1)!;
  if (value === undefined) delete cur[last]; else cur[last] = value;
  return next;
}

// ---------- audio fades ----------

/** Current fade length (s) of music or an sfx at one edge. */
export function fadeOf(doc: Doc, ref: Ref, edge: Edge): number {
  const item = getItem(doc, ref);
  return Number((edge === 'start' ? item?.fadeIn : item?.fadeOut) ?? 0);
}

/** Set a fade on music or an sfx; capped so in + out never exceed the sound's length. */
export function setFade(doc: Doc, ref: Ref, edge: Edge, secs: number): Doc {
  if (ref.kind !== 'music' && ref.kind !== 'sfx') return doc;
  const span = getSpan(doc, ref);
  if (!span) return doc;
  const other = fadeOf(doc, ref, edge === 'start' ? 'end' : 'start');
  const v = round(Math.max(0, Math.min(span.end - span.start - other, secs)));
  const item = clone(getItem(doc, ref));
  const key = edge === 'start' ? 'fadeIn' : 'fadeOut';
  if (v > 0) item[key] = v; else if (ref.kind === 'sfx') delete item[key]; else item[key] = 0;
  return replaceItem(doc, ref, item);
}

// ---------- snapping ----------

export function snapPoints(doc: Doc, exclude: Ref[] = [], extra: number[] = []): number[] {
  const skip = new Set(exclude.map(refKey));
  const pts: number[] = [0, duration(doc), ...extra];
  words(doc).forEach((w, i) => { if (!skip.has(`word:${i}`)) pts.push(w[0], w[1]); });
  clips(doc).forEach(c => { if (!skip.has(`clip:${c.id}`)) pts.push(c.from, c.to); });
  zooms(doc).forEach((z, i) => { if (!skip.has(`zoom:${i}`)) { const s = zoomSpan(z); pts.push(s.start, s.end); } });
  sfxList(doc).forEach((s, i) => { if (!skip.has(`sfx:${i}`)) pts.push(s.at); });
  pts.push(...beats(doc));
  return pts.sort((a, b) => a - b);
}

/** Nearest snap point within `threshold` seconds, else the input. */
export function snap(t: number, points: number[], threshold: number): number {
  let best = t, dist = threshold;
  for (const p of points) {
    const d = Math.abs(p - t);
    if (d <= dist) { best = p; dist = d; }
  }
  return best;
}

// ---------- change labels (human_changes.md) ----------

const fmt = (t: number) => `${round(t).toFixed(2)}s`;

export function refLabel(doc: Doc, ref: Ref): string {
  const item = getItem(doc, ref);
  switch (ref.kind) {
    case 'clip': return `clip ${ref.id}${item ? ` (${item.component})` : ''}`;
    case 'word': return `word #${ref.index}${item ? ` "${item[2]}"` : ''}`;
    case 'zoom': return `zoom #${ref.index}${item ? ` (${item.type})` : ''}`;
    case 'sfx': return `sfx #${ref.index}${item ? ` (${String(item.file).split('/').pop()})` : ''}`;
    case 'transition': return `transition #${ref.index}${item ? ` (${item.type})` : ''}`;
    case 'note': return `note ${ref.id}`;
    case 'base': return `base video #${ref.index}`;
    case 'music': return 'music';
    case 'voice': return 'voice';
  }
}

export function describeMove(doc: Doc, refs: Ref[], before: Doc): string {
  const first = refs[0];
  const a = getSpan(before, first), b = getSpan(doc, first);
  const what = refs.length > 1 ? `${refs.length} items` : refLabel(before, first);
  return a && b ? `moved ${what} ${fmt(a.start)} -> ${fmt(b.start)}` : `moved ${what}`;
}

export function describeTrim(doc: Doc, ref: Ref): string {
  const s = getSpan(doc, ref);
  return s ? `trimmed ${refLabel(doc, ref)} to ${fmt(s.start)}-${fmt(s.end)}` : `trimmed ${refLabel(doc, ref)}`;
}

/** Field-level diff of one item, for inspector edits: `changed clip x: props.title "a" -> "b"`. */
export function describeFieldChange(before: any, after: any, label: string): string {
  const diffs: string[] = [];
  const walk = (a: any, b: any, path: string) => {
    if (diffs.length > 4) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], path ? `${path}.${k}` : k);
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      const show = (v: any) => (v === undefined ? 'unset' : JSON.stringify(v).slice(0, 60));
      diffs.push(`${path || 'value'} ${show(a)} -> ${show(b)}`);
    }
  };
  walk(before, after, '');
  return `changed ${label}: ${diffs.join(', ') || 'no visible change'}`;
}

// ---------- text-based cutting (ripple delete) ----------

/**
 * Remove the time range [a, b) from the whole edit and close the gap: footage and voice
 * become segments of their files (sourceIn), everything after b moves left by b - a.
 * Items fully inside the range go; items crossing it are shortened.
 */
export function rippleDelete(doc: Doc, a: number, b: number): Doc {
  a = round(Math.max(0, a)); b = round(Math.min(duration(doc), b));
  const gap = b - a;
  if (gap <= 0) return doc;
  const next = clone(doc);
  const t = (x: number) => (x <= a ? x : x >= b ? round(x - gap) : a);
  const inside = (s: number, e: number) => s >= a && e <= b;

  // Spans: drop if inside, else remap both ends (crossing items shrink).
  next.captions.words = words(doc).filter(w => !inside(w[0], w[1])).map(w => [t(w[0]), t(w[1]), w[2]]).filter(w => (w[1] as number) - (w[0] as number) > 0.001);
  next.clips = clips(doc).filter(c => !inside(c.from, c.to)).map(c => ({...c, from: t(c.from), to: t(c.to)})).filter(c => c.to - c.from >= MIN_LEN);
  next.zooms = zooms(doc).filter(z => { const s = zoomSpan(z); return !inside(s.start, s.end); }).map(z => {
    const c = clone(z);
    if ('t' in c) c.t = t(c.t);
    if ('t0' in c) c.t0 = t(c.t0);
    if ('t1' in c) c.t1 = t(c.t1);
    if (Array.isArray(c.steps)) c.steps = c.steps.map(([s, p]: [number, number]) => [t(s), p]);
    return c;
  });
  if (next.audio) next.audio.sfx = sfxList(doc).filter(s => s.at < a || s.at >= b).map(s => ({...s, at: t(s.at)}));
  next.transitions = transitions(doc).filter(x => x.at < a || x.at >= b).map(x => ({...x, at: t(x.at)}));
  if (doc.notes) next.notes = notes(doc).map(n => ({...n, at: t(n.at)}));
  if (doc.layout?.beats) next.layout.beats = doc.layout.beats.filter((x: any) => !inside(x.from, x.to)).map((x: any) => ({...x, from: t(x.from), to: t(x.to)}));

  // Footage: split each base entry around the hole, keeping file time via sourceIn.
  const cutSegments = <T extends {start: number; sourceIn: number; duration: number}>(segs: T[]): T[] => segs.flatMap(sg => {
    const s = sg.start, e = sg.start + sg.duration;
    if (e <= a) return [sg];
    if (s >= b) return [{...sg, start: round(s - gap)}];
    const out: T[] = [];
    const k = (sg as any).keys;
    if (s < a) out.push(k ? keyed({...sg, duration: round(a - s)}, windowKeys(k, 0, a - s)) : {...sg, duration: round(a - s)});
    if (e > b) out.push(k ? keyed({...sg, start: a, sourceIn: round(sg.sourceIn + (b - s)), duration: round(e - b)}, windowKeys(k, b - s, e - s)) : {...sg, start: a, sourceIn: round(sg.sourceIn + (b - s)), duration: round(e - b)});
    return out;
  });
  const total = duration(doc);
  next.base = cutSegments(bases(doc).map(x => ({...x, start: x.start ?? 0, sourceIn: x.sourceIn ?? 0, duration: x.duration ?? Math.max(0, total - (x.start ?? 0))})));

  const voice = doc.audio?.voice;
  if (voice) next.audio.voice = {...voice, segments: cutSegments(voice.segments ?? [{start: 0, sourceIn: 0, duration: total}])};

  next.settings.duration = round(total - gap);
  return next;
}

// ---------- lanes: lock / hide / mute, select by side ----------

/** The timeline lane an item lives in (matches doc.lanes keys and the Timeline lane keys). */
export function laneOf(doc: Doc, ref: Ref): string {
  switch (ref.kind) {
    case 'clip': return `track-${getItem(doc, ref)?.track ?? 5}`;
    case 'word': return 'words';
    case 'zoom': return 'zoom';
    case 'sfx': return 'sfx';
    case 'transition': return 'transitions';
    case 'note': return 'notes';
    case 'base': return 'base';
    case 'music': return 'music';
    case 'voice': return 'voice';
  }
}
export const isLocked = (doc: Doc, ref: Ref): boolean => Boolean(doc.lanes?.[laneOf(doc, ref)]?.locked);
export const unlocked = (doc: Doc, refs: Ref[]): Ref[] => refs.filter(r => !isLocked(doc, r));

/** Flip one switch of a lane; an all-off lane entry is removed so edit.json stays clean. */
export function toggleLane(doc: Doc, lane: string, key: 'locked' | 'hidden' | 'muted'): Doc {
  const cur = {...doc.lanes?.[lane]};
  if (cur[key]) delete cur[key]; else cur[key] = true;
  const lanes = {...doc.lanes};
  if (Object.keys(cur).length) lanes[lane] = cur; else delete lanes[lane];
  return setPath(doc, ['lanes'], Object.keys(lanes).length ? lanes : undefined);
}

/** Give a lane the owner's own name; an empty name goes back to the automatic one. */
export function setLaneName(doc: Doc, lane: string, name: string): Doc {
  const cur = {...doc.lanes?.[lane]};
  if (name.trim()) cur.name = name.trim(); else delete cur.name;
  const lanes = {...doc.lanes};
  if (Object.keys(cur).length) lanes[lane] = cur; else delete lanes[lane];
  return setPath(doc, ['lanes'], Object.keys(lanes).length ? lanes : undefined);
}

/**
 * Everything that starts at/after t (side 'after') or ends at/before t ('before'), CapCut's
 * "select all to the right". Caption words and footage stay put (they belong to the voice).
 */
export function sideRefs(doc: Doc, t: number, side: 'before' | 'after'): Ref[] {
  const hit = (s: Span) => (side === 'after' ? s.start >= t - 1e-3 : s.end <= t + 1e-3);
  const out: Ref[] = [];
  clips(doc).forEach(c => hit({start: c.from, end: c.to}) && out.push({kind: 'clip', id: c.id}));
  zooms(doc).forEach((z, i) => hit(zoomSpan(z)) && out.push({kind: 'zoom', index: i}));
  sfxList(doc).forEach((s, i) => hit({start: s.at, end: s.at + (s.duration ?? SFX_DEFAULT)}) && out.push({kind: 'sfx', index: i}));
  transitions(doc).forEach((x, i) => hit({start: x.at, end: x.at + x.duration}) && out.push({kind: 'transition', index: i}));
  notes(doc).forEach(n => hit({start: n.at, end: n.at}) && out.push({kind: 'note', id: n.id}));
  return unlocked(doc, out);
}

// ---------- music beats (audio.music.beats, seconds; music always starts at 0) ----------

export const beats = (doc: Doc): number[] => doc.audio?.music?.beats ?? [];
export function addBeat(doc: Doc, t: number): Doc {
  if (!doc.audio?.music) return doc;
  const list = beats(doc).filter(b => Math.abs(b - t) > 0.04);
  return setPath(doc, ['audio', 'music', 'beats'], [...list, round(t)].sort((a, b) => a - b));
}
export function removeBeatNear(doc: Doc, t: number, within = 0.15): Doc {
  const list = beats(doc);
  if (!list.length) return doc;
  const i = list.reduce((best, b, k) => (Math.abs(b - t) < Math.abs(list[best] - t) ? k : best), 0);
  if (Math.abs(list[i] - t) > within) return doc;
  return setPath(doc, ['audio', 'music', 'beats'], list.filter((_, k) => k !== i));
}

// ---------- inserting time (freeze frames, slowing footage down) ----------

/**
 * Open `len` seconds of empty time at `at`: everything that starts at or after `at` moves right,
 * items crossing `at` get longer, the voice is split so it pauses through the new time.
 */
export function rippleInsert(doc: Doc, at: number, len: number): Doc {
  at = round(at); len = round(len);
  if (len <= 0) return doc;
  const next = clone(doc);
  const t = (x: number) => (x >= at ? round(x + len) : x);
  next.captions.words = words(doc).map(w => [t(w[0]), t(w[1]), w[2]]);
  next.clips = clips(doc).map(c => ({...c, from: t(c.from), to: c.to > at ? round(c.to + len) : c.to}));
  next.zooms = zooms(doc).map(z => {
    const c = clone(z);
    if ('t' in c) c.t = t(c.t);
    if ('t0' in c) c.t0 = t(c.t0);
    if ('t1' in c) c.t1 = t(c.t1);
    if (Array.isArray(c.steps)) c.steps = c.steps.map(([s, p]: [number, number]) => [t(s), p]);
    return c;
  });
  if (next.audio) next.audio.sfx = sfxList(doc).map(s => ({...s, at: t(s.at)}));
  next.transitions = transitions(doc).map(x => ({...x, at: t(x.at)}));
  if (doc.notes) next.notes = notes(doc).map(n => ({...n, at: t(n.at)}));
  if (doc.layout?.beats) next.layout.beats = doc.layout.beats.map((x: any) => ({...x, from: t(x.from), to: x.to > at ? round(x.to + len) : x.to}));
  const total = duration(doc);
  next.base = bases(doc).map(b => ((b.start ?? 0) >= at - 1e-6 ? {...b, start: round((b.start ?? 0) + len)} : b));
  const voice = doc.audio?.voice;
  if (voice) {
    const segs = voice.segments ?? [{start: 0, sourceIn: 0, duration: total}];
    next.audio.voice = {...voice, segments: segs.flatMap((sg: any) => {
      const e = sg.start + sg.duration;
      if (e <= at) return [sg];
      if (sg.start >= at) return [{...sg, start: round(sg.start + len)}];
      const head = round(at - sg.start);
      return [{...sg, duration: head}, {...sg, start: round(at + len), sourceIn: round(sg.sourceIn + head), duration: round(sg.duration - head)}];
    })};
  }
  next.settings.duration = round(total + len);
  return next;
}

// ---------- moving a stretch of time (main-track reorder) ----------

/** Cut voice segments at t so no segment crosses it (voice has no keys or speed). */
function splitVoiceAt(segs: any[], t: number): any[] {
  return segs.flatMap(sg => {
    if (t <= sg.start + MIN_LEN || t >= sg.start + sg.duration - MIN_LEN) return [sg];
    const head = round(t - sg.start);
    return [{...sg, duration: head}, {...sg, start: round(t), sourceIn: round(sg.sourceIn + head), duration: round(sg.duration - head)}];
  });
}

/**
 * Move the stretch [a, b) of the whole edit so it starts at `to` (a cut outside the stretch), and close
 * up behind it: CapCut's main-track reorder. Footage and voice are split at a, b and `to` and carried
 * along; every other item (words, clips, zooms, sounds, transitions, notes) follows the time it starts
 * at, so captions stay on their words and graphics on their shot. Length never changes, no gaps open.
 * Music and its beats stay where they are (music always starts at 0).
 */
export function moveRange(doc: Doc, a: number, b: number, to: number): Doc {
  a = round(Math.max(0, a)); b = round(Math.min(duration(doc), b)); to = round(to);
  const len = b - a;
  if (len <= MIN_LEN || (to > a - 1e-3 && to < b + 1e-3) || to < 0 || to > duration(doc) + 1e-3) return doc;
  // where time x ends up
  const m = (x: number): number => {
    if (to < a) return x >= a && x < b ? round(x - a + to) : x >= to && x < a ? round(x + len) : x;
    return x >= a && x < b ? round(x + (to - b)) : x >= b && x < to ? round(x - len) : x;
  };
  let d = doc;
  for (const t of [a, b, to]) d = splitBase(d, t).doc;
  const next = clone(d);
  const total = duration(doc);
  next.base = bases(d).map(x => ({...x, start: m(x.start ?? 0)})).sort((p, q) => p.start - q.start);
  const voice = d.audio?.voice;
  if (voice) {
    let segs = voice.segments ?? [{start: 0, sourceIn: 0, duration: total}];
    for (const t of [a, b, to]) segs = splitVoiceAt(segs, t);
    next.audio.voice = {...voice, segments: segs.map((sg: any) => ({...sg, start: m(sg.start)})).sort((p: any, q: any) => p.start - q.start)};
  }
  const by = (x: number) => m(x) - x;
  next.captions.words = words(d).map(w => [m(w[0]), round(w[1] + by(w[0])), w[2]]).sort((p, q) => (p[0] as number) - (q[0] as number));
  next.clips = clips(d).map(c => ({...c, from: m(c.from), to: round(c.to + by(c.from))}));
  next.zooms = zooms(d).map(z => { const c = clone(z); shiftZoom(c, by(zoomSpan(z).start)); return c; });
  if (next.audio) next.audio.sfx = sfxList(d).map(s => ({...s, at: m(s.at)}));
  next.transitions = transitions(d).map(x => ({...x, at: m(x.at)}));
  if (d.notes) next.notes = notes(d).map(n => ({...n, at: m(n.at)}));
  if (d.layout?.beats) next.layout.beats = d.layout.beats.map((x: any) => ({...x, from: m(x.from), to: round(x.to + by(x.from))}));
  return next;
}

/**
 * Drag footage piece `index` to sit before the piece now at `before` (bases in time order;
 * `before` = count puts it last). The linked voice, words and clips go with it. Returns the piece's new index.
 */
export function movePiece(doc: Doc, index: number, before: number): {doc: Doc; index: number} {
  const order = bases(doc).map((_, i) => i).sort((p, q) => getSpan(doc, {kind: 'base', index: p})!.start - getSpan(doc, {kind: 'base', index: q})!.start);
  const pos = order.indexOf(index);
  if (pos < 0 || before === pos || before === pos + 1) return {doc, index};
  const span = getSpan(doc, {kind: 'base', index})!;
  const to = before >= order.length ? duration(doc) : getSpan(doc, {kind: 'base', index: order[before]})!.start;
  const next = moveRange(doc, span.start, span.end, to);
  if (next === doc) return {doc, index};
  const start = to < span.start ? to : round(to - (span.end - span.start));
  const src = bases(doc)[index].src;
  return {doc: next, index: bases(next).findIndex(x => Math.abs((x.start ?? 0) - start) < 1e-3 && x.src === src)};
}

/** Hold the footage still for `len` seconds at `t` (CapCut "freeze"): the rest of the edit waits. */
export function insertFreeze(doc: Doc, t: number, len = 1): {doc: Doc; index: number | null} {
  t = round(t);
  let d = doc;
  let i = bases(d).findIndex(b => Math.abs((b.start ?? 0) - t) < 1e-3);
  if (i < 0) {
    const r = splitBase(d, t);
    if (r.index == null) return {doc, index: null};
    d = r.doc; i = r.index;
  }
  const after = bases(d)[i];
  const frozen = keyed({...after, start: t, duration: round(len), freeze: true}, windowKeys(after.keys, 0, 0));
  delete (frozen as any).speed;
  d = rippleInsert(d, t, len);
  const next = clone(d);
  next.base.splice(i, 0, frozen);
  return {doc: next, index: i};
}

/**
 * Play one footage piece faster or slower. Its length on the timeline becomes source / speed and the
 * rest of the edit closes up or waits; the voice keeps its own speed (use it on shots without talking).
 */
export function setBaseSpeed(doc: Doc, index: number, speed: number): Doc {
  const b = bases(doc)[index];
  if (!b || b.freeze || speed <= 0) return doc;
  const span = getSpan(doc, {kind: 'base', index})!;
  const oldSpeed = b.speed ?? 1;
  const source = (span.end - span.start) * oldSpeed;
  const len = round(Math.max(MIN_LEN, source / speed));
  const delta = round(len - (span.end - span.start));
  let next = delta > 0 ? rippleInsert(doc, span.end, delta) : delta < 0 ? rippleDelete(doc, round(span.end + delta), span.end) : doc;
  next = clone(next);
  // rippleDelete may have cut this piece's tail; rebuild it whole from the original.
  const stretch = len / Math.max(MIN_LEN, span.end - span.start);
  const piece = keyed({...b, start: span.start, duration: len}, b.keys?.map((k: Key) => ({...k, t: round(k.t * stretch)})));
  if (Math.abs(speed - 1) < 1e-6) delete (piece as any).speed; else (piece as any).speed = round(speed);
  const j = next.base.findIndex((x: any) => Math.abs((x.start ?? 0) - span.start) < 1e-3 && x.src === b.src);
  if (j >= 0) next.base[j] = piece;
  return next;
}

// ---------- keyframes on a clip's on-screen box ----------

export type Key = {t: number; x?: number; y?: number; scale?: number; rotate?: number; opacity?: number; ease?: string};

type Keyed = Ref | string;
const keyRef = (r: Keyed): Ref => (typeof r === 'string' ? {kind: 'clip', id: r} : r);
/** Keyframes live on clips (on-screen box) and on footage pieces (zoom, pan, rotate), in seconds from the item's start. */
export const keysOf = (doc: Doc, r: Keyed): Key[] => (getItem(doc, keyRef(r))?.keys ?? []) as Key[];
const itemLength = (doc: Doc, r: Ref) => { const s = getSpan(doc, r); return s ? s.end - s.start : 0; };
function withKeys(doc: Doc, r: Ref, keys: Key[]): Doc {
  const item = {...getItem(doc, r)};
  if (keys.length) item.keys = keys; else delete item.keys;
  return replaceItem(doc, r, item);
}

/** Put a keyframe at item time `t` (seconds from its start), replacing one within a frame of it. */
export function upsertKey(doc: Doc, target: Keyed, t: number, values: Omit<Key, 't'>): Doc {
  const r = keyRef(target);
  if (!getItem(doc, r)) return doc;
  t = round(Math.max(0, Math.min(itemLength(doc, r), t)));
  const all = keysOf(doc, r);
  const keys: Key[] = all.filter(k => Math.abs(k.t - t) > 1 / 60);
  const old = all.find(k => Math.abs(k.t - t) <= 1 / 60);
  const clean = Object.fromEntries(Object.entries({...old, ...values}).filter(([k, v]) => k !== 't' && v !== undefined).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]));
  keys.push({t, ...clean});
  keys.sort((a, b) => a.t - b.t);
  return withKeys(doc, r, keys);
}

export function removeKey(doc: Doc, target: Keyed, t: number): Doc {
  const r = keyRef(target);
  const keys = keysOf(doc, r);
  if (!keys.length) return doc;
  return withKeys(doc, r, keys.filter(k => Math.abs(k.t - t) > 1e-3));
}

/** Drag a keyframe to another time (CapCut "move keyframe position"); it never passes the item's ends. */
export function moveKey(doc: Doc, target: Keyed, from: number, to: number): Doc {
  const r = keyRef(target);
  const keys = keysOf(doc, r);
  const k = keys.find(x => Math.abs(x.t - from) < 1e-3);
  if (!k) return doc;
  to = round(Math.max(0, Math.min(itemLength(doc, r), to)));
  const rest = keys.filter(x => x !== k && Math.abs(x.t - to) > 1 / 60);
  return withKeys(doc, r, [...rest, {...k, t: to}].sort((a, b) => a.t - b.t));
}

/**
 * The keyframes of the stretch [from, to] of an item, re-timed to start at 0. When the stretch cuts
 * between keys, a key with the in-between value is added at each cut, so the motion carries on
 * exactly where it was (used when footage is split, trimmed or cut by text).
 */
export function windowKeys(keys: Key[] | undefined, from: number, to: number): Key[] | undefined {
  if (!keys?.length) return undefined;
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  const valueAt = (t: number): Key => {
    const v = keyedBox({x: NaN, y: NaN, scale: NaN, rotate: NaN, opacity: NaN}, sorted as Parameters<typeof keyedBox>[1], t) as Record<string, number>;
    const out: Key = {t: round(t - from)};
    for (const f of ['x', 'y', 'scale', 'rotate', 'opacity'] as const) if (Number.isFinite(v[f])) out[f] = round(v[f]);
    return out;
  };
  const out: Key[] = [valueAt(from)];
  for (const k of sorted) if (k.t > from + 1e-3 && k.t < to - 1e-3) out.push({...k, t: round(k.t - from)});
  if (to - from > 1e-3) {
    const end = valueAt(to);
    const ease = sorted.find(k => k.t >= to - 1e-3)?.ease;
    out.push(ease ? {...end, ease} : end);
  }
  return out;
}
const keyed = <T extends Record<string, any>>(piece: T, keys: Key[] | undefined): T => {
  const out: any = {...piece};
  if (keys?.length) out.keys = keys; else delete out.keys;
  return out;
};

// ---------- silences and filler words ----------

export type Cut = {start: number; end: number; kind: 'pause' | 'filler'; text?: string};

/** Default fillers (Egyptian Arabic + English); matched against whole caption words, punctuation ignored. */
export const FILLERS = ['آآ', 'اا', 'ااه', 'آه', 'ام', 'امم', 'اممم', 'ممم', 'إمم', 'اه', 'uh', 'um', 'umm', 'erm', 'ah'];
const bare = (w: string) => w.replace(/[\s.,،!?؟:;"'«»…-]+/g, '').toLowerCase();

/**
 * Silences longer than `minGap` between caption words (and before the first / after the last),
 * shrunk by `keep` on each side so speech keeps a little air. Plus filler words.
 */
export function findCuts(doc: Doc, minGap = 0.35, keep = 0.08, fillers: string[] = FILLERS): Cut[] {
  const ws = words(doc);
  if (!ws.length) return [];
  const out: Cut[] = [];
  const total = duration(doc);
  const gap = (a: number, b: number) => { if (b - a > minGap) out.push({start: round(a + keep), end: round(b - keep), kind: 'pause'}); };
  gap(-keep, ws[0][0]);
  const fill = new Set(fillers.map(bare));
  for (let i = 0; i < ws.length; i++) {
    const [s, e, text] = ws[i];
    if (fill.has(bare(text))) {
      const next = ws[i + 1]?.[0] ?? total;
      out.push({start: round(s), end: round(Math.min(next, e + 0.05)), kind: 'filler', text});
    }
    if (i < ws.length - 1) gap(e, ws[i + 1][0]);
  }
  if (total - ws.at(-1)![1] > minGap + keep) out.push({start: round(ws.at(-1)![1] + keep), end: round(total), kind: 'pause'});
  // merge overlaps (a filler next to a pause becomes one cut)
  out.sort((a, b) => a.start - b.start);
  const merged: Cut[] = [];
  for (const c of out) {
    if (c.end - c.start < 0.04) continue;
    const last = merged.at(-1);
    if (last && c.start <= last.end + 0.01) { last.end = Math.max(last.end, c.end); if (c.kind === 'filler') { last.kind = 'filler'; last.text = c.text; } }
    else merged.push({...c});
  }
  return merged.map(c => ({...c, start: Math.max(0, c.start)}));
}

/** Ripple-delete several ranges at once (latest first, so earlier times stay valid). */
export function rippleDeleteMany(doc: Doc, ranges: {start: number; end: number}[]): Doc {
  return [...ranges].sort((a, b) => b.start - a.start).reduce((d, r) => rippleDelete(d, r.start, r.end), doc);
}

/** Split the footage at t (CapCut "split" on the main track): one base entry becomes two. */
export function splitBase(doc: Doc, t: number): {doc: Doc; index: number | null} {
  const total = duration(doc);
  const i = bases(doc).findIndex(b => {
    const s = b.start ?? 0, e = s + (b.duration ?? Math.max(0, total - s));
    return t > s + MIN_LEN && t < e - MIN_LEN;
  });
  if (i < 0) return {doc, index: null};
  const next = clone(doc);
  const b = next.base[i];
  const s = b.start ?? 0, len = b.duration ?? Math.max(0, total - s), cut = round(t - s);
  next.base.splice(i, 1,
    keyed({...b, start: s, sourceIn: b.sourceIn ?? 0, duration: cut}, windowKeys(b.keys, 0, cut)),
    keyed({...b, start: round(t), sourceIn: round((b.sourceIn ?? 0) + cut), duration: round(len - cut)}, windowKeys(b.keys, cut, len)));
  return {doc: next, index: i + 1};
}

// ---------- transitions on footage cuts (CapCut: drag a transition onto a cut) ----------

/** The cuts in the footage: where each piece after the first starts, in time order. */
export function cutTimes(doc: Doc): number[] {
  return bases(doc).map((_, i) => getSpan(doc, {kind: 'base', index: i})!.start).sort((a, b) => a - b).slice(1);
}
/** The cut nearest t, or null when there is none within `within` seconds. */
export function nearestCut(doc: Doc, t: number, within = Infinity): number | null {
  const best = cutTimes(doc).reduce<number | null>((b, c) => (b == null || Math.abs(c - t) < Math.abs(b - t) ? c : b), null);
  return best != null && Math.abs(best - t) <= within ? best : null;
}
const covers = (x: {at: number; duration: number}, cut: number) => cut >= x.at - 1e-3 && cut <= x.at + x.duration + 1e-3;
/**
 * Put a transition on the cut at `cut`, centred on it (half before, half after), replacing one that is
 * already there. Its length never reaches past the middle of either piece.
 */
export function setCutTransition(doc: Doc, cut: number, type: string, duration = 0.5): {doc: Doc; index: number} {
  const spans = bases(doc).map((_, i) => getSpan(doc, {kind: 'base', index: i})!).sort((a, b) => a.start - b.start);
  const j = spans.findIndex(s => Math.abs(s.start - cut) < 1e-3);
  const room = j > 0 ? Math.min(spans[j - 1].end - spans[j - 1].start, spans[j].end - spans[j].start) : duration;
  const d = round(Math.max(0.1, Math.min(duration, room)));
  const list = transitions(doc).filter(x => !covers(x, cut));
  const item = {at: round(cut - d / 2), type, duration: d};
  const next = setPath(doc, ['transitions'], [...list, item].sort((a, b) => a.at - b.at));
  return {doc: next, index: next.transitions.findIndex((x: any) => x.at === item.at && x.type === type)};
}
/** CapCut "Apply to all": the same transition on every cut. */
export function transitionOnAllCuts(doc: Doc, type: string, duration = 0.5): Doc {
  return cutTimes(doc).reduce((d, c) => setCutTransition(d, c, type, duration).doc, doc);
}
/** The cut a transition sits on, if any. */
export const cutOf = (doc: Doc, x: {at: number; duration: number}): number | null => cutTimes(doc).find(c => covers(x, c)) ?? null;

// ---------- tracking (tools/track/track.py, reel/src/edit/tracking.ts) ----------

export type Follow = {track: string; mode?: 'perspective' | 'transform' | 'position'; point?: [number, number]};

/** Make a clip follow a track, or stop following (null). */
export function setFollow(doc: Doc, id: string, follow: Follow | null): Doc {
  const next = clone(doc);
  const c = clips(next).find(x => x.id === id);
  if (!c) return doc;
  if (follow) c.follow = follow; else delete c.follow;
  return next;
}

/** Add a clip that rides on a track over [from, to] (a highlight, a callout...). */
export function addTrackedClip(doc: Doc, component: string, from: number, to: number, props: Record<string, unknown>, follow: Follow): {doc: Doc; id: string} {
  const r = addClip(doc, component, from, props, Math.max(MIN_LEN, to - from));
  const c = clips(r.doc).find(x => x.id === r.id)!;
  c.follow = follow;
  return r;
}

/** Steady a footage piece with a stabilize track (null turns it off). */
export function setStabilize(doc: Doc, index: number, stabilize: {track: string; level?: string} | null): Doc {
  const next = clone(doc);
  const b = next.base?.[index];
  if (!b) return doc;
  if (stabilize) b.stabilize = stabilize; else delete b.stabilize;
  return next;
}
