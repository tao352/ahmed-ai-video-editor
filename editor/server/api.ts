// Dev-server API for the Studio Editor. Everything works on files under projects/:
// edit.json is the single source of truth that Claude and the editor both write.
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync, type ChildProcess} from 'node:child_process';
import type {IncomingMessage, ServerResponse} from 'node:http';
import type {Plugin} from 'vite';
import {MAIN, resolveFormat} from '../src/model/formats';

import {listFonts} from './fonts';
export const ROOT = path.resolve(import.meta.dirname, '../..');
export const PROJECTS = path.join(ROOT, 'projects');
const RENDER_SCRIPT = path.join(ROOT, 'reel', 'scripts', 'render_edit.mjs');
const SKIP_DIRS = new Set(['node_modules', 'history', 'out', 'cache', 'public', 'source', 'transcripts', 'verify', 'storyboard', 'work', 'saved']);

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.m4v': 'video/mp4', '.mkv': 'video/x-matroska', '.flac': 'audio/flac',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8', '.srt': 'text/plain; charset=utf-8',
};

// ---------- paths ----------

/** Resolve a path relative to projects/, refusing anything that escapes it. */
export function insideProjects(rel: string): string {
  const abs = path.resolve(PROJECTS, rel);
  if (abs !== PROJECTS && !abs.startsWith(PROJECTS + path.sep)) throw new HttpError(400, 'path outside projects/');
  return abs;
}

function editPath(id: string | null): string {
  if (!id || !id.endsWith('edit.json')) throw new HttpError(400, 'id must point at an edit.json');
  const abs = insideProjects(id);
  if (!fs.existsSync(abs)) throw new HttpError(404, 'edit.json not found');
  return abs;
}

class HttpError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
}

// ---------- edit.json io ----------

export type EditFile = {data: Record<string, any>; rev: number; updatedBy: string | null; mtime: number};

export function readEdit(abs: string): EditFile {
  const text = fs.readFileSync(abs, 'utf8').replace(/^﻿/, '');
  const data = JSON.parse(text);
  return {data, rev: Number(data?.meta?.rev ?? 0), updatedBy: data?.meta?.updatedBy ?? null, mtime: fs.statSync(abs).mtimeMs};
}

/** Match the file's own indent (projects use 1 space, examples 2) so diffs stay readable. */
function detectIndent(abs: string): number {
  const m = /\n( +)"/.exec(fs.readFileSync(abs, 'utf8'));
  return m ? m[1].length : 1;
}

export function writeEdit(abs: string, data: Record<string, any>, baseRev: number, by = 'human'): number {
  const current = readEdit(abs);
  if (current.rev !== baseRev) throw new HttpError(409, 'rev conflict', current);
  const rev = baseRev + 1;
  data.meta = {...(data.meta ?? {}), rev, updatedBy: by, updatedAt: new Date().toISOString()};
  const text = JSON.stringify(data, null, detectIndent(abs)) + '\n';
  const tmp = abs + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, abs);
  const history = path.join(path.dirname(abs), 'history');
  fs.mkdirSync(history, {recursive: true});
  fs.writeFileSync(path.join(history, `${path.basename(abs, '.json')}.${rev}.json`), text, 'utf8');
  return rev;
}

// ---------- project listing ----------

export type ProjectInfo = {id: string; name: string; width: number; height: number; duration: number; rev: number; mtime: number};

export function listProjects(): ProjectInfo[] {
  const out: ProjectInfo[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(path.join(dir, entry.name), depth + 1);
      } else if (entry.name === 'edit.json') {
        const abs = path.join(dir, entry.name);
        try {
          const {data, rev, mtime} = readEdit(abs);
          const id = path.relative(PROJECTS, abs).split(path.sep).join('/');
          const s = data.settings ?? {};
          out.push({id, name: id.replace(/\/(edit\/)?edit\.json$/, ''), width: s.width, height: s.height, duration: s.duration, rev, mtime});
        } catch { /* unreadable json: not a project */ }
      }
    }
  };
  walk(PROJECTS, 0);
  return out.sort((a, b) => b.mtime - a.mtime);
}

// Media requests arrive many times per second while scrubbing; cache the directory list briefly.
let dirCache: {at: number; dirs: string[]} = {at: 0, dirs: []};
function projectDirs(): string[] {
  if (Date.now() - dirCache.at > 5000) dirCache = {at: Date.now(), dirs: listProjects().map(x => path.posix.dirname(x.id))};
  return dirCache.dirs;
}

// ---------- http helpers ----------

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'invalid JSON body'); }
}

/** Serve a file with HTTP Range support so video can seek. */
function serveFile(req: IncomingMessage, res: ServerResponse, abs: string) {
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new HttpError(404, 'file not found');
  const size = fs.statSync(abs).size;
  res.setHeader('Content-Type', MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache');
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (range) {
    let start = range[1] ? Number(range[1]) : 0;
    let end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (!range[1] && range[2]) { start = Math.max(0, size - Number(range[2])); end = size - 1; }
    if (start >= size || start > end) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${size}`); res.end(); return; }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(abs, {start, end}).pipe(res);
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Length', String(size));
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(abs).pipe(res);
}

// ---------- live file watching (SSE) ----------

type Watch = {clients: Set<ServerResponse>; watcher: fs.FSWatcher; timer?: NodeJS.Timeout; lastMtime: number};
const watches = new Map<string, Watch>();

function subscribe(abs: string, res: ServerResponse) {
  let w = watches.get(abs);
  if (!w) {
    // Watch the directory: editors and scripts often replace the file, which kills a file watcher.
    const watcher = fs.watch(path.dirname(abs), (_event, name) => {
      if (name && name.toString() !== path.basename(abs)) return;
      const cur = watches.get(abs);
      if (!cur) return;
      clearTimeout(cur.timer);
      cur.timer = setTimeout(() => {
        try {
          const file = readEdit(abs);
          if (file.mtime === cur.lastMtime) return;
          cur.lastMtime = file.mtime;
          const msg = `data: ${JSON.stringify({rev: file.rev, updatedBy: file.updatedBy, mtime: file.mtime})}\n\n`;
          for (const client of cur.clients) client.write(msg);
        } catch { /* mid-write or invalid json: the next event will retry */ }
      }, 150);
    });
    w = {clients: new Set(), watcher, lastMtime: fs.statSync(abs).mtimeMs};
    watches.set(abs, w);
  }
  w.clients.add(res);
  res.on('close', () => {
    w!.clients.delete(res);
    if (!w!.clients.size) { w!.watcher.close(); watches.delete(abs); }
  });
}

// ---------- render jobs ----------

type RenderJob = {id: string; status: 'running' | 'done' | 'error'; progress: number; output: string; log: string[]; startedAt: number; proc?: ChildProcess};
let job: RenderJob | null = null;

function startRender(id: string, quality: string, format = MAIN): RenderJob {
  if (job?.status === 'running') throw new HttpError(409, 'a render is already running');
  const master = editPath(id);
  // Another format renders from a resolved copy next to edit.json, so public/ stays the media folder.
  let abs = master;
  if (format !== MAIN) {
    const {data} = readEdit(master);
    if (!data.formats?.[format]) throw new HttpError(400, `no format ${format}`);
    abs = path.join(path.dirname(master), `.render-${format}.json`);
    fs.writeFileSync(abs, JSON.stringify(resolveFormat(data, format)), 'utf8');
  }
  const outDir = path.join(path.dirname(abs), 'out');
  fs.mkdirSync(outDir, {recursive: true});
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const output = path.join(outDir, `editor-${format === MAIN ? '' : `${format}-`}${quality}-${stamp}.mp4`);
  const args = [RENDER_SCRIPT, abs, output, '--progress'];
  if (quality === 'preview') args.push('--scale', '0.5');
  const proc = spawn(process.execPath, args, {cwd: path.join(ROOT, 'reel'), windowsHide: true});
  const current: RenderJob = {id, status: 'running', progress: 0, output, log: [], startedAt: Date.now(), proc};
  const onData = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const m = /^progress ([\d.]+)/.exec(line);
      if (m) current.progress = Number(m[1]);
      else current.log = [...current.log, line].slice(-40);
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('close', (code) => {
    current.status = code === 0 && fs.existsSync(output) ? 'done' : 'error';
    if (current.status === 'done') current.progress = 1;
    delete current.proc;
  });
  job = current;
  return current;
}

// ---------- media tools (tools/edit/editor_tools.py) ----------

const TOOLS_SCRIPT = path.join(ROOT, 'tools', 'edit', 'editor_tools.py');
const TOOL_ARGS: Record<string, (b: any) => string[]> = {
  lut: b => [String(b.video), String(b.cube)],
  voice: b => [String(b.audio), '--preset', ['light', 'pro', 'strong'].includes(b.preset) ? b.preset : 'pro'],
  loudness: b => [String(b.audio)],
  beats: b => [String(b.music)],
  reverse: b => [String(b.video), '--from', String(Number(b.from)), '--to', String(Number(b.to))],
  audio: b => [String(b.video), '--from', String(Number(b.from)), '--to', String(Number(b.to))],
};
// tracking and stabilization (tools/track/track.py): points are fractions of the source frame
const TRACK_SCRIPT = path.join(ROOT, 'tools', 'track', 'track.py');
const nums = (v: unknown) => (Array.isArray(v) ? v.flat(2) : []).map(Number).filter(Number.isFinite).map(n => n.toFixed(5)).join(',');
const span = (b: any) => [...(b.from != null ? ['--from', String(Number(b.from))] : []), ...(b.to != null ? ['--to', String(Number(b.to))] : [])];
const out = (b: any) => ['--out', `tracks/${String(b.name ?? 'track').replace(/[^\w.-]+/g, '-')}-${Date.now().toString(36)}.json`, '--preview'];
const TRACK_ARGS: Record<string, (b: any) => string[]> = {
  'track-segment': b => ['segment', String(b.video), '--at', String(Number(b.at)), ...(b.box ? ['--box', nums(b.box)] : ['--point', nums(b.point)])],
  'track-plane': b => ['plane', String(b.video), '--at', String(Number(b.at)), '--shape', nums(b.shape), ...span(b), ...out(b)],
  'track-object': b => ['object', String(b.video), '--at', String(Number(b.at)), '--box', nums(b.box), ...(b.rotate ? ['--rotate'] : []), ...span(b), ...out(b)],
  'track-face': b => ['face', String(b.video), ...(b.at != null ? ['--at', String(Number(b.at))] : []), ...(b.point ? ['--point', nums(b.point)] : []), ...span(b), ...out(b)],
  'track-stabilize': b => ['stabilize', String(b.video), '--strength', String(Math.max(0, Math.min(1, Number(b.strength ?? 0.6)))), ...(b.lock ? ['--lock', String(b.lock)] : []), ...span(b), '--out', `tracks/stab-${Date.now().toString(36)}.json`],
};
type ToolJob = {id: string; tool: string; status: 'running' | 'done' | 'error'; log: string[]; result: unknown; startedAt: number; progress: number; proc?: ChildProcess};
let toolJob: ToolJob | null = null;

function startTool(id: string, tool: string, body: any): ToolJob {
  if (toolJob?.status === 'running') throw new HttpError(409, `a ${toolJob.tool} job is already running`);
  const make = TOOL_ARGS[tool], track = TRACK_ARGS[tool];
  if (!make && !track) throw new HttpError(400, `unknown tool ${tool}`);
  const pub = path.join(path.dirname(editPath(id)), 'public');
  const args = track ? (([cmd, ...rest]) => [TRACK_SCRIPT, cmd, pub, ...rest])(track(body)) : [TOOLS_SCRIPT, tool, pub, ...make(body)];
  const proc = spawn('python', ['-I', ...args], {cwd: ROOT, windowsHide: true});
  const current: ToolJob = {id, tool, status: 'running', log: [], result: null, startedAt: Date.now(), progress: 0, proc};
  const onData = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (line.startsWith('RESULT ')) { try { current.result = JSON.parse(line.slice(7)); } catch { /* keep as log */ } }
      else if (line.startsWith('PROGRESS ')) current.progress = Number(line.split(' ')[1]) || current.progress;
      else current.log = [...current.log, line].slice(-30);
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('close', code => { current.status = code === 0 && current.result ? 'done' : 'error'; });
  toolJob = current;
  return current;
}

/** Track files of a project (public/tracks/*.json), without their per-frame data. */
function listTracks(id: string) {
  const dir = path.join(path.dirname(editPath(id)), 'public', 'tracks');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const conf = (t.frames ?? []).map((r: number[]) => r[9] ?? 1);
      const preview = f.replace(/\.json$/, '.preview.mp4');
      return {file: `tracks/${f}`, kind: t.kind, src: t.src, anchor: t.anchor, start: t.start, end: t.end, shape: t.shape, width: t.width, height: t.height,
        zoom: t.zoom, meanConf: conf.length ? conf.reduce((a: number, b: number) => a + b, 0) / conf.length : 0,
        preview: fs.existsSync(path.join(dir, preview)) ? `tracks/${preview}` : undefined, mtime: fs.statSync(path.join(dir, f)).mtimeMs};
    } catch { return null; }
  }).filter(Boolean).sort((a: any, b: any) => b.mtime - a.mtime);
}

// ---------- preview proxies (public/.proxy/, made by editor_tools.py proxy) ----------
// Like CapCut's proxy media: half-size copies with a keyframe every 10 frames, so the live preview
// plays and seeks smoothly. One ffmpeg at a time, in the background, separate from the tool job.

const proxyRel = (src: string) => `.proxy/${src.replace(/[\\/]/g, '__')}.${/\.webm$/i.test(src) ? 'webm' : 'mp4'}`;
const proxyQueue: {pub: string; src: string; cmd: 'proxy' | 'thumbs'}[] = [];
const proxyFailed = new Set<string>();
let proxyBusy = false;

const thumbsRel = (src: string) => proxyRel(src).replace(/\.(mp4|webm)$/, '.thumbs.json');
function fresh(pub: string, src: string, made: string): boolean {
  try { return fs.statSync(path.join(pub, made)).mtimeMs >= fs.statSync(path.join(pub, src)).mtimeMs; } catch { return false; }
}

function pumpProxies() {
  if (proxyBusy || !proxyQueue.length) return;
  const {pub, src, cmd} = proxyQueue.shift()!;
  proxyBusy = true;
  const proc = spawn('python', ['-I', TOOLS_SCRIPT, cmd, pub, src], {cwd: ROOT, windowsHide: true, stdio: 'ignore'});
  proc.on('close', code => {
    proxyBusy = false;
    if (code !== 0) proxyFailed.add(`${cmd}:${path.join(pub, src)}`);
    pumpProxies();
  });
}

/** Proxies (and timeline filmstrips) that are ready for this project's videos; queues the missing ones. */
function proxiesFor(id: string): {ready: Record<string, string>; thumbs: Record<string, unknown>; pending: number} {
  const pub = path.join(path.dirname(editPath(id)), 'public');
  const doc = readEdit(editPath(id)).data as {base?: {src?: string; matte?: string}[]};
  const footage = new Set((doc.base ?? []).map(b => b.src).filter((v): v is string => typeof v === 'string'));
  const videos = [...new Set((doc.base ?? []).flatMap(b => [b.src, b.matte]).filter((v): v is string => typeof v === 'string'))];
  const ready: Record<string, string> = {};
  const thumbs: Record<string, unknown> = {};
  let pending = 0;
  const want = (src: string, cmd: 'proxy' | 'thumbs') => {
    if (proxyFailed.has(`${cmd}:${path.join(pub, src)}`)) return;
    pending++;
    if (!proxyQueue.some(q => q.pub === pub && q.src === src && q.cmd === cmd)) proxyQueue.push({pub, src, cmd});
  };
  for (const src of videos) {
    if (!fs.existsSync(path.join(pub, src))) continue;
    if (fresh(pub, src, proxyRel(src))) ready[src] = proxyRel(src); else want(src, 'proxy');
    if (!footage.has(src)) continue;
    if (fresh(pub, src, thumbsRel(src))) { try { thumbs[src] = JSON.parse(fs.readFileSync(path.join(pub, thumbsRel(src)), 'utf8')); } catch { /* being written */ } }
    else want(src, 'thumbs');
  }
  pumpProxies();
  return {ready, thumbs, pending};
}

// ---------- user presets (editor/user/presets/<kind>.json) ----------

const PRESET_KINDS = new Set(['grades', 'anims', 'styles', 'clips']);
const presetFile = (kind: string) => {
  if (!PRESET_KINDS.has(kind)) throw new HttpError(400, `unknown preset kind ${kind}`);
  return path.join(ROOT, 'editor', 'user', 'presets', `${kind}.json`);
};
function readPresets(kind: string): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(presetFile(kind), 'utf8')); } catch { return {}; }
}

const publicJob = (j: RenderJob | null) => j && {id: j.id, status: j.status, progress: j.progress, output: path.relative(PROJECTS, j.output).split(path.sep).join('/'), log: j.log.slice(-8), startedAt: j.startedAt};

function localStamp(): string {
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- router ----------

// ---------- media the owner brings in (CapCut's Import) ----------
// Files land in the project's public/media/<videos|images|audio>/, so staticFile('media/...') finds
// them in the preview and in the render alike.

export type MediaKind = 'video' | 'image' | 'audio';
const KINDS: Record<string, MediaKind> = {
  '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.m4v': 'video', '.mkv': 'video',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.svg': 'image',
  '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.aac': 'audio', '.ogg': 'audio', '.flac': 'audio',
};
export const mediaKind = (name: string): MediaKind | null => KINDS[path.extname(name).toLowerCase()] ?? null;
const FOLDER: Record<MediaKind, string> = {video: 'videos', image: 'images', audio: 'audio'};

/** A file name that is safe on disk and in a URL, keeping its extension. */
export function safeName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').normalize('NFC');
  const ext = path.extname(base).toLowerCase();
  // ASCII only: names travel in URLs (staticFile) and through ffmpeg; an all-Arabic name becomes file-<time>
  const stem = base.slice(0, base.length - ext.length).replace(/[^\w.]+/g, '-').replace(/-+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 80) || `file-${Date.now().toString(36)}`;
  return stem + ext;
}

export type MediaInfo = {path: string; kind: MediaKind; size: number; duration?: number; width?: number; height?: number};
const probeCache = new Map<string, {mtime: number; info: Partial<MediaInfo>}>();
function probe(abs: string, kind: MediaKind): Partial<MediaInfo> {
  if (kind === 'image') return {};
  const mtime = fs.statSync(abs).mtimeMs;
  const hit = probeCache.get(abs);
  if (hit && hit.mtime === mtime) return hit.info;
  let info: Partial<MediaInfo> = {};
  try {
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_type', '-of', 'json', abs], {encoding: 'utf8', windowsHide: true, timeout: 15000});
    const j = JSON.parse(r.stdout || '{}');
    const v = (j.streams ?? []).find((x: any) => x.codec_type === 'video');
    info = {duration: Number(j.format?.duration) || undefined, width: v?.width, height: v?.height};
  } catch { /* no ffprobe: durations stay unknown */ }
  probeCache.set(abs, {mtime, info});
  return info;
}

function publicDir(id: string): string { return path.join(path.dirname(editPath(id)), 'public'); }

/** Every video, image and sound in the project's public/ (outside dot folders), newest first. */
export function listMedia(id: string): MediaInfo[] {
  const pub = publicDir(id);
  const out: (MediaInfo & {mtime: number})[] = [];
  const walk = (dir: string, depth: number) => {
    let names: fs.Dirent[] = [];
    try { names = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
    for (const d of names) {
      if (d.name.startsWith('.') || (depth === 0 && d.name === 'tracks')) continue;
      const abs = path.join(dir, d.name);
      if (d.isDirectory()) { if (depth < 4) walk(abs, depth + 1); continue; }
      const kind = d.isFile() ? mediaKind(d.name) : null;
      if (!kind) continue;
      const st = fs.statSync(abs);
      out.push({path: path.relative(pub, abs).split(path.sep).join('/'), kind, size: st.size, mtime: st.mtimeMs, ...probe(abs, kind)});
    }
  };
  walk(pub, 0);
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 800).map(({mtime: _m, ...m}) => m);
}

/** Save an uploaded file (raw body) into public/media/<kind>/; the same name and size is reused, not copied twice. */
async function upload(req: IncomingMessage, id: string, name: string): Promise<MediaInfo> {
  const kind = mediaKind(name);
  if (!kind) throw new HttpError(400, `unsupported file type: ${path.extname(name) || name}`);
  const pub = publicDir(id);
  const dir = path.join(pub, 'media', FOLDER[kind]);
  fs.mkdirSync(dir, {recursive: true});
  const file = safeName(name), ext = path.extname(file), stem = file.slice(0, -ext.length || undefined);
  const size = Number(req.headers['content-length'] ?? -1);
  let abs = path.join(dir, file);
  for (let i = 2; fs.existsSync(abs); i++) {
    if (fs.statSync(abs).size === size) { req.resume(); return {path: path.relative(pub, abs).split(path.sep).join('/'), kind, size, ...probe(abs, kind)}; }
    abs = path.join(dir, `${stem}-${i}${ext}`);
  }
  const tmp = `${abs}.part`;
  await new Promise<void>((resolve, reject) => {
    const outStream = fs.createWriteStream(tmp);
    req.pipe(outStream);
    outStream.on('finish', () => resolve());
    outStream.on('error', reject);
    req.on('error', reject);
  });
  fs.renameSync(tmp, abs);
  return {path: path.relative(pub, abs).split(path.sep).join('/'), kind, size: fs.statSync(abs).size, ...probe(abs, kind)};
}

// ---------- the shared library (assets/library): music, sound effects, stickers for every project ----------
export const LIBRARY = path.join(ROOT, 'assets', 'library');
export type LibraryItem = {path: string; kind: MediaKind; tab: 'audio' | 'stickers'; group: string; name: string; duration?: number};
let libraryCache: {at: number; items: LibraryItem[]} | null = null;
export function listLibrary(): LibraryItem[] {
  if (libraryCache && Date.now() - libraryCache.at < 60_000) return libraryCache.items;
  const items: LibraryItem[] = [];
  const walk = (dir: string, depth: number) => {
    let names: fs.Dirent[] = [];
    try { names = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
    for (const d of names) {
      const abs = path.join(dir, d.name);
      if (d.name.startsWith('.')) continue;
      if (d.isDirectory()) { if (depth < 3) walk(abs, depth + 1); continue; }
      const kind = mediaKind(d.name);
      const rel = path.relative(LIBRARY, abs).split(path.sep).join('/');
      const top = rel.split('/')[0];
      if (kind === 'audio' && (top === 'music' || top === 'sfx')) {
        items.push({path: rel, kind, tab: 'audio', group: top === 'music' ? 'Music' : 'Sound effects', name: path.parse(d.name).name, ...probe(abs, kind)});
      } else if (kind === 'image' && top === 'graphics') {
        items.push({path: rel, kind, tab: 'stickers', group: rel.split('/')[1] ?? 'Stickers', name: path.parse(d.name).name});
      }
    }
  };
  walk(LIBRARY, 0);
  libraryCache = {at: Date.now(), items: items.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))};
  return libraryCache.items;
}

/** Copy a library file into the project's public/media (once) so staticFile finds it; returns it as media. */
function useLibrary(id: string, rel: string): MediaInfo {
  const src = path.resolve(LIBRARY, rel);
  if (!src.startsWith(LIBRARY + path.sep) || !fs.existsSync(src)) throw new HttpError(400, 'not in the library');
  const kind = mediaKind(src);
  if (!kind) throw new HttpError(400, 'unsupported file type');
  const pub = publicDir(id);
  const dir = path.join(pub, 'media', FOLDER[kind]);
  fs.mkdirSync(dir, {recursive: true});
  const abs = path.join(dir, safeName(path.basename(src)));
  if (!fs.existsSync(abs) || fs.statSync(abs).size !== fs.statSync(src).size) fs.copyFileSync(src, abs);
  return {path: path.relative(pub, abs).split(path.sep).join('/'), kind, size: fs.statSync(abs).size, ...probe(abs, kind)};
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://local');
  const p = url.pathname;
  const id = url.searchParams.get('id');

  if (p.startsWith('/media/')) {
    // /media/<edit dir relative to projects>/<file in that dir's public/>
    const rel = decodeURIComponent(p.slice('/media/'.length));
    const project = projectDirs().filter(dir => rel.startsWith(dir + '/')).sort((a, b) => b.length - a.length)[0];
    if (!project) throw new HttpError(404, 'unknown project');
    const pub = insideProjects(path.posix.join(project, 'public'));
    const file = path.resolve(pub, rel.slice(project.length + 1));
    if (!file.startsWith(pub + path.sep)) throw new HttpError(400, 'path outside public/');
    serveFile(req, res, file);
    return true;
  }
  if (!p.startsWith('/api/')) return false;

  if (p === '/api/projects' && req.method === 'GET') { send(res, 200, listProjects()); return true; }

  if (p === '/api/edit' && req.method === 'GET') { send(res, 200, readEdit(editPath(id))); return true; }

  if (p === '/api/edit' && req.method === 'PUT') {
    const body = await readBody(req);
    if (!body.data || typeof body.data !== 'object') throw new HttpError(400, 'missing data');
    const rev = writeEdit(editPath(id), body.data, Number(body.baseRev ?? 0));
    send(res, 200, {rev});
    return true;
  }

  if (p === '/api/events' && req.method === 'GET') {
    const abs = editPath(id);
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive'});
    res.write(': connected\n\n');
    subscribe(abs, res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    res.on('close', () => clearInterval(ping));
    return true;
  }

  if (p === '/api/changes' && req.method === 'POST') {
    const body = await readBody(req);
    const lines: string[] = Array.isArray(body.lines) ? body.lines.filter((x: unknown) => typeof x === 'string' && x.trim()) : [];
    if (lines.length) {
      const file = path.join(path.dirname(editPath(id)), 'human_changes.md');
      if (!fs.existsSync(file)) fs.writeFileSync(file, '# Human edits from the Studio Editor\n\nNewest at the bottom. Claude: read this before editing edit.json.\n', 'utf8');
      const rev = body.rev != null ? ` (rev ${body.rev})` : '';
      fs.appendFileSync(file, `\n## ${localStamp()}${rev}\n${lines.map(l => `- ${l}`).join('\n')}\n`, 'utf8');
    }
    send(res, 200, {ok: true, count: lines.length});
    return true;
  }

  if (p === '/api/render' && req.method === 'POST') {
    send(res, 200, publicJob(startRender(id ?? '', url.searchParams.get('quality') === 'final' ? 'final' : 'preview', url.searchParams.get('format') ?? MAIN)));
    return true;
  }
  if (p === '/api/render' && req.method === 'GET') { send(res, 200, publicJob(job)); return true; }
  if (p === '/api/render' && req.method === 'DELETE') {
    job?.proc?.kill();
    send(res, 200, {ok: true});
    return true;
  }

  if (p === '/api/tool' && req.method === 'POST') {
    const j = startTool(id ?? '', url.searchParams.get('tool') ?? '', await readBody(req));
    send(res, 200, {tool: j.tool, status: j.status});
    return true;
  }
  if (p === '/api/tool' && req.method === 'GET') {
    send(res, 200, toolJob && {id: toolJob.id, tool: toolJob.tool, status: toolJob.status, log: toolJob.log.slice(-6), result: toolJob.result, progress: toolJob.progress});
    return true;
  }
  if (p === '/api/tool' && req.method === 'DELETE') {
    if (toolJob?.status === 'running') { toolJob.proc?.kill(); toolJob.status = 'error'; toolJob.log = [...toolJob.log, 'stopped']; }
    send(res, 200, {ok: true});
    return true;
  }
  if (p === '/api/tracks' && req.method === 'GET') { send(res, 200, listTracks(String(id))); return true; }

  if (p === '/api/presets' && req.method === 'GET') { send(res, 200, readPresets(url.searchParams.get('kind') ?? '')); return true; }
  if (p === '/api/presets' && req.method === 'PUT') {
    const kind = url.searchParams.get('kind') ?? '';
    const body = await readBody(req);
    if (typeof body.name !== 'string' || !body.name.trim()) throw new HttpError(400, 'missing name');
    const all = readPresets(kind);
    if (body.value == null) delete all[body.name]; else all[body.name.trim()] = body.value;
    fs.mkdirSync(path.dirname(presetFile(kind)), {recursive: true});
    fs.writeFileSync(presetFile(kind), `${JSON.stringify(all, null, 1)}\n`, 'utf8');
    send(res, 200, all);
    return true;
  }

  // Files in the project's public/ folder (optionally one sub folder and extensions), for pickers.
  if (p === '/api/proxies' && req.method === 'GET') { send(res, 200, proxiesFor(String(id))); return true; }

  if (p === '/api/media' && req.method === 'GET') { send(res, 200, listMedia(String(id))); return true; }
  if (p === '/api/fonts' && req.method === 'GET') { send(res, 200, listFonts()); return true; }
  if (p === '/api/library' && req.method === 'GET') { send(res, 200, listLibrary()); return true; }
  if (p === '/api/library/use' && req.method === 'POST') { send(res, 200, useLibrary(String(id), url.searchParams.get('path') ?? '')); return true; }
  if (p === '/api/library/file' && (req.method === 'GET' || req.method === 'HEAD')) {
    const abs = path.resolve(LIBRARY, url.searchParams.get('path') ?? '');
    if (!abs.startsWith(LIBRARY + path.sep)) throw new HttpError(400, 'path outside the library');
    serveFile(req, res, abs);
    return true;
  }
  if (p === '/api/upload' && req.method === 'POST') { send(res, 200, await upload(req, String(id), url.searchParams.get('name') ?? 'file')); return true; }

  if (p === '/api/files' && req.method === 'GET') {
    const pub = path.join(path.dirname(editPath(id)), 'public');
    const exts = (url.searchParams.get('ext') ?? '').split(',').filter(Boolean).map(e => `.${e.replace(/^\./, '').toLowerCase()}`);
    const out: string[] = [];
    const walk = (dir: string, depth: number) => {
      let names: fs.Dirent[] = [];
      try { names = fs.readdirSync(dir, {withFileTypes: true}); } catch { return; }
      for (const d of names) {
        const abs = path.join(dir, d.name);
        if (d.name.startsWith('.')) continue; // .proxy and other caches
        if (d.isDirectory() && depth < 3) walk(abs, depth + 1);
        else if (d.isFile() && (!exts.length || exts.includes(path.extname(d.name).toLowerCase()))) out.push(path.relative(pub, abs).split(path.sep).join('/'));
      }
    };
    walk(pub, 0);
    send(res, 200, out.sort().slice(0, 500));
    return true;
  }

  if (p === '/api/file' && (req.method === 'GET' || req.method === 'HEAD')) {
    serveFile(req, res, insideProjects(url.searchParams.get('path') ?? ''));
    return true;
  }

  throw new HttpError(404, `no route ${req.method} ${p}`);
}

// The same API serves the dev server (`npm run dev`) and the fast production build (`npm run app`).
export function editorApi(): Plugin {
  const mount = (server: {middlewares: {use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void}}) => {
    server.middlewares.use((req, res, next) => {
      handle(req, res).then(done => { if (!done) next(); }).catch((err: unknown) => {
        const e = err instanceof HttpError ? err : new HttpError(500, err instanceof Error ? err.message : String(err));
        if (res.headersSent) { res.end(); return; }
        send(res, e.status, {error: e.message, ...(e.body ? {current: e.body} : {})});
      });
    });
  };
  return {name: 'studio-editor-api', configureServer: mount, configurePreviewServer: mount};
}
