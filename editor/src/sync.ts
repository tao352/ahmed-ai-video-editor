// Disk sync: load, autosave with rev checks, live updates from Claude (SSE), render jobs.
import {useSyncExternalStore} from 'react';
import {editSchema} from '../../reel/src/edit/schema';
import {acceptFromDisk, currentDoc, editor, endGroup, openDocument, toast, type Writer} from './store';
import {clips, notes, refKey, sfxList, words, zooms, type Doc} from './model/ops';

const enc = encodeURIComponent;
const writerOf = (by: unknown): Writer => (by === 'human' ? 'human' : 'claude');
const LAST_PROJECT = 'studio-editor:last-project';

export type ProjectInfo = {id: string; name: string; width: number; height: number; duration: number; rev: number; mtime: number};

export async function fetchProjects(): Promise<ProjectInfo[]> {
  const r = await fetch('/api/projects');
  if (!r.ok) throw new Error('could not list projects');
  return r.json();
}

export function lastProject(): string | null {
  try { return localStorage.getItem(LAST_PROJECT); } catch { return null; }
}

/** Where staticFile() points: the project's public/ folder served by /media. */
export const mediaBase = (id: string) => `/media/${id.split('/').slice(0, -1).map(enc).join('/')}`;

let events: EventSource | null = null;

export async function loadProject(id: string) {
  const r = await fetch(`/api/edit?id=${enc(id)}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'could not open project');
  const file = await r.json();
  (window as any).remotion_staticBase = mediaBase(id);
  openDocument(id, file.data, file.rev, file.updatedBy ? writerOf(file.updatedBy) : 'claude');
  void watchProxies(id);
  try { localStorage.setItem(LAST_PROJECT, id); } catch { /* private mode: fine */ }
  events?.close();
  events = new EventSource(`/api/events?id=${enc(id)}`);
  events.onmessage = e => { void onDiskChange(JSON.parse(e.data)); };
}

// ---------- preview proxies ----------

let proxyWatch = 0;
/** Ask the server for light preview copies of the footage; it makes missing ones in the background. */
export async function watchProxies(id: string) {
  const mine = ++proxyWatch;
  for (;;) {
    let r: {ready: Record<string, string>; thumbs?: Record<string, any>; pending: number};
    try { r = await (await fetch(`/api/proxies?id=${enc(id)}`)).json(); } catch { return; }
    if (mine !== proxyWatch || editor.get().projectId !== id) return;
    const thumbs = r.thumbs ?? {};
    editor.set(s => (JSON.stringify(s.proxies) === JSON.stringify(r.ready) && JSON.stringify(s.thumbs) === JSON.stringify(thumbs) && s.proxyPending === r.pending ? s : {...s, proxies: r.ready, thumbs, proxyPending: r.pending}));
    if (!r.pending) return;
    await new Promise(res => setTimeout(res, 3000));
  }
}

// ---------- validation ----------

export function validate(doc: Doc): string | null {
  const r = editSchema.safeParse(doc);
  if (r.success) return null;
  const issue = r.error.issues[0];
  return `${issue.path.join('.') || 'edit.json'}: ${issue.message}`;
}

// ---------- autosave ----------

let timer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;

editor.subscribe(() => {
  const s = editor.get();
  if (s.save !== 'dirty') return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void saveNow(); }, 1000);
});

export async function saveNow(): Promise<void> {
  if (saving) await saving;
  const s = editor.get();
  const doc = currentDoc();
  if (!s.projectId || !doc || (s.save !== 'dirty' && s.save !== 'error')) return;
  const invalid = validate(doc);
  if (invalid) { editor.set(x => ({...x, save: 'error', saveError: invalid})); return; }
  editor.set(x => ({...x, save: 'saving'}));
  saving = (async () => {
    try {
      const r = await fetch(`/api/edit?id=${enc(s.projectId!)}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({data: doc, baseRev: s.rev})});
      const body = await r.json();
      if (r.status === 409) {
        editor.set(x => ({...x, save: 'conflict', incoming: {doc: body.current.data, rev: body.current.rev}}));
        return;
      }
      if (!r.ok) throw new Error(body.error ?? `save failed (${r.status})`);
      const lines = editor.get().pendingChanges;
      editor.set(x => ({...x, rev: body.rev, savedDoc: doc, lastWriter: 'human', pendingChanges: [], save: currentDoc() === doc ? 'saved' : 'dirty', saveError: null}));
      if (lines.length) void fetch(`/api/changes?id=${enc(s.projectId!)}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({lines, rev: body.rev})});
    } catch (err) {
      editor.set(x => ({...x, save: 'error', saveError: err instanceof Error ? err.message : String(err)}));
    }
  })();
  await saving;
  saving = null;
}

// ---------- incoming edits (Claude) ----------

/** Keys of items that differ, so the timeline can flash what Claude touched. */
export function changedKeys(a: Doc, b: Doc): Set<string> {
  const out = new Set<string>();
  const byId = (list: any[]) => new Map(list.map(x => [x.id, JSON.stringify(x)]));
  const before = byId(clips(a));
  for (const c of clips(b)) if (before.get(c.id) !== JSON.stringify(c)) out.add(refKey({kind: 'clip', id: c.id}));
  const nb = byId(notes(a));
  for (const n of notes(b)) if (nb.get(n.id) !== JSON.stringify(n)) out.add(refKey({kind: 'note', id: n.id}));
  const indexed = (kind: 'word' | 'zoom' | 'sfx', x: any[], y: any[]) => y.forEach((v, i) => { if (JSON.stringify(x[i]) !== JSON.stringify(v)) out.add(`${kind}:${i}`); });
  indexed('word', words(a), words(b));
  indexed('zoom', zooms(a), zooms(b));
  indexed('sfx', sfxList(a), sfxList(b));
  return out;
}

async function onDiskChange(msg: {rev: number; updatedBy: string | null}) {
  if (saving) await saving; // the echo of our own save can arrive before the PUT response
  const s = editor.get();
  if (!s.projectId || msg.rev === s.rev) return; // our own save echoing back
  const r = await fetch(`/api/edit?id=${enc(s.projectId)}`);
  if (!r.ok) return;
  const file = await r.json();
  const now = editor.get();
  if (file.rev === now.rev) return;
  const writer = writerOf(file.updatedBy ?? 'claude');
  if (now.save === 'saved' || now.save === 'idle') {
    endGroup();
    acceptFromDisk(file.data, file.rev, changedKeys(now.savedDoc ?? {}, file.data));
    if (writer === 'human') editor.set(x => ({...x, lastWriter: 'human'}));
    toast(writer === 'claude' ? 'Claude edited the file and the editor updated' : 'The file was changed elsewhere and the editor updated', 'claude');
    setTimeout(() => editor.set(x => ({...x, flash: new Set()})), 1600);
  } else {
    editor.set(x => ({...x, save: 'conflict', incoming: {doc: file.data, rev: file.rev}}));
  }
}

/** Conflict: drop local edits and take the version on disk. */
export function takeIncoming() {
  const s = editor.get();
  if (!s.incoming) return;
  acceptFromDisk(s.incoming.doc, s.incoming.rev, changedKeys(currentDoc() ?? {}, s.incoming.doc));
  editor.set(x => ({...x, pendingChanges: []}));
  setTimeout(() => editor.set(x => ({...x, flash: new Set()})), 1600);
}

/** Conflict: keep local edits and write them over the newer file. */
export function keepMine() {
  const s = editor.get();
  if (!s.incoming) return;
  editor.set(x => ({...x, rev: s.incoming!.rev, incoming: null, save: 'dirty', pendingChanges: [...x.pendingChanges, `kept human version over rev ${s.incoming!.rev}`]}));
}

/** How many top-level items differ between local and incoming, for the conflict banner. */
export function conflictSize(): number {
  const s = editor.get();
  const doc = currentDoc();
  return s.incoming && doc ? changedKeys(doc, s.incoming.doc).size : 0;
}

// ---------- render ----------

export type RenderJob = {id: string; status: 'running' | 'done' | 'error'; progress: number; output: string; log: string[]; startedAt: number};
let job: RenderJob | null = null;
const jobListeners = new Set<() => void>();
const setJob = (j: RenderJob | null) => { job = j; for (const l of jobListeners) l(); };
export const useRenderJob = () => useSyncExternalStore(l => { jobListeners.add(l); return () => { jobListeners.delete(l); }; }, () => job);

export async function startRender(quality: 'preview' | 'final') {
  const s = editor.get();
  if (!s.projectId) return;
  if (s.save === 'dirty' || s.save === 'error') await saveNow();
  if (editor.get().save !== 'saved') { toast('Save the file before rendering', 'error'); return; }
  const r = await fetch(`/api/render?id=${enc(s.projectId)}&quality=${quality}&format=${enc(s.format)}`, {method: 'POST'});
  const body = await r.json();
  if (!r.ok) { toast(body.error === 'a render is already running' ? 'A render is already running' : `Render did not start: ${body.error}`, 'error'); return; }
  setJob(body);
  const poll = async () => {
    const res = await fetch('/api/render');
    const j: RenderJob | null = await res.json();
    setJob(j);
    if (j?.status === 'running') setTimeout(poll, 1000);
    else if (j?.status === 'done') toast('Render finished', 'info', 5000);
    else if (j?.status === 'error') toast('Render stopped with an error, check the log', 'error', 6000);
  };
  setTimeout(poll, 1000);
}

export async function cancelRender() { await fetch('/api/render', {method: 'DELETE'}); }
export const dismissRender = () => setJob(null);
