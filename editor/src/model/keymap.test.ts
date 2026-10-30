import {describe, expect, it, vi} from 'vitest';

vi.mock('../ui/Guides', () => ({toggleGuides: () => {}}));
const {SHORTCUTS, matches} = await import('../ui/keymap');

// A key press that the spec asks for, with shift picked when the spec leaves it open.
function presses(spec: (typeof SHORTCUTS)[number]['spec']) {
  const shifts = spec.shift === undefined ? [false, true] : [spec.shift];
  const keys = spec.code ? [{code: spec.code, key: ''}] : (spec.key ?? []).map(key => ({code: '', key}));
  return shifts.flatMap(shiftKey => keys.map(k => ({...k, shiftKey, ctrlKey: Boolean(spec.ctrl), altKey: Boolean(spec.alt), metaKey: false})));
}

describe('keymap', () => {
  it('answers every key press with exactly one shortcut', () => {
    for (const s of SHORTCUTS) {
      for (const e of presses(s.spec)) {
        const hits = SHORTCUTS.filter(o => matches(o.spec, e));
        expect(hits.map(h => h.keys || h.label), JSON.stringify(e)).toHaveLength(1);
      }
    }
  });

  it('labels every shortcut that shows a key', () => {
    for (const s of SHORTCUTS) if (s.keys) expect(s.label).not.toBe('');
  });
});
