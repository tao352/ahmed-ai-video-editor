/** Broadcast-style timecode MM:SS:FF (HH: prefix past an hour). */
export function timecode(frame: number, fps: number): string {
  const f = Math.max(0, Math.round(frame));
  const ff = f % fps, s = Math.floor(f / fps), ss = s % 60, m = Math.floor(s / 60), mm = m % 60, h = Math.floor(m / 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${h ? `${p(h)}:` : ''}${p(mm)}:${p(ss)}:${p(ff)}`;
}

/** Short seconds label for the ruler and lists: 1:05.2 or 12.4 */
export function secs(t: number, digits = 1): string {
  const m = Math.floor(t / 60), s = t - m * 60;
  return m ? `${m}:${s.toFixed(digits).padStart(digits ? 3 + digits : 2, '0')}` : s.toFixed(digits);
}

export const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
