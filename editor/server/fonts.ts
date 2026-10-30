// The fonts installed on this machine, for the text font picker (CapCut lists the system fonts too).
// Reads each font file's own 'name' table, so the family is exactly what CSS and the render's
// Chrome use. The editor and the render run on the same machine, so every listed font renders.
import fs from 'node:fs';
import path from 'node:path';

export type FontFamily = {family: string; styles: string[]; arabic: boolean};

const UTF16 = new TextDecoder('utf-16be');
const LATIN1 = new TextDecoder('latin1');

/** Family, style and Arabic coverage of one font inside a font file (sfnt at `at`). */
function readFace(buf: Buffer, at: number): {family: string; style: string; arabic: boolean} | null {
  const tables = buf.readUInt16BE(at + 4);
  let name = -1, os2 = -1;
  for (let i = 0; i < tables; i++) {
    const rec = at + 12 + i * 16;
    const tag = buf.toString('latin1', rec, rec + 4);
    if (tag === 'name') name = buf.readUInt32BE(rec + 8);
    if (tag === 'OS/2') os2 = buf.readUInt32BE(rec + 8);
  }
  if (name < 0) return null;
  const count = buf.readUInt16BE(name + 2), strings = name + buf.readUInt16BE(name + 4);
  const found: Record<number, {score: number; text: string}> = {};
  for (let i = 0; i < count; i++) {
    const r = name + 6 + i * 12;
    const platform = buf.readUInt16BE(r), enc = buf.readUInt16BE(r + 2), lang = buf.readUInt16BE(r + 4), id = buf.readUInt16BE(r + 6);
    if (![1, 2, 16, 17].includes(id)) continue;
    const len = buf.readUInt16BE(r + 8), off = strings + buf.readUInt16BE(r + 10);
    if (off + len > buf.length) continue;
    // English Windows names first, then any Windows name, then Mac Roman
    const score = platform === 3 && lang === 0x409 ? 3 : platform === 3 ? 2 : platform === 1 && enc === 0 ? 1 : 0;
    if (!score || (found[id]?.score ?? 0) >= score) continue;
    const bytes = buf.subarray(off, off + len);
    found[id] = {score, text: (platform === 3 ? UTF16.decode(bytes) : LATIN1.decode(bytes)).trim()};
  }
  // the classic family (name 1) is what Windows apps and CSS list: "Arial Black", not "Arial" + Black
  const family = found[1]?.text || found[16]?.text;
  if (!family) return null;
  // OS/2 ulUnicodeRange1 bit 13 = Arabic
  const arabic = os2 > 0 && os2 + 46 <= buf.length ? (buf.readUInt32BE(os2 + 42) & (1 << 13)) !== 0 : false;
  return {family, style: found[2]?.text || found[17]?.text || 'Regular', arabic};
}

/** Every face in a .ttf / .otf / .ttc file (a collection holds several). */
export function readFontFile(buf: Buffer): {family: string; style: string; arabic: boolean}[] {
  if (buf.length < 12) return [];
  const tag = buf.toString('latin1', 0, 4);
  const starts = tag === 'ttcf' ? Array.from({length: buf.readUInt32BE(8)}, (_, i) => buf.readUInt32BE(12 + i * 4)) : [0];
  const out = [];
  for (const s of starts) {
    try { const f = readFace(buf, s); if (f) out.push(f); } catch { /* a broken face is skipped */ }
  }
  return out;
}

const FONT_EXT = new Set(['.ttf', '.otf', '.ttc']);
export function fontDirs(): string[] {
  const win = process.env.WINDIR ?? 'C:\\Windows';
  const local = process.env.LOCALAPPDATA;
  return [path.join(win, 'Fonts'), ...(local ? [path.join(local, 'Microsoft', 'Windows', 'Fonts')] : []), '/usr/share/fonts', '/Library/Fonts'];
}

let cache: FontFamily[] | null = null;
/** All font families on the machine, sorted by name; read once per server run. */
export function listFonts(dirs?: string[]): FontFamily[] {
  if (!dirs && cache) return cache;
  const fams = new Map<string, FontFamily>();
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3) walk(abs, depth + 1);
      else if (FONT_EXT.has(path.extname(e.name).toLowerCase())) {
        let faces: ReturnType<typeof readFontFile> = [];
        try { faces = readFontFile(fs.readFileSync(abs)); } catch { continue; }
        for (const f of faces) {
          if (f.family.startsWith('.')) continue; // hidden system faces
          const cur = fams.get(f.family) ?? {family: f.family, styles: [], arabic: false};
          if (!cur.styles.includes(f.style)) cur.styles.push(f.style);
          cur.arabic ||= f.arabic;
          fams.set(f.family, cur);
        }
      }
    }
  };
  for (const d of dirs ?? fontDirs()) walk(d, 0);
  const list = [...fams.values()].sort((a, b) => a.family.localeCompare(b.family));
  if (!dirs) cache = list;
  return list;
}
