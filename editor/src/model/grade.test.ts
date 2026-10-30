import {describe, expect, it} from 'vitest';
import {colorMatrix, gradePixel, imageStats, isGraded, matchGrade, mergeGrade, toneCurve} from '../../../reel/src/edit/grade';

describe('grade math', () => {
  it('is the identity when every slider is 0', () => {
    for (const x of [0, 0.25, 0.5, 1]) expect(toneCurve(x, {})).toBeCloseTo(x, 5);
    expect(gradePixel(10, 128, 240, {})).toEqual([10, 128, 240]);
    expect(colorMatrix({}).split(' ').map(Number)).toEqual([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
    expect(isGraded({})).toBe(false);
    expect(isGraded({contrast: 0.2})).toBe(true);
  });
  it('moves pixels the way the sliders say', () => {
    expect(gradePixel(100, 100, 100, {exposure: 1})[0]).toBeGreaterThan(150);
    const warm = gradePixel(128, 128, 128, {temperature: 1});
    expect(warm[0]).toBeGreaterThan(warm[2]);
    const grey = gradePixel(200, 60, 60, {saturation: -1});
    expect(Math.abs(grey[0] - grey[1])).toBeLessThan(2);
    expect(toneCurve(0, {shadows: 1})).toBe(0); // black stays black
    expect(toneCurve(0.3, {shadows: 1})).toBeGreaterThan(0.3);
  });
  it('merges a piece grade over the project grade', () => {
    expect(mergeGrade({contrast: 0.2, saturation: 0.1}, {saturation: -0.5})).toEqual({contrast: 0.2, saturation: -0.5});
    expect(mergeGrade(undefined, {fade: 0.2})).toEqual({fade: 0.2});
  });
  it('matches a darker, desaturated reference by lowering exposure and saturation', () => {
    const px = (r: number, g: number, b: number) => new Uint8ClampedArray(Array.from({length: 64}, () => [r, g, b, 255]).flat());
    const g = matchGrade(imageStats(px(180, 120, 90)), imageStats(px(90, 80, 75)));
    expect(g.exposure!).toBeLessThan(0);
    expect(g.saturation!).toBeLessThan(0);
  });
});
