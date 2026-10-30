// Right-click menu shared by the timeline and the monitor.
import React, {useEffect, useSyncExternalStore} from 'react';

export type MenuItem = {label: string; hint?: string; action: () => void; danger?: boolean; disabled?: boolean} | 'sep';
type MenuState = {x: number; y: number; items: MenuItem[]} | null;

let state: MenuState = null;
const listeners = new Set<() => void>();
const set = (s: MenuState) => { state = s; for (const l of listeners) l(); };

export const openMenu = (x: number, y: number, items: MenuItem[]) => set({x, y, items});
export const closeMenu = () => set(null);

export function ContextMenu() {
  const menu = useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (!(e.target instanceof Element) || !e.target.closest('.ctx')) closeMenu(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', esc, true);
    window.addEventListener('blur', closeMenu);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', esc, true); window.removeEventListener('blur', closeMenu); };
  }, [menu]);
  if (!menu) return null;
  // keep the menu on screen
  const h = menu.items.length * 32 + 8, w = 230;
  const left = Math.min(menu.x, window.innerWidth - w - 8), top = Math.min(menu.y, window.innerHeight - h - 8);
  return (
    <div className="menu ctx" role="menu" style={{position: 'fixed', left, top, right: 'auto', width: w}} onContextMenu={e => e.preventDefault()}>
      {menu.items.map((it, i) => it === 'sep'
        ? <div key={i} className="ctx-sep" role="separator" />
        : <button key={i} role="menuitem" disabled={it.disabled} className={it.danger ? 'danger' : ''} onClick={() => { closeMenu(); it.action(); }}>
            <span>{it.label}</span>{it.hint && <kbd>{it.hint}</kbd>}
          </button>)}
    </div>
  );
}
