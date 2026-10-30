import {describe, expect, test} from 'vitest';
import {guideTargets, snapRect} from '../ui/Stage';

const frame = guideTargets(400, 700, [{left: 40, top: 100, width: 120, height: 60}]);

describe('smart guides on the monitor', () => {
  test('a rect whose centre is near the frame centre snaps onto it on both axes', () => {
    const r = {left: 153, top: 323, width: 100, height: 50}; // centre 203, 348 (frame centre 200, 350)
    const s = snapRect(r, frame);
    expect([s.dx, s.dy]).toEqual([-3, 2]);
    expect(s.guides.map(g => `${g.axis}@${g.at}:${g.frame}`).sort()).toEqual(['x@200:true', 'y@350:true']);
  });

  test('edges line up with another layer and the guide spans both', () => {
    const r = {left: 44, top: 400, width: 80, height: 40}; // left 4px right of the other layer's left edge
    const s = snapRect(r, frame);
    expect(s.dx).toBe(-4);
    const g = s.guides.find(g => g.axis === 'x')!;
    expect(g).toMatchObject({at: 40, frame: false, from: 100, to: 440});
  });

  test('nothing within reach: no pull, no lines', () => {
    const s = snapRect({left: 250, top: 500, width: 30, height: 30}, frame);
    expect(s).toEqual({dx: 0, dy: 0, guides: []});
  });

  test('a tie goes to the frame line', () => {
    const t = guideTargets(400, 700, [{left: 190, top: 0, width: 20, height: 20}]); // centre 200 = frame centre
    const s = snapRect({left: 150, top: 300, width: 104, height: 10}, t);
    expect(s.dx).toBe(-2);
    expect(s.guides.find(g => g.axis === 'x')!.frame).toBe(true);
  });
});
