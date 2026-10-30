"""Shared visual analysis for reference.py and pace.py: low-res frame sampling, cuts,
visual-change events, zoom (punch/push) estimation and look stats. Local OpenCV + FFmpeg only."""
import subprocess
import numpy as np
import cv2
from _media import probe

W = 192  # analysis width; height follows the aspect ratio


def frames(video, fps=10.0):
    """Yield (t, bgr) samples at `fps`, scaled to W px wide."""
    info = probe(video); h = max(2, round(info["height"] * W / max(1, info["width"]) / 2) * 2)
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(video), "-vf", f"fps={fps},scale={W}:{h}",
                          "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    size, i = W * h * 3, 0
    while True:
        buf = p.stdout.read(size)
        if len(buf) < size:
            break
        yield i / fps, np.frombuffer(buf, np.uint8).reshape(h, W, 3); i += 1
    p.wait()


def _scale(prev, cur):
    """Similarity scale between two gray frames from tracked corners (1.0 = no zoom), or None."""
    pts = cv2.goodFeaturesToTrack(prev, 120, .01, 6)
    if pts is None or len(pts) < 12:
        return None
    nxt, ok, _ = cv2.calcOpticalFlowPyrLK(prev, cur, pts, None, winSize=(15, 15), maxLevel=2)
    ok = ok.ravel() == 1
    if ok.sum() < 12:
        return None
    m, inl = cv2.estimateAffinePartial2D(pts[ok], nxt[ok], method=cv2.RANSAC, ransacReprojThreshold=2)
    if m is None or inl is None or inl.sum() < 10:
        return None
    return float(np.hypot(m[0, 0], m[1, 0]))


GRID = (8, 6)  # rows, cols: change is measured per cell so a graphic popping in one region still counts


def _cells(gray):
    h, w = gray.shape; r, c = GRID
    return gray[:h // r * r, :w // c * c].reshape(r, h // r, c, w // c).mean(axis=(1, 3))


def analyze(video, fps=10.0):
    """One pass over the video. Returns per-sample signals and derived events:
    cuts (most of the frame changes at once), big events (>=15% of cells: graphics, layout, punch zooms)
    and small events (a few cells: caption swaps, small stickers)."""
    ts, diff, cell, hd, scale, bright, sat, contrast, warm, thumbs = [], [], [], [], [], [], [], [], [], []
    prev = prev_hist = None
    for t, img in frames(video, fps):
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [16, 8], [0, 180, 0, 256]); cv2.normalize(hist, hist)
        ts.append(t); bright.append(float(gray.mean())); contrast.append(float(gray.std()))
        sat.append(float(hsv[..., 1].mean())); warm.append(float(img[..., 2].mean() - img[..., 0].mean()))
        if prev is None:
            diff.append(0.0); cell.append(np.zeros(GRID)); hd.append(0.0); scale.append(1.0)
        else:
            d = cv2.absdiff(gray, prev).astype(np.float32)
            diff.append(float(d.mean())); cell.append(_cells(d))
            hd.append(float(cv2.compareHist(prev_hist, hist, cv2.HISTCMP_BHATTACHARYYA)))
            scale.append(_scale(prev, gray) or 1.0)
        if len(thumbs) < 400 and int(round(t * fps)) % int(fps) == 0:
            thumbs.append(img)
        prev, prev_hist = gray, hist
    if not ts:
        raise ValueError(f"No frames decoded from {video}")
    ts, diff, hd, sc = map(np.array, (ts, diff, hd, scale))
    cell = np.stack(cell)  # (n, rows, cols)
    # A cell "spikes" when its change beats both an absolute floor and 3x its own recent activity.
    n = len(ts); k = max(3, int(fps))
    spike = np.zeros(cell.shape, bool)
    for i in range(1, n):
        ref = np.median(cell[max(1, i - k):i], axis=0) if i > 1 else np.zeros(GRID)
        spike[i] = (cell[i] > 14) & (cell[i] > 3 * ref + 4)
    frac = spike.reshape(n, -1).mean(axis=1)
    peak = lambda a, i: a[i] >= a[i - 1] and (i + 1 >= n or a[i] >= a[i + 1])
    cuts = _dedupe([float(ts[i]) for i in range(2, n) if (frac[i] >= .55 or hd[i] > .45) and peak(frac + hd, i)], .25)
    big = _dedupe([float(ts[i]) for i in range(2, n) if frac[i] >= .15 and peak(frac, i)], .3)
    small = _dedupe([float(ts[i]) for i in range(1, n) if 0 < frac[i] < .15 and spike[i].sum() >= 1 and peak(frac, i)], .3)
    events = _dedupe(sorted(set(cuts + big)), .3)
    punches, pushes = _zooms(ts, sc, cuts, fps)
    return {"fps": fps, "duration": float(ts[-1] + 1 / fps), "times": ts, "diff": diff, "frac": frac, "cuts": cuts, "events": events,
            "small": [t for t in small if all(abs(t - e) >= .3 for e in events)],
            "punches": punches, "pushes": pushes, "thumbs": thumbs,
            "look": {"brightness": round(float(np.mean(bright)) / 255, 3), "contrast": round(float(np.mean(contrast)) / 255, 3),
                     "saturation": round(float(np.mean(sat)) / 255, 3), "warmth": round(float(np.mean(warm)) / 255, 3),
                     "palette": palette(thumbs)}}


def _dedupe(times, gap):
    out = []
    for t in times:
        if not out or t - out[-1] >= gap:
            out.append(round(t, 2))
    return out


def _zooms(ts, sc, cuts, fps):
    """Punch = >=4% scale jump inside ~0.3 s that is not a cut. Push = steady >=6% drift across one shot."""
    near_cut = lambda t: any(abs(t - c) < .2 for c in cuts)
    punches, i, win = [], 1, max(1, round(.3 * fps))
    while i < len(ts):
        k = float(np.prod(sc[i:i + win]))
        if abs(k - 1) >= .04 and not near_cut(float(ts[i])):
            punches.append({"t": round(float(ts[i]), 2), "scale": round(k, 3)}); i += win * 2
        else:
            i += 1
    pushes, edges = [], [0.0] + cuts + [float(ts[-1])]
    for a, b in zip(edges, edges[1:]):
        sel = (ts > a + .15) & (ts < b - .15)
        if sel.sum() > fps and b - a > 1.2:
            k = float(np.prod(np.clip(sc[sel], .9, 1.1)))
            if abs(k - 1) >= .06:
                pushes.append({"from": round(a, 2), "to": round(b, 2), "scale": round(k, 3)})
    return punches, pushes


def palette(thumbs, k=5):
    if not thumbs:
        return []
    px = np.concatenate([t.reshape(-1, 3)[::7] for t in thumbs]).astype(np.float32)
    _, lab, cen = cv2.kmeans(px, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1), 3, cv2.KMEANS_PP_CENTERS)
    order = np.argsort(-np.bincount(lab.ravel(), minlength=k))
    return ["#%02x%02x%02x" % tuple(int(v) for v in cen[j][::-1]) for j in order]


def gaps(events, duration, start=0.0):
    """Stretches between consecutive visual events, longest first: [(from, to, length)]."""
    edges = [start] + [e for e in events if start < e < duration] + [duration]
    return sorted(((round(a, 2), round(b, 2), round(b - a, 2)) for a, b in zip(edges, edges[1:])), key=lambda g: -g[2])
