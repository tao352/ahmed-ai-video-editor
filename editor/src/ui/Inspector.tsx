// Parameter panel: edits the selected item, or the project when nothing is selected.
import React, {useMemo, useState} from 'react';
import {ChromaFields} from './ChromaFields';
import * as ed from '../model/edits';
import {CropFields} from './CropFields';
import {AudioKeys} from './AudioKeys';
import {transitionName} from './transitionTypes';
import {CUT_TRANSITIONS, isCutTransition} from '../../../reel/src/edit/cutTransitions';
import {FootageMotion, MotionPanel} from './FootageMotion';
import {z} from 'zod';
import {CopySimple, Crosshair, Trash} from '@phosphor-icons/react';
import {registry} from '../../../reel/src/edit/registry';
import * as op from '../model/ops';
import type {Doc, Ref} from '../model/ops';
import {commit, currentDoc, editor, endGroup, fps, groupOrigin, seekTime, useDoc, useEditor, usePlayhead} from '../store';
import {keyedBox} from '../../../reel/src/edit/clipfx';
import {CheckField, ColorField, JsonField, NumberField, SchemaFields, SelectField, SliderField, TextField, type JsonSchema} from './fields';
import {deleteSelection, duplicateSelection, freezeAtPlayhead, keyAtPlayhead, reversePiece} from './actions';
import {CAPTIONS_ID, resetBox} from './Stage';
import {formatLabel, MAIN, removeFormat, resolveFormat, setClipOverride, setFormatField} from '../model/formats';
import {footageFrame, GradePanel, LutControls} from './ColorPanel';
import {PaneResize} from './PaneResize';
import {AnimSection, MaskSection, StyleSection, SubjectSection} from './ClipLook';
import {TextFields} from './TextPanel';
import {runTool} from './jobs';
import {FollowSection, StabilizeSection, TrackingSection} from './Tracking';


// Props Edit injects into every component; editing them per clip would be overwritten anyway.
const INJECTED = ['accent', 'mode', 'width', 'height', 'audioSrc', 'words', 'style', 'anim', 'from', 'to'];
const CAPTION_PRESETS = ['default', 'reel4', 'bottom-bold', 'karaoke', 'keyword-pop', 'behind', 'none'];
const FITS = ['cover', 'contain', 'fill', 'blurfill'];
const FIT_NAMES: Record<string, string> = {cover: 'Fill frame (crops overflow)', contain: 'Fit whole frame', fill: 'Stretch to frame', blurfill: 'Fit with blurred background'};
const ZOOM_TYPES = ['punch', 'ratchet', 'kenburns', 'ramp', 'drop'];
const COMPONENTS = Object.keys(registry).sort();

const schemaCache = new Map<string, JsonSchema | null>();
function propsSchema(name: string): JsonSchema | null {
  if (!schemaCache.has(name)) {
    const entry = registry[name];
    let s: JsonSchema | null = null;
    try { s = entry ? (z.toJSONSchema(entry.schema, {unrepresentable: 'any', io: 'input'}) as JsonSchema) : null; } catch { s = null; }
    schemaCache.set(name, s);
  }
  return schemaCache.get(name)!;
}

/** Same merge Edit.tsx does before rendering, so validation here matches the preview. */
function checkClipProps(doc: Doc, clip: any): string | null {
  const entry = registry[clip.component];
  if (!entry) return `Unknown component: ${clip.component}`;
  const s = doc.settings ?? {};
  const r = entry.schema.safeParse({...entry.defaults, accent: doc.theme?.colors?.accent ?? '#0084FF', mode: 'full', width: s.width, height: s.height,
    audioSrc: doc.audio?.voice?.src, words: doc.captions?.words ?? [], style: doc.captions?.style ?? {}, ...clip.props, from: clip.from, to: clip.to});
  if (r.success) return null;
  const issue = r.error.issues[0];
  return `${issue.path.join('.')}: ${issue.message}`;
}

export function Inspector() {
  const doc = useDoc('panel');
  const selection = useEditor(s => s.selection);
  return (
    <aside className="bay params" aria-label="Properties">
      <PaneResize pane="params" />
      <div className="bay-head"><span className="bay-title">Properties</span></div>
      <div className="bay-body"><PanelBody doc={doc} selection={selection} /></div>
    </aside>
  );
}

const PanelBody = React.memo(function PanelBody({doc, selection}: {doc: Doc | null; selection: Ref[]}) {
  if (!doc) return null;
  return selection.length === 0 ? <ProjectPanel doc={doc} /> : selection.length > 1 ? <MultiPanel doc={doc} refs={selection} /> : <ItemPanel doc={doc} ref_={selection[0]} />;
});

/** Replace the selected item; the change line names the fields that moved. */
function useUpdate(ref: Ref) {
  return (value: any, field = 'value') => {
    const doc = currentDoc();
    if (!doc) return;
    const group = `field:${op.refKey(ref)}:${field}`;
    const before = groupOrigin(group, op.getItem(doc, ref));
    const next = op.replaceItem(doc, ref, value);
    commit(next, `edit ${field}`, {group, change: op.describeFieldChange(before, value, op.refLabel(doc, ref))});
  };
}

/** Inspector tabs (CapCut style: one tab per kind of setting). The open tab is remembered per panel. */
function Tabs({id, tabs, dot = {}, children}: {id: string; tabs: [string, string][]; dot?: Record<string, boolean>; children: (tab: string) => React.ReactNode}) {
  const key = `studio-editor:tab:${id}`;
  const [tab, setTab] = useState(() => { try { return localStorage.getItem(key) ?? tabs[0][0]; } catch { return tabs[0][0]; } });
  const current = tabs.some(t => t[0] === tab) ? tab : tabs[0][0];
  const pick = (t: string) => { setTab(t); try { localStorage.setItem(key, t); } catch { /* storage blocked */ } };
  return <>
    <div className="seg param-tabs" role="tablist">
      {tabs.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={current === k} className={`key small ${current === k ? 'lit' : ''}`} onClick={() => pick(k)}>
          {label}{dot[k] && <span className="tab-dot" aria-label="Edited" />}
        </button>
      ))}
    </div>
    {children(current)}
  </>;
}

function Head({title, sub, desc}: {title: string; sub?: string; desc?: string}) {
  return <>
    <div className="param-head"><h2>{title}</h2>{sub && <small dir="ltr">{sub}</small>}</div>
    {desc && <p className="param-desc">{desc}</p>}
  </>;
}

function Actions({ref_, span}: {ref_: Ref; span: op.Span | null}) {
  return (
    <div className="param-actions">
      {span && <button className="key small" onClick={() => seekTime(span.start)}><Crosshair size={14} /> Go to start</button>}
      {!op.isFixed(ref_) && <button className="key small" onClick={duplicateSelection}><CopySimple size={14} /> Duplicate</button>}
      {!op.isFixed(ref_) && <button className="key small" onClick={deleteSelection}><Trash size={14} /> Delete</button>}
    </div>
  );
}

function ItemPanel({doc, ref_}: {doc: Doc; ref_: Ref}) {
  const item = op.getItem(doc, ref_);
  const update = useUpdate(ref_);
  const span = op.getSpan(doc, ref_);
  if (!item) return <p className="empty">This item no longer exists.</p>;
  switch (ref_.kind) {
    case 'clip': return <ClipPanel doc={doc} clip={item} update={update} ref_={ref_} />;
    case 'word': return <>
      <Head title="Word" sub={`#${ref_.index}`} />
      <TextField label="Word" value={item[2]} onChange={v => update([item[0], item[1], v], 'text')} dir="auto" />
      <div className="pair">
        <NumberField label="Start" hint="s" value={item[0]} min={0} onChange={v => v != null && v < item[1] && update([op.round(v), item[1], item[2]], 'start')} />
        <NumberField label="End" hint="s" value={item[1]} min={0} onChange={v => v != null && v > item[0] && update([item[0], op.round(v), item[2]], 'end')} />
      </div>
      <Actions ref_={ref_} span={span} />
    </>;
    case 'zoom': return <>
      <Head title="Zoom" sub={`#${ref_.index}`} />
      <SelectField label="Type" value={item.type} options={ZOOM_TYPES} onChange={v => update(convertZoom(item, v), 'type')} />
      {(['t', 't0', 't1', 'peak', 'hold', 'dur'] as const).filter(k => k in item || (k === 'hold' && ['punch', 'ratchet', 'ramp'].includes(item.type)) || (k === 'dur' && item.type === 'drop')).map(k => (
        <NumberField key={k} label={{t: 'Time', t0: 'From', t1: 'To', peak: 'Zoom amount', hold: 'Hold time', dur: 'Duration'}[k]} hint={k} value={item[k]} step={k === 'peak' ? 0.01 : 0.05} min={0}
          onChange={v => update({...item, [k]: v == null ? undefined : op.round(v)}, k)} />
      ))}
      {item.type === 'ratchet' && <JsonField label="Steps" hint="[[time, amount], ...]" value={item.steps} onChange={v => Array.isArray(v) && update({...item, steps: v}, 'steps')} />}
      <TextField label="Note" hint="label" value={item.label ?? ''} onChange={v => update({...item, label: v || undefined}, 'label')} />
      <Actions ref_={ref_} span={span} />
    </>;
    case 'sfx': return <>
      <Head title="Sound" sub={`#${ref_.index}`} />
      <TextField label="File" value={item.file} dir="ltr" onChange={v => update({...item, file: v}, 'file')} />
      <div className="pair">
        <NumberField label="Time" hint="s" value={item.at} min={0} onChange={v => v != null && update({...item, at: op.round(v)}, 'at')} />
        <NumberField label="Duration" hint="s" value={item.duration} min={0} onChange={v => update({...item, duration: v}, 'duration')} />
      </div>
      <SliderField label="Volume" hint="×" value={item.volume ?? 1} neutral={1} min={0} max={2} step={0.01} onChange={v => update({...item, volume: v ?? 1}, 'volume')} />
      <div className="pair">
        <NumberField label="Fade in" hint="s" value={item.fadeIn ?? 0} min={0} step={0.05} onChange={v => update({...item, fadeIn: v || undefined}, 'fadeIn')} />
        <NumberField label="Fade out" hint="s" value={item.fadeOut ?? 0} min={0} step={0.05} onChange={v => update({...item, fadeOut: v || undefined}, 'fadeOut')} />
      </div>
      <AudioKeys doc={doc} ref_={ref_} />
      <Actions ref_={ref_} span={span} />
    </>;
    case 'transition': {
      const cut = op.cutOf(doc, item);
      const isCut = isCutTransition(item.type);
      return <>
      <Head title={transitionName(item.type)} sub={cut != null ? `cut at ${cut.toFixed(2)}s` : `#${ref_.index}`} />
      <div className="subgroup">
        <div className="sub-title">Transition</div>
        <div className="chip-grid">{CUT_TRANSITIONS.map(([t, n]) => <button key={t} className={`key small ${item.type === t ? 'lit' : ''}`} aria-pressed={item.type === t}
          onClick={() => update(cut != null ? {...item, type: t, at: op.round(cut - item.duration / 2)} : {...item, type: t}, 'type')}>{n}</button>)}</div>
        {!isCut && <p className="param-desc">This is an older effect drawn over the cut ({transitionName(item.type)}). Pick one above to blend the two shots instead.</p>}
      </div>
      {cut != null
        ? <SliderField label="Duration" hint="s" value={item.duration} neutral={0.5} min={0.1} max={2} step={0.05} onChange={v => {
            const r = op.setCutTransition(doc, cut, item.type, v ?? 0.5);
            update(r.doc.transitions[r.index], 'duration');
          }} />
        : <div className="pair">
            <NumberField label="Time" hint="s" value={item.at} min={0} onChange={v => v != null && update({...item, at: op.round(v)}, 'at')} />
            <NumberField label="Duration" hint="s" value={item.duration} min={0.01} onChange={v => v != null && update({...item, duration: op.round(v)}, 'duration')} />
          </div>}
      {cut != null && <button className="key small" onClick={() => { commit(op.transitionOnAllCuts(doc, item.type, item.duration), 'transition', {change: `${transitionName(item.type)} (${item.duration}s) on every cut`}); endGroup(); }}>Apply to all cuts</button>}
      <Actions ref_={ref_} span={span} />
    </>;
    }
    case 'note': return <>
      <Head title="Note for Claude" sub={item.id} />
      <TextField label="Text" value={item.text} long dir="auto" onChange={v => update({...item, text: v}, 'text')} />
      <NumberField label="Time" hint="s" value={item.at} min={0} onChange={v => v != null && update({...item, at: op.round(v)}, 'at')} />
      <CheckField label="Done" value={item.status === 'done'} onChange={v => update({...item, status: v ? 'done' : 'open'}, 'status')} />
      <div className="field"><span>Marker color</span>
        <div className="chip-grid">{MARK_COLORS.map(([c, n]) => <button key={c} className={`mark-chip ${c} ${(item.color ?? 'amber') === c ? 'on' : ''}`} title={n} aria-label={n} aria-pressed={(item.color ?? 'amber') === c} onClick={() => update({...item, color: c === 'amber' ? undefined : c}, 'color')} />)}</div>
      </div>
      <Actions ref_={ref_} span={span} />
    </>;
    case 'base': return <>
      <Head title="Main video" sub={`#${ref_.index}`} />
      <Tabs id="base" tabs={[['basic', 'Video'], ['anim', 'Animation'], ['speed', 'Speed'], ['track', 'Tracking'], ['color', 'Adjust']]}
        dot={{basic: !!(item.crop || item.mirror || (item.fit && item.fit !== 'cover') || item.keys?.length || item.stabilize), anim: !!item.anim, speed: !!(item.speed || item.freeze || item.reversed), color: !!(item.grade || item.lut),
          track: op.clips(doc).some(c => c.follow)}}>
        {tab => <>
          {/* the animation picker speaks clip time (from / to); the piece keeps its own start / duration */}
          {tab === 'track' && ref_.kind === 'base' && <TrackingSection doc={doc} index={ref_.index} />}
          {tab === 'anim' && span && <AnimSection clip={{...item, from: span.start, to: span.end}} update={(c: any, f: string) => { const {from: _f, to: _t, ...piece} = c; update(piece, f); }} />}
          {tab === 'basic' && <>
            <SelectField label="Fit" value={item.fit ?? 'cover'} options={FITS} labels={FIT_NAMES} onChange={v => update({...item, fit: v}, 'fit')} />
            <CheckField label="Mirror" value={Boolean(item.mirror)} onChange={v => update({...item, mirror: v || undefined}, 'mirror')} />
            {ref_.kind === 'base' && <FootageMotion doc={doc} index={ref_.index} />}
            {ref_.kind === 'base' && <StabilizeSection doc={doc} index={ref_.index} />}
            <CropFields value={item.crop} onChange={(c, edge) => { const {crop: _c, ...rest} = item; update(c ? {...item, crop: c} : rest, `crop.${edge}`); }} />
            <details className="details-box">
              <summary>File & timing</summary>
              <TextField label="File" value={item.src} dir="ltr" onChange={v => update({...item, src: v}, 'src')} />
              <div className="pair">
                <NumberField label="Starts at" hint="s" value={item.start ?? 0} min={0} onChange={v => update({...item, start: v ?? 0}, 'start')} />
                <NumberField label="Source in" hint="sourceIn" value={item.sourceIn} min={0} onChange={v => update({...item, sourceIn: v}, 'sourceIn')} />
              </div>
              <NumberField label="Duration" hint="s" value={item.duration} min={0} onChange={v => update({...item, duration: v}, 'duration')} />
              <TextField label="Speaker matte" hint="matte" value={item.matte ?? ''} dir="ltr" onChange={v => update({...item, matte: v || undefined}, 'matte')} />
            </details>
          </>}

          {tab === 'speed' && <div className="subgroup">
            {item.freeze
              ? <p className="param-desc">This is a freeze frame. Press Delete to remove it.</p>
              : <>
                <SliderField label="Speed" hint="×" value={item.speed ?? 1} neutral={1} min={0.25} max={4} step={0.05} onChange={v => {
                  const d = currentDoc();
                  if (!d || ref_.kind !== 'base') return;
                  const group = `speed:${ref_.index}`;
                  const start = groupOrigin(group, d);
                  commit(op.setBaseSpeed(start, ref_.index, v ?? 1), 'speed', {group, change: `footage piece #${ref_.index} speed ${item.speed ?? 1}x -> ${v ?? 1}x (rest of the edit rippled)`});
                }} />
                <div className="sub-title">Speed curve</div>
                <div className="chip-grid">{ed.SPEED_CURVES.map(c => <button key={c.name} className="key small" title={c.points.map(p => `${p}×`).join(' → ')}
                  onClick={() => { const d = currentDoc(); if (d && ref_.kind === 'base') commit(ed.speedCurve(d, ref_.index, c.points), 'speed curve', {change: `footage piece #${ref_.index}: "${c.name}" speed curve (${c.points.join(', ')}x), split into steps`}); }}>{c.label}</button>)}</div>
                <p className="param-desc">Audio does not follow the speed change, so use speed on clips without speech.</p>
              </>}
            <div className="preset-row">
              {!item.freeze && <button className={`key small ${item.reversed ? 'lit' : ''}`} aria-pressed={!!item.reversed} onClick={() => ref_.kind === 'base' && void reversePiece(ref_.index)}
                title="Play this part backwards (creates a new file, the original is untouched)">{item.reversed ? 'Play forward again' : 'Reverse'}</button>}
              <button className="key small" title="F" onClick={() => freezeAtPlayhead()}>Freeze frame at playhead</button>
            </div>
          </div>}
          {tab === 'color' && <GradePanel title="Color for this clip only" value={item.grade} overlayFx={false} frame={footageFrame}
            onChange={(g, f) => update({...item, grade: g}, `grade.${f}`)}>
            <LutControls doc={doc} src={item.src} onDoc={(next, change) => commit(next, 'lut', {change})} />
          </GradePanel>}
        </>}
      </Tabs>
      <Actions ref_={ref_} span={span} />
    </>;
    case 'voice': return <>
      <Head title="Speech" />
      <AudioPanel doc={doc} set={setDocPath} />
    </>;
    case 'music': return <>
      <Head title="Music" />
      <TextField label="File" value={item.src} dir="ltr" onChange={v => update({...item, src: v}, 'src')} />
      <SliderField label="Volume" hint="×" value={item.volume} neutral={0.15} min={0} max={1} step={0.005} onChange={v => update({...item, volume: v ?? 0.15}, 'volume')} />
      <AudioKeys doc={doc} ref_={ref_} />
      <div className="pair">
        <NumberField label="Fade in" hint="s" value={item.fadeIn ?? 0} min={0} step={0.1} onChange={v => update({...item, fadeIn: v ?? 0}, 'fadeIn')} />
        <NumberField label="Fade out" hint="s" value={item.fadeOut ?? 0} min={0} step={0.1} onChange={v => update({...item, fadeOut: v ?? 0}, 'fadeOut')} />
      </div>
      <div className="subgroup">
        <CheckField label="Duck under speech" value={Boolean(item.duck)} onChange={v => update({...item, duck: v ? {db: 9, attack: 0.08, release: 0.35} : undefined}, 'duck')} />
        {item.duck ? <>
          <NumberField label="Duck by" hint="dB" value={item.duck.db} min={0} max={40} step={0.5} onChange={v => update({...item, duck: {...item.duck, db: v ?? 9}}, 'duck.db')} />
          <div className="pair">
            <NumberField label="Attack" hint="s" value={item.duck.attack} min={0} max={1} step={0.01} onChange={v => update({...item, duck: {...item.duck, attack: v ?? 0.08}}, 'duck.attack')} />
            <NumberField label="Release" hint="s" value={item.duck.release} min={0} max={3} step={0.05} onChange={v => update({...item, duck: {...item.duck, release: v ?? 0.35}}, 'duck.release')} />
          </div>
        </> : <NumberField label="Boost in silence" hint="gapBoost" value={item.gapBoost ?? 1} min={0} max={4} step={0.05} onChange={v => update({...item, gapBoost: v ?? 1}, 'gapBoost')} />}
      </div>
    </>;
  }
}

function convertZoom(z: any, type: string): any {
  const s = op.zoomSpan(z);
  const peak = z.peak ?? z.steps?.at(-1)?.[1] ?? 1.15;
  const label = z.label;
  switch (type) {
    case 'punch': return {type, t: s.start, peak, hold: op.round(s.end - s.start), label};
    case 'drop': return {type, t: s.start, peak, dur: op.round(s.end - s.start), label};
    case 'kenburns': return {type, t0: s.start, t1: s.end, peak, label};
    case 'ramp': return {type, t0: s.start, t1: op.round(Math.max(s.start + 0.1, s.end - 0.4)), peak, hold: 0.4, label};
    default: return {type: 'ratchet', steps: [[s.start, peak]], hold: op.round(s.end - s.start), label};
  }
}

function ClipPanel({doc, clip, update, ref_}: {doc: Doc; clip: any; update: (v: any, f?: string) => void; ref_: Ref}) {
  const [raw, setRaw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schema = useMemo(() => propsSchema(clip.component), [clip.component]);
  const entry = registry[clip.component];
  const apply = (next: any, field: string) => {
    const problem = checkClipProps(doc, next);
    setError(problem);
    if (!problem || field === 'component') update(next, field);
  };
  const otherIds = new Set(op.clips(doc).filter(c => c !== clip).map(c => c.id));
  if (clip.component === 'Text') return <>
    <Head title="Text" sub={clip.id} />
    <Tabs id="text" tabs={[['text', 'Text'], ['anim', 'Animation'], ['mask', 'Mask'], ['track', 'Tracking']]} dot={{anim: !!clip.anim, mask: !!clip.mask, track: !!clip.follow}}>
      {tab => <>
        {tab === 'text' && <>
          <TextFields clip={clip} update={update} />
          <ClipMotion doc={doc} clip={clip} update={update} ref_={ref_} />
          <StyleSection clip={clip} update={update} />
        </>}
        {tab === 'anim' && <AnimSection clip={clip} update={update} text />}
        {tab === 'mask' && <MaskSection clip={clip} update={update} />}
        {tab === 'track' && <FollowSection doc={doc} clip={clip} />}
      </>}
    </Tabs>
    <Actions ref_={ref_} span={{start: clip.from, end: clip.to}} />
  </>;
  return <>
    <Head title={clip.component} sub={clip.id} desc={entry?.description} />
    <Tabs id="clip" tabs={[['basic', 'Basic'], ['motion', 'Animation'], ['look', 'Mask'], ['track', 'Tracking'], ['color', 'Adjust']]} dot={{basic: !!(clip.keys || clip.style || clip.behind), motion: !!clip.anim, look: !!(clip.mask || clip.crop || clip.chroma), track: !!clip.follow, color: !!clip.grade}}>
      {tab => <>
        {tab === 'basic' && <>
          <SelectField label="Component" value={clip.component} options={COMPONENTS} onChange={v => apply({...clip, component: v}, 'component')} />
          {error && <div className="error-text">{error}</div>}
          <details className="details-box">
            <summary>Timing & name</summary>
            <div className="pair">
              <NumberField label="Start" hint="s" value={clip.from} min={0} onChange={v => v != null && v < clip.to && apply({...clip, from: op.round(v)}, 'from')} />
              <NumberField label="End" hint="s" value={clip.to} min={0} onChange={v => v != null && v > clip.from && apply({...clip, to: op.round(v)}, 'to')} />
            </div>
            <div className="pair">
              <NumberField label="Layer" value={clip.track ?? 5} step={1} min={0} onChange={v => apply({...clip, track: v ?? 5}, 'track')} />
              <TextField label="Name" hint="id" value={clip.id} dir="ltr" onChange={v => { if (v && !otherIds.has(v)) update({...clip, id: v}, 'id'); }} />
            </div>
          </details>
          <div className="subgroup">
            <div className="sub-title" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
              <span title="props">Component content</span>
              <button className={`key small ${raw ? 'lit' : ''}`} onClick={() => setRaw(r => !r)}>JSON</button>
            </div>
            {raw || !schema
              ? <JsonField label="Component content" tip="props" value={clip.props ?? {}} rows={12} onChange={v => v && typeof v === 'object' && apply({...clip, props: v}, 'props')} />
              : <SchemaFields schema={schema} value={clip.props ?? {}} hidden={INJECTED} onChange={v => apply({...clip, props: v}, 'props')} />}
          </div>
          <ClipMotion doc={doc} clip={clip} update={update} ref_={ref_} />
          <StyleSection clip={clip} update={update} />
        </>}
        {tab === 'motion' && <AnimSection clip={clip} update={update} />}
        {tab === 'look' && <>
          <MaskSection clip={clip} update={update} />
          <CropFields value={clip.crop} onChange={(c, edge) => { const {crop: _c, ...rest} = clip; update(c ? {...clip, crop: c} : rest, `crop.${edge}`); }} />
          <ChromaFields value={clip.chroma} onChange={(c, f) => { const {chroma: _c, ...rest} = clip; update(c ? {...clip, chroma: c} : rest, `chroma.${f}`); }} />
        </>}
        {tab === 'track' && <FollowSection doc={doc} clip={clip} />}
        {tab === 'color' && <GradePanel title="Adjust this clip" value={clip.grade} overlayFx={false} onChange={(g, f) => update({...clip, grade: g}, `grade.${f}`)} />}
      </>}
    </Tabs>
    <Actions ref_={ref_} span={{start: clip.from, end: clip.to}} />
  </>;
}

/** Main format: the shared motion panel (sliders + ◆). Other sizes: that size's own placement. */
function ClipMotion({doc, clip, update, ref_}: {doc: Doc; clip: any; update: (v: any, f?: string) => void; ref_: Ref}) {
  const format = useFormat();
  return format === MAIN ? <MotionPanel doc={doc} ref_={ref_} /> : <ClipPlacement doc={doc} clip={clip} update={update} />;
}

/** On-screen placement written by dragging on the monitor; editable by number too. */
function BoxFields({box, title = 'Position on screen', onChange, onReset}: {box?: any; title?: string; onChange: (b: any) => void; onReset: () => void}) {
  const b = {x: 0, y: 0, scale: 1, rotate: 0, ...(box ?? {})};
  const set = (k: string, v: number | undefined) => onChange({...b, [k]: v ?? (k === 'scale' ? 1 : 0)});
  return (
    <div className="subgroup">
      <div className="sub-title" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <span>{title}</span>
        {box && <button className="key small" onClick={onReset}>Reset position</button>}
      </div>
      <div className="pair">
        <NumberField label="Left/right" hint="x" value={b.x} step={0.01} onChange={v => set('x', v)} />
        <NumberField label="Up/down" hint="y" value={b.y} step={0.01} onChange={v => set('y', v)} />
      </div>
      <div className="pair">
        <NumberField label="Scale" hint="scale" value={b.scale} step={0.05} min={0.1} max={6} onChange={v => set('scale', v)} />
        <NumberField label="Rotation" hint="deg" value={b.rotate} step={1} onChange={v => set('rotate', v)} />
      </div>
    </div>
  );
}

function useFormat() { return useEditor(s => s.format); }

/** Placement for the format on screen: the master writes clip.box, other formats write their override. */
function ClipPlacement({doc, clip, update}: {doc: Doc; clip: any; update: (v: any, f?: string) => void}) {
  const format = useFormat();
  const keyed = format === MAIN && !!clip.keys?.length;
  const frame = usePlayhead(p => (keyed ? p.frame : 0));
  if (format === MAIN && keyed) {
    const t = frame / fps() - clip.from;
    const now = keyedBox({x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, ...clip.box}, clip.keys, t);
    const inside = t >= 0 && t <= clip.to - clip.from;
    const write = (b: any) => {
      const d = currentDoc();
      if (d && inside) commit(op.upsertKey(d, clip.id, t, {x: b.x, y: b.y, scale: b.scale, rotate: b.rotate}), 'keyframe', {group: `key:${clip.id}:${t.toFixed(3)}`, change: `keyframe on clip ${clip.id} at +${t.toFixed(2)}s -> ${JSON.stringify({x: op.round(b.x), y: op.round(b.y), scale: op.round(b.scale)})}`});
    };
    return <>
      <BoxFields title={inside ? 'Position at playhead (writes a keyframe)' : 'Playhead is outside the clip'} box={now} onChange={write} onReset={() => resetBox(clip.id)} />
      <KeyList clip={clip} t={t} />
    </>;
  }
  if (format === MAIN) return <>
    <BoxFields box={clip.box} onChange={b => update({...clip, box: b}, 'box')} onReset={() => resetBox(clip.id)} />
    <button className="key small" title="Shift+K" onClick={keyAtPlayhead}>◆ Add keyframe at playhead</button>
    <p className="param-desc">The first keyframe locks the current position. Move the playhead, then move the clip on screen; each move adds a keyframe.</p>
  </>;
  const o = doc.formats?.[format]?.clips?.[clip.id] ?? {};
  const shown = op.clips(resolveFormat(doc, format)).find(c => c.id === clip.id);
  const write = (key: 'box' | 'hidden', value: unknown, change: string) => {
    const d = currentDoc();
    if (d) commit(setClipOverride(d, format, clip.id, key, value), 'format override', {group: `fmt:${format}:${clip.id}:${key}`, change: `${change} [format ${format}]`});
  };
  return <>
    <BoxFields title={`Position in ${formatLabel(doc, format)}`} box={o.box ?? shown?.box} onChange={b => write('box', b, `moved clip ${clip.id} to ${JSON.stringify(b)}`)} onReset={() => resetBox(clip.id)} />
    <CheckField label={`Hide in ${formatLabel(doc, format)}`} value={Boolean(o.hidden)} onChange={v => write('hidden', v || undefined, `${v ? 'hid' : 'showed'} clip ${clip.id}`)} />
  </>;
}

const EASE_NAMES: Record<string, string> = {linear: 'Linear', in: 'Ease in', out: 'Ease out', inOut: 'Smooth', hold: 'Hold'};

/** The clip's keyframes: jump to one, change how the move into it eases, delete it. */
function KeyList({clip, t}: {clip: any; t: number}) {
  const set = (next: any, change: string) => { const d = currentDoc(); if (d) commit(op.replaceItem(d, {kind: 'clip', id: clip.id}, next), 'keyframe', {change}); };
  return (
    <div className="subgroup">
      <div className="sub-title" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <span>Keyframes <span className="mono">{clip.keys.length}</span></span>
        <button className="key small" title="Shift+K" onClick={keyAtPlayhead}>◆ Here</button>
      </div>
      {clip.keys.map((k: any) => (
        <div key={k.t} className={`key-row ${Math.abs(k.t - t) < 1 / 60 ? 'on' : ''}`}>
          <button className="key small" title="Go to keyframe" onClick={() => seekTime(clip.from + k.t)}>◆ <bdi className="mono">+{k.t.toFixed(2)}</bdi></button>
          <select value={k.ease ?? 'linear'} aria-label="Easing" onChange={e => set({...clip, keys: clip.keys.map((x: any) => (x === k ? {...x, ease: e.target.value === 'linear' ? undefined : e.target.value} : x))}, `keyframe +${k.t}s of clip ${clip.id} ease ${e.target.value}`)}>
            {Object.entries(EASE_NAMES).map(([e, n]) => <option key={e} value={e}>{n}</option>)}
          </select>
          <button className="key small icon" aria-label="Delete keyframe" onClick={() => { const d = currentDoc(); if (d) commit(op.removeKey(d, clip.id, k.t), 'keyframe', {change: `removed keyframe +${k.t}s of clip ${clip.id}`}); }}><Trash size={12} /></button>
        </div>
      ))}
    </div>
  );
}

function CaptionsPlacement({doc, set}: {doc: Doc; set: (path: (string | number)[], value: unknown, label: string) => void}) {
  const format = useFormat();
  if (format === MAIN) return <BoxFields box={doc.captions?.box} title="Caption position on screen" onChange={b => set(['captions', 'box'], b, 'captions box')} onReset={() => resetBox(CAPTIONS_ID)} />;
  const f = doc.formats?.[format] ?? {};
  return <BoxFields box={f.captions?.box} title={`Caption position in ${formatLabel(doc, format)}`} onChange={b => set(['formats', format, 'captions', 'box'], b, 'captions box')} onReset={() => resetBox(CAPTIONS_ID)} />;
}

/** Settings of the format being shown: how the footage fills the frame, caption size, remove. */
function FormatPanel({doc}: {doc: Doc}) {
  const format = useFormat();
  if (format === MAIN) return null;
  const f = doc.formats?.[format];
  if (!f) return null;
  const resolvedFit = resolveFormat(doc, format).base?.[0]?.fit ?? 'cover';
  const write = (path: string[], value: unknown, change: string) => {
    const d = currentDoc();
    if (d) commit(setFormatField(d, format, path, value), 'format', {group: `fmt:${format}:${path.join('.')}`, change: `${change} [format ${format}]`});
  };
  const focus: [number, number] = f.base?.focus ?? [0.5, 0.5];
  return (
    <div className="subgroup">
      <div className="sub-title" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
        <span>{formatLabel(doc, format)} size <span className="mono">{f.width}×{f.height}</span></span>
        <button className="key small" onClick={() => {
          const d = currentDoc();
          if (!d) return;
          editor.set(s => ({...s, format: MAIN}));
          commit(removeFormat(d, format), 'remove format', {change: `removed output format ${format}`});
        }}>Remove size</button>
      </div>
      <SelectField label="Video fit in frame" value={f.base?.fit ?? resolvedFit} options={FITS} onChange={v => write(['base', 'fit'], v, `footage fit ${v}`)} />
      <div className="pair">
        <NumberField label="Focus left/right" hint="0 - 1" value={focus[0]} min={0} max={1} step={0.05} onChange={v => write(['base', 'focus'], [v ?? 0.5, focus[1]], `footage focus x ${v}`)} />
        <NumberField label="Focus up/down" hint="0 - 1" value={focus[1]} min={0} max={1} step={0.05} onChange={v => write(['base', 'focus'], [focus[0], v ?? 0.5], `footage focus y ${v}`)} />
      </div>
      <NumberField label="Caption size here" value={f.captions?.style?.size ?? doc.captions?.style?.size ?? 64} min={8} step={1} onChange={v => write(['captions', 'style', 'size'], v, `caption size ${v}`)} />
    </div>
  );
}

function MultiPanel({doc, refs}: {doc: Doc; refs: Ref[]}) {
  const counts = refs.reduce<Record<string, number>>((m, r) => ({...m, [r.kind]: (m[r.kind] ?? 0) + 1}), {});
  const names: Record<string, string> = {clip: 'clip', word: 'word', zoom: 'zoom', sfx: 'sound', transition: 'transition', note: 'note', base: 'video', music: 'music'};
  const spans = refs.map(r => op.getSpan(doc, r)).filter((s): s is op.Span => !!s);
  return <>
    <Head title={`${refs.length} items selected`} />
    <p className="param-desc">{Object.entries(counts).map(([k, n]) => `${n} ${names[k]}`).join(', ')}</p>
    <p className="param-desc">Drag any of them on the timeline to move them all together.</p>
    <Actions ref_={refs[0]} span={spans.length ? {start: Math.min(...spans.map(s => s.start)), end: 0} : null} />
  </>;
}

/** Change one value of the document by path, as one undo step per field while dragging or typing. */
function setDocPath(path: (string | number)[], value: unknown, label: string) {
  const d = currentDoc();
  if (!d) return;
  const group = `project:${path.join('.')}`;
  const before = groupOrigin(group, path.reduce<any>((o, k) => o?.[k], d));
  commit(op.setPath(d, path, value), label, {group, change: `changed ${path.join('.')} ${JSON.stringify(before)} -> ${JSON.stringify(value)}`});
}

/** Marker colours (CapCut tags markers by colour); the colour is only for the owner's eye. */
const MARK_COLORS: [string, string][] = [['amber', 'Yellow'], ['red', 'Red'], ['green', 'Green'], ['blue', 'Blue'], ['violet', 'Violet'], ['grey', 'Grey']];

function ProjectPanel({doc}: {doc: Doc}) {
  const set = setDocPath;
  const style = doc.captions?.style ?? {};
  const s = doc.settings ?? {};
  return <>
    <Head title="Project" sub={`${s.width}×${s.height} · ${s.fps}fps`} />
    <Tabs id="project" tabs={[['basic', 'Basic'], ['color', 'Adjust'], ['audio', 'Audio']]} dot={{color: !!(doc.grade || doc.subject), audio: !!(doc.audio?.voice?.chain || doc.audio?.music?.duck)}}>
      {tab => tab === 'color' ? <>
        <GradePanel title="Color for the whole video" value={doc.grade} frame={footageFrame} onChange={(g, f) => set(['grade'], g, `grade ${f}`)} />
        <SubjectSection doc={doc} set={set} />
      </> : tab === 'audio' ? <AudioPanel doc={doc} set={set} /> : <ProjectBasics doc={doc} set={set} />}
    </Tabs>
    <p className="param-desc" style={{marginTop: 16}}>Select something on the timeline to edit its properties.</p>
  </>;
}

type SetPath = (path: (string | number)[], value: unknown, label: string) => void;

const VOICE_PRESETS: [string, string, string][] = [['light', 'Light', 'Good mic, a light touch'], ['pro', 'Pro', 'Cleanup + EQ + compressor + de-esser'], ['strong', 'Strong', 'Echoey room or noisy gym']];

function AudioPanel({doc, set}: {doc: Doc; set: SetPath}) {
  const [meter, setMeter] = useState<{lufs: number | null; peak: number | null; file: string} | null>(null);
  const v = doc.audio?.voice;
  if (!v) return <p className="empty">This project has no speech audio (audio.voice).</p>;
  const chain = v.chain;
  const clean = async (preset: string) => {
    const from = v.original ?? v.src;
    const r = await runTool<{src: string; before: any; after: any}>('voice', {audio: from, preset}, 'Cleaning audio');
    const d = currentDoc();
    if (!r || !d) return;
    commit(op.setPath(d, ['audio', 'voice'], {...d.audio.voice, src: r.src, original: from, chain: {preset, before: r.before, after: r.after}}), 'voice chain',
      {change: `cleaned the voice with the "${preset}" chain: ${from} -> ${r.src} (LUFS ${r.before?.lufs} -> ${r.after?.lufs})`});
    setMeter({...r.after, file: r.src});
  };
  const measure = async () => {
    const r = await runTool<{lufs: number; peak: number; file: string}>('loudness', {audio: v.src}, 'Measuring audio');
    if (r) setMeter(r);
  };
  const shown = meter && meter.file === v.src ? meter : chain?.after ? {...chain.after, file: v.src} : null;
  return <>
    <div className="subgroup">
      <div className="sub-title">Speech</div>
      <SliderField label="Speech volume" hint="×" value={v.volume ?? 1} neutral={1} min={0} max={3} step={0.05} onChange={x => set(['audio', 'voice', 'volume'], x ?? 1, 'voice volume')} />
    </div>
    <div className="subgroup">
      <div className="sub-title">Pro audio</div>
      <p className="param-desc">Creates a new audio file next to the original (the original is untouched), so you can compare them.</p>
      <div className="preset-row">
        {VOICE_PRESETS.map(([k, label, hint]) => <button key={k} className={`key small ${chain?.preset === k ? 'lit' : ''}`} title={hint} onClick={() => void clean(k)}>{label}</button>)}
      </div>
      {chain && v.original && <>
        <div className="seg ab" role="group" aria-label="Compare">
          <button className={`key small ${!chain.bypass ? 'lit' : ''}`} onClick={() => set(['audio', 'voice', 'chain', 'bypass'], undefined, 'voice A/B')}>After (B)</button>
          <button className={`key small ${chain.bypass ? 'lit' : ''}`} onClick={() => set(['audio', 'voice', 'chain', 'bypass'], true, 'voice A/B')}>Before (A)</button>
        </div>
        <button className="key small" onClick={() => { const d = currentDoc(); if (!d) return; const {chain: _c, original, ...rest} = d.audio.voice; commit(op.setPath(d, ['audio', 'voice'], {...rest, src: original}), 'voice chain', {change: `removed the voice chain, back to ${original}`}); }}>Restore original audio</button>
      </>}
    </div>
    <div className="subgroup">
      <div className="sub-title">Loudness</div>
      {shown ? <LoudnessMeter lufs={shown.lufs} peak={shown.peak} /> : <p className="param-desc">Reels work best at <bdi dir="ltr">-14 LUFS</bdi> with the peak below <bdi dir="ltr">-1 dB</bdi>.</p>}
      <button className="key small" onClick={() => void measure()}>Measure speech</button>
    </div>
  </>;
}

function LoudnessMeter({lufs, peak}: {lufs: number | null; peak: number | null}) {
  const target = -14;
  const off = lufs == null ? null : lufs - target;
  const tone = off == null ? '' : Math.abs(off) <= 1.5 ? 'ok' : Math.abs(off) <= 4 ? 'warn' : 'bad';
  const pos = lufs == null ? 0 : Math.max(0, Math.min(100, ((lufs + 30) / 24) * 100)); // -30..-6 LUFS
  return (
    <div className={`lufs ${tone}`}>
      <div className="lufs-bar" dir="ltr"><span className="target" style={{left: `${((target + 30) / 24) * 100}%`}} /><span className="needle" style={{left: `${pos}%`}} /></div>
      <div className="lufs-read mono" dir="ltr">{lufs?.toFixed(1) ?? '—'} LUFS · peak {peak?.toFixed(1) ?? '—'} dB</div>
      <p className="param-desc">{off == null ? '' : tone === 'ok' ? 'Good for Reels.' : off < 0 ? `${(-off).toFixed(1)} dB below -14. The render fixes it (loudnorm), but it is better to raise the volume.` : `${off.toFixed(1)} dB above -14.`}{peak != null && peak > -1 ? ' The peak is high and may clip.' : ''}</p>
    </div>
  );
}

function ProjectBasics({doc, set}: {doc: Doc; set: SetPath}) {
  const style = doc.captions?.style ?? {};
  const s = doc.settings ?? {};
  return <>
    <div className="pair">
      <NumberField label="Duration" hint="s" value={s.duration} min={0.1} onChange={v => v != null && set(['settings', 'duration'], op.round(v), 'duration')} />
      <ColorField label="Background" value={s.background ?? '#000000'} onChange={v => set(['settings', 'background'], v, 'background')} />
    </div>
    <ColorField label="Brand color" hint="theme.colors.accent" value={doc.theme?.colors?.accent ?? ''} onChange={v => set(['theme', 'colors', 'accent'], v || undefined, 'accent')} />
    <div className="subgroup">
      <div className="sub-title">Captions</div>
      <CheckField label="Show captions" value={doc.captions?.enabled !== false} onChange={v => set(['captions', 'enabled'], v, 'captions')} />
      <SelectField label="Style" hint="preset" value={style.preset ?? 'reel4'} options={CAPTION_PRESETS} onChange={v => set(['captions', 'style', 'preset'], v, 'preset')} />
      <div className="pair">
        <NumberField label="Size" value={style.size ?? 64} min={8} step={1} onChange={v => set(['captions', 'style', 'size'], v, 'size')} />
        <NumberField label="Words at a time" value={style.maxWords ?? 2} min={1} step={1} onChange={v => set(['captions', 'style', 'maxWords'], v, 'maxWords')} />
      </div>
      <NumberField label="Silence splits line" hint="gapBreak s" value={style.gapBreak ?? 0.25} min={0} step={0.05} onChange={v => set(['captions', 'style', 'gapBreak'], v, 'gapBreak')} />
      <TextField label="Highlight words" hint="comma-separated" value={(style.keywords ?? []).join(', ')} dir="rtl"
        onChange={v => set(['captions', 'style', 'keywords'], v.split(/[,،]/).map(x => x.trim()).filter(Boolean), 'keywords')} />
    </div>
    <FormatPanel doc={doc} />
    <CaptionsPlacement doc={doc} set={set} />
  </>;
}
