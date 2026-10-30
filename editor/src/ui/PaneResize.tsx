// A divider on the inner edge of a side panel (CapCut: drag it to give the player more or less room).
// The width lives in a CSS variable on <html> and is remembered between visits.
import React, {useEffect, useSyncExternalStore} from 'react';

const LIMITS = {bank: [220, 560], params: [240, 560], monitor: [300, 1000]} as const;
type Pane = keyof typeof LIMITS;

export function PaneResize({pane}: {pane: Pane}) {
  // each desk shape (wide 16:9, tall 9:16) keeps its own sizes, like CapCut
  const desk = useDeskShape();
  const key = `studio-editor:${pane}-w:${desk}`, cssVar = `--${pane}-w`;
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem(key));
      if (w) document.documentElement.style.setProperty(cssVar, `${w}px`);
      else document.documentElement.style.removeProperty(cssVar);
    } catch { /* storage blocked: keep default */ }
  }, [key, cssVar]);
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const [min, max] = LIMITS[pane];
    const move = (ev: PointerEvent) => {
      // the bank's handle is on its right edge, the others on their left edge (the pane grows leftwards)
      const box = document.querySelector(`.${pane}`)?.getBoundingClientRect();
      const raw = pane === 'bank' ? ev.clientX - (box?.left ?? 0) : (box?.right ?? window.innerWidth) - ev.clientX;
      // leave the other panes room: ~300px for whatever takes the rest
      // the pane that takes the rest (the player when wide, the library when tall) is not counted
      const flex: Pane = document.querySelector('.app[data-desk="tall"]') ? 'bank' : 'monitor';
      const others = (['bank', 'params', 'monitor'] as Pane[]).filter(p => p !== pane && p !== flex).reduce((sum, p) => sum + paneW(p), 0);
      const w = Math.round(Math.max(min, Math.min(max, window.innerWidth - 300 - others, raw)));
      document.documentElement.style.setProperty(cssVar, `${w}px`);
      try { localStorage.setItem(key, String(w)); } catch { /* ignore */ }
    };
    const up = () => { document.body.classList.remove('resizing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const reset = () => {
    document.documentElement.style.removeProperty(cssVar);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  };
  return <div className={`pane-resize ${pane}`} onPointerDown={down} onDoubleClick={reset} title="Drag to resize · double-click to reset" aria-hidden />;
}

function paneW(pane: Pane): number {
  return document.querySelector(`.${pane}`)?.getBoundingClientRect().width ?? 300;
}

/** The desk shape App put on .app (wide / tall / square). */
export function useDeskShape(): string {
  return useSyncExternalStore(subscribeDesk, () => document.querySelector('.app')?.getAttribute('data-desk') ?? 'wide');
}
function subscribeDesk(cb: () => void) {
  const app = document.querySelector('.app');
  if (!app) return () => {};
  const mo = new MutationObserver(cb);
  mo.observe(app, {attributes: true, attributeFilter: ['data-desk']});
  return () => mo.disconnect();
}
