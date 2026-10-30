import React, {useEffect, useState} from 'react';
import {useEditor} from './store';
import {fetchProjects, lastProject, loadProject} from './sync';
import {Router} from './ui/Router';
import {Bank} from './ui/Bank';
import {Monitor} from './ui/Monitor';
import {Inspector} from './ui/Inspector';
import {Timeline} from './ui/Timeline';
import {onKey} from './ui/keymap';
import {Shortcuts} from './ui/Shortcuts';
import {ContextMenu} from './ui/ContextMenu';
import {Boundary} from './ui/Boundary';
import {PaneResize} from './ui/PaneResize';
import {ArrowsIn, ArrowsOut, CornersOut} from '@phosphor-icons/react';
import {fullscreenPreview, togglePlayerMax} from './ui/actions';

/** CapCut's corner of the player: make it bigger inside the editor, or full screen. */
function PlayerCorner({max}: {max: boolean}) {
  return <div className="player-corner">
    <button className="key small icon" title={max ? 'Back to the editor (` or Esc)' : 'Bigger player: hide the panels (`)'} aria-label={max ? 'Restore the panels' : 'Bigger player'} aria-pressed={max} onClick={() => togglePlayerMax()}>{max ? <ArrowsIn size={15} /> : <ArrowsOut size={15} />}</button>
    <button className="key small icon" title="Full screen (Ctrl + Shift + F, Esc to leave)" aria-label="Full screen" onClick={fullscreenPreview}><CornersOut size={15} /></button>
  </div>;
}
import {formatOf} from './model/formats';
import type {Doc} from './model/ops';

/** CapCut lays the desk out by the frame: a wide player for 16:9, a tall narrow one with roomier side panels for 9:16. */
export type DeskShape = 'wide' | 'tall' | 'square';
function deskShape(doc: Doc | undefined, format: string): DeskShape {
  if (!doc?.settings) return 'wide';
  const f = formatOf(doc, format) ?? doc.settings;
  const r = f.width / f.height;
  return r > 1.15 ? 'wide' : r < 0.87 ? 'tall' : 'square';
}

export function App() {
  const projectId = useEditor(s => s.projectId);
  const toasts = useEditor(s => s.toasts);
  // Layout menu in the top bar: Auto follows the frame, or the owner fixes Wide / Tall
  const desk = useEditor(s => (s.layout === 'auto' ? deskShape(s.history?.present.doc, s.format) : s.layout));
  const playerMax = useEditor(s => s.playerMax);
  const [error, setError] = useState<string | null>(null);

  const open = (id: string) => {
    if (!id) return;
    setError(null);
    const fromUrl = new URL(location.href);
    fromUrl.searchParams.set('project', id);
    history.replaceState(null, '', fromUrl);
    loadProject(id).catch(e => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => {
    const wanted = new URL(location.href).searchParams.get('project') ?? lastProject();
    fetchProjects().then(list => {
      const id = list.find(p => p.id === wanted)?.id ?? list[0]?.id;
      if (id) open(id); else setError('No project with an edit.json inside projects/.');
    }).catch(() => setError('The editor server is not running.'));
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { document.title = projectId ? `${projectId.replace(/\/(edit\/)?edit\.json$/, '')} · Ahmed AI Video Editor` : 'Ahmed AI Video Editor'; }, [projectId]);

  if (!projectId) {
    return <div className="boot">{error ?? <div className="skeleton" style={{width: 320, height: 12}} />}</div>;
  }
  return (
    <div className="app" data-desk={desk} data-max={playerMax || undefined}>
      <Router onOpen={open} />
      <Boundary name="Library" area="bank"><Bank /></Boundary>
      <Boundary name="Player" area="monitor"><Monitor /></Boundary>
      <Boundary name="Properties" area="params"><Inspector /></Boundary>
      <Boundary name="Timeline" area="desk"><Timeline /></Boundary>
      {desk === 'tall' && !playerMax && <div className="monitor-edge"><PaneResize pane="monitor" /></div>}
      <PlayerCorner max={playerMax} />
      <ContextMenu />
      <Shortcuts />
      <div className="toasts" aria-live="polite">{toasts.map(t => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}</div>
    </div>
  );
}
