// Guide lines over the program monitor: the platform safe zone (from tools/edit/profiles.json),
// rule of thirds and centre lines. Editor-only: nothing here reaches edit.json or the render.
import React, {useEffect, useRef, useState} from 'react';
import {GridFour} from '@phosphor-icons/react';
import profiles from '../../../tools/edit/profiles.json';
import {editor, GUIDES_KEY, useEditor, type Guides} from '../store';

type Safe = {top: number; bottom: number; left: number; right: number};
type Profile = {width: number; height: number; safe: Safe};
const PROFILES = profiles as Record<string, Profile>;
const NAMES: Record<string, string> = {reels: 'Reels', shorts: 'Shorts', tiktok: 'TikTok', youtube: 'YouTube', instagram_feed: 'Instagram feed', linkedin: 'LinkedIn', cinematic_21x9: '21:9'};

function saveGuides(g: Guides) {
  editor.set(s => ({...s, guides: g}));
  try { localStorage.setItem(GUIDES_KEY, JSON.stringify(g)); } catch { /* storage blocked */ }
}

/** The platform whose safe zone fits this frame: the format's own profile, else the closest shape. */
export function autoProfile(width: number, height: number, profile?: string): string | null {
  if (profile && PROFILES[profile]) return profile;
  const r = width / height;
  if (r < 0.7) return 'reels';
  if (r > 2) return 'cinematic_21x9';
  if (r > 1.2) return 'youtube';
  return 'instagram_feed';
}

export function GuidesOverlay({width, height, profile}: {width: number; height: number; profile?: string}) {
  const g = useEditor(s => s.guides);
  const id = g.safe === 'off' ? null : g.safe === 'auto' ? autoProfile(width, height, profile) : g.safe;
  const safe = id ? PROFILES[id]?.safe : null;
  if (!safe && !g.thirds && !g.center) return null;
  const pct = (n: number) => `${n * 100}%`;
  return (
    <div className="guides" aria-hidden>
      {safe && <>
        <div className="safe-shade" style={{left: 0, top: 0, right: 0, height: pct(safe.top)}} />
        <div className="safe-shade" style={{left: 0, bottom: 0, right: 0, height: pct(safe.bottom)}} />
        <div className="safe-shade" style={{left: 0, top: pct(safe.top), bottom: pct(safe.bottom), width: pct(safe.left)}} />
        <div className="safe-shade" style={{right: 0, top: pct(safe.top), bottom: pct(safe.bottom), width: pct(safe.right)}} />
        <div className="safe-box" style={{left: pct(safe.left), right: pct(safe.right), top: pct(safe.top), bottom: pct(safe.bottom)}}>
          <span>{NAMES[id!] ?? id} safe</span>
        </div>
      </>}
      {g.thirds && [1, 2].map(i => <React.Fragment key={i}>
        <div className="guide-line v" style={{left: pct(i / 3)}} />
        <div className="guide-line h" style={{top: pct(i / 3)}} />
      </React.Fragment>)}
      {g.center && <>
        <div className="guide-line v center" style={{left: '50%'}} />
        <div className="guide-line h center" style={{top: '50%'}} />
      </>}
    </div>
  );
}

export function GuidesKey() {
  const g = useEditor(s => s.guides);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const on = g.safe !== 'off' || g.thirds || g.center;
  const options: [string, string][] = [['auto', 'By size'], ...Object.keys(PROFILES).filter(k => !k.endsWith('4k')).map(k => [k, NAMES[k] ?? k] as [string, string]), ['off', 'None']];
  return (
    <div ref={ref} style={{position: 'relative'}}>
      <button className={`key small icon ${on ? 'lit' : ''}`} title="Guides and safe area (G)" aria-label="Guides" aria-expanded={open} onClick={() => setOpen(o => !o)}><GridFour size={14} /></button>
      {open && (
        <div className="menu guides-menu" role="menu">
          <div className="menu-title">Safe area</div>
          {options.map(([k, label]) => (
            <button key={k} role="menuitemradio" aria-checked={g.safe === k} className={g.safe === k ? 'on' : ''} onClick={() => saveGuides({...g, safe: k})}>{label}</button>
          ))}
          <div className="menu-sep" />
          <button role="menuitemcheckbox" aria-checked={g.thirds} className={g.thirds ? 'on' : ''} onClick={() => saveGuides({...g, thirds: !g.thirds})}>Rule of thirds</button>
          <button role="menuitemcheckbox" aria-checked={g.center} className={g.center ? 'on' : ''} onClick={() => saveGuides({...g, center: !g.center})}>Center lines</button>
        </div>
      )}
    </div>
  );
}

/** G key: show or hide every guide at once, remembering the last setup. */
let last: Guides | null = null;
export function toggleGuides() {
  const g = editor.get().guides;
  const on = g.safe !== 'off' || g.thirds || g.center;
  if (on) { last = g; saveGuides({safe: 'off', thirds: false, center: false}); }
  else saveGuides(last ?? {safe: 'auto', thirds: true, center: false});
}
