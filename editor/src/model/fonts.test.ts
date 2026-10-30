import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fontDirs, listFonts, readFontFile} from '../../server/fonts';

const arial = path.join(fontDirs()[0], 'arial.ttf');

describe('system fonts', () => {
  it('reads the family and style from a font file', () => {
    if (!fs.existsSync(arial)) return; // not a Windows machine
    expect(readFontFile(fs.readFileSync(arial))).toEqual([{family: 'Arial', style: 'Regular', arabic: true}]);
  });
  it('lists every family once, sorted', () => {
    const fams = listFonts();
    expect(new Set(fams.map(f => f.family)).size).toBe(fams.length);
    expect(fams.map(f => f.family)).toEqual([...fams.map(f => f.family)].sort((a, b) => a.localeCompare(b)));
  });
  it('ignores files that are not fonts', () => {
    expect(readFontFile(Buffer.from('not a font at all'))).toEqual([]);
  });
});
