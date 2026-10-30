import {describe, expect, it} from 'vitest';
import {animAt, animSchema, edgeFilters, maskCss} from '../../../reel/src/edit/clipfx';

describe('clip fx', () => {
  it('animates in and out and rests in between', () => {
    const a = {in: 'fade' as const, out: 'slide-up' as const, inDur: 0.4, outDur: 0.4, loopSpeed: 1};
    expect(animAt(a, 0, 3).opacity).toBe(0);
    expect(animAt(a, 1.5, 3)).toEqual({tx: 0, ty: 0, scale: 1, rotate: 0, opacity: 1, blur: 0});
    expect(animAt(a, 3, 3).ty).toBeCloseTo(14);
    expect(animAt(undefined, 1, 3).opacity).toBe(1);
  });
  it('never lets in + out overlap on short clips', () => {
    const m = animAt({in: 'pop', out: 'pop', inDur: 1, outDur: 1, loopSpeed: 1}, 0.25, 0.5);
    expect(m.scale).toBeGreaterThan(0.9);
  });
  it('builds drop-shadow chains for outline, glow and shadow', () => {
    expect(edgeFilters({outline: {color: '#fff', width: 4}})).toHaveLength(4);
    expect(edgeFilters({glow: {color: '#07BFF1', size: 20}, shadow: {color: '#000000', blur: 10, y: 5, opacity: 0.5}})).toEqual([
      'drop-shadow(0 0 10px #07BFF1)', 'drop-shadow(0 0 20px #07BFF1)', 'drop-shadow(0 5px 10px rgba(0,0,0,0.5))',
    ]);
    expect(edgeFilters(undefined)).toEqual([]);
  });
  it('draws the mask shape as an SVG data url', () => {
    const css = decodeURIComponent(maskCss({shape: 'circle', x: 0.5, y: 0.5, w: 0.4, h: 0.4, rotate: 0, feather: 0, radius: 0, invert: true}, 1080, 1920));
    expect(css).toContain('<ellipse');
    expect(css).toContain('fill="black" filter'); // inverted: shape cuts a hole
  });
});

import {chromaMatrix} from '../../../reel/src/edit/clipfx';
describe('chroma key matrix', () => {
  const alpha = (m: string, [r, g, b]: number[]) => { const v = m.split(' ').map(Number); return Math.max(0, Math.min(1, v[15] * r + v[16] * g + v[17] * b + v[19])); };
  it('clears green screen and keeps skin', () => {
    const m = chromaMatrix({key: 'green'});
    expect(alpha(m, [0.1, 0.8, 0.15])).toBe(0);
    expect(alpha(m, [0.8, 0.6, 0.5])).toBe(1);
  });
  it('can key blue instead', () => {
    const m = chromaMatrix({key: 'blue'});
    expect(alpha(m, [0.1, 0.2, 0.9])).toBe(0);
    expect(alpha(m, [0.1, 0.8, 0.15])).toBe(1);
  });
});

describe('text animations live in clip.anim but play inside Text', () => {
  it('the clip layer leaves text-only animations alone', () => {
    expect(animAt({in: 'typewriter', inDur: 0.8, outDur: 0.3, loopSpeed: 1} as any, 0.1, 3)).toEqual({tx: 0, ty: 0, scale: 1, rotate: 0, opacity: 1, blur: 0});
    expect(animAt({loop: 'wave', inDur: 0.35, outDur: 0.3, loopSpeed: 1} as any, 1, 3)).toEqual({tx: 0, ty: 0, scale: 1, rotate: 0, opacity: 1, blur: 0});
  });
  it('the new clip entrances start hidden and settle', () => {
    for (const name of ['rise', 'swing', 'bounce', 'rotate']) {
      expect(animAt({in: name, inDur: 0.5, outDur: 0.3, loopSpeed: 1} as any, 0, 3).opacity).toBeLessThan(0.05);
      expect(animAt({in: name, inDur: 0.5, outDur: 0.3, loopSpeed: 1} as any, 1, 3)).toEqual({tx: 0, ty: 0, scale: 1, rotate: 0, opacity: 1, blur: 0});
    }
  });
  it('the schema accepts text names in the same fields', () => {
    expect(animSchema.safeParse({in: 'word-pop', out: 'wipe', loop: 'jelly'}).success).toBe(true);
  });
});
