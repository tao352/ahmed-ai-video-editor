// Timeline desk. Time runs left to right; every drag rebuilds the document from the
// state at pointer-down, so a gesture is one undo step and one human_changes line.
import {useDeskShape} from './PaneResize';
import {mediaDrop} from './MediaBin';
import {COMP_MIME, dropReplace, isMediaDrag} from './actions';
import {addTransitionAt, frameAt, TRANS_MIME} from './TransitionsBank';
import {transitionName} from './transitionTypes';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ArrowsLeftRight, FilmStrip, ImageSquare, Microphone, MusicNotes, Shapes, Sparkle, Subtitles, TextT, Waveform as WaveIcon, ArrowArcLeft, ArrowArcRight, ArrowLineLeft, ArrowLineRight, ArrowsOutLineHorizontal, CopySimple, Cursor, Eye, EyeSlash, Knife, Lock, LockOpen, MagnetStraight, MagnifyingGlassMinus, MagnifyingGlassPlus, NotePencil, Plus, Rows, Scissors, Snowflake, SpeakerHigh, SpeakerSlash, Trash} from '@phosphor-icons/react';
import {registry} from '../../../reel/src/edit/registry';
import * as op from '../model/ops';
import * as ed from '../model/edits';
import type {Doc, Ref} from '../model/ops';
import {type Thumbs, clearMarks, commit, redo, undo, currentDoc, editor, endGesture, endGroup, endSkim, startGesture, useDoc, fps, nowTime, seekTime, select, skimTo, toast, useEditor, usePlayhead} from '../store';
import {secs} from './format';
import {Waveform} from './Waveform';
import {Filmstrip} from './Filmstrip';
import {addNoteAtPlayhead, analyzeBeats, saveClipPreset, copySelection, extractAudio, groupSelection, deleteSide, fitTimeline, freezeAtPlayhead, toggleDisable, beatAtPlayhead, bladeAt, cutSelectedWords, deleteSelection, duplicateSelection, selectSide, setTool, splitAtPlayhead, toggleSkim, zoomTimeline} from './actions';
import {openMenu, type MenuItem} from './ContextMenu';
import {clipKind, trackRole} from './labels';
import {EASES, savedSmoothZoom} from './FootageMotion';

const HEAD_W = 188;
const DRAG_THRESHOLD = 3;

type Item = {ref: Ref; start: number; end: number; label: string; cls: string; marker?: boolean; title?: string; fadeIn?: number; fadeOut?: number; keys?: number[]; wave?: string; volume?: number; off?: boolean;
  /** footage: file, file time and speed, for the filmstrip */
  film?: {src: string; sourceIn: number; speed: number; freeze?: boolean};
  /** volume keyframes, drawn as a level curve over the block */
  env?: {t: number; v: number}[];
  /** a small tag on the clip (speed, freeze) and a picture shown along it (image clips) */
  badge?: string; still?: string; len?: boolean};

type LaneIcon = 'video' | 'media' | 'text' | 'graphic' | 'effect' | 'captions' | 'voice' | 'sound' | 'music' | 'zoom' | 'note' | 'transition';
const LANE_ICONS: Record<LaneIcon, React.ElementType> = {video: FilmStrip, media: ImageSquare, text: TextT, graphic: Shapes, effect: Sparkle, captions: Subtitles, voice: Microphone, sound: WaveIcon, music: MusicNotes, zoom: MagnifyingGlassPlus, note: NotePencil, transition: ArrowsLeftRight};
const envOf = (keys?: {t: number; volume?: number}[]) => keys?.filter(k => k.volume !== undefined).map(k => ({t: k.t, v: k.volume!}));
type Lane = {key: string; label: string; icon?: LaneIcon; items: Item[];
  /** items drawn on this lane that belong to other kinds (zooms, transitions on the main track) */
  extra?: Item[]; layer?: number; title?: string; joins?: number[]; tall?: boolean; thin?: boolean; overlay?: boolean; pinned?: boolean; wave?: boolean};

/** A clip that plays a file shows its own name (anim-03, caption-12, the file), text its words; others their component. */
const FILE_CLIPS = new Set(['VideoLayer', 'ImageLayer']);
function clipLabel(c: any): string {
  if (c.component === 'Text') return String(c.props?.text ?? '').replace(/\s+/g, ' ').trim() || 'Text'; // CapCut shows what the text says
  if (!FILE_CLIPS.has(c.component)) return c.component;
  const auto = /^(video|image)-layer-\d+$/.test(c.id);
  return auto ? String(c.props?.src ?? c.props?.image ?? c.id).split('/').pop() ?? c.id : c.id;
}

/** The icon of a clip track: the kind most of its clips are. */
function trackIcon(components: string[]): LaneIcon {
  const n = new Map<string, number>();
  for (const c of components) { const k = clipKind(c); n.set(k, (n.get(k) ?? 0) + 1); }
  return ([...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'graphic') as LaneIcon;
}

/** Notes for Claude: CapCut-style markers on the ruler. */
const noteItems = (doc: Doc): Item[] => op.notes(doc).map(n => ({ref: {kind: 'note', id: n.id}, start: n.at, end: n.at, label: n.text, cls: `${n.status === 'done' ? 'done' : ''} ${n.color ?? ''}`, marker: true, title: n.text || 'Note'}));

function buildLanes(doc: Doc): Lane[] {
  const lanes: Lane[] = [];
  lanes.push({key: 'words', label: 'Captions', icon: 'captions', tall: true, items: op.words(doc).map((w, i) => ({ref: {kind: 'word', index: i}, start: w[0], end: w[1], label: w[2], cls: 'word'}))});
  const tracks = [...new Set(op.clips(doc).map(c => c.track ?? 5))].sort((a, b) => b - a);
  for (const track of tracks) {
    const inTrack = op.clips(doc).filter(c => (c.track ?? 5) === track);
    const names = [...new Set(inTrack.map(c => c.component))];
    lanes.push({
      key: `track-${track}`, label: doc.lanes?.[`track-${track}`]?.name || trackRole(inTrack.map(c => c.component)), layer: track, overlay: true, icon: trackIcon(inTrack.map(c => c.component)),
      title: `Track ${track}: higher-numbered tracks appear above lower ones.
Contains: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} more` : ''}
Double-click the name to rename it.`,
      items: inTrack.map(c => ({
        ref: {kind: 'clip', id: c.id}, start: c.from, end: c.to, label: clipLabel(c), title: `${c.id} · ${c.component}`, keys: c.keys?.map((k: any) => k.t),
        cls: `clip k-${clipKind(c.component)}${registry[c.component] ? '' : ' unknown'}${c.group ? ' grouped' : ''}`, off: c.disabled, len: true,
        still: c.component === 'ImageLayer' && c.props?.image ? String(c.props.image) : undefined,
        film: c.component === 'VideoLayer' && c.props?.src ? {src: String(c.props.src), sourceIn: Number(c.props.sourceIn ?? 0), speed: 1} : undefined,
      })),
    });
  }
  // cuts between two footage pieces with no transition yet: CapCut shows a + there
  const spans = op.bases(doc).map((_, i) => op.getSpan(doc, {kind: 'base', index: i})!).filter(Boolean).sort((a, b) => a.start - b.start);
  const joins = spans.slice(1).map(s => s.start).filter((t, i) => Math.abs(spans[i].end - t) < 1e-3 && !op.transitions(doc).some(x => x.at <= t + 0.05 && x.at + x.duration >= t - 0.05));
  // CapCut keeps zooms and transitions on the main track itself: zooms as marks along its foot,
  // transitions as a chip across the cut.
  const onMain: Item[] = [
    ...op.zooms(doc).map((z, i) => {
      const s = op.zoomSpan(z);
      return {ref: {kind: 'zoom', index: i} as Ref, start: s.start, end: s.end, label: `${z.type} ${z.peak ?? z.steps?.at(-1)?.[1] ?? ''}`, cls: 'zoom on-main', title: `Zoom: ${z.label ?? z.type}`};
    }),
    ...op.transitions(doc).map((t, i) => ({ref: {kind: 'transition', index: i} as Ref, start: t.at, end: t.at + t.duration, label: transitionName(t.type), cls: 'transition on-main', title: `${transitionName(t.type)} transition: click to edit`})),
  ];
  lanes.push({key: 'base', label: 'Main', icon: 'video', pinned: true, joins, extra: onMain, items: op.bases(doc).map((b, i) => {
    const s = op.getSpan(doc, {kind: 'base', index: i})!;
    return {ref: {kind: 'base', index: i}, start: s.start, end: s.end, label: String(b.src).split('/').pop()!, badge: b.freeze ? 'Freeze' : b.speed && b.speed !== 1 ? `${b.speed}×` : undefined, len: true, cls: `base${b.freeze ? ' frozen' : ''}`, keys: b.keys?.map((k: any) => k.t), film: {src: b.src, sourceIn: b.sourceIn ?? 0, speed: b.freeze ? 0 : b.speed ?? 1}};
  })});
  if (doc.audio?.voice) lanes.push({key: 'voice', label: 'Speech', icon: 'voice', tall: true, wave: true, items: [{ref: {kind: 'voice'}, start: 0, end: op.duration(doc), label: '', cls: 'voice', title: 'Speech: click to adjust volume and clean up audio'}]});

  if (op.sfxList(doc).length) lanes.push({key: 'sfx', label: 'Sounds', icon: 'sound', items: op.sfxList(doc).map((s, i) => ({
    ref: {kind: 'sfx', index: i}, start: s.at, end: s.at + (s.duration ?? op.SFX_DEFAULT), label: String(s.file).split('/').pop()!.replace(/\.\w+$/, ''), len: true, cls: 'sfx', fadeIn: s.fadeIn, fadeOut: s.fadeOut, wave: s.file, volume: s.volume ?? 1, off: s.disabled, keys: s.keys?.map((k: any) => k.t), env: envOf(s.keys),
  }))});
  if (doc.audio?.music) {
    const m = doc.audio.music;
    lanes.push({key: 'music', label: 'Music', icon: 'music', items: [{ref: {kind: 'music'}, start: 0, end: op.duration(doc), label: `${m.src}${m.duck ? ` · ducks ${m.duck.db ?? 9}dB under speech` : ''}`, cls: 'music', fadeIn: m.fadeIn, fadeOut: m.fadeOut, wave: m.src, volume: m.volume, keys: m.keys?.map((k: any) => k.t), env: envOf(m.keys)}]});
  }
  return lanes;
}

// A drag changes one lane; the others keep their object so their rows skip rendering.
/** Everything drawn on a lane: its own items and the ones it carries for other kinds. */
const allItems = (l: Lane): Item[] => (l.extra?.length ? [...l.items, ...l.extra] : l.items);
const laneSig = (l: Lane) => JSON.stringify([l.label, l.title, l.joins, l.icon, allItems(l).map(i => [op.refKey(i.ref), i.start, i.end, i.label, i.cls, i.title, i.fadeIn, i.fadeOut, i.keys, i.volume, i.off, i.film, i.env])]);
const sigs = new WeakMap<Lane, string>();
function reuseLanes(next: Lane[], prev: Lane[]): Lane[] {
  const old = new Map(prev.map(l => [l.key, l]));
  return next.map(l => {
    const sig = laneSig(l);
    const was = old.get(l.key);
    if (was && sigs.get(was) === sig) return was;
    sigs.set(l, sig);
    return l;
  });
}
const laneKeys = new WeakMap<Lane, Set<string>>();
const keysOf = (l: Lane) => { let k = laneKeys.get(l); if (!k) { k = new Set(allItems(l).map(i => op.refKey(i.ref))); laneKeys.set(l, k); } return k; };

/** The stretch of time worth drawing: the visible part of the desk plus a screen on each side, in coarse steps. */
type Win = {from: number; to: number};
const WIN_STEP = 800;
function windowOf(el: HTMLElement | null, pps: number): Win {
  if (!el) return {from: 0, to: Infinity};
  const left = Math.floor(el.scrollLeft / WIN_STEP) * WIN_STEP;
  return {from: Math.max(0, (left - el.clientWidth) / pps), to: (left + WIN_STEP + el.clientWidth * 2) / pps};
}

// Which lanes can be hidden from the video or muted (the rest only lock).
const canHide = (key: string) => key.startsWith('track-') || key === 'words' || key === 'base' || key === 'zoom' || key === 'transitions';
const canMute = (key: string) => key === 'voice' || key === 'music' || key === 'sfx';

function tickStep(pps: number): [number, number] {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60, 120]) if (s * pps >= 70) return [s, s >= 5 ? s / 5 : s / 2];
  return [300, 60];
}

type Drag = {
  mode: 'move' | 'trim' | 'scrub' | 'fade' | 'key' | 'volume' | 'marquee' | 'reorder';
  startX: number; startScroll: number; started: boolean; startDoc: Doc; refs: Ref[]; edge?: op.Edge; group: string;
  origin: number; points: number[];
  /** key mode: the keyframe's time inside the item when the drag began */
  keyT?: number;
  startY: number;
  /** move mode: the track of the grabbed clip, to follow the pointer up and down */
  track?: number;
  /** volume mode: the value and block height when the drag began */
  volume?: number; height?: number;
};

export function Timeline() {
  const doc = useDoc('timeline');
  const selection = useEditor(s => s.selection);
  const flash = useEditor(s => s.flash);
  const marks = useEditor(s => s.claudeMarks);
  const pps = useEditor(s => s.pxPerSec);
  const snapOn = useEditor(s => s.snap);
  const tool = useEditor(s => s.tool);
  const skim = useEditor(s => s.skim);
  const canUndo = useEditor(s => Boolean(s.history?.past.length));
  const canRedo = useEditor(s => Boolean(s.history?.future.length));
  const thumbs = useEditor(s => s.thumbs);
  const scroller = useRef<HTMLDivElement>(null);
  const hoverLine = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [snapAt, setSnapAt] = useState<number | null>(null);
  const [win, setWin] = useState<Win>({from: 0, to: Infinity});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [laneSize, setLaneSize] = useState<number>(() => { try { return Number(localStorage.getItem('studio-editor:lane-size')) || 1; } catch { return 1; } });
  const cycleLaneSize = () => setLaneSize(k => { const n = k === 1 ? 1.5 : k === 1.5 ? 0.8 : 1; try { localStorage.setItem('studio-editor:lane-size', String(n)); } catch { /* ignore */ } return n; });
  const [marquee, setMarquee] = useState<{x0: number; y0: number; x1: number; y1: number} | null>(null);
  const finishMarquee = (x0: number, y0: number, x1: number, y1: number, add: boolean) => {
    const box = {l: Math.min(x0, x1), r: Math.max(x0, x1), t: Math.min(y0, y1), b: Math.max(y0, y1)};
    const byKey = new Map(prevLanes.current.flatMap(l => allItems(l).map(i => [op.refKey(i.ref), i.ref] as const)));
    const hits: Ref[] = [];
    scroller.current?.querySelectorAll<HTMLElement>('[data-key]').forEach(el => {
      const r = el.getBoundingClientRect();
      const ref = byKey.get(el.dataset.key!);
      if (ref && !op.isFixed(ref) && r.right > box.l && r.left < box.r && r.bottom > box.t && r.top < box.b) hits.push(ref);
    });
    select(add ? [...editor.get().selection, ...hits.filter(h => !editor.get().selection.some(s => op.sameRef(s, h)))] : hits);
  };

  const prevLanes = useRef<Lane[]>([]);
  const lanes = useMemo(() => (prevLanes.current = doc ? reuseLanes(buildLanes(doc), prevLanes.current) : []), [doc]);
  const notes = useMemo(() => (doc ? noteItems(doc) : []), [doc?.notes]);
  const noteSel = selection.filter(r => r.kind === 'note').map(op.refKey).join('|');
  // the cover frame (doc.cover.t, else the first frame) from the footage thumbnails, for the main track's head
  const thumbs0 = useEditor(s => s.thumbs);
  const coverStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!doc) return undefined;
    const t = doc.cover?.t ?? 0;
    const i = op.bases(doc).findIndex((_, k) => { const s = op.getSpan(doc, {kind: 'base', index: k})!; return t >= s.start && t < s.end; });
    const b = op.bases(doc)[Math.max(0, i)];
    if (!b) return undefined;
    const local = t - op.getSpan(doc, {kind: 'base', index: Math.max(0, i)})!.start;
    return frameAt(thumbs0[b.src], (b.sourceIn ?? 0) + local * (b.speed ?? 1), 'var(--lane-base)');
  }, [doc, thumbs0]);
  const selected = useMemo(() => new Set(selection.map(op.refKey)), [selection]);
  const total = doc ? op.duration(doc) : 0;
  const width = Math.ceil(total * pps) + 80;

  const timeAt = useCallback((clientX: number) => {
    const el = scroller.current!;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - HEAD_W;
    return Math.max(0, Math.min(total, x / pps));
  }, [pps, total]);

  // Only the visible stretch of the desk is drawn; it moves in coarse steps while scrolling.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setWin(w => { const n = windowOf(el, pps); return n.from === w.from && n.to === w.to ? w : n; });
    update();
    el.addEventListener('scroll', update, {passive: true});
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, [pps, doc != null]);

  // ---------- gestures ----------

  const begin = (e: React.PointerEvent, mode: Drag['mode'], refs: Ref[], edge?: op.Edge, keyT?: number, from?: Doc) => {
    const d = from ?? currentDoc();
    if (!d || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* synthetic events have no pointer */ }
    const first = refs[0] ? op.getSpan(d, refs[0]) : null;
    const origin = mode === 'key' && first ? first.start + (keyT ?? 0) : mode === 'fade' && first ? (edge === 'start' ? first.start + op.fadeOf(d, refs[0], 'start') : first.end - op.fadeOf(d, refs[0], 'end'))
      : mode === 'trim' && first ? (edge === 'start' ? first.start : first.end) : first?.start ?? 0;
    drag.current = {
      mode, startX: e.clientX, startScroll: scroller.current?.scrollLeft ?? 0, started: mode === 'scrub', startDoc: d, refs, edge, group: `${mode}:${Date.now()}`, origin,
      points: op.snapPoints(d, refs, [nowTime()]), keyT, startY: e.clientY,
      track: mode === 'move' && refs[0]?.kind === 'clip' ? op.getItem(d, refs[0])?.track ?? 5 : undefined,
      volume: mode === 'volume' ? op.getItem(d, refs[0])?.volume ?? 1 : undefined,
      height: mode === 'volume' ? (e.currentTarget as HTMLElement).parentElement?.clientHeight ?? 24 : undefined,
    };
    startGesture('timeline');
    if (mode === 'scrub') seekTime(timeAt(e.clientX));
  };

  useEffect(() => {
    // Pointer moves arrive faster than the screen draws; apply only the latest one per frame.
    let pendingX: number | null = null, pendingY = 0;
    let raf = 0;
    const apply = (clientX: number, clientY = pendingY) => {
      const g = drag.current;
      if (!g) return;
      if (g.mode === 'scrub') { seekTime(timeAt(clientX)); return; }
      // distance in timeline pixels: the desk may have scrolled under the pointer since the press
      const dx = clientX - g.startX + (scroller.current?.scrollLeft ?? 0) - g.startScroll;
      const dy = clientY - g.startY;
      if (!g.started && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      g.started = true;
      if (g.mode === 'marquee') { setMarquee({x0: g.startX, y0: g.startY, x1: clientX, y1: clientY}); return; }
      if (g.mode === 'volume') {
        // drag the level line: the full block height is 0 .. 2x
        const v = Math.round(Math.max(0, Math.min(2, g.volume! - (dy / Math.max(10, g.height!)) * 2)) * 100) / 100;
        const r = g.refs[0];
        commit(op.replaceItem(g.startDoc, r, {...op.getItem(g.startDoc, r), volume: v}), 'volume', {group: g.group, change: `volume of ${op.refLabel(g.startDoc, r)} set to ${v}`});
        return;
      }
      if (g.mode === 'reorder') {
        // main-track magnet: the piece drops into the slot under the pointer, the rest closes up
        const r = g.refs[0] as {kind: 'base'; index: number};
        const tp = timeAt(clientX);
        const order = op.bases(g.startDoc).map((_, i) => ({i, s: op.getSpan(g.startDoc, {kind: 'base', index: i})!})).sort((p, q) => p.s.start - q.s.start);
        const pos = order.findIndex(o => o.i === r.index);
        const k = order.filter(o => o.i !== r.index && (o.s.start + o.s.end) / 2 < tp).length;
        const before = k <= pos ? k : k + 1;
        const res = op.movePiece(g.startDoc, r.index, before);
        const at = op.getSpan(res.doc, {kind: 'base', index: res.index});
        setSnapAt(res.doc !== g.startDoc && at ? at.start : null);
        commit(res.doc, 'reorder', {group: g.group, change: res.doc === g.startDoc ? 'footage order unchanged' : `moved footage piece #${r.index} (${op.bases(g.startDoc)[r.index].src}) to slot ${before}, with its voice, words and clips`, selection: [{kind: 'base', index: res.index}]});
        return;
      }
      const raw = g.origin + dx / pps;
      const threshold = 8 / pps;
      if (g.mode === 'key') {
        const span = op.getSpan(g.startDoc, g.refs[0])!;
        const target = editor.get().snap ? op.snap(raw, g.points, threshold) : raw;
        setSnapAt(target !== raw ? target : null);
        const to = Math.max(0, Math.min(span.end - span.start, target - span.start));
        commit(op.moveKey(g.startDoc, g.refs[0], g.keyT!, to), 'keyframe', {group: g.group, change: `moved keyframe of ${op.refLabel(g.startDoc, g.refs[0])} +${g.keyT!.toFixed(2)}s -> +${to.toFixed(2)}s`});
        seekTime(span.start + to);
        return;
      }
      if (g.mode === 'fade') {
        const span = op.getSpan(g.startDoc, g.refs[0])!;
        const secs = g.edge === 'start' ? raw - span.start : span.end - raw;
        const next = op.setFade(g.startDoc, g.refs[0], g.edge!, secs);
        commit(next, 'fade', {group: g.group, change: `fade ${g.edge === 'start' ? 'in' : 'out'} of ${op.refLabel(g.startDoc, g.refs[0])} set to ${op.fadeOf(next, g.refs[0], g.edge!).toFixed(2)}s`});
        return;
      }
      if (g.mode === 'move') {
        let target = raw;
        // up and down: the clip follows the pointer to another track (above the top track: a new one)
        let dTrack = 0;
        if (g.track != null && Math.abs(dy) > 8) { // only look for another track once the pointer really went up or down
          const row = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest('.lane') as HTMLElement | null;
          const layer = row?.dataset.layer, tracks = op.clips(g.startDoc).map(c => c.track ?? 5);
          if (layer) dTrack = Number(layer) - g.track;
          else if (row && (row.dataset.lane === 'words' || row.dataset.lane === 'notes')) dTrack = Math.max(...tracks) + 1 - g.track;
        }
        let hit: number | null = null;
        if (editor.get().snap) {
          const span = op.getSpan(g.startDoc, g.refs[0])!;
          const len = span.end - span.start;
          const s1 = op.snap(raw, g.points, threshold), s2 = op.snap(raw + len, g.points, threshold) - len;
          if (s1 !== raw && (s2 === raw || Math.abs(s1 - raw) <= Math.abs(s2 - raw))) { target = s1; hit = s1; }
          else if (s2 !== raw) { target = s2; hit = s2 + len; }
        }
        setSnapAt(hit);
        let next = op.moveItems(g.startDoc, g.refs, target - g.origin);
        const ids = g.refs.filter(r => r.kind === 'clip').map(r => (r as {id: string}).id);
        if (dTrack) next = ed.moveToTrack(next, ids, dTrack);
        next = ed.settleTracks(next, ids);
        commit(next, 'move', {group: g.group, change: op.describeMove(next, g.refs, g.startDoc) + (dTrack ? ` and ${dTrack > 0 ? 'up' : 'down'} ${Math.abs(dTrack)} track(s)` : ''), selection: op.remapWordRefs(g.startDoc, next, g.refs)});
      } else {
        const target = editor.get().snap ? op.snap(raw, g.points, threshold) : raw;
        setSnapAt(target !== raw ? target : null);
        const r = g.refs[0];
        // the footage is the main track: trimming it closes the gap, everything after follows (CapCut)
        const next = r.kind === 'base' ? ed.rippleTrimBase(g.startDoc, r.index, g.edge!, target) : op.trimItem(g.startDoc, r, g.edge!, target);
        commit(next, 'trim', {group: g.group, change: r.kind === 'base' ? `ripple-trimmed the ${g.edge} of footage piece #${r.index} to ${target.toFixed(2)}s` : op.describeTrim(next, r)});
      }
    };
    const flush = () => { raf = 0; if (pendingX != null) { const x = pendingX; pendingX = null; apply(x, pendingY); } };
    // Held near either edge of the desk, the desk scrolls and the drag keeps following (CapCut style).
    let lastX = 0, edgeRaf = 0;
    const edgeScroll = () => {
      edgeRaf = 0;
      const el = scroller.current;
      if (!drag.current || !el) return;
      const r = el.getBoundingClientRect(), zone = 48;
      const left = r.left + HEAD_W + zone, right = r.right - zone;
      const v = lastX < left ? -Math.min(1, (left - lastX) / zone) : lastX > right ? Math.min(1, (lastX - right) / zone) : 0;
      if (v) {
        const before = el.scrollLeft;
        el.scrollLeft += v * 18;
        if (el.scrollLeft !== before) apply(lastX);
      }
      edgeRaf = requestAnimationFrame(edgeScroll);
    };
    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      lastX = e.clientX;
      if (!edgeRaf) edgeRaf = requestAnimationFrame(edgeScroll);
      pendingX = e.clientX; pendingY = e.clientY;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const up = (e: PointerEvent) => {
      cancelAnimationFrame(edgeRaf); edgeRaf = 0;
      if (raf) { cancelAnimationFrame(raf); flush(); }
      const g = drag.current;
      if (g?.mode === 'marquee') {
        if (g.started) finishMarquee(g.startX, g.startY, e.clientX, e.clientY, e.shiftKey || e.ctrlKey);
        else { select([]); seekTime(timeAt(e.clientX)); } // a plain click on empty desk moves the playhead
        setMarquee(null);
      }
      if (drag.current) { endGroup(); endGesture(); }
      drag.current = null;
      setSnapAt(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { cancelAnimationFrame(raf); cancelAnimationFrame(edgeRaf); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [pps, timeAt]);

  // files from the computer or cards from the media bin land where they are dropped; held over a
  // video, picture or sound block for a moment they Replace it instead (CapCut)
  const place = mediaDrop(e => timeAt(e.clientX));
  const hover = useRef<{key: string; since: number} | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const armedRef = useRef<string | null>(null);
  const arm = (k: string | null) => { if (armedRef.current !== k) { armedRef.current = k; setArmed(k); } };
  const refOf = (k: string) => lanes.flatMap(allItems).find(i => op.refKey(i.ref) === k)?.ref ?? null;
  const replaceable = (r: Ref | null) => !!r && (r.kind === 'base' || r.kind === 'sfx' || r.kind === 'music'
    || (r.kind === 'clip' && ['VideoLayer', 'ImageLayer'].includes(op.getItem(currentDoc()!, r)?.component)));
  const drop = {
    onDragOver(e: React.DragEvent) {
      if (e.dataTransfer.types.includes(TRANS_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; return; }
      place.onDragOver(e);
      if (!isMediaDrag(e.dataTransfer) || e.dataTransfer.types.includes(COMP_MIME)) return; // a component adds, never replaces
      const k = (e.target as Element).closest?.('.block[data-key]')?.getAttribute('data-key') ?? null;
      if (!k || !replaceable(refOf(k))) { hover.current = null; arm(null); return; }
      const now = performance.now();
      if (hover.current?.key !== k) { hover.current = {key: k, since: now}; arm(null); return; }
      if (now - hover.current.since > 450) arm(k);
    },
    onDragLeave(e: React.DragEvent) {
      if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) { hover.current = null; arm(null); }
    },
    onDrop(e: React.DragEvent) {
      const trans = e.dataTransfer.getData(TRANS_MIME);
      if (trans) { e.preventDefault(); addTransitionAt(trans, timeAt(e.clientX), 40 / editor.get().pxPerSec + 0.3); return; } // CapCut: drop it on a cut
      const k = armedRef.current;
      hover.current = null; arm(null);
      const ref = k ? refOf(k) : null;
      if (ref && isMediaDrag(e.dataTransfer)) {
        e.preventDefault();
        void dropReplace(e.dataTransfer, ref);
        return;
      }
      place.onDrop(e);
    },
  };
  useEffect(() => {
    if (!armed) return;
    const el = scroller.current?.querySelector(`[data-key="${CSS.escape(armed)}"]`);
    el?.classList.add('replace-armed');
    return () => el?.classList.remove('replace-armed');
  }, [armed]);

  const laneState = (key: string) => (doc?.lanes?.[key] ?? {}) as LaneSwitches;
  const flipLane = (key: string, sw: keyof LaneSwitches) => {
    const d = currentDoc();
    if (!d) return;
    const on = !((d.lanes?.[key] ?? {}) as LaneSwitches)[sw];
    commit(op.toggleLane(d, key, sw), 'lane', {change: `${on ? '' : 'un'}${sw === 'locked' ? 'locked' : sw === 'hidden' ? 'hid' : 'muted'} lane ${key}`});
  };

  // Rows are memoised, so they get one stable object whose functions always see the latest state.
  const act = useRef<RowActions>(null as unknown as RowActions);
  act.current = {
    setCover() {
      const d = currentDoc();
      if (!d) return;
      const t = op.round(nowTime());
      commit(op.setPath(d, ['cover'], {t}), 'cover', {change: `cover set to the frame at ${t.toFixed(2)}s`});
      toast(`Cover set to ${t.toFixed(2)}s. The export also saves it as a picture.`);
    },
    blockDown(e, item) {
      clearMarks([op.refKey(item.ref)]);
      if (tool === 'blade' && e.button === 0) { e.stopPropagation(); bladeAt(item.ref, timeAt(e.clientX)); return; }
      if (doc && op.isLocked(doc, item.ref)) { select([item.ref]); return; } // locked: look, don't touch
      const multi = e.shiftKey || e.ctrlKey || e.metaKey;
      let refs = selection;
      if (multi) {
        refs = selected.has(op.refKey(item.ref)) ? selection.filter(r => !op.sameRef(r, item.ref)) : [...selection, item.ref];
        select(refs);
        return;
      }
      if (!selected.has(op.refKey(item.ref))) { refs = doc ? ed.withGroups(doc, [item.ref]) : [item.ref]; select(refs); }
      if (item.ref.kind === 'base' && op.bases(doc!).length > 1) { select([item.ref]); begin(e, 'reorder', [item.ref]); return; }
      if (!op.isMovable(item.ref)) return;
      const movable = op.unlocked(doc!, refs).filter(op.isMovable);
      if (e.altKey && doc) {
        // Alt + drag: drag a copy, the original stays (CapCut)
        const board = ed.copyItems(doc, movable);
        const r = ed.pasteItems(doc, board, Math.min(...board.map(b => b.start)));
        if (r.created.length) { select(r.created); begin(e, 'move', r.created, undefined, undefined, r.doc); return; }
      }
      begin(e, 'move', movable);
    },
    blockMenu(e, item) {
      e.preventDefault();
      if (!selected.has(op.refKey(item.ref))) select([item.ref]);
      const k = item.ref.kind;
      const fixed = op.isFixed(item.ref);
      const items: MenuItem[] = [];
      if (k === 'clip' || k === 'base') items.push({label: 'Split at playhead', hint: 'Ctrl+B', action: splitAtPlayhead}, {label: 'Delete before playhead', hint: 'Q', action: () => deleteSide('left')}, {label: 'Delete after playhead', hint: 'W', action: () => deleteSide('right')});
      if (k === 'clip' || k === 'base') items.push({label: 'Extract audio', action: () => void extractAudio()});
      if (k === 'clip') items.push(op.getItem(currentDoc() ?? {}, item.ref)?.group ? {label: 'Ungroup', hint: 'Ctrl+Shift+G', action: () => groupSelection(false)} : {label: 'Group selected', hint: 'Ctrl+G', action: () => groupSelection(true)});
      if (k === 'clip') items.push({label: 'Save as preset…', action: () => void saveClipPreset()});
      if (k === 'clip' || k === 'sfx') items.push({label: op.getItem(currentDoc() ?? {}, item.ref)?.disabled ? 'Enable clip' : 'Disable clip (stays in place)', hint: 'V', action: toggleDisable}, {label: 'Copy', hint: 'Ctrl+C', action: () => copySelection()});
      if (k === 'word') items.push({label: 'Remove this speech from the video', hint: 'Shift+Delete', action: cutSelectedWords});
      if (!fixed) items.push({label: 'Duplicate', hint: 'Ctrl+D', action: duplicateSelection});
      items.push({label: 'Go to start', action: () => seekTime(item.start)}, {label: 'Note here', hint: 'M', action: () => { seekTime(item.start); addNoteAtPlayhead(); }});
      if (!fixed) items.push('sep', {label: 'Delete', hint: 'Delete', danger: true, action: deleteSelection});
      if (k === 'base') items.push('sep', {label: 'Smooth zoom here', action: () => {
        const d = currentDoc(), r = item.ref as {kind: 'base'; index: number}, sp = d && op.getSpan(d, r);
        if (!d || !sp) return;
        const t = Math.max(0, Math.min(sp.end - sp.start, nowTime() - sp.start)), z = savedSmoothZoom();
        commit(ed.smoothZoom(d, r.index, t, z), 'keyframe', {change: `footage piece #${r.index}: smooth zoom ${z.amount}x at +${t.toFixed(2)}s`});
      }});
      if (k === 'base') items.push('sep', {label: 'Delete this part of the video', hint: 'Delete', danger: true, action: deleteSelection});
      openMenu(e.clientX, e.clientY, items);
    },
    gripDown(e, item, edge) {
      select([item.ref]);
      if (tool === 'blade' || (doc && op.isLocked(doc, item.ref))) return;
      begin(e, 'trim', [item.ref], edge);
    },
    fadeDown(e, item, edge) { select([item.ref]); begin(e, 'fade', [item.ref], edge); },
    keyDown(e, item, k) {
      e.stopPropagation();
      select([item.ref]);
      seekTime(item.start + k);
      if (tool !== 'blade' && !(doc && op.isLocked(doc, item.ref))) begin(e, 'key', [item.ref], undefined, k);
    },
    keyMenu(e, item, k) {
      e.preventDefault(); e.stopPropagation();
      select([item.ref]);
      const set = (ease: string) => { const d = currentDoc(); if (d) commit(op.upsertKey(d, item.ref, k, {ease: (ease === 'linear' ? undefined : ease) as op.Key['ease']}), 'keyframe', {change: `keyframe +${k.toFixed(2)}s of ${op.refLabel(d, item.ref)} ease ${ease}`}); };
      const ease = op.keysOf(currentDoc() ?? {}, item.ref).find(x => Math.abs(x.t - k) < 1e-3)?.ease ?? 'linear';
      openMenu(e.clientX, e.clientY, [
        ...EASES.map(([v, n]) => ({label: `${v === ease ? '● ' : ''}${n}`, action: () => set(v)})),
        'sep',
        {label: 'Delete keyframe', danger: true, action: () => { const d = currentDoc(); if (d) commit(op.removeKey(d, item.ref, k), 'keyframe', {change: `removed keyframe +${k.toFixed(2)}s of ${op.refLabel(d, item.ref)}`}); }},
      ]);
    },
    trackDown(e) { if (e.target === e.currentTarget) begin(e, 'marquee', []); },
    volumeDown(e, item) { e.stopPropagation(); select([item.ref]); if (!(doc && op.isLocked(doc, item.ref))) begin(e, 'volume', [item.ref]); },
    laneMenu(e, lane) {
      e.preventDefault();
      const ls = laneState(lane.key);
      const items: MenuItem[] = [
        {label: 'Select all on track', action: () => select(lane.items.map(i => i.ref))},
        ...(lane.layer != null ? [{label: 'Rename track', action: () => setRenaming(lane.key)}] : []),
        {label: ls.locked ? 'Unlock track' : 'Lock track', action: () => flipLane(lane.key, 'locked')},
      ];
      if (canHide(lane.key)) items.push({label: ls.hidden ? 'Show' : 'Hide from video', action: () => flipLane(lane.key, 'hidden')});
      if (canMute(lane.key)) items.push({label: ls.muted ? 'Unmute' : 'Mute', action: () => flipLane(lane.key, 'muted')});
      if (lane.key === 'music') items.push('sep', {label: 'Detect beats', action: () => void analyzeBeats()}, {label: 'Beat at playhead', hint: 'B', action: () => beatAtPlayhead()}, {label: 'Remove all beats', danger: true, action: () => { const d = currentDoc(); if (d) commit(op.setPath(d, ['audio', 'music', 'beats'], undefined), 'beats', {change: 'cleared music beats'}); }});
      openMenu(e.clientX, e.clientY, items);
    },
    rename(lane, name) {
      setRenaming(null);
      const d = currentDoc();
      if (!d || name === undefined || name === (d.lanes?.[lane.key]?.name ?? '')) return;
      commit(op.setLaneName(d, lane.key, name), 'lane', {change: name.trim() ? `named lane ${lane.key} "${name.trim()}"` : `cleared the name of lane ${lane.key}`});
    },
    startRename(lane) { if (lane.layer != null) setRenaming(lane.key); },
    addTransition(t) {
      const d = currentDoc();
      if (!d) return;
      const next = op.setPath(d, ['transitions'], [...op.transitions(d), {at: op.round(t - 0.15), type: 'zoomBlur', duration: 0.3}]);
      commit(next, 'transition', {change: `added a zoomBlur transition on the cut at ${t.toFixed(2)}s`, selection: [{kind: 'transition', index: op.transitions(next).length - 1}]});
    },
    selectLane(lane) { select(lane.items.map(i => i.ref)); clearMarks([...keysOf(lane)]); },
    flipLane,
  };

  // ---------- preview axis: the monitor follows the mouse, the playhead stays ----------
  // The hover line is moved directly, so the mouse never re-renders the desk.
  const onHover = (e: React.PointerEvent) => {
    const line = hoverLine.current;
    if (drag.current || !line) return;
    const t = timeAt(e.clientX);
    const show = skim || tool === 'blade';
    line.style.display = show ? '' : 'none';
    if (show) line.style.left = `${HEAD_W + t * pps}px`;
    if (skim) skimTo(t * fps());
  };
  const onLeave = () => { if (hoverLine.current) hoverLine.current.style.display = 'none'; endSkim(); };

  // ---------- zoom with ctrl+wheel around the cursor ----------
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const t = timeAt(e.clientX);
      const before = t * editor.get().pxPerSec;
      zoomTimeline(e.deltaY < 0 ? 1.15 : 1 / 1.15);
      requestAnimationFrame(() => { el.scrollLeft += t * editor.get().pxPerSec - before; });
    };
    el.addEventListener('wheel', wheel, {passive: false});
    return () => el.removeEventListener('wheel', wheel);
  }, [timeAt]);

  if (!doc) return <section className="desk" />;

  const voice = doc.audio?.voice;
  return (
    <section className="desk" aria-label="Timeline" style={{['--head-w' as string]: `${HEAD_W}px`, ['--lane-k' as string]: laneSize}}>
      <DeskResize />
      <div className="desk-tools">
        {/* CapCut order: tool mode, undo/redo, then the cutting tools; view switches on the right */}
        <div className="seg" role="group" aria-label="Tool">
          <button className={`key small icon ${tool === 'select' ? 'lit' : ''}`} title="Select and move (A)" aria-label="Select" aria-pressed={tool === 'select'} onClick={() => setTool('select')}><Cursor size={14} /></button>
          <button className={`key small icon ${tool === 'blade' ? 'lit' : ''}`} title="Split mode: click any clip to cut it where you click (B)" aria-label="Split mode" aria-pressed={tool === 'blade'} onClick={() => setTool(tool === 'blade' ? 'select' : 'blade')}><Knife size={14} /></button>
        </div>
        <button className="key small icon" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={undo}><ArrowArcLeft size={14} /></button>
        <button className="key small icon" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo} onClick={redo}><ArrowArcRight size={14} /></button>
        <span className="tool-sep" />
        <button className="key small icon" title="Split at playhead (Ctrl+B)" aria-label="Split" onClick={splitAtPlayhead}><Scissors size={14} /></button>
        <button className="key small icon" title="Delete left of playhead (Q)" aria-label="Delete left" onClick={() => deleteSide('left')}><ArrowLineLeft size={14} /></button>
        <button className="key small icon" title="Delete right of playhead (W)" aria-label="Delete right" onClick={() => deleteSide('right')}><ArrowLineRight size={14} /></button>
        <button className="key small icon" title="Delete (Delete)" aria-label="Delete" disabled={!selection.length} onClick={deleteSelection}><Trash size={14} /></button>
        <button className="key small icon" title="Freeze frame, 1 s (F)" aria-label="Freeze frame" onClick={() => freezeAtPlayhead()}><Snowflake size={14} /></button>
        <button className="key small icon" title="Duplicate (Ctrl+D)" aria-label="Duplicate" disabled={!selection.length} onClick={duplicateSelection}><CopySimple size={14} /></button>
        <button className="key small icon" title="Note at playhead (M)" aria-label="Note" onClick={addNoteAtPlayhead}><NotePencil size={14} /></button>
        <span className="spacer" />
        <button className={`key small icon ${snapOn ? 'lit' : ''}`} title="Auto snapping (N)" aria-label="Auto snapping" aria-pressed={snapOn} onClick={() => editor.set(s => ({...s, snap: !s.snap}))}><MagnetStraight size={14} /></button>
        <button className={`key small icon ${skim ? 'lit' : ''}`} title="Preview axis: the player follows the mouse over the timeline (S)" aria-label="Preview axis" aria-pressed={skim} onClick={toggleSkim}><Eye size={14} /></button>
        <button className="key small icon" title={`Track height: ${laneSize === 1 ? 'Normal' : laneSize > 1 ? 'Large' : 'Small'}`} aria-label="Track height" onClick={cycleLaneSize}><Rows size={14} /></button>
        <span className="tool-sep" />
        <button className="key small icon" title="Zoom out (-)" aria-label="Zoom out timeline" onClick={() => zoomTimeline(1 / 1.4)}><MagnifyingGlassMinus size={14} /></button>
        <input className="zoom-slider" type="range" min={0} max={1} step={0.001} aria-label="Timeline zoom" title="Timeline zoom (Ctrl + wheel)"
          value={Math.log(pps / 8) / Math.log(600 / 8)} onChange={e => editor.set(st => ({...st, pxPerSec: 8 * Math.pow(600 / 8, Number(e.target.value))}))} />
        <button className="key small icon" title="Zoom in (+)" aria-label="Zoom in timeline" onClick={() => zoomTimeline(1.4)}><MagnifyingGlassPlus size={14} /></button>
        <button className="key small icon" title="Fit the whole video (Shift+Z)" aria-label="Fit timeline" onClick={fitTimeline}><ArrowsOutLineHorizontal size={14} /></button>
      </div>
      <div className={`desk-scroll ${tool === 'blade' ? 'blade' : ''}`} ref={scroller} onPointerMove={onHover} onPointerLeave={onLeave} {...drop}>
        <div className="desk-grid" style={{width: width + HEAD_W}}>
          <Ruler total={total} pps={pps} win={win} onDown={e => begin(e, 'scrub', [])} notes={notes} sel={noteSel} act={act} />
          {lanes.map(lane => {
            const keys = keysOf(lane);
            const sel = allItems(lane).filter(i => selected.has(op.refKey(i.ref))).map(i => op.refKey(i.ref)).join('|');
            const lit = selection.length > 0 && selection.every(r => keys.has(op.refKey(r)));
            const ls = laneState(lane.key);
            return (
              <LaneRow key={lane.key} lane={lane} pps={pps} winFrom={win.from} winTo={win.to} sel={sel} lit={lit}
                flash={flash} led={[...keys].some(k => marks.has(k))} locked={!!ls.locked} hidden={!!ls.hidden} muted={!!ls.muted}
                beats={lane.key === 'music' ? doc.audio?.music?.beats : undefined}
                wave={lane.wave && voice ? voice : undefined} total={total} act={act} renaming={renaming === lane.key}
                cover={lane.key === 'base' ? coverStyle : undefined} thumbs={lane.key === 'base' || lane.overlay ? thumbs : undefined} filmH={lane.key === 'base' ? Math.round(44 * laneSize) - 2 : Math.round(24 * laneSize) - 6} />
            );
          })}
          <Playline pps={pps} scroller={scroller} onGrab={e => begin(e, 'scrub', [])} />
          {snapAt != null && <div className="snapline" style={{left: HEAD_W + snapAt * pps}} />}
          <div ref={hoverLine} className={`skimline ${tool === 'blade' ? 'blade' : ''}`} style={{display: 'none'}} />
          {marquee && <MarqueeBox m={marquee} scroller={scroller} />}
        </div>
      </div>
    </section>
  );
}

type LaneSwitches = {locked?: boolean; hidden?: boolean; muted?: boolean};
type RowActions = {
  setCover(): void;
  blockDown(e: React.PointerEvent, item: Item): void;
  blockMenu(e: React.MouseEvent, item: Item): void;
  gripDown(e: React.PointerEvent, item: Item, edge: op.Edge): void;
  fadeDown(e: React.PointerEvent, item: Item, edge: op.Edge): void;
  keyDown(e: React.PointerEvent, item: Item, k: number): void;
  keyMenu(e: React.MouseEvent, item: Item, k: number): void;
  trackDown(e: React.PointerEvent, lane: Lane): void;
  volumeDown(e: React.PointerEvent, item: Item): void;
  laneMenu(e: React.MouseEvent, lane: Lane): void;
  selectLane(lane: Lane): void;
  addTransition(t: number): void;
  /** undefined = cancelled */
  rename(lane: Lane, name: string | undefined): void;
  startRename(lane: Lane): void;
  flipLane(key: string, sw: keyof LaneSwitches): void;
};

const Ruler = React.memo(function Ruler({total, pps, win, onDown, notes, sel, act}: {total: number; pps: number; win: Win; onDown: (e: React.PointerEvent) => void; notes: Item[]; sel: string; act: React.RefObject<RowActions>}) {
  const [major, minor] = tickStep(pps);
  const first = Math.max(0, Math.floor(win.from / minor)), last = Math.floor(Math.min(total, win.to) / minor);
  const ticks = [];
  for (let i = first; i <= last; i++) {
    const t = i * minor;
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    ticks.push(<div key={i} className={`tick ${isMajor ? '' : 'minor'}`} style={{left: t * pps}}>{isMajor && <span>{secs(t, major < 1 ? 1 : 0)}</span>}</div>);
  }
  return (
    <div className="ruler">
      <div className="ruler-head" />
      <div className="ruler-track" onPointerDown={onDown}>
        {ticks}
        {/* notes for Claude: CapCut's timeline markers */}
        {notes.filter(n => n.start >= win.from - 1 && n.start <= win.to + 1).map(n => {
          const key = op.refKey(n.ref);
          return <div key={key} data-key={key} className={`marker ruler-mark ${n.cls} ${sel.split('|').includes(key) ? 'sel' : ''}`} style={{left: n.start * pps}} title={n.title}
            onPointerDown={e => act.current!.blockDown(e, n)} onContextMenu={e => act.current!.blockMenu(e, n)} />;
        })}
      </div>
    </div>
  );
}, (a, b) => a.total === b.total && a.pps === b.pps && a.win === b.win && a.notes === b.notes && a.sel === b.sel);

type RowProps = {
  lane: Lane; pps: number; winFrom: number; winTo: number; sel: string; lit: boolean; flash: Set<string>; led: boolean;
  locked: boolean; hidden: boolean; muted: boolean; beats?: number[]; wave?: {src: string; segments?: any[]}; total: number;
  act: React.RefObject<RowActions>; renaming: boolean;
  thumbs?: Record<string, Thumbs>; filmH?: number;
  /** main track: the cover frame as a CSS background */
  cover?: React.CSSProperties;
};

const LaneRow = React.memo(function LaneRow({lane, pps, winFrom, winTo, sel, lit, flash, led, locked, hidden, muted, beats, wave, total, act, renaming, thumbs, filmH = 40, cover}: RowProps) {
  const selected = useMemo(() => new Set(sel ? sel.split('|') : []), [sel]);
  const a = () => act.current!;
  return (
    <div data-lane={lane.key} data-layer={lane.layer} className={`lane ${lane.tall ? 'tall' : ''} ${lane.thin ? 'thin' : ''} ${lane.overlay ? 'overlay' : ''} ${lane.pinned ? 'pinned' : ''} ${locked ? 'locked' : ''} ${hidden || muted ? 'off' : ''}`}>
      <div className={`lane-head ${lit ? 'lit' : ''}`} onContextMenu={e => a().laneMenu(e, lane)}>
        {renaming
          ? <input className="lane-rename" autoFocus defaultValue={lane.label} aria-label="Track name" dir="auto"
              onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') a().rename(lane, e.currentTarget.value); if (e.key === 'Escape') a().rename(lane, undefined); }}
              onBlur={e => a().rename(lane, e.currentTarget.value)} />
          : <button className="lane-name" title={lane.title ?? 'Select everything on this track (right-click to lock or hide)'} aria-pressed={lit}
              onClick={() => a().selectLane(lane)} onDoubleClick={() => a().startRename(lane)}>
              <span className={`led ${led ? 'claude' : ''}`} title={led ? 'Claude changed something here' : undefined} />
              {cover && <span className="cover" style={cover} title="Cover: click to use the frame at the playhead" role="button" aria-label="Set cover"
                onClick={e => { e.stopPropagation(); a().setCover(); }} />}
              {lane.icon && !cover && React.createElement(LANE_ICONS[lane.icon], {size: 13, className: `lane-icon i-${lane.icon}`, 'aria-hidden': true})}
              <span className="lane-label" dir="auto">{lane.label}</span>
              {lane.layer != null && <span className="layer" aria-label={`Track ${lane.layer}`}>{lane.layer}</span>}
              <span className="count">{lane.items.length || ''}</span>
            </button>}
        <span className="lane-switches">
          {canHide(lane.key) && <button className={`sw ${hidden ? 'on' : ''}`} title={hidden ? 'Show' : 'Hide from video'} aria-label="Hide" aria-pressed={hidden} onClick={() => a().flipLane(lane.key, 'hidden')}>{hidden ? <EyeSlash size={12} /> : <Eye size={12} />}</button>}
          {canMute(lane.key) && <button className={`sw ${muted ? 'on' : ''}`} title={muted ? 'Unmute' : 'Mute'} aria-label="Mute" aria-pressed={muted} onClick={() => a().flipLane(lane.key, 'muted')}>{muted ? <SpeakerSlash size={12} /> : <SpeakerHigh size={12} />}</button>}
          <button className={`sw ${locked ? 'on' : ''}`} title={locked ? 'Unlock track' : 'Lock track (neither you nor Claude can move it)'} aria-label="Lock" aria-pressed={locked} onClick={() => a().flipLane(lane.key, 'locked')}>{locked ? <Lock size={12} /> : <LockOpen size={12} />}</button>
        </span>
      </div>
      <div className="lane-track" onPointerDown={e => a().trackDown(e, lane)}>
        {beats?.filter(b => b >= winFrom && b <= winTo).map(b => <span key={b} className="beat" style={{left: b * pps}} />)}
        {lane.joins?.filter(t => t >= winFrom && t <= winTo).map(t => <button key={t} className="join-add" style={{left: t * pps}} title="Add a transition at this cut" aria-label="Transition" onPointerDown={e => e.stopPropagation()} onClick={() => a().addTransition(t)}><Plus size={10} weight="bold" /></button>)}
        {wave && <Waveform url={`${(window as any).remotion_staticBase}/${wave.src}`} segments={wave.segments ?? [{start: 0, sourceIn: 0, duration: total}]} duration={total} pps={pps} height={36} />}
        {allItems(lane).map(item => {
          if (item.end < winFrom || item.start > winTo) return null;
          const key = op.refKey(item.ref);
          const left = item.start * pps;
          const cls = `${item.cls} ${selected.has(key) ? 'sel' : ''} ${flash.has(key) ? 'flash' : ''} ${item.off ? 'disabled' : ''}`;
          if (item.marker) {
            return <div key={key} data-key={key} className={`marker ${cls}`} style={{left}} title={item.title}
              onPointerDown={e => a().blockDown(e, item)} onContextMenu={e => a().blockMenu(e, item)} />;
          }
          const w = Math.max(3, (item.end - item.start) * pps);
          const trimmable = op.isTrimmable(item.ref); // footage trims ripple: no gaps (main track)
          return (
            <div key={key} data-key={key} className={`block ${cls}`}
              style={{left, width: w, cursor: op.isMovable(item.ref) ? undefined : 'pointer'}} title={item.title ?? item.label}
              onPointerDown={e => a().blockDown(e, item)} onContextMenu={e => a().blockMenu(e, item)}>
              {trimmable && w > 14 && <span className="grip l" onPointerDown={e => a().gripDown(e, item, 'start')} />}
              {item.film && thumbs?.[item.film.src] && <Filmstrip thumbs={thumbs[item.film.src]} base={(window as any).remotion_staticBase} sourceIn={item.film.sourceIn} speed={item.film.speed}
                duration={item.end - item.start} pps={pps} height={filmH} />}
              {item.wave && <Waveform url={`${(window as any).remotion_staticBase}/${item.wave}`} segments={[{start: 0, sourceIn: 0, duration: item.end - item.start}]}
                duration={item.end - item.start} pps={pps} height={22} color={item.cls === 'music' ? '#7fb08b' : '#8fd0a4'} />}
              {item.still && <span className="still" style={{backgroundImage: `url("${(window as any).remotion_staticBase}/${item.still}")`}} />}
              {item.badge && w > 30 && <span className="badge mono">{item.badge}</span>}
              {w > 22 && <span className="label" dir="auto">{item.label}</span>}
              {item.len && w > 96 && <span className="len mono">{secs(item.end - item.start, 1)}{item.end - item.start < 60 ? 's' : ''}</span>}
              {item.keys?.map(k => <span key={k} className="kf" style={{left: k * pps}} title={`keyframe +${k.toFixed(2)}s: drag to move it, right-click for easing`} onPointerDown={e => a().keyDown(e, item, k)} onContextMenu={e => a().keyMenu(e, item, k)} />)}
              {trimmable && w > 14 && <span className="grip r" onPointerDown={e => a().gripDown(e, item, 'end')} />}
              {item.env?.length && w > 18 ? <svg className="vol-env" viewBox={`0 0 ${w} 100`} preserveAspectRatio="none" aria-hidden>
                <polyline points={[{t: 0, v: item.env[0].v}, ...item.env, {t: item.end - item.start, v: item.env.at(-1)!.v}].map(p => `${p.t * pps},${100 - Math.min(2, p.v * (item.volume ?? 1)) * 50}`).join(' ')} />
              </svg> : null}
              {item.volume != null && w > 18 && <span className="vol-line" style={{top: `${(1 - Math.min(2, item.volume) / 2) * 100}%`}}
                title={`Volume ${Math.round(item.volume * 100)}%: drag the line up or down`} onPointerDown={e => a().volumeDown(e, item)} />}
              {(item.ref.kind === 'music' || item.ref.kind === 'sfx') && w > 18 && <>
                {!!item.fadeIn && <span className="fade-ramp in" style={{width: item.fadeIn * pps}} />}
                {!!item.fadeOut && <span className="fade-ramp out" style={{width: item.fadeOut * pps}} />}
                <span className="fade-knob" style={{left: (item.fadeIn ?? 0) * pps}} title="Drag to fade in" onPointerDown={e => a().fadeDown(e, item, 'start')} />
                <span className="fade-knob" style={{right: (item.fadeOut ?? 0) * pps}} title="Drag to fade out" onPointerDown={e => a().fadeDown(e, item, 'end')} />
              </>}
            </div>
          );
        })}
      </div>
    </div>
  );
});

function MarqueeBox({m, scroller}: {m: {x0: number; y0: number; x1: number; y1: number}; scroller: React.RefObject<HTMLDivElement | null>}) {
  const el = scroller.current;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const x = (v: number) => v - r.left + el.scrollLeft, y = (v: number) => v - r.top + el.scrollTop;
  return <div className="marquee" style={{left: Math.min(x(m.x0), x(m.x1)), top: Math.min(y(m.y0), y(m.y1)), width: Math.abs(m.x1 - m.x0), height: Math.abs(m.y1 - m.y0)}} />;
}

function Playline({pps, scroller, onGrab}: {pps: number; scroller: React.RefObject<HTMLDivElement | null>; onGrab: (e: React.PointerEvent) => void}) {
  const frame = usePlayhead(p => p.frame);
  const playing = usePlayhead(p => p.playing);
  const x = HEAD_W + (frame / fps()) * pps;
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    const visibleEnd = el.scrollLeft + el.clientWidth;
    if (x > visibleEnd - 40 || x < el.scrollLeft + HEAD_W) el.scrollLeft = x - HEAD_W - 60;
  }, [x, playing, scroller]);
  return <div className="playline" style={{left: x}}><span className="playhead-grip" title="Drag playhead" onPointerDown={onGrab} /></div>;
}

function DeskResize() {
  const desk = useDeskShape(), key = `studio-editor:timeline-h:${desk}`;
  useEffect(() => {
    try {
      const h = Number(localStorage.getItem(key));
      if (h) document.documentElement.style.setProperty('--timeline-h', `${h}px`);
      else document.documentElement.style.removeProperty('--timeline-h');
    } catch { /* storage blocked: keep default */ }
  }, [key]);
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      // Never squeeze the program monitor below ~380px of screen height.
      const h = Math.max(170, Math.min(window.innerHeight - 48 - 36 - 40 - 380, window.innerHeight - ev.clientY));
      document.documentElement.style.setProperty('--timeline-h', `${h}px`);
      try { localStorage.setItem(key, String(h)); } catch { /* ignore */ }
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return <div className="desk-resize" onPointerDown={down} aria-hidden />;
}

