import {describe, expect, it} from 'vitest';
import * as op from './ops';
import {apply, followCss, followMatrix, homographyAt, inv, mul, shapeAtAnchor, sourceToComp, type TrackFile} from '../../../reel/src/edit/tracking';

const doc = (): op.Doc => ({version: 1, settings: {width: 1920, height: 1080, fps: 30, background: '#000', duration: 10},
  base: [{src: 'a.mp4', start: 0, sourceIn: 2, duration: 10, fit: 'cover'}], layout: {mode: 'full', drift: false}, zooms: [], clips: [], transitions: []} as any);

// a surface that slides 10% right per second and doubles in size by 2 s after the anchor
const H = (s: number) => { const k = 1 + Math.max(0, s - 3) / 2, dx = (s - 3) * 0.1; return [k, 0, dx + 0.5 * (1 - k), 0, k, 0.5 * (1 - k), 0, 0]; };
const track: TrackFile = {version: 1, kind: 'plane', src: 'a.mp4', width: 3840, height: 2160, fps: 10, anchor: 3, start: 0, end: 8,
  shape: [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]], frames: Array.from({length: 81}, (_, i) => [i / 10, ...H(i / 10), 1])};

describe('tracking math', () => {
  it('maps source to composition with cover fit', () => {
    const m = sourceToComp(doc() as any, (doc() as any).base[0], 0, 1920, 1080, 3840, 2160);
    expect(apply(m, [0.5, 0.5])).toEqual([960, 540]);
    expect(apply(m, [1, 1])).toEqual([1920, 1080]);
  });
  it('is the identity at the anchor and follows the surface after it', () => {
    const d = doc() as any;
    // the anchor (source 3 s) shows at composition 1 s (sourceIn 2)
    const G0 = followMatrix(d, track, 1, 1920, 1080, {})!;
    expect(apply(G0, [960, 540]).map(v => Math.round(v))).toEqual([960, 540]);
    const G = followMatrix(d, track, 2, 1920, 1080, {})!; // one second later: +10% x, scale 1.5 about the centre
    const [x, y] = apply(G, [960, 540]);
    expect(Math.round(x)).toBe(960 + 192);
    expect(Math.round(y)).toBe(540);
    const [cx] = apply(G, [1060, 540]);
    expect(Math.round(cx - x)).toBe(150);
  });
  it('holds the last good frame where the track was lost', () => {
    const lost = {...track, frames: track.frames.map((r, i) => (i > 50 ? [...r.slice(0, 9), 0] : r))};
    expect(homographyAt(lost, 7)).toEqual(homographyAt(lost, 5));
  });
  it('position mode only moves', () => {
    const G = followMatrix(doc() as any, track, 2, 1920, 1080, {})!;
    expect(followCss(G, 'position', [960, 540])).toBe('translate(192.00px,0.00px)');
  });
  it('places the shape over the anchor frame', () => {
    const pts = shapeAtAnchor(doc() as any, track, 1920, 1080);
    expect(pts[0].map(Math.round)).toEqual([768, 432]);
  });
  it('matrix inverse', () => {
    const m = [2, 0.1, 5, 0.2, 1.5, -3, 0.001, 0, 1];
    const p = mul(m, inv(m));
    p.forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 0, 1, 0, 0, 0, 1][i], 9));
  });
});

describe('tracking ops', () => {
  it('adds a clip that follows a track and stops following', () => {
    const r = op.addTrackedClip(doc(), 'Highlight', 1, 6, {points: []}, {track: 'tracks/t.json', mode: 'perspective'});
    const c = op.clips(r.doc).find(x => x.id === r.id);
    expect(c?.follow).toEqual({track: 'tracks/t.json', mode: 'perspective'});
    expect([c?.from, c?.to]).toEqual([1, 6]);
    const off = op.setFollow(r.doc, r.id, null);
    expect(op.clips(off).find(x => x.id === r.id)?.follow).toBeUndefined();
  });
  it('turns stabilization on and off', () => {
    const on = op.setStabilize(doc(), 0, {track: 'tracks/s.json', level: 'normal'});
    expect(on.base[0].stabilize).toEqual({track: 'tracks/s.json', level: 'normal'});
    expect(op.setStabilize(on, 0, null).base[0].stabilize).toBeUndefined();
  });
});
