// Every real project must still open after a change to the schema, the ops or the formats.
// Read-only: the files are parsed, never written.
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {editSchema} from '../../../reel/src/edit/schema';
import {applyLanes} from '../../../reel/src/edit/lanes';
import {resolveFormat} from './formats';
import * as op from './ops';
import {share} from './share';
import {registry} from '../../../reel/src/edit/registry';

const root = path.resolve(__dirname, '../../../projects');
// your projects (projects/<name>/edit/edit.json) and the starters (projects/_examples/<name>/edit.json)
const examples = path.join(root, '_examples');
const files = [
  ...fs.readdirSync(root).map(name => path.join(root, name, 'edit', 'edit.json')),
  ...(fs.existsSync(examples) ? fs.readdirSync(examples).map(name => path.join(examples, name, 'edit.json')) : []),
].filter(f => fs.existsSync(f));

const issue = (doc: unknown) => {
  const r = editSchema.safeParse(doc);
  return r.success ? null : `${r.error.issues[0].path.join('.')}: ${r.error.issues[0].message}`;
};

describe.each(files.map(f => [path.relative(root, f), f]))('%s', (_, file) => {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));

  it('passes the render schema', () => expect(issue(doc)).toBeNull());

  it('passes in every output format', () => {
    for (const id of ['main', ...Object.keys(doc.formats ?? {})]) expect(issue(resolveFormat(doc, id)), id).toBeNull();
  });

  it('survives lanes and a no-op edit without losing fields', () => {
    expect(() => applyLanes(editSchema.parse(doc))).not.toThrow();
    const clip = op.clips(doc)[0];
    if (clip) expect(share(doc, op.moveItems(doc, [{kind: 'clip', id: clip.id}], 0))).toBe(doc);
  });

  it('uses only components the renderer has', () => {
    for (const c of op.clips(doc)) expect(registry[c.component], c.component).toBeDefined();
  });

  it('has a span for every timeline item', () => {
    for (const [i] of op.words(doc).entries()) expect(op.getSpan(doc, {kind: 'word', index: i})).not.toBeNull();
    for (const c of op.clips(doc)) expect(op.getSpan(doc, {kind: 'clip', id: c.id})).not.toBeNull();
  });
});
