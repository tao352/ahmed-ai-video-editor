import {describe, expect, it} from 'vitest';
import {share} from './share';

describe('share', () => {
  it('keeps untouched subtrees and replaces changed ones', () => {
    const prev = {clips: [{id: 'a', from: 1}, {id: 'b', from: 2}], audio: {music: {src: 'm.mp3'}}};
    const next = structuredClone(prev);
    next.clips[1].from = 3;
    const out = share(prev, next);
    expect(out).not.toBe(prev);
    expect(out.audio).toBe(prev.audio);
    expect(out.clips[0]).toBe(prev.clips[0]);
    expect(out.clips[1]).not.toBe(prev.clips[1]);
    expect(out).toEqual(next);
  });

  it('returns prev when nothing changed', () => {
    const prev = {a: [1, 2, {b: 'x'}]};
    expect(share(prev, structuredClone(prev))).toBe(prev);
  });

  it('notices added, removed and retyped keys', () => {
    const prev: Record<string, unknown> = {a: 1, b: [1]};
    expect(share(prev, {a: 1})).toEqual({a: 1});
    expect(share(prev, {a: 1, b: [1], c: 2})).toEqual({a: 1, b: [1], c: 2});
    expect(share(prev, {a: 1, b: {0: 1}})).toEqual({a: 1, b: {0: 1}});
    expect(share({a: [1, 2]}, {a: [1]})).toEqual({a: [1]});
  });
});
