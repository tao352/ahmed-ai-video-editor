import {describe, expect, it} from 'vitest';
import {keyedBox} from '../../../reel/src/edit/clipfx';

describe('keyedBox', () => {
  const base = {x: 0, y: 0, scale: 1, rotate: 0, opacity: 1};
  it('interpolates each field between the keys that set it, with easing', () => {
    const keys = [{t: 0, x: 0}, {t: 2, x: 1}, {t: 1, scale: 2}, {t: 3, scale: 1, ease: 'hold' as const}];
    expect(keyedBox(base, keys, 1).x).toBeCloseTo(0.5);
    expect(keyedBox(base, keys, 5).x).toBe(1);
    expect(keyedBox(base, keys, 0).scale).toBe(2); // before the first scale key: hold it
    expect(keyedBox(base, keys, 2.9).scale).toBe(2); // hold until the key
    expect(keyedBox(base, keys, 3).scale).toBe(1);
    expect(keyedBox(base, [{t: 0, x: 0}, {t: 1, x: 1, ease: 'in'}], 0.5).x).toBeCloseTo(0.125);
    expect(keyedBox(base, undefined, 1)).toEqual(base);
  });
});

import * as op from './ops';

describe('zoom keyframes on footage (CapCut style)', () => {
  const STILL = {x: 0, y: 0, scale: 1, rotate: 0, opacity: 1};
  const doc = () => ({settings: {duration: 10, fps: 30}, clips: [], captions: {words: []},
    base: [{src: 'a.mp4', start: 0, sourceIn: 0, duration: 10, keys: [{t: 0, scale: 1}, {t: 10, scale: 1.2}]}]});
  // the zoom the viewer sees at timeline time t
  const zoomAt = (d: any, t: number) => {
    const b = d.base.find((x: any) => t >= x.start && t < x.start + x.duration) ?? d.base.at(-1);
    return op.keysOf(d, {kind: 'base', index: d.base.indexOf(b)}).length ? keyedBox(STILL, b.keys, t - b.start).scale : 1;
  };

  it('keeps the motion unchanged across a split', () => {
    const before = doc();
    const {doc: after} = op.splitBase(before, 4);
    for (const t of [1, 3.9, 4, 4.1, 7, 9.9]) expect(zoomAt(after, t)).toBeCloseTo(zoomAt(before, t), 3);
    expect(after.base[1].keys[0]).toMatchObject({t: 0, scale: 1.08});
  });

  it('cuts the zoom with the footage when text is removed', () => {
    const after = op.rippleDelete(doc(), 2, 5);
    expect(zoomAt(after, 1)).toBeCloseTo(1.02, 3);
    expect(zoomAt(after, 2)).toBeCloseTo(1.1, 3); // jumps to where the footage resumes
  });

  it('adds, moves and removes keys on a footage piece', () => {
    const ref = {kind: 'base' as const, index: 0};
    let d: any = op.upsertKey(doc(), ref, 5, {scale: 1.5, ease: 'out'});
    expect(op.keysOf(d, ref).map(k => k.t)).toEqual([0, 5, 10]);
    d = op.moveKey(d, ref, 5, 6);
    expect(op.keysOf(d, ref).map(k => k.t)).toEqual([0, 6, 10]);
    d = op.removeKey(op.removeKey(op.removeKey(d, ref, 0), ref, 6), ref, 10);
    expect(d.base[0].keys).toBeUndefined();
  });

  it('stretches key times with a speed change', () => {
    const d = op.setBaseSpeed(doc(), 0, 2);
    expect(d.base[0].duration).toBe(5);
    expect(d.base[0].keys.at(-1).t).toBe(5);
  });
});

import * as ed from './edits';
describe('CapCut timeline commands', () => {
  const doc = () => ({settings: {duration: 10, fps: 30}, captions: {words: [[1, 1.5, 'a'], [6, 6.5, 'b']]}, audio: {sfx: []},
    clips: [{id: 'a', component: 'X', from: 1, to: 3, track: 5}, {id: 'b', component: 'X', from: 2, to: 4, track: 6}],
    base: [{src: 'v.mp4', start: 0, sourceIn: 0, duration: 10}]});
  it('Q / W ripple the footage and move the playhead to the cut', () => {
    const r = ed.deleteSide(doc(), [], 5, 'left');
    expect(r.doc.settings.duration).toBe(5);
    expect(r.playhead).toBe(0);
    expect(r.doc.captions.words).toEqual([[1, 1.5, 'b']]); // "a" was inside the cut; "b" moved back 5 s
    const w = ed.deleteSide(doc(), [], 5, 'right');
    expect(w.doc.settings.duration).toBe(5);
    expect(w.playhead).toBe(5);
  });
  it('Q / W trim a selected clip instead', () => {
    const r = ed.deleteSide(doc(), [{kind: 'clip', id: 'a'}], 2, 'right');
    expect(r.doc.clips[0]).toMatchObject({from: 1, to: 2});
    expect(r.doc.settings.duration).toBe(10);
  });
  it('paste lands at the playhead on a free track', () => {
    const d = doc();
    const r = ed.pasteItems(d, ed.copyItems(d, [{kind: 'clip', id: 'a'}]), 1.5);
    const copy = r.doc.clips.at(-1);
    expect(copy).toMatchObject({from: 1.5, to: 3.5});
    expect(copy.track).not.toBe(5);
  });
  it('moved clips never overlap on a track', () => {
    const d = ed.moveToTrack(doc(), ['b'], -1);
    const s = ed.settleTracks(d, ['b']);
    expect(s.clips[1].track).not.toBe(5);
  });
  it('disable toggles on and off', () => {
    const d = ed.toggleDisabled(doc(), [{kind: 'clip', id: 'a'}]);
    expect(d.clips[0].disabled).toBe(true);
    expect(ed.toggleDisabled(d, [{kind: 'clip', id: 'a'}]).clips[0].disabled).toBeUndefined();
  });
});

describe('smooth zoom (in, hold, out)', () => {
  const STILL = {x: 0, y: 0, scale: 1, rotate: 0, opacity: 1};
  const doc = () => ({settings: {duration: 10, fps: 30}, base: [{src: 'v.mp4', start: 2, sourceIn: 0, duration: 8}]});
  it('glides in, holds and glides back out', () => {
    const d: any = ed.smoothZoom(doc(), 0, 1, {amount: 1.2, inDur: 0.5, hold: 1, outDur: 0.5, ease: 'inOut'});
    const z = (t: number) => keyedBox(STILL, d.base[0].keys, t).scale;
    expect(z(1)).toBe(1);
    expect(z(1.25)).toBeGreaterThan(1.05); expect(z(1.25)).toBeLessThan(1.15); // half way in, eased
    expect(z(2)).toBeCloseTo(1.2);
    expect(z(2.75)).toBeLessThan(1.2);
    expect(z(3)).toBe(1);
  });
});

describe('speed curves', () => {
  it('turns one piece into constant-speed steps that cover the same source', () => {
    const doc: any = {settings: {duration: 10, fps: 30}, captions: {words: []}, base: [{src: 'v.mp4', start: 0, sourceIn: 2, duration: 4}, {src: 'w.mp4', start: 4, sourceIn: 0, duration: 6}]};
    const d: any = ed.speedCurve(doc, 0, [1, 2], 4);
    const steps = d.base.filter((b: any) => b.src === 'v.mp4');
    expect(steps).toHaveLength(4);
    expect(steps.at(-1).sourceIn + steps.at(-1).duration * steps.at(-1).speed).toBeCloseTo(6, 2); // ends where the source ended
    const len = steps.reduce((a: number, b: any) => a + b.duration, 0);
    expect(d.base.find((b: any) => b.src === 'w.mp4').start).toBeCloseTo(len, 2); // the next piece closed up
    expect(d.settings.duration).toBeCloseTo(len + 6, 2);
  });
});
