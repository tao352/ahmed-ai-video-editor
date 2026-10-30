// Direct manipulation on the program monitor: click anything drawn in the video,
// drag to move it, pull the corner to resize. Writes clip.box / captions.box.
import React, {useCallback, useEffect, useRef, useState} from 'react';
import * as op from '../model/ops';
import {commit, currentDoc, editor, endGesture, endGroup, groupOrigin, nowTime, seekTime, select, startGesture, toast, useDoc, useEditor, usePlayhead} from '../store';
import {MAIN, resolveFormat, setClipOverride, setFormatField} from '../model/formats';
import {findTextTarget, type TextTarget} from '../model/textedit';
import {registry} from '../../../reel/src/edit/registry';
import {cropPath, keyedBox} from '../../../reel/src/edit/clipfx';
import {baseAt} from '../model/edits';
import {openMenu} from './ContextMenu';
import {deleteSelection, duplicateSelection, splitAtPlayhead} from './actions';
import type {MenuItem} from './ContextMenu';

const CAPTIONS = '__captions';
type Box = {x: number; y: number; scale: number; rotate: number};
type Rect = {left: number; top: number; width: number; height: number};
const DEFAULT: Box = {x: 0, y: 0, scale: 1, rotate: 0};

// Boxes are read from what the monitor shows (the resolved format) and written to that format.
const boxOf = (master: op.Doc, id: string): Box => {
  const doc = resolveFormat(master, editor.get().format);
  if (id === CAPTIONS) return {...DEFAULT, ...doc.captions?.box};
  const clip = op.clips(doc).find(c => c.id === id);
  const k = keyedBox({...DEFAULT, opacity: 1, ...clip?.box}, clip?.keys, nowTime() - (clip?.from ?? 0));
  return {x: k.x, y: k.y, scale: k.scale, rotate: k.rotate};
};

function withBox(doc: op.Doc, id: string, box: Box): op.Doc {
  const clean = {x: op.round(box.x), y: op.round(box.y), scale: op.round(box.scale), rotate: op.round(box.rotate)};
  const format = editor.get().format;
  if (format !== MAIN) return id === CAPTIONS ? setFormatField(doc, format, ['captions', 'box'], clean) : setClipOverride(doc, format, id, 'box', clean);
  if (id === CAPTIONS) return op.setPath(doc, ['captions', 'box'], clean);
  const clip = op.clips(doc).find(c => c.id === id);
  if (!clip) return doc;
  // A keyframed clip: the drag sets (or adds) the keyframe at the playhead instead of the base box.
  if (clip.keys?.length) {
    const t = nowTime() - clip.from;
    if (t >= 0 && t <= clip.to - clip.from) return op.upsertKey(doc, id, t, {x: clean.x, y: clean.y, scale: clean.scale, rotate: clean.rotate});
  }
  return op.replaceItem(doc, {kind: 'clip', id}, {...clip, box: clean});
}

/** Visible extent of a layer: union of its drawn descendants, ignoring full-frame backdrops. */
function contentRect(layer: Element, screen: DOMRect): Rect | null {
  const full = screen.width * screen.height * 0.85;
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  const els = layer.querySelectorAll('*');
  for (let i = 0; i < els.length && i < 600; i++) {
    const rc = els[i].getBoundingClientRect();
    if (rc.width < 2 || rc.height < 2 || rc.width * rc.height >= full) continue;
    // keep to what is on screen
    const L = Math.max(rc.left, screen.left), T = Math.max(rc.top, screen.top), R = Math.min(rc.right, screen.right), B = Math.min(rc.bottom, screen.bottom);
    if (R <= L || B <= T) continue;
    l = Math.min(l, L); t = Math.min(t, T); r = Math.max(r, R); b = Math.max(b, B);
  }
  if (r > l) return {left: l - screen.left, top: t - screen.top, width: r - l, height: b - t};
  // only a full-frame transparent video: the box is where its pixels are drawn now
  const v = layer.querySelector('video');
  return v ? drawnBox(v, screen) : null;
}

/** Bounds of the drawn (non-transparent) pixels of a video, read from a small copy of the frame. */
let boxCanvas: CanvasRenderingContext2D | null = null;
function drawnBox(v: HTMLVideoElement, screen: DOMRect): Rect | null {
  if (v.readyState < 2 || !v.videoWidth) return null;
  const rc = v.getBoundingClientRect();
  const W = 96, H = Math.max(1, Math.round(96 * rc.height / rc.width));
  try {
    boxCanvas ??= document.createElement('canvas').getContext('2d', {willReadFrequently: true});
    if (!boxCanvas) return null;
    boxCanvas.canvas.width = W; boxCanvas.canvas.height = H;
    boxCanvas.clearRect(0, 0, W, H);
    // same fit as the element (cover / contain / fill), drawn into the element's box
    const fit = getComputedStyle(v).objectFit, sx = W / v.videoWidth, sy = H / v.videoHeight;
    const s = fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy), kx = fit === 'fill' ? sx : s, ky = fit === 'fill' ? sy : s;
    boxCanvas.drawImage(v, (W - v.videoWidth * kx) / 2, (H - v.videoHeight * ky) / 2, v.videoWidth * kx, v.videoHeight * ky);
    const a = boxCanvas.getImageData(0, 0, W, H).data;
    let l = W, t = H, r = -1, b = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a[(y * W + x) * 4 + 3] > 40) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; }
    if (r < 0) return null;
    const ux = rc.width / W, uy = rc.height / H;
    return {left: rc.left - screen.left + l * ux, top: rc.top - screen.top + t * uy, width: (r - l + 1) * ux, height: (b - t + 1) * uy};
  } catch { return null; }
}

// ---------- smart guides (Canva style) ----------
// While a layer is dragged, its edges and centre lines are pulled onto the frame's edges and centre
// and onto the edges and centres of the other layers on screen, and a guide line shows what it met.

/** A guide line in screen px: vertical (x) or horizontal (y), drawn from `from` to `to` along the other axis. */
export type Guide = {axis: 'x' | 'y'; at: number; from: number; to: number; frame: boolean};
type Target = {at: number; from: number; to: number; frame: boolean};
const SNAP_PX = 6;

/** Lines a dragged rect can meet: the frame's edges and centre, then every other layer's edges and centre. */
export function guideTargets(frameW: number, frameH: number, others: Rect[]): {x: Target[]; y: Target[]} {
  const x: Target[] = [0, frameW / 2, frameW].map(at => ({at, from: 0, to: frameH, frame: true}));
  const y: Target[] = [0, frameH / 2, frameH].map(at => ({at, from: 0, to: frameW, frame: true}));
  for (const o of others) {
    for (const at of [o.left, o.left + o.width / 2, o.left + o.width]) x.push({at, from: o.top, to: o.top + o.height, frame: false});
    for (const at of [o.top, o.top + o.height / 2, o.top + o.height]) y.push({at, from: o.left, to: o.left + o.width, frame: false});
  }
  return {x, y};
}

/** Pull a moved rect onto the nearest target on each axis; returns the snapped offset and the lines to draw. */
export function snapRect(r: Rect, targets: {x: Target[]; y: Target[]}, threshold = SNAP_PX): {dx: number; dy: number; guides: Guide[]} {
  const pick = (edges: number[], list: Target[]) => {
    let best: {d: number; t: Target} | null = null;
    for (const e of edges) for (const t of list) {
      const d = t.at - e;
      if (Math.abs(d) > threshold) continue;
      // nearest wins; on a tie the frame's own lines win, they are what people aim for
      const closer = !best || Math.abs(d) < Math.abs(best.d) - 0.01;
      const tie = best && Math.abs(Math.abs(d) - Math.abs(best.d)) <= 0.01 && t.frame && !best.t.frame;
      if (closer || tie) best = {d, t};
    }
    return best;
  };
  const bx = pick([r.left, r.left + r.width / 2, r.left + r.width], targets.x);
  const by = pick([r.top, r.top + r.height / 2, r.top + r.height], targets.y);
  const dx = bx?.d ?? 0, dy = by?.d ?? 0;
  // every line the snapped rect now sits on is drawn (its left and right edge can both meet one)
  const m = {left: r.left + dx, top: r.top + dy, width: r.width, height: r.height};
  const on = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const guides: Guide[] = [];
  if (bx) for (const t of targets.x) if ([m.left, m.left + m.width / 2, m.left + m.width].some(e => on(e, t.at)))
    guides.push({axis: 'x', at: t.at, frame: t.frame, from: t.frame ? t.from : Math.min(t.from, m.top), to: t.frame ? t.to : Math.max(t.to, m.top + m.height)});
  if (by) for (const t of targets.y) if ([m.top, m.top + m.height / 2, m.top + m.height].some(e => on(e, t.at)))
    guides.push({axis: 'y', at: t.at, frame: t.frame, from: t.frame ? t.from : Math.min(t.from, m.left), to: t.frame ? t.to : Math.max(t.to, m.left + m.width)});
  return {dx, dy, guides: merge(guides)};
}

/** One line per position, spanning everything that meets there. */
function merge(gs: Guide[]): Guide[] {
  const out: Guide[] = [];
  for (const g of gs) {
    const same = out.find(o => o.axis === g.axis && Math.abs(o.at - g.at) < 0.5);
    if (!same) out.push({...g});
    else { same.from = Math.min(same.from, g.from); same.to = Math.max(same.to, g.to); same.frame ||= g.frame; }
  }
  return out;
}

/** Topmost layer with something drawn under the point. */
function hitTest(screenEl: HTMLElement, x: number, y: number): string | null {
  const screen = screenEl.getBoundingClientRect();
  const full = screen.width * screen.height * 0.85;
  const layers = [...screenEl.querySelectorAll<HTMLElement>('[data-clip-id]')].reverse();
  for (const layer of layers) {
    const els = layer.querySelectorAll('*');
    for (let i = 0; i < els.length && i < 600; i++) {
      const rc = els[i].getBoundingClientRect();
      if (rc.width < 2 || rc.height < 2) continue;
      if (x >= rc.left && x <= rc.right && y >= rc.top && y <= rc.bottom) {
        // a full-frame transparent video (a layer rendered elsewhere: captions, graphics, cut-out) counts
        // only where its own pixel is drawn; other full-frame boxes are backdrops
        if (rc.width * rc.height >= full && !(els[i] instanceof HTMLVideoElement && drawnAt(els[i] as HTMLVideoElement, rc, x, y))) continue;
        const style = getComputedStyle(els[i]);
        if (style.visibility === 'hidden' || Number(style.opacity) < 0.05) continue;
        return layer.dataset.clipId ?? null;
      }
    }
  }
  return null;
}

/** Is the video's pixel under (x, y) drawn (alpha), for transparent layers? Reads one pixel. */
let probe: CanvasRenderingContext2D | null = null;
function drawnAt(v: HTMLVideoElement, rc: DOMRect, x: number, y: number): boolean {
  if (v.readyState < 2 || !v.videoWidth) return false;
  // object-fit cover / contain / fill -> the video pixel under the point
  const fit = getComputedStyle(v).objectFit;
  const sx = rc.width / v.videoWidth, sy = rc.height / v.videoHeight;
  const s = fit === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy);
  const kx = fit === 'fill' ? sx : s, ky = fit === 'fill' ? sy : s;
  const px = (x - rc.left - (rc.width - v.videoWidth * kx) / 2) / kx, py = (y - rc.top - (rc.height - v.videoHeight * ky) / 2) / ky;
  if (px < 0 || py < 0 || px >= v.videoWidth || py >= v.videoHeight) return false;
  try {
    probe ??= document.createElement('canvas').getContext('2d', {willReadFrequently: true});
    if (!probe) return false;
    probe.canvas.width = probe.canvas.height = 5;
    probe.clearRect(0, 0, 5, 5);
    // a 5x5 patch, so a click on the edge of a thin letter still counts
    probe.drawImage(v, Math.max(0, px - 2), Math.max(0, py - 2), 5, 5, 0, 0, 5, 5);
    const a = probe.getImageData(0, 0, 5, 5).data;
    for (let i = 3; i < a.length; i += 4) if (a[i] > 40) return true;
    return false;
  } catch { return false; }
}

/** Deepest element under the point that carries its own text, with the layer it belongs to. */
function textAt(screenEl: HTMLElement, x: number, y: number): {id: string; el: HTMLElement; text: string} | null {
  const layers = [...screenEl.querySelectorAll<HTMLElement>('[data-clip-id]')].reverse();
  for (const layer of layers) {
    let best: HTMLElement | null = null, bestArea = Infinity;
    for (const el of layer.querySelectorAll<HTMLElement>('*')) {
      const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent!.trim());
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      if (r.width * r.height < bestArea) { best = el; bestArea = r.width * r.height; }
    }
    if (best) return {id: layer.dataset.clipId!, el: best, text: best.textContent ?? ''};
  }
  return null;
}

// the tracking picker loads with the Tracking panel (SAM2 outline on the player)
const TrackPicker = React.lazy(() => import('./Tracking').then(m => ({default: m.TrackPicker})));

export function Stage({screenRef}: {screenRef: React.RefObject<HTMLDivElement | null>}) {
  const selection = useEditor(s => s.selection);
  const doc = useDoc('monitor');
  const [captionsPicked, setCaptionsPicked] = useState(false);
  const [rect, setRect] = useState<Rect | null>(null);
  const [hover, setHover] = useState<Rect | null>(null);
  const [editing, setEditing] = useState<{target: TextTarget; rect: Rect} | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const drag = useRef<{mode: 'move' | 'scale' | 'rotate'; id: string; x: number; y: number; start: Box; group: string; cx: number; cy: number; d0: number; moved: boolean;
    rect: Rect; targets: {x: Target[]; y: Target[]}; layer: HTMLElement | null; k: number; tx: number; ty: number; box?: Box} | null>(null);
  // pointer moves arrive faster than frames draw: only the latest one per frame is applied
  const pending = useRef<{x: number; y: number; free: boolean; shift?: boolean} | null>(null);
  const [turn, setTurn] = useState(0);
  const raf = useRef(0);

  const picked = captionsPicked ? CAPTIONS : selection.length === 1 && selection[0].kind === 'clip' ? selection[0].id : null;
  // The selection box follows the picked layer as the video plays. Nothing picked: the stage ignores the
  // playhead entirely; while playing it re-measures every 3rd frame (measuring forces a layout).
  const frame = usePlayhead(p => (picked == null ? 0 : p.playing ? p.frame - (p.frame % 3) : p.frame));
  const pickedBase = !captionsPicked && selection.length === 1 && selection[0].kind === 'base' ? selection[0].index : null;
  const [cropping, setCropping] = useState(false);
  useEffect(() => setCropping(false), [picked, pickedBase]);
  useEffect(() => { if (selection.length) setCaptionsPicked(false); }, [selection]);

  const measure = useCallback((id: string | null): Rect | null => {
    const el = screenRef.current;
    if (!el || !id) return null;
    const layer = el.querySelector(`[data-clip-id="${CSS.escape(id)}"]`);
    return layer ? contentRect(layer, el.getBoundingClientRect()) : null;
  }, [screenRef]);

  // the player changed size (window, panes, zoom): measure again
  const [sized, setSized] = useState(0);
  useEffect(() => {
    const el = screenRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSized(n => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, [screenRef]);
  // Re-measure after the player paints the new frame or document (during a drag the box moves by arithmetic).
  useEffect(() => {
    if (drag.current?.moved) return;
    // same box as before: keep the old object, so nothing re-renders
    const same = (a: Rect | null, b: Rect | null) => a === b || (!!a && !!b && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);
    let id = requestAnimationFrame(() => { id = requestAnimationFrame(() => { const r = measure(picked); setRect(old => (same(old, r) ? old : r)); }); });
    return () => cancelAnimationFrame(id);
  }, [measure, picked, frame, doc, sized]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const begin = (e: React.PointerEvent, mode: 'move' | 'scale' | 'rotate', id: string) => {
    const d = currentDoc();
    const el = screenRef.current;
    if (!d || !el) return;
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* synthetic events have no pointer */ }
    const r = measure(id) ?? {left: 0, top: 0, width: 0, height: 0};
    const s = el.getBoundingClientRect();
    const cx = s.left + r.left + r.width / 2, cy = s.top + r.top + r.height / 2;
    // what the dragged layer can line up with, measured once: the frame and every other layer on screen
    const others = mode === 'move' ? [...el.querySelectorAll<HTMLElement>('[data-clip-id]')]
      .filter(l => l.dataset.clipId !== id).map(l => contentRect(l, s)).filter((o): o is Rect => !!o) : [];
    // The drag moves the drawn layer itself (a GPU transform, no re-render); the edit is written once on release.
    // k turns screen px into composition px; tx, ty is where the layer's own transform puts it now.
    const layer = el.querySelector<HTMLElement>(`[data-clip-id="${CSS.escape(id)}"]`);
    const m = layer ? new DOMMatrix(getComputedStyle(layer).transform === 'none' ? undefined : getComputedStyle(layer).transform) : new DOMMatrix();
    drag.current = {mode, id, x: e.clientX, y: e.clientY, start: boxOf(d, id), group: `stage:${id}:${Date.now()}`, cx, cy, d0: Math.max(8, Math.hypot(e.clientX - cx, e.clientY - cy)), moved: false,
      rect: r, targets: guideTargets(s.width, s.height, others), layer, k: layer && s.width ? layer.offsetWidth / s.width : 1, tx: m.m41, ty: m.m42};
    startGesture('monitor');
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !screenRef.current) return;
    const id = hitTest(screenRef.current, e.clientX, e.clientY);
    if (!id) {
      setCaptionsPicked(false);
      const d = currentDoc(), i = d ? baseAt(d, nowTime()) : -1;
      select(i >= 0 ? [{kind: 'base', index: i}] : []);
      return;
    }
    if (id === CAPTIONS) { select([]); setCaptionsPicked(true); }
    else { setCaptionsPicked(false); select([{kind: 'clip', id}]); }
    begin(e, 'move', id);
  };

  const onMove = (e: React.PointerEvent) => {
    const g = drag.current;
    const el = screenRef.current;
    if (!el) return;
    if (!g) {
      const id = hitTest(el, e.clientX, e.clientY);
      setHover(id && id !== picked ? measure(id) : null);
      return;
    }
    // Alt held: move freely, no guides (as in Canva)
    pending.current = {x: e.clientX, y: e.clientY, free: e.altKey, shift: e.shiftKey};
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  };

  const flush = () => {
    raf.current = 0;
    const g = drag.current, p = pending.current, el = screenRef.current;
    pending.current = null;
    if (!g || !p || !el) return;
    const s = el.getBoundingClientRect();
    if (!g.moved && Math.hypot(p.x - g.x, p.y - g.y) < 3) return;
    g.moved = true;
    const st = g.layer?.style;
    if (g.mode === 'move') {
      let dx = p.x - g.x, dy = p.y - g.y;
      const snap = p.free ? {dx: 0, dy: 0, guides: []} : snapRect({...g.rect, left: g.rect.left + dx, top: g.rect.top + dy}, g.targets);
      dx += snap.dx; dy += snap.dy;
      setGuides(snap.guides);
      setRect({...g.rect, left: g.rect.left + dx, top: g.rect.top + dy});
      // `translate` sits outside the layer's own transform, so it shifts it exactly like a box.x / box.y change
      if (st) st.translate = `${dx * g.k}px ${dy * g.k}px`;
      g.box = {...g.start, x: g.start.x + dx / s.width, y: g.start.y + dy / s.height};
    } else if (g.mode === 'rotate') {
      // the turn of the pointer around the centre; snaps to straight angles, Shift turns in 15 degree steps
      let deg = (Math.atan2(p.y - g.cy, p.x - g.cx) - Math.atan2(g.y - g.cy, g.x - g.cx)) * 180 / Math.PI;
      const total = g.start.rotate + deg;
      const target = p.shift ? Math.round(total / 15) * 15 : Math.abs(total - Math.round(total / 90) * 90) < 3 ? Math.round(total / 90) * 90 : total;
      deg = target - g.start.rotate;
      const a = deg * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
      // `rotate` turns the layer around the frame centre; the translate keeps it turning on its own centre
      if (st) { st.rotate = `${deg}deg`; st.translate = `${g.tx - (cos * g.tx - sin * g.ty)}px ${g.ty - (sin * g.tx + cos * g.ty)}px`; }
      setTurn(deg);
      g.box = {...g.start, rotate: op.round(((target % 360) + 540) % 360 - 180)};
    } else {
      const k = Math.hypot(p.x - g.cx, p.y - g.cy) / g.d0;
      const scale = Math.max(0.1, Math.min(6, g.start.scale * k)), f = scale / g.start.scale;
      setRect({left: g.rect.left + g.rect.width * (1 - f) / 2, top: g.rect.top + g.rect.height * (1 - f) / 2, width: g.rect.width * f, height: g.rect.height * f});
      // `scale` grows the whole layer around the frame centre; the translate puts its own centre back where it was
      if (st) { st.scale = String(f); st.translate = `${(1 - f) * g.tx}px ${(1 - f) * g.ty}px`; }
      g.box = {...g.start, scale};
    }
  };

  /** Write the dragged box into the edit (one undo step), then hand the picture back to the real render. */
  const finish = (g: NonNullable<typeof drag.current>) => {
    const d = currentDoc(), box = g.box;
    if (!d || !box) return;
    const fmt = editor.get().format;
    const label = `${g.id === CAPTIONS ? 'captions' : op.refLabel(d, {kind: 'clip', id: g.id})}${fmt !== MAIN ? ` [format ${fmt}]` : ''}`;
    const before = groupOrigin(g.group, g.start);
    const change = g.mode === 'move'
      ? `moved ${label} on screen (x ${before.x.toFixed(3)} -> ${op.round(box.x).toFixed(3)}, y ${before.y.toFixed(3)} -> ${op.round(box.y).toFixed(3)})`
      : g.mode === 'rotate' ? `rotated ${label} on screen (${before.rotate.toFixed(1)} -> ${box.rotate.toFixed(1)} deg)`
      : `resized ${label} on screen (scale ${before.scale.toFixed(2)} -> ${op.round(box.scale).toFixed(2)})`;
    commit(withBox(d, g.id, box), g.mode, {group: g.group, change});
  };

  const onUp = () => {
    if (raf.current) { cancelAnimationFrame(raf.current); flush(); }
    const g = drag.current;
    drag.current = null;
    setGuides([]);
    if (!g) return;
    const before = g.layer?.style.transform;
    finish(g);
    endGroup();
    // The stand-in transform stays until the picture has drawn the new box (React rewrites the layer's
    // transform), then goes in that same moment, so the layer never jumps back for a frame.
    const done = () => { endGesture(); setRect(measure(g.id)); };
    const layer = g.layer;
    setTurn(0);
    if (!layer || !g.box) { done(); return; }
    let timer = 0;
    const handBack = () => { watch.disconnect(); clearTimeout(timer); layer.style.translate = ''; layer.style.scale = ''; layer.style.rotate = ''; requestAnimationFrame(done); };
    const watch = new MutationObserver(() => { if (layer.style.transform !== before) handBack(); });
    watch.observe(layer, {attributes: true, attributeFilter: ['style']});
    timer = window.setTimeout(handBack, 400); // the box did not change after all (or the edit was refused)
  };

  // Double-click any word in the picture to retype it; it is written back to its prop or caption word.
  const onDouble = (e: React.MouseEvent) => {
    const el = screenRef.current, d = currentDoc();
    if (!el || !d) return;
    const hit = textAt(el, e.clientX, e.clientY);
    if (!hit) return;
    const clip = op.clips(d).find(c => c.id === hit.id);
    const target = findTextTarget(d, hit.id, hit.text, nowTime(), clip ? (registry[clip.component]?.defaults as Record<string, unknown>) ?? {} : {});
    if (!target) { toast('This text comes from inside the component itself and is not stored as a property; ask Claude to change it', 'error', 4500); return; }
    const s = el.getBoundingClientRect(), r = hit.el.getBoundingClientRect();
    setEditing({target, rect: {left: r.left - s.left, top: r.top - s.top, width: Math.max(90, r.width), height: Math.max(26, r.height)}});
  };

  const finishEdit = (text: string | null) => {
    const ed = editing;
    setEditing(null);
    const d = currentDoc();
    if (!ed || !d || text == null) return;
    const t = text.trim();
    if (!t || t === ed.target.current) return;
    commit(ed.target.apply(d, t), 'edit text', {change: ed.target.change(t)});
  };

  const onContext = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = screenRef.current;
    if (!el) return;
    const id = hitTest(el, e.clientX, e.clientY);
    if (!id) return;
    if (id === CAPTIONS) { select([]); setCaptionsPicked(true); } else { setCaptionsPicked(false); select([{kind: 'clip', id}]); }
    openMenu(e.clientX, e.clientY, stageMenu(id, () => onDouble(e)));
  };

  return (
    <div className={`stage ${cropping ? 'cropping' : ''}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHover(null)} onDoubleClick={onDouble} onContextMenu={onContext}>
      {editing && <TextEditor rect={editing.rect} value={editing.target.current} onDone={finishEdit} />}
      {hover && <div className="stage-hover" style={hover} />}
      {guides.map(g => <div key={`${g.axis}${g.at}`} className={`snap-guide ${g.axis} ${g.frame ? 'frame' : ''}`}
        style={g.axis === 'x' ? {left: g.at, top: g.from, height: g.to - g.from} : {top: g.at, left: g.from, width: g.to - g.from}} />)}
      {rect && picked && (
        <div className="stage-sel" style={{...rect, rotate: turn ? `${turn}deg` : undefined}}>
          <span className="stage-tag" dir="ltr">{picked === CAPTIONS ? 'captions' : picked}</span>
          {!cropping && <>
            {(['tl', 'tr', 'bl', 'br'] as const).map(c => <span key={c} className={`stage-handle ${c}`} title="Drag to resize" onPointerDown={e => begin(e, 'scale', picked)} />)}
            {picked !== CAPTIONS && <span className="stage-rotate" title="Drag to rotate (Shift: 15° steps)" onPointerDown={e => begin(e, 'rotate', picked)} />}
          </>}
          {picked !== CAPTIONS && !drag.current?.moved && <button className="stage-crop-btn" onPointerDown={e => e.stopPropagation()} onClick={() => setCropping(c => !c)}>{cropping ? 'Done' : 'Crop'}</button>}
        </div>
      )}
      {pickedBase != null && !picked && !cropping && <button className="stage-crop-btn base" onPointerDown={e => e.stopPropagation()} onClick={() => setCropping(true)}>Crop video</button>}
      <React.Suspense fallback={null}><TrackPicker screenRef={screenRef} /></React.Suspense>
      {cropping && <CropFrame screenRef={screenRef} target={pickedBase != null && !picked ? {kind: 'base', index: pickedBase} : picked ? {kind: 'clip', id: picked} : null} onDone={() => setCropping(false)} />}
    </div>
  );
}

// ---------- crop on the picture (CapCut crop) ----------
type CropT = {l: number; t: number; r: number; b: number};
type Edge = 'l' | 't' | 'r' | 'b';
const HANDLES: Edge[][] = [['l', 't'], ['t'], ['r', 't'], ['r'], ['r', 'b'], ['b'], ['l', 'b'], ['l']];
const NO_CROP: CropT = {l: 0, t: 0, r: 0, b: 0};

/**
 * Handles on the crop edges of the picked clip or footage piece. Crop values are shares of the layer's
 * full frame, so the handles live in that frame as it is drawn now (rotation is not followed).
 * Dragging moves the layer's clip-path directly; the edit is written once on release.
 */
function CropFrame({screenRef, target, onDone}: {screenRef: React.RefObject<HTMLDivElement | null>; target: op.Ref | null; onDone: () => void}) {
  const doc = useDoc('monitor');
  const [frame, setFrame] = useState<Rect | null>(null);
  const [turned, setTurned] = useState(false);
  const [live, setLive] = useState<CropT | null>(null);
  const layerOf = useCallback(() => {
    const el = screenRef.current;
    if (!el || !target) return null;
    return el.querySelector<HTMLElement>(target.kind === 'clip' ? `[data-clip-id="${CSS.escape(target.id)}"]` : `[data-base-index="${(target as {index: number}).index}"]`);
  }, [screenRef, target]);
  const item = doc && target ? op.getItem(doc, target) : null;
  const saved: CropT = {...NO_CROP, ...(item?.crop ?? {})};
  const crop = live ?? saved;
  useEffect(() => {
    let id = requestAnimationFrame(() => {
      const el = screenRef.current, layer = layerOf();
      if (!el || !layer) return setFrame(null);
      const s = el.getBoundingClientRect(), r = layer.getBoundingClientRect();
      const m = getComputedStyle(layer).transform;
      setTurned(m !== 'none' && Math.abs(new DOMMatrix(m).b) > 1e-3);
      setFrame({left: r.left - s.left, top: r.top - s.top, width: r.width, height: r.height});
    });
    return () => cancelAnimationFrame(id);
  }, [layerOf, doc]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === 'Escape') { e.stopPropagation(); onDone(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onDone]);
  if (!frame || !target || !item) return null;
  if (turned) return <div className="crop-note">Set Rotation to 0 to crop this clip, then turn it again.</div>;

  const grab = (e: React.PointerEvent, edges: Edge[]) => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget as HTMLElement;
    try { handle.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    const layer = layerOf(), start = {...crop}, x0 = e.clientX, y0 = e.clientY;
    const radius = target.kind === 'clip' ? item.style?.radius : undefined;
    startGesture('monitor');
    let next = start, raf = 0;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / frame.width, dy = (ev.clientY - y0) / frame.height;
      const c = {...start};
      // each edge stays inside the frame and leaves at least 5% of the picture
      if (edges.includes('l')) c.l = Math.max(0, Math.min(0.95 - c.r, start.l + dx));
      if (edges.includes('r')) c.r = Math.max(0, Math.min(0.95 - c.l, start.r - dx));
      if (edges.includes('t')) c.t = Math.max(0, Math.min(0.95 - c.b, start.t + dy));
      if (edges.includes('b')) c.b = Math.max(0, Math.min(0.95 - c.t, start.b - dy));
      next = {l: op.round(c.l), t: op.round(c.t), r: op.round(c.r), b: op.round(c.b)};
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; setLive(next); if (layer) layer.style.clipPath = cropPath(next, radius) ?? 'none'; });
    };
    const up = () => {
      cancelAnimationFrame(raf);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      const d = currentDoc();
      const any = next.l || next.t || next.r || next.b;
      if (d && (next.l !== start.l || next.t !== start.t || next.r !== start.r || next.b !== start.b)) {
        const it = op.getItem(d, target);
        const {crop: _c, ...rest} = it;
        commit(op.replaceItem(d, target, any ? {...it, crop: next} : rest), 'crop', {change: `cropped ${op.refLabel(d, target)} on screen (l ${next.l}, t ${next.t}, r ${next.r}, b ${next.b})`});
      }
      if (layer) layer.style.clipPath = '';
      setLive(null);
      endGesture();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const box = {left: frame.left + crop.l * frame.width, top: frame.top + crop.t * frame.height, width: frame.width * (1 - crop.l - crop.r), height: frame.height * (1 - crop.t - crop.b)};
  return <>
    <div className="crop-full" style={frame} />
    <div className="crop-box" style={box}>
      <i className="crop-third v1" /><i className="crop-third v2" /><i className="crop-third h1" /><i className="crop-third h2" />
      {HANDLES.map(h => <span key={h.join('')} className={`crop-handle ${h.join('')}`} onPointerDown={e => grab(e, h)} />)}
      <span className="crop-size mono">{Math.round((1 - crop.l - crop.r) * 100)}% × {Math.round((1 - crop.t - crop.b) * 100)}%</span>
    </div>
  </>;
}

function TextEditor({rect, value, onDone}: {rect: Rect; value: string; onDone: (t: string | null) => void}) {
  const [v, setV] = useState(value);
  return (
    <textarea className="stage-text" dir="auto" autoFocus value={v} style={{left: rect.left, top: rect.top, width: rect.width + 24, minHeight: rect.height}}
      onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}
      onChange={e => setV(e.target.value)} onBlur={() => onDone(v)}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onDone(v); } if (e.key === 'Escape') onDone(null); }} />
  );
}

/** Right-click menu for something picked on the monitor. */
function stageMenu(id: string, editText: () => void): MenuItem[] {
  const d = currentDoc();
  const fmt = editor.get().format;
  if (id === CAPTIONS) return [
    {label: 'Edit word', hint: 'Double-click', action: editText},
    {label: 'Reset caption position', action: () => resetBox(CAPTIONS)},
  ];
  const clip = d ? op.clips(d).find(c => c.id === id) : null;
  const items: MenuItem[] = [
    {label: 'Edit text', hint: 'Double-click', action: editText},
    'sep',
    {label: 'Split at playhead', hint: 'S', action: splitAtPlayhead},
    {label: 'Duplicate', hint: 'Ctrl+D', action: duplicateSelection},
    {label: 'Go to start', action: () => clip && seekTime(clip.from)},
    'sep',
    {label: 'Reset position', action: () => resetBox(id)},
  ];
  if (fmt !== MAIN && d) items.push({label: 'Hide in this size', action: () => commit(setClipOverride(d, fmt, id, 'hidden', true), 'hide', {change: `hid clip ${id} [format ${fmt}]`})});
  items.push('sep', {label: 'Delete', hint: 'Delete', danger: true, action: deleteSelection});
  return items;
}

/** Reset helpers for the inspector. */
export const resetBox = (id: string) => {
  const d = currentDoc();
  if (!d) return;
  const format = editor.get().format;
  if (format !== MAIN) {
    const next = id === CAPTIONS ? setFormatField(d, format, ['captions', 'box'], undefined) : setClipOverride(d, format, id, 'box', undefined);
    commit(next, 'reset position', {change: `reset on-screen position of ${id === CAPTIONS ? 'captions' : `clip ${id}`} in format ${format}`});
    return;
  }
  const next = id === CAPTIONS ? op.setPath(d, ['captions', 'box'], undefined) : (() => {
    const clip = op.clips(d).find(c => c.id === id);
    if (!clip) return d;
    const {box: _drop, ...rest} = clip;
    return op.replaceItem(d, {kind: 'clip', id}, rest);
  })();
  commit(next, 'reset position', {change: `reset on-screen position of ${id === CAPTIONS ? 'captions' : `clip ${id}`}`});
};
export const CAPTIONS_ID = CAPTIONS;
