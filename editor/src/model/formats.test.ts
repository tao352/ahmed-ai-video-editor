import {describe, expect, it} from 'vitest';
import * as F from './formats';

const doc = () => ({
  version: 1,
  settings: {width: 1080, height: 1920, fps: 30, background: '#000', duration: 10},
  base: [{src: 'base.mp4', start: 0, matte: 'm.webm'}],
  layout: {mode: 'full', beats: [{from: 0, to: 10, mode: 'full'}]},
  captions: {words: [], style: {preset: 'default', size: 64}, enabled: true},
  clips: [{id: 'a', component: 'BigType', from: 1, to: 3, props: {t: 1}, box: {x: 0.1, y: 0, scale: 1, rotate: 0}}, {id: 'b', component: 'Sticker', from: 4, to: 5, props: {}}],
  notes: [{id: 'n1', at: 1, text: 'x', status: 'open'}],
  extra: {keep: 1},
});

describe('formats', () => {
  it('main returns the document itself', () => {
    const d = doc();
    expect(F.resolveFormat(d, F.MAIN)).toBe(d);
  });
  it('resolves size, fill, clip overrides and drops formats', () => {
    let d: any = F.addFormat(doc(), F.PRESETS[1]);
    d = F.setClipOverride(d, '16x9', 'a', 'box', {x: -0.2, y: 0.1, scale: 0.6, rotate: 0});
    d = F.setClipOverride(d, '16x9', 'b', 'hidden', true);
    d = F.setFormatField(d, '16x9', ['captions', 'style'], {size: 48});
    const r = F.resolveFormat(d, '16x9');
    expect(r.settings).toMatchObject({width: 1920, height: 1080, fps: 30});
    expect(r.base[0]).toMatchObject({fit: 'blurfill', matte: 'm.webm'});
    expect(r.clips.map((c: any) => c.id)).toEqual(['a']);
    expect(r.clips[0].box).toEqual({x: -0.2, y: 0.1, scale: 0.6, rotate: 0});
    expect(r.clips[0].props).toEqual({t: 1});
    expect(r.captions.style).toEqual({preset: 'default', size: 48});
    expect(r.formats).toBeUndefined();
    expect(r.extra).toEqual({keep: 1});
    expect(d.clips[0].box.x).toBe(0.1); // master untouched
  });
  it('keeps cover when orientation does not flip, and honours an explicit fit and focus', () => {
    let d: any = F.addFormat(doc(), F.PRESETS[3]);
    expect(F.resolveFormat(d, '4x5').base[0].fit).toBe('cover');
    d = F.setFormatField(d, '4x5', ['base'], {fit: 'contain', focus: [0.5, 0.2]});
    expect(F.resolveFormat(d, '4x5').base[0]).toMatchObject({fit: 'contain', focus: [0.5, 0.2]});
  });
  it('clearing the last override removes the entry, removing the last format removes formats', () => {
    let d: any = F.addFormat(doc(), F.PRESETS[2]);
    d = F.setClipOverride(d, '1x1', 'a', 'hidden', true);
    d = F.setClipOverride(d, '1x1', 'a', 'hidden', undefined);
    expect(d.formats['1x1'].clips).toEqual({});
    expect(F.removeFormat(d, '1x1').formats).toBeUndefined();
  });
});
