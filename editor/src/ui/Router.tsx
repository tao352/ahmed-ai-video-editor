// Top bar (CapCut): project on the left, who edited and the save state in the middle, Export on the right.
// Undo and redo live on the timeline toolbar, like CapCut.
import React, {useEffect, useRef, useState} from 'react';
import {CaretDown, CheckCircle, CircleNotch, DeviceMobile, FilmStrip, FolderOpen, Keyboard, Monitor as MonitorIcon, MagicWand, Warning, X} from '@phosphor-icons/react';
import {editor, useEditor} from '../store';
import {cancelRender, dismissRender, fetchProjects, keepMine, conflictSize, startRender, takeIncoming, useRenderJob, type ProjectInfo} from '../sync';

export function Router({onOpen}: {onOpen: (id: string) => void}) {
  const projectId = useEditor(s => s.projectId);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  useEffect(() => { fetchProjects().then(setProjects).catch(() => setProjects([])); }, [projectId]);
  return (
    <header className="router">
      <div className="wordmark"><img src="/favicon.png" alt="" width="20" height="20" /> Ahmed AI <span>Video Editor</span></div>
      <label className="project-select" title="Project">
        <select value={projectId ?? ''} onChange={e => onOpen(e.target.value)} aria-label="Project">
          {!projectId && <option value="">Choose a project</option>}
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}  ·  {p.width}×{p.height}  ·  {Math.round(p.duration)}s</option>)}
        </select>
        <FolderOpen size={14} />
      </label>
      <span className="spacer" />
      <Tallies />
      <SaveState />
      <span className="spacer" />
      <LayoutSwitch />
      <button className="key icon" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={() => editor.set(s => ({...s, help: !s.help}))}><Keyboard size={16} /></button>
      <RenderKey />
      <ConflictBanner />
      <RenderHud />
    </header>
  );
}

/** CapCut's layout menu: Auto follows the video's shape; Wide and Tall fix the desk. Remembered. */
const LAYOUTS = [['auto', 'Auto', 'Follow the video: wide for 16:9, tall for 9:16'], ['wide', 'Wide', 'Player in the middle, timeline full width (16:9 / YouTube)'], ['tall', 'Tall', 'Player full height on the right, tools on the left (9:16 / reels)']] as const;
function LayoutSwitch() {
  const layout = useEditor(s => s.layout);
  const pick = (l: typeof LAYOUTS[number][0]) => { editor.set(s => ({...s, layout: l})); try { localStorage.setItem('studio-editor:layout', l); } catch { /* ignore */ } };
  return <div className="layout-switch" role="group" aria-label="Layout">
    {LAYOUTS.map(([k, label, tip]) => <button key={k} className={`key small ${layout === k ? 'lit' : ''}`} aria-pressed={layout === k} title={tip} onClick={() => pick(k)}>
      {k === 'auto' ? <MagicWand size={14} /> : k === 'wide' ? <MonitorIcon size={14} /> : <DeviceMobile size={14} />}<span className="layout-label">{label}</span></button>)}
  </div>;
}

function Tallies() {
  const writer = useEditor(s => s.lastWriter);
  const save = useEditor(s => s.save);
  const pulse = useEditor(s => s.claudePulse);
  const [pulsing, setPulsing] = useState(false);
  useEffect(() => {
    if (!pulse) return;
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 950);
    return () => clearTimeout(t);
  }, [pulse]);
  // You are "on air" while you hold unsaved edits or wrote last; Claude when Claude wrote last.
  const human = save === 'dirty' || save === 'saving' || (writer === 'human' && save !== 'conflict');
  const claude = !human && writer === 'claude';
  return (
    <div className="tallies" role="status" aria-label="Who edited last">
      <span className={`tally human ${human ? 'on' : ''}`} title="Last edit was yours"><i />You</span>
      <span className={`tally claude ${claude ? 'on' : ''} ${pulsing ? 'pulse' : ''}`} title="Last edit was by Claude"><i />Claude</span>
    </div>
  );
}

function SaveState() {
  const save = useEditor(s => s.save);
  const error = useEditor(s => s.saveError);
  const rev = useEditor(s => s.rev);
  const text = {idle: '', dirty: 'Unsaved', saving: 'Saving…', saved: `Saved · v${rev}`, conflict: 'Conflict', error: 'Not saved'}[save];
  return <span className={`tally save-state ${save}`} role="status" title={error ?? undefined}><i />{text}</span>;
}

function RenderKey() {
  const [open, setOpen] = useState(false);
  const job = useRenderJob();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const running = job?.status === 'running';
  return (
    <div ref={ref} style={{position: 'relative'}}>
      <button className="key program" disabled={running} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <FilmStrip size={16} /> {running ? `Rendering ${Math.round(job.progress * 100)}%` : 'Export'} <CaretDown size={12} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={() => { setOpen(false); void startRender('preview'); }}>Quick preview<small>Half quality, for review</small></button>
          <button role="menuitem" onClick={() => { setOpen(false); void startRender('final'); }}>Final<small>Full quality, into out/</small></button>
        </div>
      )}
    </div>
  );
}

function RenderHud() {
  const job = useRenderJob();
  if (!job) return null;
  const pct = Math.round(job.progress * 100);
  const url = `/api/file?path=${encodeURIComponent(job.output)}`;
  return (
    <div className="render-hud" role="status">
      <h3>
        {job.status === 'running' ? <CircleNotch size={16} className="spin" /> : job.status === 'done' ? <CheckCircle size={16} weight="fill" color="var(--green)" /> : <Warning size={16} weight="fill" color="var(--red)" />}
        {job.status === 'running' ? 'Rendering…' : job.status === 'done' ? 'Export finished' : 'Export stopped'}
        <span style={{flex: 1}} />
        {job.status !== 'running' && <button className="key small icon" aria-label="Close" onClick={dismissRender}><X size={12} /></button>}
      </h3>
      <div className={`meter ${job.status === 'done' ? 'done' : ''}`}><i style={{transform: `scaleX(${pct / 100})`}} /></div>
      <div className="row">
        <span className="mono">{pct}%</span>
        <span style={{flex: 1}} />
        {job.status === 'running' && <button className="key small" onClick={cancelRender}>Stop</button>}
        {job.status === 'done' && <a className="key small" href={url} target="_blank" rel="noreferrer">Open video</a>}
      </div>
      {job.status === 'done' && <pre>{job.output}</pre>}
      {job.status === 'error' && job.log.length > 0 && <pre>{job.log.join('\n')}</pre>}
    </div>
  );
}

function ConflictBanner() {
  const incoming = useEditor(s => s.incoming);
  if (!incoming) return null;
  return (
    <div className="banner" role="alert">
      <Warning size={18} weight="fill" color="var(--red)" />
      <p>Claude changed the file while you had unsaved edits ({conflictSize()} differences). Which version do you keep?</p>
      <button className="key" onClick={takeIncoming}>Take Claude's version</button>
      <button className="key program" onClick={keepMine}>Keep mine</button>
    </div>
  );
}
