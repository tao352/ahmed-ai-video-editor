// Map text seen on screen back to the edit.json string that produced it, so the owner
// can retype any word in the preview (caption words or any component's text props).
import * as op from './ops';
import type {Doc} from './ops';

export type TextTarget = {label: string; current: string; apply: (doc: Doc, text: string) => Doc; change: (text: string) => string};

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

type Leaf = {path: (string | number)[]; value: string};
function leaves(v: unknown, path: (string | number)[] = [], out: Leaf[] = []): Leaf[] {
  if (typeof v === 'string') { if (v.trim() && !/^#|^https?:|\.(png|jpe?g|webp|svg|mp4|webm|wav|mp3)$/i.test(v)) out.push({path, value: v}); }
  else if (Array.isArray(v)) v.forEach((x, i) => leaves(x, [...path, i], out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) leaves(x, [...path, k], out);
  return out;
}

const setIn = (obj: any, path: (string | number)[], value: unknown) => {
  const root = structuredClone(obj ?? {});
  let cur = root;
  for (const k of path.slice(0, -1)) { cur[k] ??= typeof k === 'number' ? [] : {}; cur = cur[k]; }
  cur[path.at(-1)!] = value;
  return root;
};

/**
 * shown: the text of the element under the cursor. For a clip, search its props (and the
 * component defaults it falls back to): exact match first, then a prop that contains the
 * shown text (word-by-word animations split one prop into many spans), then the reverse.
 */
export function findTextTarget(doc: Doc, layerId: string, shown: string, time: number, defaults: Record<string, unknown> = {}): TextTarget | null {
  const s = norm(shown);
  if (!s) return null;
  if (layerId === '__captions') {
    const ws = op.words(doc);
    const live = ws.map((w, i) => ({w, i})).filter(({w}) => time >= w[0] - 1 && time <= w[1] + 1);
    const hit = live.find(({w}) => norm(w[2]) === s) ?? live.find(({w}) => s.includes(norm(w[2])));
    if (!hit) return null;
    const i = hit.i;
    return {label: `word #${i}`, current: ws[i][2], apply: (d, text) => op.editWord(d, i, text), change: text => `word #${i} text "${ws[i][2]}" -> "${text}" (edited on screen)`};
  }
  const clip = op.clips(doc).find(c => c.id === layerId);
  if (!clip) return null;
  const all = leaves({...defaults, ...(clip.props ?? {})});
  const exact = all.find(l => norm(l.value) === s);
  const container = exact ? null : all.find(l => norm(l.value).includes(s));
  const inner = exact || container ? null : all.filter(l => s.includes(norm(l.value))).sort((a, b) => b.value.length - a.value.length)[0];
  const leaf = exact ?? container ?? inner;
  if (!leaf) return null;
  const partial = !!container;
  const current = partial ? s : leaf.value;
  const where = `props.${leaf.path.join('.')}`;
  return {
    label: `clip ${clip.id} ${where}`,
    current,
    apply: (d, text) => {
      const c = op.clips(d).find(x => x.id === clip.id);
      if (!c) return d;
      const base = {...defaults, ...(c.props ?? {})};
      const old = leaf.path.reduce<any>((o, k) => o?.[k], base);
      const value = partial && typeof old === 'string' ? old.replace(s, text) : text;
      return op.replaceItem(d, {kind: 'clip', id: clip.id}, {...c, props: setIn(c.props, leaf.path, value)});
    },
    change: text => `changed text of clip ${clip.id} (${clip.component}) ${where}: "${current}" -> "${text}" (edited on screen)`,
  };
}
