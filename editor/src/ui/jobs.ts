// Client side of the server's media tools and user presets.
import {editor, toast} from '../store';

const enc = encodeURIComponent;
const project = () => editor.get().projectId ?? '';

export type ToolName = 'lut' | 'voice' | 'loudness' | 'beats' | 'reverse' | 'audio';

/** Start a media job and wait for its RESULT. One job at a time on the server. */
export async function runTool<T = any>(tool: ToolName, body: Record<string, unknown>, label: string): Promise<T | null> {
  const r = await fetch(`/api/tool?id=${enc(project())}&tool=${tool}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  if (!r.ok) { toast((await r.json().catch(() => ({}))).error ?? `${label}: failed`, 'error', 5000); return null; }
  toast(`${label}… running`, 'info', 2500);
  for (;;) {
    await new Promise(res => setTimeout(res, 700));
    const s = await (await fetch('/api/tool')).json();
    if (!s || s.status === 'running') continue;
    if (s.status === 'done') return s.result as T;
    toast(`${label}: ${String(s.log?.at(-1) ?? 'failed').slice(0, 160)}`, 'error', 7000);
    return null;
  }
}

export async function listFiles(ext: string[]): Promise<string[]> {
  const r = await fetch(`/api/files?id=${enc(project())}&ext=${ext.join(',')}`);
  return r.ok ? r.json() : [];
}

export type PresetKind = 'grades' | 'anims' | 'styles' | 'clips';
export async function loadPresets<T>(kind: PresetKind): Promise<Record<string, T>> {
  const r = await fetch(`/api/presets?kind=${kind}`);
  return r.ok ? r.json() : {};
}
export async function savePreset<T>(kind: PresetKind, name: string, value: T | null): Promise<Record<string, T>> {
  const r = await fetch(`/api/presets?kind=${kind}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, value})});
  return r.ok ? r.json() : {};
}
