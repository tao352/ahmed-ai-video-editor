// Media bin (CapCut's Media panel): the project's own videos, images and sounds. Import with the
// button or by dropping files here, on the timeline or on the player; click + or drag onto the timeline.
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {FilmStrip, Image as ImageIcon, MusicNotes, Pause, Play, Plus, UploadSimple} from '@phosphor-icons/react';
import {useEditor} from '../store';
import type {Media} from '../model/edits';
import {isElement, SFX_MAX} from '../model/edits';
import {addComponentAt, COMP_MIME, droppedMedia, importAndPlace, isMediaDrag, LIB_MIME, MEDIA_MIME, mediaFromDrop, onMediaChange, placeMedia, uploadFiles} from './actions';

type Item = Media & {size: number};
type Filter = 'all' | 'video' | 'image' | 'audio';
const FILTERS: [Filter, string][] = [['all', 'All'], ['video', 'Video'], ['image', 'Images'], ['audio', 'Audio']];
const ACCEPT = 'video/*,image/*,audio/*,.mkv,.flac';

const fmt = (s?: number) => (s == null ? '' : s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

export function MediaBin() {
  const projectId = useEditor(s => s.projectId);
  const [items, setItems] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    const r = await fetch(`/api/media?id=${encodeURIComponent(projectId)}`);
    setItems(r.ok ? await r.json() : []);
  }, [projectId]);
  useEffect(() => { setItems(null); void load(); }, [load]);
  useEffect(() => onMediaChange(() => void load()), [load]);

  const bring = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try { await uploadFiles(files); } finally { setBusy(false); }
  };

  const shown = (items ?? []).filter(m => filter === 'all' || m.kind === filter);
  return (
    <div className={`media-bin ${over ? 'drop-over' : ''}`}
      onDragOver={e => { if (isMediaDrag(e.dataTransfer) && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={e => { e.preventDefault(); setOver(false); void bring(mediaFromDrop(e.dataTransfer).files); }}>
      <div className="media-tools">
        <button className="key small media-import" onClick={() => input.current?.click()} disabled={busy || !projectId}>
          <UploadSimple size={14} /> {busy ? 'Importing…' : 'Import'}
        </button>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={e => { void bring([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <div className="seg" role="tablist" aria-label="Show">
          {FILTERS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={`key small ${filter === k ? 'lit' : ''}`} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      </div>
      {items == null ? <p className="empty">Loading…</p>
        : !shown.length ? (
          <button className="media-empty" onClick={() => input.current?.click()}>
            <UploadSimple size={22} />
            <b>Drop videos, images or sounds here</b>
            <span>or click to choose files. You can also drop them straight on the timeline.</span>
          </button>
        ) : (
          <div className="media-grid">
            {shown.map(m => <MediaCard key={m.path} m={m} />)}
          </div>
        )}
    </div>
  );
}

function MediaCard({m}: {m: Item}) {
  const base = (window as any).remotion_staticBase as string;
  const url = `${base}/${m.path.split('/').map(encodeURIComponent).join('/')}`;
  const name = m.path.split('/').pop() ?? m.path;
  const role = m.kind === 'audio' ? ((m.duration ?? 0) > SFX_MAX ? 'Music' : 'Sound') : m.kind === 'image' ? (isElement(m.path) ? 'Element' : 'Image') : 'Video';
  return (
    <div className={`media-card ${m.kind}`} draggable title={`${m.path}\nDrag onto the timeline, or click + to add at the playhead`}
      onDragStart={e => { e.dataTransfer.setData(MEDIA_MIME, JSON.stringify(m)); e.dataTransfer.effectAllowed = 'copy'; }}
      onDoubleClick={() => placeMedia(m)}>
      <div className="media-thumb">
        {m.kind === 'image' ? <img src={url} alt="" loading="lazy" draggable={false} />
          : m.kind === 'video' ? <video src={`${url}#t=0.5`} preload="metadata" muted playsInline draggable={false} />
          : <AudioThumb url={url} />}
        <span className="media-kind">{m.kind === 'video' ? <FilmStrip size={11} /> : m.kind === 'image' ? <ImageIcon size={11} /> : <MusicNotes size={11} />} {role}</span>
        {m.duration != null && <span className="media-dur mono">{fmt(m.duration)}</span>}
        <button className="media-add key small icon" title="Add at playhead" aria-label={`Add ${name} at playhead`} onClick={() => placeMedia(m)}><Plus size={13} weight="bold" /></button>
      </div>
      <div className="media-name">{name}</div>
    </div>
  );
}

/** A sound has no picture: a play button to listen before adding it. */
function AudioThumb({url}: {url: string}) {
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!audio.current) { audio.current = new Audio(url); audio.current.onended = () => setPlaying(false); }
    if (playing) { audio.current.pause(); setPlaying(false); } else { void audio.current.play(); setPlaying(true); }
  };
  return (
    <div className="media-audio">
      <MusicNotes size={26} />
      <button className="key small icon" aria-label={playing ? 'Stop' : 'Listen'} title={playing ? 'Stop' : 'Listen'} onClick={toggle}>
        {playing ? <Pause size={12} weight="fill" /> : <Play size={12} weight="fill" />}
      </button>
    </div>
  );
}

/** Drop handlers for the timeline and the player: files from the computer or cards from the bin. */
export function mediaDrop(timeAt: (e: React.DragEvent) => number) {
  return {
    onDragOver: (e: React.DragEvent) => { if (isMediaDrag(e.dataTransfer)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } },
    onDrop: (e: React.DragEvent) => {
      if (!isMediaDrag(e.dataTransfer)) return;
      e.preventDefault();
      const t = timeAt(e);
      const dt = e.dataTransfer;
      if (dt.types.includes(LIB_MIME) || dt.types.includes(COMP_MIME)) {
        void droppedMedia(dt).then(({media, component}) => { if (component) addComponentAt(component, t); else if (media) placeMedia(media, t); });
        return;
      }
      const {files, media} = mediaFromDrop(dt);
      if (media) placeMedia(media, t);
      else if (files.length) void importAndPlace(files, t);
    },
  };
}
