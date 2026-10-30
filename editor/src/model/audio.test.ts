import {describe, expect, it} from 'vitest';
import {duckGain, fadeGain, speechAmount} from '../../../reel/src/edit/audioMix';
import * as op from './ops';

const words: [number, number, string][] = [[1, 1.5, 'a'], [3, 3.4, 'b']];

describe('audio mix', () => {
  it('fades in and out linearly', () => {
    expect(fadeGain(0, 0, 10, 2, 0)).toBe(0);
    expect(fadeGain(1, 0, 10, 2, 0)).toBe(0.5);
    expect(fadeGain(5, 0, 10, 2, 2)).toBe(1);
    expect(fadeGain(9, 0, 10, 0, 2)).toBe(0.5);
  });
  it('ducks fully inside speech and eases around it', () => {
    expect(speechAmount(1.2, words)).toBe(1);
    expect(speechAmount(0.96, words, 0.08, 0.35)).toBeCloseTo(0.5);
    expect(speechAmount(1.5 + 0.35 / 2, words, 0.08, 0.35)).toBeCloseTo(0.5);
    expect(speechAmount(2.5, words)).toBe(0);
    expect(duckGain(1.2, words, {db: 20, attack: 0.08, release: 0.35})).toBeCloseTo(0.1);
    expect(duckGain(2.5, words, {db: 20, attack: 0.08, release: 0.35})).toBe(1);
  });
});

describe('setFade', () => {
  const doc = {settings: {duration: 20}, audio: {music: {src: 'm.mp3', volume: 0.3}, sfx: [{at: 2, file: 'w.mp3', duration: 1}]}};
  it('writes fadeIn / fadeOut and caps them at the sound length', () => {
    let d = op.setFade(doc, {kind: 'sfx', index: 0}, 'start', 0.3);
    expect(d.audio.sfx[0].fadeIn).toBe(0.3);
    d = op.setFade(d, {kind: 'sfx', index: 0}, 'end', 5);
    expect(d.audio.sfx[0].fadeOut).toBe(0.7);
    d = op.setFade(d, {kind: 'sfx', index: 0}, 'start', -1);
    expect('fadeIn' in d.audio.sfx[0]).toBe(false);
    expect(op.setFade(doc, {kind: 'music'}, 'end', 3).audio.music.fadeOut).toBe(3);
  });
});
