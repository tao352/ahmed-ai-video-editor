// Commands shared by keys, buttons and the timeline.
import {registry} from '../../../reel/src/edit/registry';
import {keyedBox} from '../../../reel/src/edit/clipfx';
import * as op from '../model/ops';
import * as ed from '../model/edits';
import {commit, currentDoc, editor, fps, nowTime, pause, play, playhead, seekTime, select, toast} from '../store';
import {runTool, savePreset} from './jobs';

export function deleteSelection() {
  const doc = currentDoc(), all = editor.get().selection;
  if (!doc || !all.length) return;
  const sel = op.unlocked(doc, all);
  if (!sel.length) { toast('This track is locked', 'error'); return; }
  // Deleting a piece of the footage removes that time from the whole video (ripple), like CapCut's main track.
  const pieces = sel.filter((r): r is {kind: 'base'; index: number} => r.kind === 'base')
    .map(r => op.getSpan(doc, r)!).filter(Boolean).sort((x, y) => y.start - x.start);
  const removable = sel.filter(r => !op.isFixed(r));
  if (!pieces.length && !removable.length) { toast('Music cannot be deleted from here; remove it in Properties', 'error'); return; }
  if (pieces.length && op.bases(doc).length === pieces.length) { toast('Cannot delete the whole video; split it first with S and delete the part you do not want', 'error'); return; }
  let next = op.deleteItems(doc, removable);
  for (const p of pieces) next = op.rippleDelete(next, p.start, p.end);
  const parts = [...removable.map(r => op.refLabel(doc, r)), ...pieces.map(p => `footage ${p.start.toFixed(2)}s-${p.end.toFixed(2)}s (rippled)`)];
  commit(next, 'delete', {change: `deleted ${parts.join(', ')}`, selection: []});
}

/** Cut the time covered by the selected words out of the whole video (text-based editing). */
export function cutSelectedWords() {
  const doc = currentDoc(), sel = editor.get().selection.filter((r): r is {kind: 'word'; index: number} => r.kind === 'word');
  if (!doc || !sel.length) { toast('Select one or more caption words first', 'error'); return; }
  const ws = op.words(doc);
  const idx = sel.map(r => r.index).sort((x, y) => x - y);
  const first = ws[idx[0]], last = ws[idx.at(-1)!];
  // Take the silence up to the next word too, so the cut lands on speech.
  const next = ws[idx.at(-1)! + 1];
  const a = first[0], b = next ? Math.min(next[0], last[1] + 0.25) : last[1];
  const text = idx.map(i => ws[i][2]).join(' ');
  commit(op.rippleDelete(doc, a, b), 'cut words', {change: `cut "${text}" (${a.toFixed(2)}s-${b.toFixed(2)}s) out of the video`, selection: []});
  toast(`Removed "${text.length > 30 ? text.slice(0, 30) + '…' : text}" from the video`);
}

export function duplicateSelection() {
  const doc = currentDoc(), sel = editor.get().selection;
  if (!doc || !sel.length) return;
  const {doc: next, created} = op.duplicateItems(doc, sel);
  if (!created.length) return;
  commit(next, 'duplicate', {change: `duplicated ${sel.map(r => op.refLabel(doc, r)).join(', ')}`, selection: created});
}

/**
 * Split at the playhead, CapCut style: the selected clips, or the footage itself when the
 * footage (or nothing) is selected. The piece after the cut gets selected so Delete removes it.
 */
export function splitAtPlayhead() {
  const doc = currentDoc();
  if (!doc) return;
  const t = op.round(nowTime());
  const sel = editor.get().selection;
  const clipIds = sel.filter((r): r is {kind: 'clip'; id: string} => r.kind === 'clip').map(r => r.id);
  if (clipIds.length) {
    let next = doc;
    const made: op.Ref[] = [];
    for (const id of clipIds) {
      const r = op.splitClip(next, id, t);
      if (r.newId) { next = r.doc; made.push({kind: 'clip', id: r.newId}); }
    }
    if (!made.length) { toast('The playhead is not on the selected clip; move it onto the clip first', 'error'); return; }
    commit(next, 'split', {change: `split ${clipIds.join(', ')} at ${t.toFixed(2)}s`, selection: made});
    return;
  }
  const r = op.splitBase(doc, t);
  if (r.index == null) { toast('The playhead is at the edge of the video; move it to where you want to split', 'error'); return; }
  commit(r.doc, 'split footage', {change: `split footage at ${t.toFixed(2)}s`, selection: [{kind: 'base', index: r.index}]});
  toast('Split. The part after the playhead is selected; press Delete to remove it');
}

/** Select everything after (or before) the playhead, to slide the rest of the edit in one drag. */
export function selectSide(side: 'before' | 'after') {
  const doc = currentDoc();
  if (!doc) return;
  const refs = op.sideRefs(doc, nowTime(), side);
  select(refs);
  toast(refs.length ? `Selected ${refs.length} items ${side === 'after' ? 'after' : 'before'} the playhead` : 'Nothing there');
}

export function setTool(tool: 'select' | 'blade') {
  editor.set(s => ({...s, tool}));
}

export function toggleSkim() {
  const skim = !editor.get().skim;
  editor.set(s => ({...s, skim}));
  try { localStorage.setItem('studio-editor:skim', skim ? '1' : '0'); } catch { /* storage blocked */ }
  toast(skim ? 'Skimming on' : 'Skimming off');
}

/** Cut whatever is under the blade at time t: a clip, or the footage when the click is on it. */
export function bladeAt(ref: op.Ref, t: number) {
  const doc = currentDoc();
  if (!doc) return;
  t = op.round(t);
  if (op.isLocked(doc, ref)) { toast('This track is locked', 'error'); return; }
  if (ref.kind === 'clip') {
    const r = op.splitClip(doc, ref.id, t);
    if (r.newId) commit(r.doc, 'blade', {change: `cut clip ${ref.id} at ${t.toFixed(2)}s (blade)`, selection: [{kind: 'clip', id: r.newId}]});
    return;
  }
  if (ref.kind === 'base') {
    const r = op.splitBase(doc, t);
    if (r.index != null) commit(r.doc, 'blade', {change: `cut footage at ${t.toFixed(2)}s (blade)`, selection: [{kind: 'base', index: r.index}]});
    return;
  }
  toast('The blade only cuts clips and video', 'error');
}

export function beatAtPlayhead(remove = false) {
  const doc = currentDoc();
  if (!doc?.audio?.music) { toast('No music in the project', 'error'); return; }
  const t = nowTime();
  const next = remove ? op.removeBeatNear(doc, t) : op.addBeat(doc, t);
  if (next === doc) { toast('No beat near the playhead', 'error'); return; }
  commit(next, 'beat', {change: `${remove ? 'removed the music beat near' : 'added a music beat at'} ${t.toFixed(2)}s`});
}

/** Detect the music's beats (tools/edit/music.py analysis) and store them as audio.music.beats. */
export async function analyzeBeats() {
  const doc = currentDoc();
  if (!doc?.audio?.music) { toast('No music in the project', 'error'); return; }
  const r = await runTool<{beats: number[]; tempo: number}>('beats', {music: doc.audio.music.src}, 'Detecting beats');
  const d = currentDoc();
  if (!r || !d) return;
  commit(op.setPath(d, ['audio', 'music', 'beats'], r.beats.filter(b => b <= op.duration(d))), 'beats', {change: `detected ${r.beats.length} music beats (${Math.round(r.tempo)} BPM)`});
  toast(`${r.beats.length} beats, ${Math.round(r.tempo)} BPM. Dragging snaps to them`);
}

/** CapCut "freeze": hold the footage frame under the playhead for one second; the rest waits. */
export function freezeAtPlayhead(len = 1) {
  const doc = currentDoc();
  if (!doc) return;
  const t = op.round(nowTime());
  const r = op.insertFreeze(doc, t, len);
  if (r.index == null) { toast('The playhead must be inside the video to freeze a frame', 'error'); return; }
  commit(r.doc, 'freeze', {change: `froze the footage frame at ${t.toFixed(2)}s for ${len}s (rest of the edit moved ${len}s later)`, selection: [{kind: 'base', index: r.index}]});
  toast('Froze a frame for 1 s. Change its duration in Properties or delete it with Delete');
}

/** Keyframe the selected clip's on-screen box at the playhead (◆ / K-less shortcut: Shift+K). */
export function keyAtPlayhead() {
  const doc = currentDoc(), sel = editor.get().selection;
  // a footage piece (or nothing selected): key its zoom, pan and rotate where the playhead is
  const base = sel.length === 1 && sel[0].kind === 'base' ? sel[0].index : sel.length ? -1 : op.bases(doc ?? {}).findIndex((_, i) => { const s = op.getSpan(doc!, {kind: 'base', index: i}); return !!s && nowTime() >= s.start && nowTime() < s.end; });
  if (doc && base >= 0) {
    const ref = {kind: 'base' as const, index: base}, span = op.getSpan(doc, ref)!, t = op.round(nowTime() - span.start);
    const now = keyedBox({x: 0, y: 0, scale: 1, rotate: 0, opacity: 1}, op.bases(doc)[base].keys, t);
    commit(op.upsertKey(doc, ref, t, {x: now.x, y: now.y, scale: now.scale, rotate: now.rotate}), 'keyframe', {change: `keyframe on footage piece #${base} at +${t.toFixed(2)}s (scale ${now.scale.toFixed(2)})`, selection: [ref]});
    return;
  }
  const ref = sel.length === 1 && sel[0].kind === 'clip' ? sel[0] : null;
  const clip = ref && op.clips(doc ?? {}).find(c => c.id === ref.id);
  if (!doc || !clip) { toast('Select a single clip first', 'error'); return; }
  const t = nowTime() - clip.from;
  if (t < 0 || t > clip.to - clip.from) { toast('The playhead must be inside the clip', 'error'); return; }
  const b = {x: 0, y: 0, scale: 1, rotate: 0, ...clip.box};
  const now = keyedBox({...b, opacity: 1}, clip.keys, t);
  commit(op.upsertKey(doc, clip.id, t, {x: now.x, y: now.y, scale: now.scale, rotate: now.rotate}), 'keyframe', {change: `keyframe on clip ${clip.id} at +${t.toFixed(2)}s (x ${now.x.toFixed(3)}, y ${now.y.toFixed(3)}, scale ${now.scale.toFixed(2)})`});
}

export function addNoteAtPlayhead() {
  const doc = currentDoc();
  if (!doc) return;
  const {doc: next, id} = op.addNote(doc, nowTime(), '');
  commit(next, 'note', {change: `added note at ${nowTime().toFixed(2)}s`, selection: [{kind: 'note', id}]});
  editor.set(s => ({...s, tab: 'notes'}));
  // The notes tab renders on the next commit; keep trying for a few frames.
  let tries = 0;
  const focus = () => {
    const el = document.querySelector<HTMLTextAreaElement>(`[data-note="${id}"]`);
    if (el) el.focus(); else if (++tries < 20) requestAnimationFrame(focus);
  };
  requestAnimationFrame(focus);
}

/**
 * A saved clip (CapCut "save as preset"): everything that makes its look, without its time. Library
 * tiles carry one of these, or a bare component name, in COMP_MIME.
 */
export type ClipTemplate = {component: string; props?: Record<string, unknown>; length?: number; [look: string]: unknown};
const TIMING = new Set(['id', 'from', 'to', 'track', 'group', 'disabled']);
export function templateOf(clip: any): ClipTemplate {
  const out: ClipTemplate = {component: clip.component, length: op.round(clip.to - clip.from)};
  for (const [k, v] of Object.entries(clip)) if (!TIMING.has(k) && k !== 'component') out[k] = structuredClone(v);
  return out;
}
export const DEFAULT_TEXT: ClipTemplate = {component: 'Text', props: {text: 'Default text'}, length: 3};

/** Add a component by name, or a saved template (JSON text), at the playhead on a free track. */
export function addComponent(name: string) {
  const doc = currentDoc();
  if (!doc) return;
  let tpl: ClipTemplate;
  try { tpl = name.startsWith('{') ? JSON.parse(name) : {component: name}; } catch { return; }
  const entry = registry[tpl.component];
  if (!entry) { toast(`There is no ${tpl.component} in this editor.`, 'error'); return; }
  const {component, props, length, ...look} = tpl;
  const {doc: added, id} = op.addClip(doc, component, nowTime(), structuredClone(props ?? entry.defaults ?? {}), length ?? 3);
  const next = Object.keys(look).length ? op.replaceItem(added, {kind: 'clip', id}, {...op.getItem(added, {kind: 'clip', id}), ...structuredClone(look)}) : added;
  commit(next, 'add', {change: `added clip ${id} (${component}) at ${nowTime().toFixed(2)}s`, selection: [{kind: 'clip', id}]});
}

/** Save the selected clip's look as a library preset (Effects, or Text for text clips). */
export async function saveClipPreset() {
  const d = currentDoc();
  const r = editor.get().selection.find(x => x.kind === 'clip');
  const clip = d && r ? op.getItem(d, r) : null;
  if (!clip) return;
  const name = prompt('Name this preset?', clip.component === 'Text' ? String(clip.props?.text ?? '').slice(0, 24) : clip.component);
  if (!name?.trim()) return;
  await savePreset('clips', name.trim(), templateOf(clip));
  for (const l of presetListeners) l();
  toast(`Saved "${name.trim()}" to the ${clip.component === 'Text' ? 'Text' : 'Effects'} library`);
}
export const presetListeners = new Set<() => void>();

export function zoomTimeline(factor: number) {
  editor.set(s => ({...s, pxPerSec: Math.max(8, Math.min(600, s.pxPerSec * factor))}));
}

export function selectAll() {
  const doc = currentDoc();
  if (doc) select(op.clips(doc).map(c => ({kind: 'clip', id: c.id})));
}


// ---------- CapCut timeline commands ----------

/** Q / W: delete what is left or right of the playhead (ripple on the footage, trim on clips). */
export function deleteSide(side: 'left' | 'right') {
  const doc = currentDoc();
  if (!doc) return;
  const sel = editor.get().selection;
  const r = ed.deleteSide(doc, sel, nowTime(), side);
  if (r.doc === doc) { toast('Nothing to split here: put the playhead inside the clip', 'error'); return; }
  commit(r.doc, 'delete side', {change: `deleted ${side === 'left' ? 'left' : 'right'} of the playhead at ${nowTime().toFixed(2)}s (${sel.length ? sel.map(x => op.refLabel(doc, x)).join(', ') : 'footage'})`});
  seekTime(r.playhead);
}

/** Up / Down: jump to the previous / next cut. */
export function jumpEdit(dir: -1 | 1) {
  const doc = currentDoc();
  if (!doc) return;
  // compare whole frames: a cut less than a frame away is where the playhead already is
  const f = fps(), now = playhead.get().frame;
  const frames = ed.editPoints(doc).map(p => Math.round(p * f));
  const hit = dir > 0 ? frames.find(x => x > now) : [...frames].reverse().find(x => x < now);
  if (hit != null) seekTime(hit / f);
}

let board: ed.Clip[] = [];
export function copySelection(cut = false) {
  const doc = currentDoc();
  if (!doc) return;
  board = ed.copyItems(doc, editor.get().selection);
  if (!board.length) { toast('Select a clip or sound first', 'error'); return; }
  if (cut) deleteSelection(); else toast(`Copied ${board.length}`);
}
export function pasteAtPlayhead() {
  const doc = currentDoc();
  if (!doc || !board.length) return;
  const r = ed.pasteItems(doc, board, nowTime());
  commit(r.doc, 'paste', {change: `pasted ${r.created.length} item(s) at ${nowTime().toFixed(2)}s`, selection: r.created});
}

/** V: switch the selected clips / sounds off (they stay on the timeline) or back on. */
export function toggleDisable() {
  const doc = currentDoc();
  if (!doc) return;
  const sel = op.unlocked(doc, editor.get().selection);
  const next = ed.toggleDisabled(doc, sel);
  if (next === doc) { toast('Select a clip or sound first', 'error'); return; }
  commit(next, 'disable', {change: `switched ${sel.map(x => op.refLabel(doc, x)).join(', ')} ${op.getItem(next, sel[0])?.disabled ? 'off' : 'on'}`});
}

/** Shift+Z: the whole video fits the timeline width. */
export function fitTimeline() {
  const doc = currentDoc();
  const el = document.querySelector('.desk-scroll') as HTMLElement | null;
  if (!doc || !el) return;
  const w = el.clientWidth - 188 - 40;
  editor.set(s => ({...s, pxPerSec: Math.max(8, Math.min(600, w / Math.max(1, op.duration(doc))))}));
  el.scrollLeft = 0;
}

/** J / K / L shuttle like CapCut and every NLE: L plays, again faster; J the same backwards; K stops. */
export function shuttle(dir: -1 | 0 | 1) {
  const {playing} = playhead.get();
  if (dir === 0) { setRate(1); pause(); return; }
  const rate = editor.get().rate;
  const next = playing && Math.sign(rate) === dir ? Math.max(-4, Math.min(4, rate * 2)) : dir;
  setRate(next);
  if (!playing) play();
}
function setRate(rate: number) { editor.set(s => (s.rate === rate ? s : {...s, rate})); if (Math.abs(rate) !== 1) toast(`${rate > 0 ? '▶' : '◀'} ${Math.abs(rate)}×`, 'info', 900); }

export function fullscreenPreview() {
  // the player with its clock and transport, so it can still be driven full screen
  const el = document.querySelector('.monitor') as HTMLElement | null;
  if (document.fullscreenElement) void document.exitFullscreen(); else void el?.requestFullscreen?.();
}

/** Bigger player inside the editor: the panels step aside and the player fills the window. */
export function togglePlayerMax(on?: boolean) {
  editor.set(s => ({...s, playerMax: on ?? !s.playerMax}));
}

/** Shift + up / down: previous / next marker (note). */
export function jumpMarker(dir: -1 | 1) {
  const doc = currentDoc();
  if (!doc) return;
  const f = fps(), now = playhead.get().frame;
  const frames = [...new Set(op.notes(doc).map((n: any) => Math.round(n.at * f)))].sort((a, b) => a - b);
  const hit = dir > 0 ? frames.find(x => x > now) : [...frames].reverse().find(x => x < now);
  if (hit != null) seekTime(hit / f); else toast('No more markers', 'info', 1200);
}

/**
 * CapCut "reverse" on a footage piece: ffmpeg writes that stretch backwards (and its matte), and the
 * piece points at the new file. `reversed` keeps where it came from, so the same key turns it back.
 */
export async function reversePiece(index: number) {
  const doc = currentDoc();
  const b = doc && op.bases(doc)[index];
  const span = doc && op.getSpan(doc, {kind: 'base', index});
  if (!doc || !b || !span) return;
  if (b.reversed) {
    const {reversed, ...rest} = b;
    commit(op.replaceItem(doc, {kind: 'base', index}, {...rest, src: reversed.src, sourceIn: reversed.sourceIn, matte: reversed.matte}), 'reverse', {change: `footage piece #${index} plays forwards again (${reversed.src})`});
    return;
  }
  const from = b.sourceIn ?? 0, to = op.round(from + (span.end - span.start) * (b.speed ?? 1));
  const video = await runTool<{file: string}>('reverse', {video: b.src, from, to}, 'Reversing video');
  if (!video) return;
  const matte = b.matte ? await runTool<{file: string}>('reverse', {video: b.matte, from, to}, 'Reversing matte') : null;
  const d = currentDoc();
  if (!d) return;
  commit(op.replaceItem(d, {kind: 'base', index}, {...op.bases(d)[index], src: video.file, sourceIn: 0, ...(matte ? {matte: matte.file} : {}), reversed: {src: b.src, sourceIn: from, matte: b.matte}}), 'reverse',
    {change: `footage piece #${index} reversed: ${b.src} ${from}s-${to}s -> ${video.file}`});
}

/** Ctrl+G / Ctrl+Shift+G: group the selected clips, or break their group. */
export function groupSelection(on: boolean) {
  const doc = currentDoc();
  if (!doc) return;
  const ids = editor.get().selection.filter(r => r.kind === 'clip').map(r => (r as {id: string}).id);
  const next = on ? ed.groupClips(doc, ids) : ed.ungroupClips(doc, ids);
  if (next === doc) { toast(on ? 'Select two or more clips' : 'These clips are not in a group', 'error'); return; }
  commit(next, 'group', {change: `${on ? 'grouped' : 'ungrouped'} clips ${ids.join(', ')}`});
  toast(on ? 'Grouped: they will move together' : 'Ungrouped');
}

/** The video file behind a footage piece or a clip (its first video-looking prop). */
function videoOf(doc: op.Doc, ref: op.Ref): {src: string; from: number; to: number; at: number} | null {
  const span = op.getSpan(doc, ref);
  if (!span) return null;
  if (ref.kind === 'base') {
    const b = op.bases(doc)[ref.index];
    const from = b.sourceIn ?? 0;
    return {src: b.src, from, to: op.round(from + (span.end - span.start) * (b.speed ?? 1)), at: span.start};
  }
  if (ref.kind === 'clip') {
    const c = op.getItem(doc, ref);
    const src = Object.values(c.props ?? {}).find(v => typeof v === 'string' && /\.(mp4|mov|webm|mkv)$/i.test(v)) as string | undefined;
    const from = Number(c.props?.startFrom ?? c.props?.sourceIn ?? 0) || 0;
    return src ? {src, from, to: op.round(from + span.end - span.start), at: span.start} : null;
  }
  return null;
}

/** CapCut "extract audio": the selected video's own sound is placed as a sound on the timeline. */
export async function extractAudio() {
  const doc = currentDoc();
  const ref = editor.get().selection[0];
  const v = doc && ref && videoOf(doc, ref);
  if (!doc || !v) { toast('Select a video (a main-video segment or a clip containing video)', 'error'); return; }
  const r = await runTool<{file: string}>('audio', {video: v.src, from: v.from, to: v.to}, 'Extracting audio');
  const d = currentDoc();
  if (!r || !d) return;
  const next = op.setPath(d, ['audio', 'sfx'], [...op.sfxList(d), {at: v.at, file: r.file, volume: 1, duration: op.round(v.to - v.from)}]);
  commit(next, 'extract audio', {change: `extracted the sound of ${v.src} ${v.from}s-${v.to}s to ${r.file} at ${v.at}s`, selection: [{kind: 'sfx', index: op.sfxList(next).length - 1}]});
}

// ---------- importing media (CapCut's Import) ----------

/** The drag payload for a file from the media bin. */
export const MEDIA_MIME = 'application/x-studio-media';
const mediaListeners = new Set<() => void>();
/** The media bin listens here so it refreshes after an import from anywhere (timeline, player, bin). */
export const onMediaChange = (l: () => void) => { mediaListeners.add(l); return () => { mediaListeners.delete(l); }; };

/** Copy files from the computer into the project's public/media/. */
export async function uploadFiles(files: File[]): Promise<ed.Media[]> {
  const id = editor.get().projectId;
  if (!id) return [];
  const out: ed.Media[] = [];
  for (const f of files) {
    toast(`Importing ${f.name}…`);
    const r = await fetch(`/api/upload?id=${encodeURIComponent(id)}&name=${encodeURIComponent(f.name)}`, {method: 'POST', body: f});
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { toast(`${f.name}: ${body.error ?? 'import failed'}`, 'error', 5000); continue; }
    out.push(body as ed.Media);
  }
  if (out.length) for (const l of mediaListeners) l();
  return out;
}

/** Put a file from the bin on the timeline at t (the playhead by default) and select it. */
export function placeMedia(m: ed.Media, t = nowTime()) {
  const doc = currentDoc();
  if (!doc) return;
  const r = ed.addMedia(doc, m, t);
  commit(r.doc, 'add media', {change: r.change, selection: [r.ref]});
  if (m.kind === 'video') toast('Video added with its sound off; raise Volume in Properties to hear it.');
  else if (r.ref.kind === 'music') toast('Set as the music (volume 25%).');
}

/** Replace (CapCut): the dropped file takes the place of the item, keeping its time, length and look. */
export function replaceWithMedia(ref: op.Ref, m: ed.Media) {
  const doc = currentDoc();
  if (!doc) return;
  if (op.isLocked(doc, ref)) { toast('That track is locked.', 'error'); return; }
  const r = ed.replaceMedia(doc, ref, m);
  if (!r) {
    const item = op.getItem(doc, ref);
    const len = ref.kind === 'base' ? item?.duration : item ? item.to - item.from : 0;
    toast(m.duration != null && len && m.duration < len ? `Too short to replace: the clip is ${len.toFixed(1)}s, the file ${m.duration.toFixed(1)}s.`
      : m.kind === 'audio' ? 'A sound can only replace a sound.' : 'Only video, picture and sound clips can be replaced.', 'error');
    return;
  }
  commit(r.doc, 'replace', {change: r.change, selection: [r.ref]});
  toast('Replaced.');
}

/** Whatever was dropped on an item held for Replace (bin card, library item or file): swap it in. */
export async function dropReplace(dt: DataTransfer, ref: op.Ref) {
  const {media} = await droppedMedia(dt);
  if (media) replaceWithMedia(ref, media);
}

/** Files dropped from the computer: import them, then lay them on the timeline one after another from t. */
export async function importAndPlace(files: File[], t = nowTime()) {
  let at = t;
  for (const m of await uploadFiles(files)) {
    placeMedia(m, at);
    if (m.kind !== 'audio') at += Math.min(m.duration ?? 3, 3);
  }
}

/** Read a drop: files from the computer, or an item dragged out of the media bin. */
export function mediaFromDrop(dt: DataTransfer): {files: File[]; media: ed.Media | null} {
  const raw = dt.getData(MEDIA_MIME);
  let media: ed.Media | null = null;
  try { media = raw ? JSON.parse(raw) : null; } catch { media = null; }
  return {files: [...dt.files], media};
}
export const LIB_MIME = 'application/x-studio-library';
export const COMP_MIME = 'application/x-studio-component';
export const isMediaDrag = (dt: DataTransfer) => dt.types.includes('Files') || dt.types.includes(MEDIA_MIME) || dt.types.includes(LIB_MIME) || dt.types.includes(COMP_MIME);

/** A shared-library file (assets/library) copied into this project, ready to place like imported media. */
export async function useLibraryItem(path: string): Promise<ed.Media | null> {
  const id = editor.get().projectId;
  if (!id) return null;
  const r = await fetch(`/api/library/use?id=${encodeURIComponent(id)}&path=${encodeURIComponent(path)}`, {method: 'POST'});
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { toast(body.error ?? 'Could not bring that file in.', 'error'); return null; }
  for (const l of mediaListeners) l();
  return body as ed.Media;
}

/** What a drop carries, as one media file (the first file for a drop from the computer), or a component name. */
export async function droppedMedia(dt: DataTransfer): Promise<{media: ed.Media | null; component: string | null}> {
  const comp = dt.getData(COMP_MIME);
  if (comp) return {media: null, component: comp};
  const lib = dt.getData(LIB_MIME);
  if (lib) return {media: await useLibraryItem(lib), component: null};
  const {files, media} = mediaFromDrop(dt);
  if (media) return {media, component: null};
  const [m] = files.length ? await uploadFiles(files.slice(0, 1)) : [];
  return {media: m ?? null, component: null};
}

/** A component from the library at time t, on a free track. */
export function addComponentAt(name: string, t: number) {
  seekTime(t);
  addComponent(name);
}
