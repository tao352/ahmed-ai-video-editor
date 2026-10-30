// Ops clone the whole document, so after an edit every object is new even where nothing
// changed. `share` puts the old objects back wherever the value is the same, so memoised
// views (timeline lanes, inspector panels, the monitor) only redo the part that changed.

/** `next` with every subtree that deep-equals the one in `prev` replaced by `prev`'s object. */
export function share<T>(prev: T, next: T): T {
  if (prev === next) return prev;
  if (typeof prev !== 'object' || typeof next !== 'object' || prev === null || next === null) return next;
  if (Array.isArray(prev) !== Array.isArray(next)) return next;
  if (Array.isArray(next)) {
    const p = prev as unknown as unknown[];
    let same = p.length === next.length;
    const out = next.map((v, i) => {
      const s = i < p.length ? share(p[i], v) : v;
      if (s !== p[i]) same = false;
      return s;
    });
    return (same ? prev : out) as T;
  }
  const p = prev as Record<string, unknown>, n = next as Record<string, unknown>;
  const keys = Object.keys(n);
  let same = keys.length === Object.keys(p).length;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const s = k in p ? share(p[k], n[k]) : n[k];
    if (s !== p[k] || !(k in p)) same = false;
    out[k] = s;
  }
  return (same ? prev : out) as T;
}
