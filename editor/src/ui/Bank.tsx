// Library (CapCut's top-left panel): a row of icon tabs, each a grid of things to drag onto the
// timeline or add at the playhead with +. Media is the project's own files; Audio comes from the shared
// assets/library; Text starts with Default text; Text and Effects then hold only the presets the owner
// saved (right-click a clip > Save as preset), so the library grows with looks that proved good.
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ArrowsLeftRight, ArrowsMerge, ArrowsSplit, Check, CircleHalfTilt, FilmStrip, MusicNotes, NotePencil, Pause, Play, Plus, Scissors, Sparkle, Subtitles, Trash, TextT} from '@phosphor-icons/react';
import {GRADE_PRESETS} from '../../../reel/src/edit/grade';
import * as op from '../model/ops';
import type {Doc, Ref} from '../model/ops';
import {commit, currentDoc, editor, endGroup, fps, groupOrigin, nowTime, seekTime, select, toast, useDoc, useEditor, usePlayhead} from '../store';
import {addComponent, addNoteAtPlayhead, type ClipTemplate, COMP_MIME, cutSelectedWords, DEFAULT_TEXT, LIB_MIME, placeMedia, presetListeners, useLibraryItem} from './actions';
import {loadPresets, savePreset} from './jobs';
import {secs} from './format';
import {MediaBin} from './MediaBin';
import {PaneResize} from './PaneResize';
import {TransitionsBank} from './TransitionsBank';

type Tab = ReturnType<typeof editor.get>['tab'];
const TABS: [Tab, string, React.ElementType][] = [
  ['media', 'Media', FilmStrip], ['audio', 'Audio', MusicNotes], ['text', 'Text', TextT],
  ['effects', 'Effects', Sparkle], ['transitions', 'Transition', ArrowsLeftRight], ['captions', 'Captions', Subtitles],
  ['filters', 'Filters', CircleHalfTilt], ['notes', 'Notes', NotePencil],
];

export function Bank() {
  const saved = useEditor(s => s.tab);
  const tab = TABS.some(t => t[0] === saved) ? saved : 'media'; // a tab that was removed falls back to Media
  const setTab = (t: Tab) => editor.set(s => ({...s, tab: t}));
  return (
    <aside className="bay bank" aria-label="Library">
      <PaneResize pane="bank" />
      <nav className="lib-rail" role="tablist" aria-label="Library">
        {TABS.map(([k, label, Icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`rail-tab ${tab === k ? 'lit' : ''}`} title={label} onClick={() => setTab(k)}>
            <Icon size={18} weight={tab === k ? 'fill' : 'regular'} /><span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="bay-body">
        {tab === 'media' ? <MediaBin /> : tab === 'audio' ? <SharedLibrary tab="audio" /> 
          : tab === 'text' ? <Presets text /> : tab === 'effects' ? <Presets /> : tab === 'transitions' ? <TransitionsBank />
          : tab === 'filters' ? <Filters /> : tab === 'captions' ? <Captions /> : <Notes />}
      </div>
    </aside>
  );
}

/** Components that are mainly words on screen go under Text; the rest under Effects. */

type LibItem = {path: string; kind: 'audio' | 'image' | 'video'; tab: string; group: string; name: string; duration?: number};
let libCache: Promise<LibItem[]> | null = null;
const libFile = (p: string) => `/api/library/file?path=${encodeURIComponent(p)}`;

function SharedLibrary({tab}: {tab: 'audio'}) {
  const [items, setItems] = useState<LibItem[] | null>(null);
  const [group, setGroup] = useState<string>('');
  const [q, setQ] = useState('');
  useEffect(() => {
    libCache ??= fetch('/api/library').then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
    libCache.then(all => setItems(all.filter(i => i.tab === tab)), () => { libCache = null; setItems([]); }); // a failed load is tried again next time
  }, [tab]);
  if (!items) return <div className="skeleton" style={{height: 12, width: 160}} />;
  const groups = [...new Set(items.map(i => i.group))];
  const g = groups.includes(group) ? group : '';
  const needle = q.trim().toLowerCase();
  const shown = items.filter(i => (!g || i.group === g) && (!needle || i.name.toLowerCase().includes(needle)));
  const add = async (i: LibItem) => { const m = await useLibraryItem(i.path); if (m) placeMedia(m); };
  return <>
    <input className="search" type="search" placeholder="Search music and sounds…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search" />
    <div className="chips" role="group" aria-label="Category">
      {['', ...groups].map(x => <button key={x || 'all'} className={`key small ${g === x ? 'lit' : ''}`} onClick={() => setGroup(x)}>{x || 'All'}</button>)}
    </div>
    {!shown.length && <p className="empty">Nothing here yet.</p>}
    <div className="lib-list">
      {shown.map(i => <AudioRow key={i.path} item={i} onAdd={() => void add(i)} />)}
    </div>
  </>;
}

function AudioRow({item, onAdd}: {item: LibItem; onAdd: () => void}) {
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = () => {
    if (playing) { audio.current?.pause(); setPlaying(false); return; }
    audio.current ??= new Audio(libFile(item.path));
    audio.current.currentTime = 0;
    audio.current.onended = () => setPlaying(false);
    void audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };
  return (
    <div className="lib-row" draggable title="Drag onto the timeline, or click + to add at the playhead"
      onDragStart={e => { e.dataTransfer.setData(LIB_MIME, item.path); e.dataTransfer.effectAllowed = 'copy'; }}>
      <button className="key small icon" aria-label={playing ? 'Stop' : 'Listen'} onClick={toggle}>{playing ? <Pause size={12} weight="fill" /> : <Play size={12} weight="fill" />}</button>
      <span className="name" title={item.name}>{item.name}</span>
      <span className="mono dim">{item.duration ? secs(item.duration) : ''}</span>
      <button className="key small icon" aria-label={`Add ${item.name}`} onClick={onAdd}><Plus size={14} /></button>
    </div>
  );
}

/** Colour looks: on the selected footage piece or clip, or on the whole video when nothing is selected. */
const LOOK_NAMES: Record<string, string> = {natural: 'Natural', punch: 'Punchy', warm: 'Warm', cool: 'Cool', film: 'Film', moody: 'Moody', bright: 'Bright', bw: 'Black & white'};
function Filters() {
  const hasSel = useEditor(s => s.selection.some(r => r.kind === 'base' || r.kind === 'clip'));
  const apply = (name: string) => {
    const d = currentDoc();
    if (!d) return;
    const preset = {...(GRADE_PRESETS as Record<string, object>)[name], preset: name};
    const target = editor.get().selection.find(r => r.kind === 'base' || r.kind === 'clip');
    if (target) {
      const where = target.kind === 'base' ? `footage piece #${target.index}` : target.kind === 'clip' ? `clip ${target.id}` : '';
      commit(op.replaceItem(d, target, {...op.getItem(d, target), grade: preset}), 'grade', {change: `look ${name} on ${where}`, selection: [target]});
    } else {
      commit(op.setPath(d, ['grade'], preset), 'grade', {change: `look ${name} on the whole video`});
    }
    endGroup();
  };
  return <>
    <p className="hint">{hasSel ? 'Applies to the selected clip.' : 'Applies to the whole video. Select a clip to colour only that one.'}</p>
    <div className="tile-grid">
      {Object.keys(GRADE_PRESETS).map(k => (
        <button key={k} className="tile text-tile" onClick={() => apply(k)}><CircleHalfTilt size={22} /><span>{LOOK_NAMES[k] ?? k}</span></button>
      ))}
    </div>
  </>;
}

/** Saved clip presets; the Text tab also offers Default text first (CapCut). Drag a tile or click + to add it. */
function Presets({text = false}: {text?: boolean}) {
  const [all, setAll] = useState<Record<string, ClipTemplate>>({});
  useEffect(() => {
    const load = () => void loadPresets<ClipTemplate>('clips').then(setAll);
    load();
    presetListeners.add(load);
    return () => { presetListeners.delete(load); };
  }, []);
  const list = Object.entries(all).filter(([, t]) => (t.component === 'Text') === text);
  const tile = (key: string, label: string, tpl: ClipTemplate, onDelete?: () => void) => {
    const payload = JSON.stringify(tpl), p = tpl.props ?? {};
    return (
      <div key={key} className="tile preset-tile" draggable title="Drag onto the timeline, or click + to add at the playhead"
        onDragStart={e => { e.dataTransfer.setData(COMP_MIME, payload); e.dataTransfer.effectAllowed = 'copy'; }} onDoubleClick={() => addComponent(payload)}>
        {tpl.component === 'Text'
          ? <b className="text-swatch" dir="auto" style={{fontFamily: p.font ? `"${p.font}"` : undefined, color: String(p.color ?? '#fff'), fontWeight: Number(p.weight ?? 700), fontStyle: p.italic ? 'italic' : undefined,
              WebkitTextStroke: (p.stroke as any)?.width ? `${Math.min(3, (p.stroke as any).width / 3)}px ${(p.stroke as any).color}` : undefined, paintOrder: 'stroke fill',
              background: (p.background as any) ? (p.background as any).color : undefined}}>{String(p.text ?? 'Text').slice(0, 14) || 'Text'}</b>
          : <Sparkle size={22} />}
        <span>{label}</span>
        <button className="key small icon" aria-label={`Add ${label}`} onClick={() => addComponent(payload)}><Plus size={14} /></button>
        {onDelete && <button className="key small icon preset-del" aria-label={`Delete ${label}`} onClick={onDelete}><Trash size={12} /></button>}
      </div>
    );
  };
  const remove = (name: string) => async () => { if (confirm(`Delete the preset "${name}"?`)) setAll(await savePreset<ClipTemplate>('clips', name, null)); };
  return <>
    {text
      ? <p className="hint">Add Default text, then style it on the right. Right-click any text on the timeline and choose Save as preset to keep its style here.</p>
      : <p className="hint">Effects you keep land here. Right-click a clip on the timeline and choose Save as preset.</p>}
    <div className="tile-grid">
      {text && tile('default', 'Default text', DEFAULT_TEXT)}
      {list.map(([name, tpl]) => tile(name, name, tpl, remove(name)))}
    </div>
    {!text && !list.length && <p className="empty">No saved effects yet.</p>}
  </>;
}

function Captions() {
  return <CaptionList doc={useDoc('panel')} selection={useEditor(s => s.selection)} />;
}

const CaptionList = React.memo(function CaptionList({doc, selection}: {doc: Doc | null; selection: Ref[]}) {
  const [editing, setEditing] = useState<number | null>(null);
  if (!doc) return null;
  const ws = op.words(doc);
  const lines = op.wordLines(doc);
  const selectedWord = selection.length === 1 && selection[0].kind === 'word' ? selection[0].index : null;
  const pickedWords = new Set(selection.filter(r => r.kind === 'word').map(r => (r as {index: number}).index));
  const pick = (i: number, shift: boolean) => {
    const anchor = selection.find(r => r.kind === 'word') as {index: number} | undefined;
    if (shift && anchor) { const [lo, hi] = [Math.min(anchor.index, i), Math.max(anchor.index, i)]; select(Array.from({length: hi - lo + 1}, (_, k) => ({kind: 'word' as const, index: lo + k}))); }
    else { select([{kind: 'word', index: i}]); seekTime(ws[i][0]); }
  };
  const apply = (next: Doc, change: string, index?: number) => commit(next, 'caption', {change, selection: index != null ? [{kind: 'word', index}] : undefined});
  if (!ws.length) return <p className="empty">No captions in this project.</p>;
  return <>
    <PauseFinder doc={doc} />
    <div className="caption-tools">
      <button className="key small" disabled={selectedWord == null} onClick={() => { const d = currentDoc()!; apply(op.splitWord(d, selectedWord!), `split word #${selectedWord} "${ws[selectedWord!][2]}"`, selectedWord!); }}><ArrowsSplit size={14} /> Split</button>
      <button className="key small" disabled={selectedWord == null || selectedWord >= ws.length - 1} onClick={() => { const d = currentDoc()!; apply(op.mergeWords(d, selectedWord!), `merged words #${selectedWord} and #${selectedWord! + 1}`, selectedWord!); }}><ArrowsMerge size={14} /> Merge with next</button>
      <button className="key small program" disabled={!pickedWords.size} title="Remove the selected speech from the whole video (Shift+Delete)" onClick={cutSelectedWords}><Scissors size={14} /> Remove from video</button>
      <span className="mono" style={{color: 'var(--text-3)', fontSize: 11.5, marginInlineStart: 'auto'}}>{ws.length} words</span>
    </div>
    {lines.map(line => (
      <div key={line[0]} className="caption-line">
        <span className="tc mono">{secs(ws[line[0]][0], 1)}</span>
        {line.map(i => editing === i
          ? <WordInput key={i} value={ws[i][2]} onDone={text => { setEditing(null); if (text != null && text.trim() && text !== ws[i][2]) apply(op.editWord(currentDoc()!, i, text.trim()), `word #${i} text "${ws[i][2]}" -> "${text.trim()}"`, i); }} />
          : <WordChip key={i} index={i} word={ws[i]} selected={pickedWords.has(i)} onPick={shift => pick(i, shift)} onEdit={() => setEditing(i)} />)}
      </div>
    ))}
  </>;
});

/**
 * Tight cuts from the transcript: finds silences and filler words, lets the owner untick any,
 * then ripple-deletes the rest in one undo step (CapCut's "remove pauses / fillers").
 */
function PauseFinder({doc}: {doc: Doc}) {
  const [open, setOpen] = useState(false);
  const [minGap, setMinGap] = useState(0.35);
  const [keep, setKeep] = useState(0.08);
  const [fillers, setFillers] = useState(true);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const cuts = useMemo(() => (open ? op.findCuts(doc, minGap, keep, fillers ? op.FILLERS : []) : []), [open, doc, minGap, keep, fillers]);
  const keyOf = (c: op.Cut) => `${c.start}-${c.end}`;
  const chosen = cuts.filter(c => !skip.has(keyOf(c)));
  const total = chosen.reduce((s, c) => s + c.end - c.start, 0);
  if (!open) return <button className="key small finder-open" onClick={() => setOpen(true)}><Scissors size={14} /> Remove pauses and fillers</button>;
  return (
    <div className="finder">
      <div className="finder-head">
        <b>Remove pauses and fillers</b>
        <button className="key small" onClick={() => { setOpen(false); setSkip(new Set()); }}>Close</button>
      </div>
      <div className="pair">
        <label className="field"><span>Silence longer than<em>s</em></span><input type="number" min={0.1} max={3} step={0.05} value={minGap} onChange={e => setMinGap(Math.max(0.1, Number(e.target.value) || 0.35))} /></label>
        <label className="field"><span>Keep breath<em>s</em></span><input type="number" min={0} max={0.5} step={0.01} value={keep} onChange={e => setKeep(Math.max(0, Number(e.target.value) || 0))} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={fillers} onChange={e => setFillers(e.target.checked)} />Filler words (uh, um, ah…)</label>
      <p className="param-desc">Found <bdi className="mono">{chosen.length}</bdi> cuts, saving <bdi className="mono">{total.toFixed(1)}</bdi> s of <bdi className="mono">{op.duration(doc).toFixed(1)}</bdi> s. Uncheck any you do not want to cut.</p>
      <div className="finder-list">
        {cuts.map(c => {
          const k = keyOf(c);
          return (
            <label key={k} className={`finder-row ${c.kind}`}>
              <input type="checkbox" checked={!skip.has(k)} onChange={e => setSkip(s => { const n = new Set(s); if (e.target.checked) n.delete(k); else n.add(k); return n; })} />
              <button className="tc mono" onClick={e => { e.preventDefault(); seekTime(Math.max(0, c.start - 0.6)); }} title="Listen">{secs(c.start, 2)}</button>
              <span>{c.kind === 'filler' ? `"${c.text}"` : 'Silence'}</span>
              <span className="mono dim">{(c.end - c.start).toFixed(2)}s</span>
            </label>
          );
        })}
      </div>
      <button className="key small program" disabled={!chosen.length} onClick={() => {
        const d = currentDoc();
        if (!d) return;
        commit(op.rippleDeleteMany(d, chosen), 'remove pauses', {change: `removed ${chosen.length} silences/fillers (${total.toFixed(2)}s) with the pause finder: ${chosen.slice(0, 12).map(c => `${c.start.toFixed(2)}-${c.end.toFixed(2)}`).join(', ')}${chosen.length > 12 ? '…' : ''}`, selection: []});
        setSkip(new Set());
      }}><Scissors size={14} /> Remove <bdi>{chosen.length}</bdi> cuts</button>
    </div>
  );
}

function WordChip({word, selected, onPick, onEdit}: {index: number; word: [number, number, string]; selected: boolean; onPick: (shift: boolean) => void; onEdit: () => void}) {
  const now = usePlayhead(p => { const t = p.frame / fps(); return t >= word[0] && t < word[1]; });
  return (
    <button className={`word ${selected ? 'sel' : ''} ${now ? 'now' : ''}`} title={`${word[0].toFixed(2)} - ${word[1].toFixed(2)}`}
      onClick={e => onPick(e.shiftKey)} onDoubleClick={onEdit}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); onEdit(); } }}>{word[2]}</button>
  );
}

function WordInput({value, onDone}: {value: string; onDone: (text: string | null) => void}) {
  const [v, setV] = useState(value);
  return <input className="word-edit" dir="auto" autoFocus value={v} style={{width: `${Math.max(4, v.length + 2)}ch`}}
    onChange={e => setV(e.target.value)} onBlur={() => onDone(v)}
    onKeyDown={e => { if (e.key === 'Enter') onDone(v); if (e.key === 'Escape') onDone(null); }} />;
}

function Notes() {
  return <NoteList doc={useDoc('panel')} selection={useEditor(s => s.selection)} />;
}

const NoteList = React.memo(function NoteList({doc, selection}: {doc: Doc | null; selection: Ref[]}) {
  if (!doc) return null;
  const list = op.notes(doc);
  const update = (id: string, patch: Record<string, unknown>, field: string) => {
    const d = currentDoc()!;
    const n = op.getItem(d, {kind: 'note', id});
    const group = `note:${id}:${field}`;
    const before = groupOrigin(group, n);
    commit(op.replaceItem(d, {kind: 'note', id}, {...n, ...patch}), 'note', {group, change: op.describeFieldChange(before, {...n, ...patch}, `note ${id} at ${n.at.toFixed(2)}s`)});
  };
  const open = list.filter(n => n.status !== 'done').length;
  return <>
    <div className="caption-tools">
      <button className="key small" onClick={addNoteAtPlayhead}><Plus size={14} /> Note at playhead</button>
      <span className="mono" style={{color: 'var(--text-3)', fontSize: 11.5, marginInlineStart: 'auto'}}>{open} open</span>
    </div>
    {!list.length && <p className="empty">Leave a note at any moment with <kbd>M</kbd>, and Claude will read and carry them all out in one go.</p>}
    {list.map(n => {
      const sel = selection.some(r => r.kind === 'note' && r.id === n.id);
      return (
        <div key={n.id} className={`note-row ${n.status === 'done' ? 'done' : ''}`} style={sel ? {background: 'var(--panel-raised)'} : undefined}>
          <span className="tc mono" title="Go to this moment" onClick={() => { seekTime(n.at); select([{kind: 'note', id: n.id}]); }}>{secs(n.at, 1)}</span>
          <textarea data-note={n.id} dir="auto" value={n.text} placeholder="Write what you want at this moment…" rows={2}
            onChange={e => update(n.id, {text: e.target.value}, 'text')} onBlur={endGroup} onFocus={() => select([{kind: 'note', id: n.id}])} />
          <button className={`key small icon ${n.status === 'done' ? 'lit' : ''}`} title={n.status === 'done' ? 'Reopen' : 'Mark done'} aria-label="Mark done"
            onClick={() => update(n.id, {status: n.status === 'done' ? 'open' : 'done'}, 'status')}><Check size={14} /></button>
        </div>
      );
    })}
  </>;
});
