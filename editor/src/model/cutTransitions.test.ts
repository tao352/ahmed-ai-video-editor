import {describe, expect, it} from 'vitest';
import {CUT_TRANSITIONS, cutOverlay, cutStyle, footageCuts} from '../../../reel/src/edit/cutTransitions';

describe('footage cut transitions', () => {
  it('ties a transition to the cut inside its window, with the pieces it joins', () => {
    const pieces = [{start: 4, end: 7}, {start: 0, end: 4}];
    expect(footageCuts(pieces, [{at: 3.75, type: 'mix', duration: 0.5}])).toEqual([{at: 3.75, type: 'mix', duration: 0.5, cut: 4, out: 1, in: 0}]);
    expect(footageCuts(pieces, [{at: 1, type: 'mix', duration: 0.5}, {at: 3.75, type: 'glitchy-old', duration: 0.5}])).toEqual([]);
  });
  it('every transition ends on the incoming shot alone, fully visible and still', () => {
    for (const [type] of CUT_TRANSITIONS) {
      expect(cutStyle(type, 1, 'in'), type).toEqual({});
      const o = cutOverlay(type, 1);
      if (o) expect(Number(o.opacity), type).toBeLessThan(0.01);
    }
  });
  it('starts on the outgoing shot', () => {
    for (const [type] of CUT_TRANSITIONS) {
      expect(cutStyle(type, 0, 'out').opacity ?? 1, type).toBe(1);
      const into = cutStyle(type, 0, 'in');
      const hidden = into.opacity === 0 || /circle\(0/.test(String(into.clipPath)) || /translate\((-?100|0)%/.test(String(into.transform)) || /transparent/.test(String(into.maskImage)) || /rotateY\(90deg\)/.test(String(into.transform)) || type === 'pull-out';
      expect(hidden, type).toBe(true);
    }
  });
});
