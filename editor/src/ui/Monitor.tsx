// Program monitor: the real Remotion Edit composition through @remotion/player.
import {mediaDrop} from './MediaBin';
import React, {useDeferredValue, useEffect, useMemo, useRef, useState} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {CaretDoubleLeft, CaretDoubleRight, CaretLeft, CaretRight, ChartBar, Pause, Play} from '@phosphor-icons/react';
import {Scopes} from './Scopes';
import {Edit} from '../../../reel/src/edit/Edit';
import {bindPlayer, isSkimming, nowTime, playhead, seekFrame, togglePlay, useEditor, usePlayhead} from '../store';
import {validate, watchProxies} from '../sync';
import {timecode} from './format';
import {Stage} from './Stage';
import {FormatBar} from './FormatBar';
import {GuidesKey, GuidesOverlay} from './Guides';
import {resolveFormat} from '../model/formats';

class Boundary extends React.Component<{children: React.ReactNode; resetKey: unknown}, {error: string | null}> {
  state = {error: null as string | null};
  static getDerivedStateFromError(e: unknown) { return {error: e instanceof Error ? e.message : String(e)}; }
  componentDidUpdate(prev: {resetKey: unknown}) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({error: null}); }
  render() { return this.state.error ? <div className="screen-error">Preview stopped: {this.state.error}</div> : this.props.children; }
}

function useFit(ref: React.RefObject<HTMLElement | null>, w: number, h: number) {
  const [size, setSize] = useState({width: 0, height: 0});
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const {width, height} = entry.contentRect;
      const s = Math.min((width - 32) / w, (height - 44) / h); // 28px of it is the UMD strip
      setSize({width: Math.max(0, Math.floor(w * s)), height: Math.max(0, Math.floor(h * s))});
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, w, h]);
  return size;
}

export function Monitor() {
  // The picture follows edits at low priority, so a drag on the timeline never waits for a frame to render.
  // Dragging on the picture itself or a slider in the panel is about the picture: it follows live then.
  const live = useEditor(s => s.history?.present.doc ?? null);
  const late = useDeferredValue(live);
  const gesture = useEditor(s => s.gesture);
  // After such a drag the picture keeps the live document until the low-priority copy has caught up,
  // so it never steps back to an older picture for a frame.
  const following = useRef(false);
  if (gesture === 'monitor' || gesture === 'panel') following.current = true;
  else if (late === live) following.current = false;
  const doc = following.current ? live : late;
  const projectId = useEditor(s => s.projectId);
  const wrap = useRef<HTMLDivElement>(null);
  const player = useRef<PlayerRef>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const [scopes, setScopes] = useState(false);

  // Keep the last valid document on screen while the current one has an error.
  const lastGood = useRef<Record<string, any> | null>(null);
  const format = useEditor(s => s.format);
  const resolved = useMemo(() => (doc ? resolveFormat(doc, format) : null), [doc, format]);
  const problem = useMemo(() => (resolved ? validate(resolved) : null), [resolved]);
  if (resolved && !problem) lastGood.current = resolved;
  const shown = lastGood.current;

  const w = Number(shown?.settings?.width ?? 1080), h = Number(shown?.settings?.height ?? 1920), fps = Number(shown?.settings?.fps ?? 30);
  const frames = Math.max(1, Math.round(Number(shown?.settings?.duration ?? 1) * fps));
  const fit = useFit(wrap, w, h);
  // CapCut's player zoom: look closer at the picture; 1 = fit the bay. Ctrl + wheel over the picture.
  const [zoom, setZoom] = useState(1);
  const size = {width: Math.round(fit.width * zoom), height: Math.round(fit.height * zoom)};
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => { if (!e.ctrlKey) return; e.preventDefault(); setZoom(z => Math.max(1, Math.min(4, +(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)).toFixed(2)))); };
    el.addEventListener('wheel', wheel, {passive: false});
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  // dropped on the picture: added at the playhead
  const drop = mediaDrop(() => nowTime());
  const proxies = useEditor(s => s.proxies);
  const rate = useEditor(s => s.rate);
  const proxyPending = useEditor(s => s.proxyPending);
  const inputProps = useMemo(() => (shown ? {...shown, __proxies: proxies} : null), [shown, proxies]);
  // Footage changed (a LUT bake, a new source): ask for its proxy.
  const videoKey = (doc?.base ?? []).map((b: any) => `${b.src}|${b.matte ?? ''}`).join(',');
  useEffect(() => { if (projectId && videoKey) void watchProxies(projectId); }, [projectId, videoKey]);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    bindPlayer(p);
    const onFrame = (e: {detail: {frame: number}}) => { if (!isSkimming()) playhead.set(s => (s.frame === e.detail.frame ? s : {...s, frame: e.detail.frame})); };
    const onPlay = () => playhead.set(s => ({...s, playing: true}));
    const onPause = () => playhead.set(s => ({...s, playing: false}));
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    p.seekTo(playhead.get().frame);
    return () => { p.removeEventListener('frameupdate', onFrame); p.removeEventListener('play', onPlay); p.removeEventListener('pause', onPause); bindPlayer(null); };
  }, [projectId, size.width > 0]);

  return (
    <section className="monitor" aria-label="Monitor">
      <div className="clock-row">
        <OnAir />
        <Clock fps={fps} frames={frames} />
        <FormatBar />
        {proxyPending > 0 && <span className="proxy-note" title="Preparing a lightweight copy of the video so preview plays smoothly. Rendering always uses the original.">Preparing light preview…</span>}
        <select className="zoom-select" value={zoom === 1 ? '1' : [1.5, 2, 3].includes(zoom) ? String(zoom) : 'x'} aria-label="Monitor zoom" title="Monitor zoom (Ctrl + mouse wheel on the picture)"
          onChange={e => e.target.value !== 'x' && setZoom(Number(e.target.value))}>
          <option value="1">Fit</option><option value="1.5">150%</option><option value="2">200%</option><option value="3">300%</option>
          {![1, 1.5, 2, 3].includes(zoom) && <option value="x">{Math.round(zoom * 100)}%</option>}
        </select>
        <GuidesKey />
        <button className={`key small icon ${scopes ? 'lit' : ''}`} title="Color scopes" aria-label="Color scopes" aria-pressed={scopes} onClick={() => setScopes(s => !s)}><ChartBar size={14} /></button>
      </div>
      {scopes && <Scopes />}
      <div className={`screen-wrap ${zoom > 1 ? 'zoomed' : ''}`} ref={wrap} {...drop}>
        {shown && size.width > 0 && (
          <div className="screen" dir="ltr" ref={screenRef} style={{width: size.width, height: size.height}}>
            <Boundary resetKey={shown}>
              <Player
                key={`${projectId ?? ''}:${w}x${h}`}
                ref={player}
                component={Edit as React.ComponentType<any>}
                inputProps={inputProps!}
                playbackRate={rate}
                durationInFrames={frames}
                fps={fps}
                compositionWidth={w}
                compositionHeight={h}
                style={{width: size.width, height: size.height}}
                renderLoading={() => <div className="skeleton" style={{position: 'absolute', inset: 0}} />}
                clickToPlay={false}
                doubleClickToFullscreen
                spaceKeyToPlayOrPause={false}
                moveToBeginningWhenEnded={false}
                initiallyMuted={false}
                acknowledgeRemotionLicense
              />
            </Boundary>
            <GuidesOverlay width={w} height={h} profile={format !== 'main' ? doc?.formats?.[format]?.profile : undefined} />
            <Stage screenRef={screenRef} />
            <Umd name={projectId?.replace(/\/(edit\/)?edit\.json$/, '') ?? ''} format={`${w}×${h}`} fps={fps} />
            {problem && <div className="screen-error">The file has an error; the preview shows the last good version. {problem}</div>}
          </div>
        )}
      </div>
      <div className="transport-wrap">
        <SeekBar fps={fps} frames={frames} />
        <Transport fps={fps} frames={frames} />
      </div>
    </section>
  );
}

/** Under-monitor display: project and format, its tally edge lit red on air and amber when Claude writes. */
function Umd({name, format, fps}: {name: string; format: string; fps: number}) {
  const playing = usePlayhead(p => p.playing);
  const pulse = useEditor(s => s.claudePulse);
  const [claude, setClaude] = useState(false);
  useEffect(() => {
    if (!pulse) return;
    setClaude(true);
    const t = setTimeout(() => setClaude(false), 1200);
    return () => clearTimeout(t);
  }, [pulse]);
  return <div className={`umd ${playing ? 'live' : claude ? 'claude' : ''}`}><b>{name}</b><span>{format} · {fps}fps</span></div>;
}

function OnAir() {
  const playing = usePlayhead(p => p.playing);
  return <span className={`on-air ${playing ? 'live' : ''}`}>{playing ? 'ON AIR' : 'STANDBY'}</span>;
}

function Clock({fps, frames}: {fps: number; frames: number}) {
  const frame = usePlayhead(p => p.frame);
  return <div className="clock" aria-live="off">{timecode(frame, fps)}<small>/ {timecode(frames, fps)}</small></div>;
}

/** Scrub bar under the picture: click or drag anywhere on it to move through the video. */
function SeekBar({fps, frames}: {fps: number; frames: number}) {
  const frame = usePlayhead(p => p.frame);
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const at = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(frames - 1, Math.round(((clientX - r.left) / r.width) * (frames - 1))));
  };
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* synthetic event */ }
    seekFrame(at(e.clientX));
  };
  const pct = frames > 1 ? (frame / (frames - 1)) * 100 : 0;
  return (
    <div ref={bar} className="seekbar" role="slider" aria-label="Playhead position" aria-valuemin={0} aria-valuemax={frames - 1} aria-valuenow={frame} aria-valuetext={timecode(frame, fps)} tabIndex={-1}
      onPointerDown={down}
      onPointerMove={e => { setHover(at(e.clientX)); if (e.buttons & 1) seekFrame(at(e.clientX)); }}
      onPointerLeave={() => setHover(null)}>
      <div className="seek-rail"><div className="seek-fill" style={{width: `${pct}%`}} /></div>
      <div className="seek-thumb" style={{left: `${pct}%`}} />
      {hover != null && <div className="seek-tip" style={{left: `${(hover / Math.max(1, frames - 1)) * 100}%`}}>{timecode(hover, fps)}</div>}
    </div>
  );
}

function Transport({fps, frames}: {fps: number; frames: number}) {
  const playing = usePlayhead(p => p.playing);
  const step = (d: number) => seekFrame(playhead.get().frame + d);
  return (
    <div className="transport">
      <button className="key icon" title="Go to start (Home)" aria-label="Go to start" onClick={() => seekFrame(0)}><CaretDoubleLeft size={16} /></button>
      <button className="key icon" title="Back 1 s (Shift+←)" aria-label="Back 1 s" onClick={() => step(-fps)}><CaretLeft size={16} weight="bold" /></button>
      <button className="key icon" title="Previous frame (←)" aria-label="Previous frame" onClick={() => step(-1)}><CaretLeft size={14} /></button>
      <button className={`key play ${playing ? 'program' : ''}`} title="Play / pause (Space)" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
        {playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
      </button>
      <button className="key icon" title="Next frame (→)" aria-label="Next frame" onClick={() => step(1)}><CaretRight size={14} /></button>
      <button className="key icon" title="Forward 1 s (Shift+→)" aria-label="Forward 1 s" onClick={() => step(fps)}><CaretRight size={16} weight="bold" /></button>
      <button className="key icon" title="Go to end (End)" aria-label="Go to end" onClick={() => seekFrame(frames - 1)}><CaretDoubleRight size={16} /></button>
    </div>
  );
}
