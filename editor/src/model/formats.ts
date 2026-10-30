// Output formats: one master edit.json plus small per-format overrides in `formats`.
// resolveFormat turns master + overrides into a plain edit.json the Edit composition renders.
import type {Doc} from './ops';

export const MAIN = 'main';

export type FormatPreset = {id: string; label: string; width: number; height: number; profile: string};
export const PRESETS: FormatPreset[] = [
  {id: '9x16', label: '9:16 vertical', width: 1080, height: 1920, profile: 'reels'},
  {id: '16x9', label: '16:9 horizontal', width: 1920, height: 1080, profile: 'youtube'},
  {id: '1x1', label: '1:1 square', width: 1080, height: 1080, profile: 'feed'},
  {id: '4x5', label: '4:5 post', width: 1080, height: 1350, profile: 'feed'},
];

export type ClipOverride = {hidden?: boolean; box?: Record<string, number>; props?: Record<string, unknown>; from?: number; to?: number};
export type FormatOverride = {
  width: number; height: number; profile?: string; label?: string;
  base?: {fit?: string; focus?: [number, number]};
  layout?: {mode?: string};
  captions?: {box?: Record<string, number>; style?: Record<string, unknown>; enabled?: boolean};
  clips?: Record<string, ClipOverride>;
};

export const formatIds = (doc: Doc): string[] => Object.keys(doc.formats ?? {});
export const formatOf = (doc: Doc, id: string): FormatOverride | null => (id === MAIN ? null : doc.formats?.[id] ?? null);

export function formatLabel(doc: Doc, id: string): string {
  if (id === MAIN) return `${doc.settings?.width}×${doc.settings?.height}`;
  const f = formatOf(doc, id);
  return f?.label ?? PRESETS.find(p => p.id === id)?.label ?? id;
}

/** A plain edit.json for one format. Unknown master fields pass through untouched. */
export function resolveFormat(doc: Doc, id: string): Doc {
  const f = formatOf(doc, id);
  if (!f) return doc;
  const out: Doc = structuredClone(doc);
  delete out.formats;
  out.settings = {...out.settings, width: f.width, height: f.height};
  // A vertical source in a wide frame (and the reverse) needs a fill rule; blurfill unless told otherwise.
  const flips = (doc.settings.width > doc.settings.height) !== (f.width > f.height);
  out.base = (out.base ?? []).map((b: any) => ({
    ...b,
    fit: f.base?.fit ?? (flips ? 'blurfill' : b.fit ?? 'cover'),
    ...(f.base?.focus ? {focus: f.base.focus} : {}),
  }));
  if (f.layout?.mode) out.layout = {...out.layout, mode: f.layout.mode, beats: []};
  if (f.captions) {
    out.captions = {...out.captions};
    if (f.captions.style) out.captions.style = {...out.captions.style, ...f.captions.style};
    if (f.captions.box) out.captions.box = f.captions.box;
    if (f.captions.enabled != null) out.captions.enabled = f.captions.enabled;
  }
  if (f.clips) {
    out.clips = (out.clips ?? []).flatMap((c: any) => {
      const o = f.clips![c.id];
      if (!o) return [c];
      if (o.hidden) return [];
      return [{...c, ...(o.from != null ? {from: o.from} : {}), ...(o.to != null ? {to: o.to} : {}), ...(o.box ? {box: o.box} : {}), props: {...c.props, ...(o.props ?? {})}}];
    });
  }
  return out;
}

export function addFormat(doc: Doc, preset: FormatPreset): Doc {
  const next = structuredClone(doc);
  next.formats ??= {};
  if (!next.formats[preset.id]) next.formats[preset.id] = {width: preset.width, height: preset.height, profile: preset.profile, label: preset.label};
  return next;
}

export function removeFormat(doc: Doc, id: string): Doc {
  const next = structuredClone(doc);
  if (next.formats) delete next.formats[id];
  if (next.formats && !Object.keys(next.formats).length) delete next.formats;
  return next;
}

/** Write one override field for a clip in a format (value undefined clears it). */
export function setClipOverride(doc: Doc, formatId: string, clipId: string, key: keyof ClipOverride, value: unknown): Doc {
  const next = structuredClone(doc);
  const f = next.formats?.[formatId];
  if (!f) return doc;
  f.clips ??= {};
  const o = {...(f.clips[clipId] ?? {})};
  if (value === undefined) delete o[key]; else (o as any)[key] = value;
  if (Object.keys(o).length) f.clips[clipId] = o; else delete f.clips[clipId];
  return next;
}

export function setFormatField(doc: Doc, formatId: string, path: string[], value: unknown): Doc {
  const next = structuredClone(doc);
  let cur: any = next.formats?.[formatId];
  if (!cur) return doc;
  for (const k of path.slice(0, -1)) { cur[k] ??= {}; cur = cur[k]; }
  if (value === undefined) delete cur[path.at(-1)!]; else cur[path.at(-1)!] = value;
  return next;
}
