import {describe, expect, it} from 'vitest';
import * as op from './ops';
import {createHistory, push, redo, seal, undo} from './history';

const base = (): op.Doc => ({
  version: 1,
  settings: {width: 1080, height: 1920, fps: 30, background: '#000', duration: 20},
  meta: {rev: 3, updatedBy: 'claude'},
  formats: {'16x9': {width: 1920, height: 1080, clips: {a: {hidden: true}}}},
  notes: [{id: 'n1', at: 2, text: 'hi', status: 'open'}],
  futureField: {keep: true},
  base: [{src: 'base.mp4', start: 0, duration: 20}],
  captions: {words: [[1, 1.5, 'one'], [1.6, 2, 'two'], [3, 3.4, 'three']], style: {preset: 'default', gapBreak: 0.25}, enabled: true},
  zooms: [{type: 'punch', t: 4, peak: 1.2, hold: 0.5}, {type: 'kenburns', t0: 6, t1: 9, peak: 1.1}, {type: 'ratchet', steps: [[10, 1.1], [11, 1.2]], hold: 0.4}],
  clips: [{id: 'a', component: 'BigType', from: 2, to: 5, track: 2, props: {b: {text: 'x'}, extra: 1}}, {id: 'b', component: 'Sticker', from: 8, to: 10, track: 5, props: {}}],
  audio: {sfx: [{at: 5, file: 'sfx/hit.wav', volume: 1}], music: {src: 'm.mp3', volume: 0.1}},
  transitions: [{at: 12, type: 'fade', duration: 0.5}],
});

const untouched = (a: op.Doc, b: op.Doc) => {
  expect(b.formats).toEqual(a.formats);
  expect(b.futureField).toEqual(a.futureField);
  expect(b.meta).toEqual(a.meta);
};

describe('spans', () => {
  it('reads each kind', () => {
    const d = base();
    expect(op.getSpan(d, {kind: 'clip', id: 'a'})).toEqual({start: 2, end: 5});
    expect(op.getSpan(d, {kind: 'word', index: 1})).toEqual({start: 1.6, end: 2});
    expect(op.getSpan(d, {kind: 'zoom', index: 0})).toEqual({start: 4, end: 4.5});
    expect(op.getSpan(d, {kind: 'zoom', index: 2})).toEqual({start: 10, end: 11.4});
    expect(op.getSpan(d, {kind: 'sfx', index: 0})).toEqual({start: 5, end: 5 + op.SFX_DEFAULT});
    expect(op.getSpan(d, {kind: 'base', index: 0})).toEqual({start: 0, end: 20});
  });
});

describe('moveItems', () => {
  it('shifts every time field and keeps unknown fields', () => {
    const d = base();
    const n = op.moveItems(d, [{kind: 'clip', id: 'a'}, {kind: 'zoom', index: 2}, {kind: 'note', id: 'n1'}], 1.25);
    expect(n.clips[0]).toMatchObject({from: 3.25, to: 6.25, props: {b: {text: 'x'}, extra: 1}});
    expect(n.zooms[2].steps).toEqual([[11.25, 1.1], [12.25, 1.2]]);
    expect(n.notes[0].at).toBe(3.25);
    untouched(d, n);
    expect(d.clips[0].from).toBe(2); // original not mutated
  });
  it('clamps the group inside the timeline', () => {
    const n = op.moveItems(base(), [{kind: 'clip', id: 'a'}], -10);
    expect(n.clips[0]).toMatchObject({from: 0, to: 3});
    const m = op.moveItems(base(), [{kind: 'clip', id: 'b'}], 50);
    expect(m.clips[1]).toMatchObject({from: 18, to: 20});
  });
  it('keeps words sorted after moving one past another', () => {
    const d = base();
    const n = op.moveItems(d, [{kind: 'word', index: 0}], 2.5);
    expect(n.captions.words.map((w: any) => w[2])).toEqual(['two', 'three', 'one']);
    expect(op.remapWordRefs(d, n, [{kind: 'word', index: 0}])).toEqual([{kind: 'word', index: 2}]);
  });
  it('ignores base and music', () => {
    const d = base();
    expect(op.moveItems(d, [{kind: 'music'}, {kind: 'base', index: 0}], 2)).toBe(d);
  });
});

describe('trimItem', () => {
  it('trims clip edges with a minimum length', () => {
    const d = base();
    expect(op.trimItem(d, {kind: 'clip', id: 'a'}, 'end', 4).clips[0]).toMatchObject({from: 2, to: 4});
    const tiny = op.trimItem(d, {kind: 'clip', id: 'a'}, 'start', 9).clips[0];
    expect(tiny.to - tiny.from).toBeCloseTo(op.MIN_LEN, 2);
  });
  it('trims zoom types through their own fields', () => {
    const d = base();
    expect(op.trimItem(d, {kind: 'zoom', index: 0}, 'end', 5).zooms[0]).toMatchObject({t: 4, hold: 1});
    expect(op.trimItem(d, {kind: 'zoom', index: 1}, 'start', 5).zooms[1]).toMatchObject({t0: 5, t1: 9});
    expect(op.trimItem(d, {kind: 'zoom', index: 2}, 'end', 12).zooms[2].hold).toBe(1);
  });
  it('moves sourceIn when the base video start is trimmed', () => {
    const n = op.trimItem(base(), {kind: 'base', index: 0}, 'start', 2);
    expect(n.base[0]).toMatchObject({start: 2, duration: 18, sourceIn: 2});
  });
  it('never goes negative or past the end', () => {
    const d = base();
    expect(op.trimItem(d, {kind: 'clip', id: 'a'}, 'start', -3).clips[0].from).toBe(0);
    expect(op.trimItem(d, {kind: 'clip', id: 'b'}, 'end', 99).clips[1].to).toBe(20);
  });
});

describe('structural edits', () => {
  it('splits a clip into two with unique ids', () => {
    const {doc, newId} = op.splitClip(base(), 'a', 3.5);
    expect(newId).toBe('a-b');
    expect(doc.clips.map((c: any) => [c.id, c.from, c.to])).toEqual([['a', 2, 3.5], ['a-b', 3.5, 5], ['b', 8, 10]]);
    expect(op.splitClip(doc, 'a', 3).newId).toBe('a-2');
    expect(op.splitClip(base(), 'a', 2).newId).toBeNull();
  });
  it('deletes mixed selections', () => {
    const d = base();
    const n = op.deleteItems(d, [{kind: 'clip', id: 'a'}, {kind: 'word', index: 0}, {kind: 'word', index: 2}, {kind: 'sfx', index: 0}, {kind: 'note', id: 'n1'}]);
    expect(n.clips.map((c: any) => c.id)).toEqual(['b']);
    expect(n.captions.words.map((w: any) => w[2])).toEqual(['two']);
    expect(n.audio.sfx).toEqual([]);
    expect(n.notes).toEqual([]);
    untouched(d, n);
  });
  it('duplicates with fresh ids', () => {
    const {doc, created} = op.duplicateItems(base(), [{kind: 'clip', id: 'a'}, {kind: 'sfx', index: 0}]);
    expect(created[0]).toEqual({kind: 'clip', id: 'a-2'});
    expect(doc.clips.find((c: any) => c.id === 'a-2')).toMatchObject({from: 5, to: 8});
    expect(new Set(doc.clips.map((c: any) => c.id)).size).toBe(doc.clips.length);
    expect(doc.audio.sfx).toHaveLength(2);
  });
  it('adds a clip on a free track and a note in order', () => {
    const {doc, id} = op.addClip(base(), 'BigType', 3, {b: {text: 'y'}});
    const c = doc.clips.find((x: any) => x.id === id);
    expect(c).toMatchObject({component: 'BigType', from: 3, to: 6, track: 5});
    expect(id).toBe('big-type-1');
    const withNote = op.addNote(doc, 1, 'first').doc;
    expect(withNote.notes.map((n: any) => n.at)).toEqual([1, 2]);
  });
});

describe('captions', () => {
  it('edits, splits and merges words', () => {
    const d = base();
    expect(op.editWord(d, 1, 'TWO').captions.words[1][2]).toBe('TWO');
    expect(op.editWord(d, 1, 'two')).toBe(d);
    const split = op.splitWord(op.editWord(d, 2, 'ab cdef'), 2);
    expect(split.captions.words.slice(2)).toEqual([[3, 3.133, 'ab'], [3.133, 3.4, 'cdef']]);
    const merged = op.mergeWords(d, 0);
    expect(merged.captions.words[0]).toEqual([1, 2, 'one two']);
    expect(merged.captions.words).toHaveLength(2);
  });
  it('groups words into lines on silence', () => {
    expect(op.wordLines(base())).toEqual([[0, 1], [2]]);
  });
});

describe('snapping and labels', () => {
  it('snaps to the nearest point within threshold', () => {
    const pts = op.snapPoints(base(), [{kind: 'clip', id: 'b'}]);
    expect(pts).not.toContain(8);
    expect(op.snap(3.95, pts, 0.1)).toBe(4);
    expect(op.snap(7, pts, 0.1)).toBe(7);
  });
  it('describes changes for human_changes.md', () => {
    const d = base();
    const n = op.moveItems(d, [{kind: 'clip', id: 'a'}], 0.5);
    expect(op.describeMove(n, [{kind: 'clip', id: 'a'}], d)).toBe('moved clip a (BigType) 2.00s -> 2.50s');
    expect(op.describeFieldChange({a: 1, p: {t: 'x'}}, {a: 1, p: {t: 'y'}}, 'clip a')).toBe('changed clip a: p.t "x" -> "y"');
  });
});

describe('history', () => {
  it('undoes, redoes and coalesces drags', () => {
    const d0 = base();
    let h = createHistory(d0);
    const d1 = op.moveItems(d0, [{kind: 'clip', id: 'a'}], 1);
    const d2 = op.moveItems(d1, [{kind: 'clip', id: 'a'}], 1);
    h = push(h, d1, 'drag', 'g1');
    h = push(h, d2, 'drag', 'g1');
    expect(h.past).toHaveLength(1);
    h = seal(h);
    const d3 = op.deleteItems(d2, [{kind: 'clip', id: 'b'}]);
    h = push(h, d3, 'delete');
    expect(h.past).toHaveLength(2);
    h = undo(h);
    expect(h.present.doc).toBe(d2);
    h = undo(h);
    expect(h.present.doc).toBe(d0);
    h = redo(h);
    expect(h.present.doc).toBe(d2);
  });
});

describe('rippleDelete', () => {
  it('cuts a range out of everything and closes the gap', () => {
    const d: op.Doc = {...base(), audio: {...base().audio, voice: {src: 'voice.wav', volume: 1}}};
    const n = op.rippleDelete(d, 1.55, 3.0); // drops word "two", 1.45s gap
    expect(n.settings.duration).toBe(18.55);
    expect(n.captions.words.map((w: any) => w[2])).toEqual(['one', 'three']);
    expect(n.captions.words[1]).toEqual([1.55, 1.95, 'three']);
    expect(n.clips.find((c: any) => c.id === 'a')).toMatchObject({from: 1.55, to: 3.55}); // crossed the cut: shortened
    expect(n.base).toEqual([{src: 'base.mp4', start: 0, sourceIn: 0, duration: 1.55}, {src: 'base.mp4', start: 1.55, sourceIn: 3, duration: 17}]);
    expect(n.audio.voice.segments).toEqual([{start: 0, sourceIn: 0, duration: 1.55}, {start: 1.55, sourceIn: 3, duration: 17}]);
    expect(n.zooms[0].t).toBe(2.55);
    expect(n.audio.sfx[0].at).toBe(3.55);
    expect(n.notes[0].at).toBe(1.55);
    expect(n.formats).toEqual(d.formats);
  });
  it('drops items fully inside the range and leaves an empty range alone', () => {
    const d = base();
    const n = op.rippleDelete(d, 1.9, 5.5);
    expect(n.clips.map((c: any) => c.id)).toEqual(['b']);
    expect(n.audio.sfx).toEqual([]);
    expect(op.rippleDelete(d, 3, 3)).toBe(d);
  });
});

describe('footage split and delete (CapCut flow)', () => {
  it('splits the base video at the playhead and deleting a piece ripples', () => {
    const d: op.Doc = {...base(), audio: {...base().audio, voice: {src: 'v.wav', volume: 1}}};
    const {doc: s, index} = op.splitBase(d, 6);
    expect(index).toBe(1);
    expect(s.base).toEqual([{src: 'base.mp4', start: 0, sourceIn: 0, duration: 6}, {src: 'base.mp4', start: 6, sourceIn: 6, duration: 14}]);
    const {doc: s2} = op.splitBase(s, 8);
    expect(s2.base.map((b: any) => [b.start, b.sourceIn, b.duration])).toEqual([[0, 0, 6], [6, 6, 2], [8, 8, 12]]);
    const span = op.getSpan(s2, {kind: 'base', index: 1})!;
    const cut = op.rippleDelete(s2, span.start, span.end);
    expect(cut.settings.duration).toBe(18);
    expect(cut.base.map((b: any) => [b.start, b.sourceIn, b.duration])).toEqual([[0, 0, 6], [6, 8, 12]]);
    expect(cut.audio.voice.segments).toEqual([{start: 0, sourceIn: 0, duration: 6}, {start: 6, sourceIn: 8, duration: 12}]);
    expect(cut.clips.find((c: any) => c.id === 'b')).toMatchObject({from: 6, to: 8}); // 8-10 lived in the cut 6-8? no: it starts at the cut end and moves back
  });
  it('ignores a split on the edge or outside the footage', () => {
    expect(op.splitBase(base(), 0).index).toBeNull();
    expect(op.splitBase(base(), 25).index).toBeNull();
  });
});

describe('findCuts', () => {
  const doc = {settings: {duration: 10}, captions: {words: [[0.5, 1, 'هاي'], [1.1, 1.5, 'اممم'], [1.6, 2, 'يا'], [3, 3.5, 'جماعة']]}, clips: [], zooms: [], base: [{src: 'b.mp4'}]} as any;
  it('finds long silences (with breathing room) and filler words', () => {
    const cuts = op.findCuts(doc, 0.35, 0.08);
    expect(cuts.map(c => c.kind)).toEqual(['pause', 'filler', 'pause', 'pause']);
    expect(cuts[0]).toMatchObject({start: 0, end: 0.42});
    expect(cuts[1]).toMatchObject({start: 1.1, end: 1.55, text: 'اممم'});
    expect(cuts[2]).toMatchObject({start: 2.08, end: 2.92});
    expect(cuts[3]).toMatchObject({start: 3.58, end: 10});
  });
  it('ripple-deletes them all in one go', () => {
    const cuts = op.findCuts(doc, 0.35, 0.08);
    const out = op.rippleDeleteMany(doc, cuts);
    const removed = cuts.reduce((s, c) => s + c.end - c.start, 0);
    expect(out.settings.duration).toBeCloseTo(10 - removed, 3);
    expect(out.captions.words.map((w: any) => w[2])).toEqual(['هاي', 'يا', 'جماعة']);
  });
});

describe('freeze, speed and keyframes', () => {
  const mk = () => ({settings: {duration: 10}, captions: {words: [[1, 2, 'a'], [6, 7, 'b']]}, clips: [{id: 'c', component: 'X', from: 5, to: 8}], zooms: [],
    base: [{src: 'b.mp4', start: 0, sourceIn: 0, duration: 10}], audio: {voice: {src: 'v.wav'}, sfx: [{at: 6, file: 's.wav'}]}}) as any;
  it('rippleInsert opens time and pauses the voice', () => {
    const d = op.rippleInsert(mk(), 4, 2);
    expect(d.settings.duration).toBe(12);
    expect(d.captions.words[1][0]).toBe(8);
    expect(d.clips[0]).toMatchObject({from: 7, to: 10});
    expect(d.audio.voice.segments).toEqual([{start: 0, sourceIn: 0, duration: 4}, {start: 6, sourceIn: 4, duration: 6}]);
  });
  it('insertFreeze holds one frame of footage', () => {
    const {doc: d, index} = op.insertFreeze(mk(), 3, 1);
    expect(index).toBe(1);
    expect(d.base.map((b: any) => [b.start, b.sourceIn, b.duration, !!b.freeze])).toEqual([[0, 0, 3, false], [3, 3, 1, true], [4, 3, 7, false]]);
    expect(d.settings.duration).toBe(11);
  });
  it('setBaseSpeed shortens a piece and closes the gap', () => {
    const {doc: s} = op.splitBase(mk(), 4);
    const d = op.setBaseSpeed(s, 0, 2);
    expect(d.base[0]).toMatchObject({start: 0, duration: 2, speed: 2});
    expect(d.base[1].start).toBe(2);
    expect(d.settings.duration).toBe(8);
    const back = op.setBaseSpeed(d, 0, 1);
    expect(back.base[0]).toMatchObject({start: 0, duration: 4});
    expect('speed' in back.base[0]).toBe(false);
  });
  it('upserts and removes keyframes', () => {
    let d = op.upsertKey(mk(), 'c', 0, {x: 0, scale: 1});
    d = op.upsertKey(d, 'c', 1.5, {x: 0.2});
    d = op.upsertKey(d, 'c', 1.51, {scale: 2});
    expect(d.clips[0].keys).toEqual([{t: 0, x: 0, scale: 1}, {t: 1.51, x: 0.2, scale: 2}]);
    d = op.removeKey(d, 'c', 1.51);
    d = op.removeKey(d, 'c', 0);
    expect('keys' in d.clips[0]).toBe(false);
  });
});

describe('main-track reorder (CapCut magnet)', () => {
  // three shots A [0,4) B [4,7) C [7,10); the voice and words run straight through
  const mk = () => ({
    settings: {duration: 10}, zooms: [{type: 'punch', t: 5}], transitions: [], notes: [{id: 'n1', at: 8, text: 'c'}],
    captions: {words: [[1, 1.5, 'a'], [5, 5.5, 'b'], [8, 8.5, 'c']]},
    clips: [{id: 'g', component: 'BigType', from: 4.5, to: 6, track: 5}],
    base: [{src: 'A.mp4', start: 0, sourceIn: 0, duration: 4}, {src: 'B.mp4', start: 4, sourceIn: 0, duration: 3}, {src: 'C.mp4', start: 7, sourceIn: 0, duration: 3}],
    audio: {voice: {src: 'v.wav'}, sfx: [{at: 4.2, file: 's.wav'}]},
  }) as any;
  const order = (d: any) => d.base.map((b: any) => `${b.src}@${b.start}`).join(' ');

  it('moves a piece to the front with its voice, words, clips and zooms', () => {
    const r = op.movePiece(mk(), 1, 0);
    expect(order(r.doc)).toBe('B.mp4@0 A.mp4@3 C.mp4@7');
    expect(r.index).toBe(0);
    expect(r.doc.audio.voice.segments).toEqual([{start: 0, sourceIn: 4, duration: 3}, {start: 3, sourceIn: 0, duration: 4}, {start: 7, sourceIn: 7, duration: 3}]);
    expect(r.doc.captions.words.map((w: any) => `${w[2]}@${w[0]}`)).toEqual(['b@1', 'a@4', 'c@8']);
    expect(r.doc.clips[0]).toMatchObject({from: 0.5, to: 2});
    expect(r.doc.zooms[0].t).toBe(1);
    expect(r.doc.audio.sfx[0].at).toBe(0.2);
    expect(r.doc.notes[0].at).toBe(8);
    expect(r.doc.settings.duration).toBe(10);
  });

  it('moves a piece to the end and closes up behind it', () => {
    const r = op.movePiece(mk(), 0, 3);
    expect(order(r.doc)).toBe('B.mp4@0 C.mp4@3 A.mp4@6');
    expect(r.index).toBe(2);
    expect(r.doc.captions.words.map((w: any) => `${w[2]}@${w[0]}`)).toEqual(['b@1', 'c@4', 'a@7']);
    expect(r.doc.notes[0].at).toBe(4);
  });

  it('dropping a piece where it already is changes nothing', () => {
    const d = mk();
    expect(op.movePiece(d, 1, 1).doc).toBe(d);
    expect(op.movePiece(d, 1, 2).doc).toBe(d);
  });

  it('moveRange splits footage that crosses the range edges', () => {
    const d = op.moveRange(mk(), 2, 5, 10);
    expect(order(d)).toBe('A.mp4@0 B.mp4@2 C.mp4@4 A.mp4@7 B.mp4@9');
    expect(d.base.reduce((s: number, b: any) => s + b.duration, 0)).toBe(10);
    expect(d.base[3]).toMatchObject({sourceIn: 2, duration: 2});
  });
});

describe('transitions on footage cuts', () => {
  const mk = () => ({settings: {duration: 10}, transitions: [], base: [{src: 'A.mp4', start: 0, duration: 4}, {src: 'B.mp4', start: 4, duration: 3}, {src: 'C.mp4', start: 7, duration: 3}]}) as any;
  it('finds the cuts and the nearest one', () => {
    expect(op.cutTimes(mk())).toEqual([4, 7]);
    expect(op.nearestCut(mk(), 6)).toBe(7);
    expect(op.nearestCut(mk(), 5.5, 1)).toBeNull();
  });
  it('centres a transition on its cut and replaces the one already there', () => {
    let r = op.setCutTransition(mk(), 4, 'mix', 0.5);
    expect(r.doc.transitions).toEqual([{at: 3.75, type: 'mix', duration: 0.5}]);
    r = op.setCutTransition(r.doc, 4, 'pull-in', 0.8);
    expect(r.doc.transitions).toEqual([{at: 3.6, type: 'pull-in', duration: 0.8}]);
    expect(r.index).toBe(0);
    expect(op.cutOf(r.doc, r.doc.transitions[0])).toBe(4);
  });
  it('never runs longer than the shorter piece', () => {
    expect(op.setCutTransition(mk(), 7, 'mix', 9).doc.transitions[0]).toEqual({at: 5.5, type: 'mix', duration: 3});
  });
  it('apply to all puts one on every cut', () => {
    expect(op.transitionOnAllCuts(mk(), 'spin').transitions.map((x: any) => x.at)).toEqual([3.75, 6.75]);
  });
});
