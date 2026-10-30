// Every keyboard shortcut lives in this one table. The key handler and the shortcuts sheet (?)
// both read it, and a test checks that no two entries answer the same key press.
// CapCut's own keys wherever CapCut has one, so muscle memory carries over; our extras (notes,
// guides, freeze, beats) sit on keys CapCut leaves free.
import {editor, playhead, redo, seekFrame, select, toast, togglePlay, totalFrames, undo} from '../store';
import {isTyping} from './format';
import {toggleGuides} from './Guides';
import {addNoteAtPlayhead, beatAtPlayhead, copySelection, cutSelectedWords, deleteSelection, deleteSide, duplicateSelection, fitTimeline, freezeAtPlayhead, fullscreenPreview, togglePlayerMax, groupSelection, jumpEdit, jumpMarker, keyAtPlayhead, pasteAtPlayhead, selectAll, selectSide, setTool, shuttle, splitAtPlayhead, toggleDisable, toggleSkim, zoomTimeline} from './actions';

export type KeySpec = {
  /** physical key (KeyboardEvent.code), so letters work on an Arabic layout too */
  code?: string;
  /** or the produced character(s) (KeyboardEvent.key) */
  key?: string[];
  ctrl?: boolean;
  alt?: boolean;
  /** true / false must match; leave out to accept both */
  shift?: boolean;
};
export type Group = 'play' | 'edit' | 'tools' | 'view';
export type Shortcut = {spec: KeySpec; keys: string; label: string; group: Group; run: () => void; keepDefault?: boolean};

export const GROUPS: Record<Group, string> = {play: 'Playback', edit: 'Edit', tools: 'Tools', view: 'View'};

const step = (frames: number) => seekFrame(playhead.get().frame + frames);

export const SHORTCUTS: Shortcut[] = [
  {group: 'play', keys: 'Space', label: 'Play / pause', spec: {key: [' ']}, run: () => { editor.set(s => (s.rate === 1 ? s : {...s, rate: 1})); togglePlay(); }},
  {group: 'play', keys: 'J / K / L', label: 'Back / stop / forward (press again: faster)', spec: {code: 'KeyJ'}, run: () => shuttle(-1)},
  {group: 'play', keys: '', label: '', spec: {code: 'KeyK', shift: false}, run: () => shuttle(0)},
  {group: 'play', keys: '', label: '', spec: {code: 'KeyL'}, run: () => shuttle(1)},
  {group: 'play', keys: '← / →', label: 'One frame back / forward', spec: {key: ['ArrowLeft'], shift: false}, run: () => step(-1)},
  {group: 'play', keys: '', label: '', spec: {key: ['ArrowRight'], shift: false}, run: () => step(1)},
  {group: 'play', keys: 'Shift + ← / →', label: '10 frames back / forward', spec: {key: ['ArrowLeft'], shift: true}, run: () => step(-10)},
  {group: 'play', keys: '', label: '', spec: {key: ['ArrowRight'], shift: true}, run: () => step(10)},
  {group: 'play', keys: '↑ / ↓', label: 'Previous / next edit point', spec: {key: ['ArrowUp'], shift: false}, run: () => jumpEdit(-1)},
  {group: 'play', keys: '', label: '', spec: {key: ['ArrowDown'], shift: false}, run: () => jumpEdit(1)},
  {group: 'play', keys: 'Shift + ↑ / ↓', label: 'Previous / next marker', spec: {key: ['ArrowUp'], shift: true}, run: () => jumpMarker(-1)},
  {group: 'play', keys: '', label: '', spec: {key: ['ArrowDown'], shift: true}, run: () => jumpMarker(1)},
  {group: 'play', keys: 'Home / End', label: 'Start / end of the video', spec: {key: ['Home']}, run: () => seekFrame(0)},
  {group: 'play', keys: '', label: '', spec: {key: ['End']}, run: () => seekFrame(totalFrames() - 1)},
  {group: 'play', keys: 'Ctrl + Shift + F', label: 'Full-screen player', spec: {code: 'KeyF', ctrl: true, shift: true}, run: fullscreenPreview},
  {group: 'view', keys: '`', label: 'Bigger player (hide the panels)', spec: {code: 'Backquote', ctrl: false}, run: () => togglePlayerMax()},

  {group: 'edit', keys: 'Ctrl + Z', label: 'Undo', spec: {code: 'KeyZ', ctrl: true, shift: false}, run: undo},
  {group: 'edit', keys: 'Ctrl + Shift + Z', label: 'Redo', spec: {code: 'KeyZ', ctrl: true, shift: true}, run: redo},
  {group: 'edit', keys: '', label: '', spec: {code: 'KeyY', ctrl: true}, run: redo},
  {group: 'edit', keys: 'Ctrl + B', label: 'Split at playhead', spec: {code: 'KeyB', ctrl: true}, run: splitAtPlayhead},
  {group: 'edit', keys: 'Q', label: 'Delete left of playhead', spec: {code: 'KeyQ'}, run: () => deleteSide('left')},
  {group: 'edit', keys: 'W', label: 'Delete right of playhead', spec: {code: 'KeyW'}, run: () => deleteSide('right')},
  {group: 'edit', keys: 'Delete', label: 'Delete selection', spec: {key: ['Delete', 'Backspace'], shift: false}, run: deleteSelection},
  {group: 'edit', keys: 'Shift + Delete', label: 'Cut the selected words out of the video', spec: {key: ['Delete', 'Backspace'], shift: true}, run: cutSelectedWords},
  {group: 'edit', keys: 'Ctrl + C / X / V', label: 'Copy / cut / paste at playhead', spec: {code: 'KeyC', ctrl: true}, run: () => copySelection()},
  {group: 'edit', keys: '', label: '', spec: {code: 'KeyX', ctrl: true}, run: () => copySelection(true)},
  {group: 'edit', keys: '', label: '', spec: {code: 'KeyV', ctrl: true}, run: pasteAtPlayhead},
  {group: 'edit', keys: 'Ctrl + G', label: 'Group selected clips', spec: {code: 'KeyG', ctrl: true, shift: false}, run: () => groupSelection(true)},
  {group: 'edit', keys: 'Ctrl + Shift + G', label: 'Ungroup', spec: {code: 'KeyG', ctrl: true, shift: true}, run: () => groupSelection(false)},
  {group: 'edit', keys: 'Ctrl + D', label: 'Duplicate', spec: {code: 'KeyD', ctrl: true}, run: duplicateSelection},
  {group: 'edit', keys: 'Ctrl + A', label: 'Select all clips', spec: {code: 'KeyA', ctrl: true}, run: selectAll},
  {group: 'edit', keys: 'V', label: 'Disable / enable clip', spec: {code: 'KeyV'}, run: toggleDisable},
  {group: 'edit', keys: 'F', label: 'Freeze frame (1 s)', spec: {code: 'KeyF'}, run: () => freezeAtPlayhead()},
  {group: 'edit', keys: 'Shift + K', label: 'Keyframe at playhead', spec: {code: 'KeyK', shift: true}, run: keyAtPlayhead},
  {group: 'edit', keys: 'M', label: 'Note for Claude', spec: {code: 'KeyM'}, run: addNoteAtPlayhead},
  {group: 'edit', keys: 'Alt + B', label: 'Beat at playhead', spec: {code: 'KeyB', alt: true, shift: false}, run: () => beatAtPlayhead(false)},
  {group: 'edit', keys: 'Alt + Shift + B', label: 'Remove nearest beat', spec: {code: 'KeyB', alt: true, shift: true}, run: () => beatAtPlayhead(true)},

  {group: 'tools', keys: 'A', label: 'Select and move', spec: {code: 'KeyA'}, run: () => setTool('select')},
  {group: 'tools', keys: 'B', label: 'Blade', spec: {code: 'KeyB'}, run: () => setTool(editor.get().tool === 'blade' ? 'select' : 'blade')},
  {group: 'tools', keys: '[ / ]', label: 'Select everything before / after playhead', spec: {key: ['[']}, run: () => selectSide('before')},
  {group: 'tools', keys: '', label: '', spec: {key: [']']}, run: () => selectSide('after')},
  {group: 'tools', keys: 'N', label: 'Snapping', spec: {code: 'KeyN'}, run: () => { editor.set(s => ({...s, snap: !s.snap})); toast(editor.get().snap ? 'Snapping on' : 'Snapping off'); }},
  {group: 'tools', keys: 'Esc', label: 'Deselect', spec: {key: ['Escape']}, run: () => { select([]); setTool('select'); editor.set(s => (s.help || s.playerMax ? {...s, help: false, playerMax: false} : s)); }, keepDefault: true},

  {group: 'view', keys: 'Ctrl + = / -', label: 'Zoom timeline in / out', spec: {key: ['+', '='], ctrl: true}, run: () => zoomTimeline(1.4)},
  {group: 'view', keys: '', label: '', spec: {key: ['-', '_'], ctrl: true}, run: () => zoomTimeline(1 / 1.4)},
  {group: 'view', keys: '', label: '', spec: {key: ['+', '=']}, run: () => zoomTimeline(1.4)},
  {group: 'view', keys: '', label: '', spec: {key: ['-', '_']}, run: () => zoomTimeline(1 / 1.4)},
  {group: 'view', keys: 'Shift + Z', label: 'Fit the whole video', spec: {code: 'KeyZ', shift: true}, run: fitTimeline},
  {group: 'view', keys: 'S', label: 'Preview follows the pointer (preview axis)', spec: {code: 'KeyS'}, run: toggleSkim},
  {group: 'view', keys: 'G', label: 'Safe-zone guides', spec: {code: 'KeyG'}, run: toggleGuides},
  {group: 'view', keys: '?', label: 'This shortcut sheet', spec: {code: 'Slash', shift: true}, run: () => editor.set(s => ({...s, help: !s.help}))},
];

export function matches(spec: KeySpec, e: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'> & {altKey?: boolean}): boolean {
  if (Boolean(spec.ctrl) !== (e.ctrlKey || e.metaKey)) return false;
  if (Boolean(spec.alt) !== Boolean(e.altKey)) return false;
  if (spec.shift !== undefined && spec.shift !== e.shiftKey) return false;
  if (spec.code) return spec.code === e.code;
  return Boolean(spec.key?.includes(e.key));
}

/** Global key handler. Ignored while typing in a field. */
export function onKey(e: KeyboardEvent) {
  if (isTyping(e.target)) {
    if (e.key === 'Escape') (e.target as HTMLElement).blur();
    return;
  }
  const hit = SHORTCUTS.find(s => matches(s.spec, e));
  if (!hit) return;
  if (!hit.keepDefault) e.preventDefault();
  hit.run();
}
