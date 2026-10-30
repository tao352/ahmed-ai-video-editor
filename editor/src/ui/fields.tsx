// Form controls that keep a local draft and only hand back valid values,
// plus a renderer that builds a form from a component's JSON schema.
import React, {useEffect, useState} from 'react';
import {ArrowCounterClockwise, CopySimple, Plus, X} from '@phosphor-icons/react';
import {endGesture, endGroup, startGesture} from '../store';
import {propName, splitHint} from './labels';

type Common = {label: string; hint?: string; tip?: string};

/** Label with its unit; JSON names behind the field go to the tooltip, not the screen. */
function FieldLabel({label, hint, tip}: Common) {
  const h = splitHint(hint);
  const title = [tip, h.tip].filter(Boolean).join(' · ') || undefined;
  return <span title={title}>{label}{h.shown && <em>{h.shown}</em>}</span>;
}

export function TextField({label, hint, tip, value, onChange, long, dir = 'auto'}: Common & {value: string; onChange: (v: string) => void; long?: boolean; dir?: 'auto' | 'ltr' | 'rtl'}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const El = long || value.length > 48 ? 'textarea' : 'input';
  return (
    <label className="field">
      <FieldLabel label={label} hint={hint} tip={tip} />
      <El type="text" dir={dir} value={draft} onBlur={endGroup}
        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setDraft(e.target.value); onChange(e.target.value); }} />
    </label>
  );
}

export function NumberField({label, hint, tip, value, onChange, step = 0.01, min, max}: Common & {value: number | undefined; onChange: (v: number | undefined) => void; step?: number; min?: number; max?: number}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => setDraft(value == null ? '' : String(value)), [value]);
  const n = Number(draft);
  const bad = draft.trim() !== '' && (!Number.isFinite(n) || (min != null && n < min) || (max != null && n > max));
  return (
    <label className="field">
      <FieldLabel label={label} hint={hint} tip={tip} />
      <input type="number" step={step} min={min} max={max} value={draft} aria-invalid={bad} style={bad ? {borderColor: 'var(--red)'} : undefined} onBlur={endGroup}
        onChange={e => {
          setDraft(e.target.value);
          const v = e.target.value.trim() === '' ? undefined : Number(e.target.value);
          if (v === undefined || (Number.isFinite(v) && (min == null || v >= min) && (max == null || v <= max))) onChange(v);
        }} />
    </label>
  );
}

export function SelectField({label, hint, tip, value, options, labels, onChange}: Common & {value: string; options: string[]; labels?: Record<string, string>; onChange: (v: string) => void}) {
  const opts = options.includes(value) ? options : [value, ...options];
  return (
    <label className="field">
      <FieldLabel label={label} hint={hint} tip={tip} />
      <select value={value} onChange={e => onChange(e.target.value)}>{opts.map(o => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}</select>
    </label>
  );
}

export function CheckField({label, value, onChange}: {label: string; value: boolean; onChange: (v: boolean) => void}) {
  return <label className="check"><input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />{label}</label>;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function ColorField({label, hint, tip, value, onChange}: Common & {value: string; onChange: (v: string) => void}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const swatch = HEX.test(draft) ? draft.slice(0, 7).padEnd(7, '0') : '#000000';
  return (
    <label className="field">
      <FieldLabel label={label} hint={hint} tip={tip} />
      <div className="row">
        <input type="color" value={swatch.length === 4 ? `#${[...swatch.slice(1)].map(c => c + c).join('')}` : swatch} onChange={e => { setDraft(e.target.value); onChange(e.target.value); }} onBlur={endGroup} />
        <input type="text" className="mono-in" value={draft} onBlur={endGroup} onChange={e => { setDraft(e.target.value); if (HEX.test(e.target.value) || !e.target.value.startsWith('#')) onChange(e.target.value); }} />
      </div>
    </label>
  );
}

/** Edit any value as JSON; only parses-clean text is handed back. */
export function JsonField({label, hint, tip, value, onChange, rows = 5}: Common & {value: unknown; onChange: (v: unknown) => void; rows?: number}) {
  const text = value === undefined ? '' : JSON.stringify(value, null, 1);
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(text); setError(null); }, [text]);
  return (
    <label className="field">
      <FieldLabel label={label} hint={hint} tip={tip} />
      <textarea className="json" rows={rows} value={draft} spellCheck={false} onBlur={endGroup}
        onChange={e => {
          setDraft(e.target.value);
          if (!e.target.value.trim()) { setError(null); onChange(undefined); return; }
          try { onChange(JSON.parse(e.target.value)); setError(null); } catch (err) { setError(err instanceof Error ? err.message : 'Invalid JSON'); }
        }} />
      {error && <div className="error-text">{error}</div>}
    </label>
  );
}

// ---------- schema-driven form ----------

export type JsonSchema = {
  type?: string | string[]; properties?: Record<string, JsonSchema>; items?: JsonSchema | JsonSchema[]; prefixItems?: JsonSchema[];
  enum?: unknown[]; const?: unknown; anyOf?: JsonSchema[]; oneOf?: JsonSchema[]; default?: unknown; description?: string;
  minimum?: number; maximum?: number; additionalProperties?: unknown;
};

/** Collapse `X | null` and single-branch unions to the meaningful branch. */
function unwrap(s: JsonSchema): JsonSchema {
  const branches = s.anyOf ?? s.oneOf;
  if (!branches) return s;
  const real = branches.filter(b => b.type !== 'null');
  if (real.length === 1) return {...unwrap(real[0]), default: s.default ?? real[0].default};
  if (real.every(b => b.const !== undefined)) return {type: 'string', enum: real.map(b => b.const), default: s.default};
  return s;
}

const isColorKey = (k: string) => /colou?r|accent|^bg$|background|ink|fill|stroke|tint/i.test(k);
const isLongKey = (k: string) => /text|body|caption|sub|desc|quote|lines|title|copy|label/i.test(k);

export function SchemaFields({schema, value, onChange, hidden = []}: {schema: JsonSchema; value: Record<string, any>; onChange: (v: Record<string, any>) => void; hidden?: string[]}) {
  const props = Object.entries(schema.properties ?? {}).filter(([k]) => !hidden.includes(k));
  const extra = Object.keys(value ?? {}).filter(k => !(k in (schema.properties ?? {})) && !hidden.includes(k));
  const set = (k: string, v: unknown) => {
    const next = {...value};
    if (v === undefined) delete next[k]; else next[k] = v;
    onChange(next);
  };
  if (!props.length && !extra.length) return <p className="empty" style={{padding: '8px 0'}}>This component has no editable properties.</p>;
  return (
    <>
      {props.map(([k, s]) => <SchemaField key={k} name={k} schema={s} value={value?.[k]} onChange={v => set(k, v)} />)}
      {extra.map(k => <JsonField key={k} label={k} hint="not in schema" value={value[k]} onChange={v => set(k, v)} rows={2} />)}
    </>
  );
}

function SchemaField({name, schema: raw, value, onChange}: {name: string; schema: JsonSchema; value: any; onChange: (v: unknown) => void}) {
  const s = unwrap(raw);
  const label = propName(name), tip = name;
  const type = Array.isArray(s.type) ? s.type.find(t => t !== 'null') : s.type;
  const shown = value ?? s.default;
  const hint = value === undefined && s.default !== undefined ? 'default' : undefined;
  if (s.enum) return <SelectField label={label} tip={tip} hint={hint} value={String(shown ?? s.enum[0])} options={s.enum.map(String)} onChange={v => onChange(typeof s.enum![0] === 'number' ? Number(v) : v)} />;
  if (type === 'boolean') return <CheckField label={label} value={Boolean(shown)} onChange={onChange} />;
  if (type === 'number' || type === 'integer') return <NumberField label={label} tip={tip} hint={hint} value={shown} min={s.minimum} max={s.maximum} step={type === 'integer' ? 1 : 0.01} onChange={onChange} />;
  if (type === 'string') {
    const str = String(shown ?? '');
    if (isColorKey(name) || HEX.test(str)) return <ColorField label={label} tip={tip} hint={hint} value={str} onChange={onChange} />;
    return <TextField label={label} tip={tip} hint={hint} value={str} long={isLongKey(name)} onChange={onChange} />;
  }
  if (type === 'array' && !s.prefixItems && s.items && !Array.isArray(s.items)) {
    const item = unwrap(s.items);
    if (item.type === 'string' && !item.enum) {
      return <ListField label={label} value={Array.isArray(shown) ? shown : []} onChange={onChange} />;
    }
    if (item.type === 'object' && item.properties && (shown == null || Array.isArray(shown))) {
      return <ObjectList label={label} tip={tip} schema={item} value={Array.isArray(shown) ? shown : []} onChange={onChange} />;
    }
  }
  if (type === 'object' && s.properties && shown && typeof shown === 'object' && !Array.isArray(shown)) {
    return (
      <div className="subgroup">
        <div className="sub-title" title={tip}>{label}</div>
        <SchemaFields schema={s} value={shown} onChange={onChange} />
      </div>
    );
  }
  return <JsonField label={label} tip={tip} hint={hint} value={shown} onChange={onChange} rows={Array.isArray(shown) && shown.length > 3 ? 6 : 3} />;
}

/** A list of objects as small forms: one per item, with remove, duplicate and add. */
function ObjectList({label, tip, schema, value, onChange}: {label: string; tip: string; schema: JsonSchema; value: Record<string, any>[]; onChange: (v: unknown) => void}) {
  const set = (i: number, v: Record<string, any>) => onChange(value.map((x, j) => (j === i ? v : x)));
  const remove = (i: number) => { onChange(value.filter((_, j) => j !== i)); endGroup(); };
  const copy = (i: number) => { onChange([...value.slice(0, i + 1), structuredClone(value[i]), ...value.slice(i + 1)]); endGroup(); };
  const preview = (v: Record<string, any>) => Object.values(v ?? {}).find(x => typeof x === 'string' && x.trim()) as string | undefined;
  return (
    <div className="subgroup object-list">
      <div className="sub-title" title={tip}>{label} <span className="count">{value.length}</span></div>
      {value.map((v, i) => (
        <details key={i} className="object-item" open={value.length <= 3}>
          <summary>
            <span className="idx">{i + 1}</span>
            <span className="preview" dir="auto">{preview(v) ?? ''}</span>
            <button type="button" className="mini" title="Duplicate" aria-label={`Duplicate ${i + 1}`} onClick={e => { e.preventDefault(); copy(i); }}><CopySimple size={12} /></button>
            <button type="button" className="mini danger" title="Delete" aria-label={`Delete ${i + 1}`} onClick={e => { e.preventDefault(); remove(i); }}><X size={12} /></button>
          </summary>
          <SchemaFields schema={schema} value={v ?? {}} onChange={next => set(i, next)} />
        </details>
      ))}
      <button type="button" className="key small add-item" onClick={() => { onChange([...value, value.length ? structuredClone(value[value.length - 1]) : {}]); endGroup(); }}><Plus size={12} /> Add item</button>
    </div>
  );
}

/** One string per line. */
function ListField({label, value, onChange}: {label: string; value: string[]; onChange: (v: string[]) => void}) {
  const [draft, setDraft] = useState(value.join('\n'));
  useEffect(() => setDraft(value.join('\n')), [value.join('\n')]);
  return (
    <label className="field">
      <span>{label}<em>one line per item</em></span>
      <textarea dir="auto" rows={Math.min(8, Math.max(2, value.length + 1))} value={draft} onBlur={endGroup}
        onChange={e => { setDraft(e.target.value); onChange(e.target.value.split('\n').filter((l, i, all) => l.trim() || i < all.length - 1)); }} />
    </label>
  );
}

/** Slider label: a unit stays visible, a JSON name goes to the tooltip. */
function FieldSliderLabel({label, hint}: {label: string; hint?: string}) {
  const h = splitHint(hint);
  return <span className="slider-label" title={h.tip}>{label}{h.shown && <em>{h.shown}</em>}</span>;
}

/**
 * The one property row used by the look panels (CapCut style): label, slider, number box and a
 * reset key. Drags coalesce into one undo step through the caller's group.
 */
export function SliderField({label, hint, value, min, max, step = 0.01, neutral = 0, onChange}: Common & {value: number | undefined; min: number; max: number; step?: number; neutral?: number; onChange: (v: number | undefined) => void}) {
  const v = value ?? neutral;
  const [draft, setDraft] = useState(String(v));
  useEffect(() => setDraft(String(Math.round(v * 100) / 100)), [v]);
  const set = (n: number) => onChange(Math.abs(n - neutral) < 1e-6 ? undefined : Math.round(Math.max(min, Math.min(max, n)) / step) * step);
  const changed = Math.abs(v - neutral) > 1e-6;
  return (
    <div className={`slider-row ${changed ? 'changed' : ''}`}>
      <FieldSliderLabel label={label} hint={hint} />
      <input type="range" min={min} max={max} step={step} value={v} aria-label={label} dir="ltr"
        onChange={e => set(Number(e.target.value))} onPointerDown={() => startGesture('panel')} onPointerUp={() => { endGroup(); endGesture(); }} onPointerCancel={endGesture} onKeyUp={endGroup} onDoubleClick={() => { onChange(undefined); endGroup(); }} />
      <input type="number" className="slider-num" step={step} min={min} max={max} value={draft} aria-label={`${label} value`} onBlur={endGroup}
        onChange={e => { setDraft(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== '' && Number.isFinite(n)) set(n); }} />
      <button className="slider-reset" title="Reset" aria-label={`Reset ${label}`} disabled={!changed} onClick={() => { onChange(undefined); endGroup(); }}><ArrowCounterClockwise size={12} /></button>
    </div>
  );
}
