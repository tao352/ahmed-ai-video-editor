// App state. Two stores: the document store (changes on edits) and the playhead store
// (changes every frame), so playback never re-renders the panels.
import {useDeferredValue, useSyncExternalStore} from 'react';
import {createHistory, push, redo as redoH, replaceFromDisk, seal, undo as undoH, type History} from './model/history';
import type {Doc, Ref} from './model/ops';
import {share} from './model/share';

export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: T | ((s: T) => T)) {
      state = typeof next === 'function' ? (next as (s: T) => T)(state) : next;
      for (const l of listeners) l();
    },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

/** Guide lines over the monitor: safe zone profile ('auto' follows the format), thirds, centre. */
export type Guides = {safe: 'auto' | 'off' | string; thirds: boolean; center: boolean};
export const GUIDES_KEY = 'studio-editor:guides';
function loadGuides(): Guides {
  const off: Guides = {safe: 'off', thirds: false, center: false};
  try { return {...off, ...JSON.parse(localStorage.getItem(GUIDES_KEY) ?? '{}')}; } catch { return off; }
}

/** A filmstrip sprite: one frame every `every` seconds, `cols` across, each w x h. */
export type Thumbs = {sprite: string; every: number; w: number; h: number; cols: number; count: number};

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error';
export type Writer = 'human' | 'claude';
export type Toast = {id: number; text: string; tone: 'info' | 'claude' | 'error'};

export type EditorState = {
  projectId: string | null;
  history: History | null;
  /** rev of the document on disk that `savedDoc` matches */
  rev: number;
  savedDoc: Doc | null;
  save: SaveState;
  saveError: string | null;
  lastWriter: Writer | null;
  /** set when Claude wrote the file while we had unsaved edits */
  incoming: {doc: Doc; rev: number} | null;
  selection: Ref[];
  /** keys of items Claude just changed, flashed once on the timeline */
  flash: Set<string>;
  /** items Claude changed that the owner has not looked at yet (lane LEDs) */
  claudeMarks: Set<string>;
  claudePulse: number;
  pendingChanges: string[];
  toasts: Toast[];
  snap: boolean;
  pxPerSec: number;
  tab: 'media' | 'audio' | 'text' | 'effects' | 'transitions' | 'captions' | 'filters' | 'notes';
  /** which output format the monitor shows and on-screen edits write to ('main' = the master edit) */
  format: string;
  /** workspace shape: auto follows the shown format (wide for YouTube sizes, tall for reels) */
  layout: 'auto' | 'wide' | 'tall';
  /** the player fills the window, panels hidden (button on the player, ` key) */
  playerMax: boolean;
  /** guide lines over the monitor (editor only) */
  guides: Guides;
  /** timeline tool: select/move, or blade (click to cut) */
  tool: 'select' | 'blade';
  /** preview follows the mouse over the timeline (CapCut preview axis) */
  skim: boolean;
  /** the shortcuts sheet (?) is open */
  help: boolean;
  /** light preview copies of the footage {original: proxy}, and how many are still being made */
  proxies: Record<string, string>;
  /** timeline filmstrip sprites of the footage files */
  thumbs: Record<string, Thumbs>;
  proxyPending: number;
  /** playback speed and direction (J / K / L shuttle) */
  rate: number;
  /** where a drag is in progress: that area renders every frame, the others catch up in the background */
  gesture: Area | null;
};

/** Parts of the window that show the document. */
export type Area = 'monitor' | 'timeline' | 'panel';

export const editor = createStore<EditorState>({
  projectId: null, history: null, rev: 0, savedDoc: null, save: 'idle', saveError: null, lastWriter: null, incoming: null,
  selection: [], flash: new Set(), claudeMarks: new Set(), claudePulse: 0, pendingChanges: [], toasts: [], snap: true, pxPerSec: 60, tab: 'media', format: 'main', guides: loadGuides(), tool: 'select', help: false, proxies: {}, thumbs: {}, proxyPending: 0, rate: 1, playerMax: false, gesture: null, skim: (() => { try { return localStorage.getItem('studio-editor:skim') !== '0'; } catch { return true; } })(), layout: (() => { try { return (localStorage.getItem('studio-editor:layout') as 'auto' | 'wide' | 'tall') || 'auto'; } catch { return 'auto'; } })(),
});

export const playhead = createStore({frame: 0, playing: false});

export const useEditor = <T,>(pick: (s: EditorState) => T): T => useSyncExternalStore(editor.subscribe, () => pick(editor.get()));
export const usePlayhead = <T,>(pick: (s: {frame: number; playing: boolean}) => T): T => useSyncExternalStore(playhead.subscribe, () => pick(playhead.get()));

export const currentDoc = (): Doc | null => editor.get().history?.present.doc ?? null;

/**
 * The document as one area of the window should show it. While a drag runs somewhere else, this area
 * gets the document at low priority: React draws the dragged thing first and fills this in when the
 * frame has time, so a drag never waits on panels it does not touch. Pair it with a memoised body.
 */
export function useDoc(area: Area): Doc | null {
  const live = useEditor(s => s.history?.present.doc ?? null);
  const late = useDeferredValue(live);
  const gesture = useEditor(s => s.gesture);
  return gesture && gesture !== area ? late : live;
}

export const startGesture = (area: Area) => { if (editor.get().gesture !== area) editor.set(s => ({...s, gesture: area})); };
export const endGesture = () => { if (editor.get().gesture) editor.set(s => ({...s, gesture: null})); };

// ---------- document actions ----------

/** Apply a new document. `group` coalesces drags/typing; `change` is the human_changes.md line. */
export function commit(next: Doc, label: string, opts: {group?: string; change?: string; selection?: Ref[]} = {}) {
  editor.set(s => {
    if (!s.history) return s;
    const doc = share(s.history.present.doc, next);
    if (doc === s.history.present.doc) return opts.selection ? {...s, selection: opts.selection} : s;
    return {
      ...s,
      history: push(s.history, doc, opts.change ?? label, opts.group ?? null),
      save: 'dirty',
      selection: opts.selection ?? s.selection,
      pendingChanges: opts.change ? withChange(s.pendingChanges, opts.change, opts.group) : s.pendingChanges,
    };
  });
}

// A drag fires many commits with the same group; keep only its latest description.
let lastChangeGroup: string | null = null;
function withChange(list: string[], change: string, group?: string): string[] {
  const replace = group && group === lastChangeGroup && list.length;
  lastChangeGroup = group ?? null;
  return replace ? [...list.slice(0, -1), change] : [...list, change];
}

/** The value an item had when a coalesced edit (typing, dragging) began, for honest change lines. */
let originGroup: string | null = null;
let originValue: unknown;
export function groupOrigin<T>(group: string, current: T): T {
  if (group !== originGroup) { originGroup = group; originValue = structuredClone(current); }
  return originValue as T;
}

export function endGroup() {
  lastChangeGroup = null;
  originGroup = null;
  editor.set(s => (s.history ? {...s, history: seal(s.history)} : s));
}

export function undo() {
  editor.set(s => (s.history && s.history.past.length ? {...s, history: undoH(s.history), save: 'dirty', pendingChanges: [...s.pendingChanges, `undo: ${s.history.present.label}`]} : s));
}
export function redo() {
  editor.set(s => (s.history && s.history.future.length ? {...s, history: redoH(s.history), save: 'dirty', pendingChanges: [...s.pendingChanges, `redo: ${s.history.future[0].label}`]} : s));
}

export function openDocument(projectId: string, doc: Doc, rev: number, writer: Writer | null) {
  editor.set(s => ({...s, projectId, history: createHistory(doc), savedDoc: doc, rev, save: 'saved', saveError: null, lastWriter: writer, incoming: null, selection: [], pendingChanges: [], claudeMarks: new Set(), format: doc.formats?.[s.format] ? s.format : 'main'}));
  playhead.set({frame: 0, playing: false});
}

/** Take a document Claude wrote; stays undoable so the human can step back to their own version. */
export function acceptFromDisk(doc: Doc, rev: number, flash: Set<string>) {
  editor.set(s => ({
    ...s,
    history: s.history ? replaceFromDisk(s.history, doc, 'Claude edit') : createHistory(doc),
    savedDoc: doc, rev, save: 'saved', saveError: null, lastWriter: 'claude', incoming: null, flash, claudeMarks: new Set([...s.claudeMarks, ...flash]), claudePulse: s.claudePulse + 1,
  }));
}

export const select = (selection: Ref[]) => editor.set(s => ({...s, selection}));

/** The owner looked at these items: their lane LED goes dark. */
export function clearMarks(keys: string[]) {
  editor.set(s => {
    if (!keys.some(k => s.claudeMarks.has(k))) return s;
    const marks = new Set(s.claudeMarks);
    for (const k of keys) marks.delete(k);
    return {...s, claudeMarks: marks};
  });
}

let toastId = 0;
export function toast(text: string, tone: Toast['tone'] = 'info', ms = 3200) {
  const id = ++toastId;
  editor.set(s => ({...s, toasts: [...s.toasts, {id, text, tone}]}));
  setTimeout(() => editor.set(s => ({...s, toasts: s.toasts.filter(t => t.id !== id)})), ms);
}

// ---------- playhead ----------

type PlayerLike = {seekTo(frame: number): void; play(): void; pause(): void; isPlaying(): boolean; toggle(): void};
let player: PlayerLike | null = null;
export const bindPlayer = (p: PlayerLike | null) => { player = p; };

export function fps(): number { return Number(currentDoc()?.settings?.fps ?? 30); }
export function totalFrames(): number { const d = currentDoc(); return d ? Math.max(1, Math.round(Number(d.settings.duration) * fps())) : 1; }

// Skimming shows another frame on the monitor without moving the playhead.
// The mouse moves faster than a frame draws, so only the latest skim target is shown per frame.
let skimming = false;
let skimTarget = 0;
let skimRaf = 0;
export const isSkimming = () => skimming;
export function skimTo(frame: number) {
  if (playhead.get().playing) return;
  skimming = true;
  skimTarget = Math.max(0, Math.min(totalFrames() - 1, Math.round(frame)));
  if (!skimRaf) skimRaf = requestAnimationFrame(() => { skimRaf = 0; if (skimming) player?.seekTo(skimTarget); });
}
function stopSkimFrame() { if (skimRaf) { cancelAnimationFrame(skimRaf); skimRaf = 0; } }
export function endSkim() {
  stopSkimFrame();
  if (!skimming) return;
  skimming = false;
  player?.seekTo(playhead.get().frame);
}

export function seekFrame(frame: number) {
  stopSkimFrame();
  skimming = false;
  const f = Math.max(0, Math.min(totalFrames() - 1, Math.round(frame)));
  player?.seekTo(f);
  playhead.set(p => ({...p, frame: f}));
}
export const seekTime = (t: number) => seekFrame(t * fps());
export const nowTime = () => playhead.get().frame / fps();
export function togglePlay() { endSkim(); player?.toggle(); }
export function pause() { player?.pause(); }
export function play() { endSkim(); player?.play(); }
