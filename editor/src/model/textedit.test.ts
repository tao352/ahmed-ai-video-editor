import {describe, expect, it} from 'vitest';
import {findTextTarget} from './textedit';

const doc = () => ({
  settings: {width: 1080, height: 1920, fps: 30, duration: 10},
  captions: {words: [[1, 1.4, 'إنت'], [1.4, 1.8, 'لسه']], style: {}},
  clips: [{id: 'card', component: 'PaperNote', from: 0, to: 5, props: {eyebrow: 'MYTH CHECK', lines: [{text: 'عروق بارزة طول الوقت', at: 1}], img: 'gen/a.png'}}],
});

describe('findTextTarget', () => {
  it('edits a caption word under the playhead', () => {
    const t = findTextTarget(doc(), '__captions', 'لسه', 1.5)!;
    expect(t.apply(doc(), 'لسّه').captions.words[1][2]).toBe('لسّه');
  });
  it('edits an exact prop deep in the props', () => {
    const t = findTextTarget(doc(), 'card', 'MYTH CHECK', 1)!;
    expect(t.current).toBe('MYTH CHECK');
    expect(t.apply(doc(), 'FACT').clips[0].props.eyebrow).toBe('FACT');
  });
  it('replaces one word when an animation splits a prop into spans', () => {
    const t = findTextTarget(doc(), 'card', 'بارزة', 1)!;
    const n = t.apply(doc(), 'ظاهرة');
    expect(n.clips[0].props.lines[0]).toEqual({text: 'عروق ظاهرة طول الوقت', at: 1});
    expect(n.clips[0].props.img).toBe('gen/a.png');
  });
  it('writes a default the clip did not override yet', () => {
    const t = findTextTarget(doc(), 'card', 'تابع', 1, {cta: 'تابع'})!;
    expect(t.apply(doc(), 'اشترك').clips[0].props.cta).toBe('اشترك');
  });
  it('returns null for text it cannot trace', () => {
    expect(findTextTarget(doc(), 'card', '02', 1)).toBeNull();
  });
});
