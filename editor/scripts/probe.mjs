// Headless check of the running editor over CDP (no extra deps): full-size screenshot + optional script result.
// usage: node editor/scripts/probe.mjs <url> <out.png> <width> <height> [waitMs] [js expression returning a value/promise]
import {spawn} from 'node:child_process';
import fs from 'node:fs';

const [url, out, w, h, wait = '7000', script = ''] = process.argv.slice(2);
// Remotion's headless Chrome lands next to wherever a render first ran: reel/node_modules or the repo root
const SHELL = '.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe';
const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const exe = [`${ROOT}reel/node_modules/`, ROOT].map(d => d + SHELL).find(p => fs.existsSync(p)) ?? `${ROOT}reel/node_modules/${SHELL}`;
const port = 9300 + Math.floor(Math.random() * 400);
const proc = spawn(exe, [`--remote-debugging-port=${port}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required', `--window-size=${w},${h}`, 'about:blank'], {stdio: 'ignore'});
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let targets;
  for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({id: i, method, params})); });
  await send('Emulation.setDeviceMetricsOverride', {width: Number(w), height: Number(h), deviceScaleFactor: 1, mobile: false});
  await send('Page.enable');
  await send('Page.navigate', {url});
  await sleep(Number(wait));
  if (script) { const r = await send("Runtime.evaluate", {expression: script, awaitPromise: true, returnByValue: true}); console.log("RESULT", JSON.stringify(r.result?.result?.value ?? r.result)); await sleep(800); }
  const shot = await send('Page.captureScreenshot', {format: 'png'});
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('saved', out);
  ws.close();
} finally { proc.kill(); }
