// Undo/redo over whole documents. A `group` key coalesces a drag (many updates) into one step.
import type {Doc} from './ops';

export type Step = {doc: Doc; label: string};
export type History = {past: Step[]; present: Step; future: Step[]; group: string | null};

const LIMIT = 200;

export const createHistory = (doc: Doc): History => ({past: [], present: {doc, label: 'open'}, future: [], group: null});

export function push(h: History, doc: Doc, label: string, group: string | null = null): History {
  if (doc === h.present.doc) return h;
  if (group && group === h.group) return {...h, present: {doc, label}};
  return {past: [...h.past, h.present].slice(-LIMIT), present: {doc, label}, future: [], group};
}

/** Close the current coalescing group so the next push starts a new step. */
export const seal = (h: History): History => (h.group ? {...h, group: null} : h);

export function undo(h: History): History {
  const prev = h.past.at(-1);
  if (!prev) return h;
  return {past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future], group: null};
}

export function redo(h: History): History {
  const next = h.future[0];
  if (!next) return h;
  return {past: [...h.past, h.present], present: next, future: h.future.slice(1), group: null};
}

/** Replace everything with a document loaded from disk (Claude's edit) but keep it undoable. */
export const replaceFromDisk = (h: History, doc: Doc, label: string): History =>
  ({past: [...h.past, h.present].slice(-LIMIT), present: {doc, label}, future: [], group: null});
