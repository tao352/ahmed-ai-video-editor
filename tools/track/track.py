"""Tracking and stabilization for the Studio Editor (CapCut's Tracking and Stabilize, done offline).

Every command reads a video under the project's public/ folder and writes a track file there.
All coordinates are normalized to the source frame (0..1, x right, y down). Progress lines are
`PROGRESS <0..1> <text>` and the last line is `RESULT {json}` (same contract as editor_tools.py).

  segment   <public> <video> --at T (--box x0,y0,x1,y1 | --point x,y)
            outline of the thing at that spot (SAM2), as a polygon: pick a target in one click
  plane     <public> <video> --at T --shape x,y,x,y,... [--out tracks/x.json] [--preview]
            a flat surface (roof, plot of land, wall, screen, sign) followed with perspective
  object    <public> <video> --at T --box x0,y0,x1,y1 [--out ...] [--preview]
            any object or person, by its mask in every frame (SAM2 video), also its outline per frame
  face      <public> <video> [--at T --point x,y] [--out ...] [--preview]
            a face: position, size and head roll every frame (MediaPipe)
  stabilize <public> <video> [--strength 0..1] [--lock tracks/x.json] [--out ...]
            camera shake removed: a correction per frame and the zoom that hides the edges

Track file (version 1):
  {kind, src, width, height, fps, anchor, start, end, shape: [[x,y],...] at the anchor,
   frames: [[t, h0..h7, conf], ...], outlines?: [[t, [[x,y],...]], ...], zoom?}
`h` is the homography (row major, h8 = 1) that maps a point of the anchor frame to the same point in
frame t; for stabilize it maps a frame's point to where it is shown after the correction.
Frames are in source seconds, one per video frame. conf 0..1 (0 = lost, the editor holds the last good).
"""
import argparse
import json
from pathlib import Path
import subprocess
import sys

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
MODELS = ROOT / "tools" / "track" / "models"
SAM2_CKPT = MODELS / "sam2.1_hiera_small.pt"
SAM2_CFG = "configs/sam2.1/sam2.1_hiera_s.yaml"
FACE_MODEL = MODELS / "blaze_face_short_range.tflite"


def result(payload):
    print("RESULT " + json.dumps(payload, ensure_ascii=False), flush=True)


def progress(p, text=""):
    print(f"PROGRESS {max(0.0, min(1.0, p)):.3f} {text}", flush=True)


def inside(public: Path, rel: str, must_exist=True) -> Path:
    p = (public / rel).resolve()
    if public.resolve() not in p.parents:
        sys.exit(f"path outside public/: {rel}")
    if must_exist and not p.exists():
        sys.exit(f"missing file: {rel}")
    return p


def nums(text, n=None):
    v = [float(x) for x in str(text).replace(";", ",").split(",") if x.strip()]
    if n and len(v) != n:
        sys.exit(f"expected {n} numbers, got {len(v)}: {text}")
    return v


# ---------- video io ----------

def probe(path: Path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                        "stream=width,height,r_frame_rate,nb_frames:stream_side_data=rotation:format=duration", "-of", "json", str(path)],
                       capture_output=True, text=True)
    info = json.loads(r.stdout)
    s = info["streams"][0]
    num, den = (int(x) for x in s["r_frame_rate"].split("/"))
    return {"width": s["width"], "height": s["height"], "fps": num / den, "duration": float(info["format"]["duration"])}


def read_frames(path: Path, width: int, start=0.0, end=None, gray=True):
    """Decode (a stretch of) the video scaled to `width`, as a list of uint8 frames. ffmpeg does the
    4K decode and scale, which is much faster than OpenCV's reader."""
    info = probe(path)
    h = round(info["height"] * width / info["width"] / 2) * 2
    args = ["ffmpeg", "-v", "error"]
    if start > 0:
        args += ["-ss", f"{start:.4f}"]
    args += ["-i", str(path)]
    if end is not None:
        args += ["-t", f"{max(0.0, end - start):.4f}"]
    args += ["-an", "-vf", f"scale={width}:{h}:flags=area", "-pix_fmt", "gray" if gray else "bgr24", "-f", "rawvideo", "-"]
    proc = subprocess.Popen(args, stdout=subprocess.PIPE)
    size = width * h * (1 if gray else 3)
    frames = []
    while True:
        buf = proc.stdout.read(size)
        if len(buf) < size:
            break
        f = np.frombuffer(buf, np.uint8).reshape((h, width) if gray else (h, width, 3))
        frames.append(f)
    proc.wait()
    return frames, info, (width, h)


def work_width(info):
    # ~1280 px is plenty for sub-pixel tracking; long clips drop to 960 to keep memory under ~700 MB
    n = info["duration"] * info["fps"]
    return 1280 if n * 1280 * 720 < 7e8 else 960


# ---------- geometry ----------

def to_px(pts, size):
    return np.asarray(pts, np.float64) * np.array(size, np.float64)


def apply_h(H, pts):
    p = np.asarray(pts, np.float64).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(p, H).reshape(-1, 2)


def norm_h(H_px, size):
    """Pixel homography -> normalized (0..1) homography, scaled so h8 = 1."""
    K = np.diag([size[0], size[1], 1.0])
    Hn = np.linalg.inv(K) @ H_px @ K
    return Hn / Hn[2, 2]


def poly_mask(shape_px, size, grow=1.0):
    pts = np.asarray(shape_px, np.float64)
    c = pts.mean(0)
    pts = c + (pts - c) * grow
    m = np.zeros((size[1], size[0]), np.uint8)
    cv2.fillPoly(m, [np.round(pts).astype(np.int32)], 255)
    return m


def smooth_series(values, sigma):
    """Gaussian smoothing along time (axis 0) that keeps the ends in place."""
    if sigma <= 0 or len(values) < 3:
        return values
    r = int(3 * sigma) + 1
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    pad = np.pad(values, ((r, r),) + ((0, 0),) * (values.ndim - 1), mode="edge")
    out = np.empty_like(values)
    for i in range(len(values)):
        out[i] = np.tensordot(k, pad[i:i + 2 * r + 1], axes=(0, 0))
    return out


def outline_of(mask, size, eps=0.004):
    """Largest contour of a binary mask as a normalized polygon (simplified)."""
    m = (mask > 0).astype(np.uint8)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cs:
        return None
    c = max(cs, key=cv2.contourArea)
    c = cv2.approxPolyDP(c, eps * cv2.arcLength(c, True), True).reshape(-1, 2).astype(np.float64)
    return (c / np.array(size, np.float64)).round(5).tolist()


# ---------- plane (KLT + homography, re-anchored with SIFT) ----------

LK = dict(winSize=(25, 25), maxLevel=4, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01))


def good_points(img, mask, n=400, near=None):
    if near is not None and len(near):
        mask = mask.copy()
        for x, y in near.reshape(-1, 2):
            cv2.circle(mask, (int(x), int(y)), 7, 0, -1)
    p = cv2.goodFeaturesToTrack(img, n, 0.005, 7, mask=mask, blockSize=7)
    return np.empty((0, 1, 2), np.float32) if p is None else p.astype(np.float32)


def klt_step(a, b, pts):
    """Track points a->b with a forward-backward check; returns (old, new) that agree within 1 px."""
    if len(pts) < 8:
        return pts[:0], pts[:0]
    nxt, st, _ = cv2.calcOpticalFlowPyrLK(a, b, pts, None, **LK)
    back, st2, _ = cv2.calcOpticalFlowPyrLK(b, a, nxt, None, **LK)
    ok = (st.ravel() == 1) & (st2.ravel() == 1) & (np.linalg.norm((back - pts).reshape(-1, 2), axis=1) < 1.0)
    return pts[ok], nxt[ok]


def track_plane(frames, a, shape_px, size, label="plane"):
    """Homography from frame a to every frame, following the surface inside shape_px."""
    n = len(frames)
    sift = cv2.SIFT_create(nfeatures=4000)
    region = poly_mask(shape_px, size, 1.08)
    kpA, desA = sift.detectAndCompute(frames[a], region)
    ptsA = np.float32([k.pt for k in kpA]) if kpA else np.empty((0, 2), np.float32)
    matcher = cv2.FlannBasedMatcher(dict(algorithm=1, trees=5), dict(checks=64))
    Hs = [None] * n
    conf = [0.0] * n
    Hs[a], conf[a] = np.eye(3), 1.0
    quad = np.asarray(shape_px, np.float64)
    span = max(np.ptp(quad[:, 0]), np.ptp(quad[:, 1]))
    done = 1
    for d in (1, -1):
        H = np.eye(3)
        pts = good_points(frames[a], region)
        i = a + d
        while 0 <= i < n:
            p0, p1 = klt_step(frames[i - d], frames[i], pts)
            c = 0.0
            if len(p0) >= 10:
                Hstep, inl = cv2.findHomography(p0, p1, cv2.RANSAC, 1.5)
                if Hstep is not None:
                    H = Hstep @ H
                    keep = inl.ravel() == 1
                    p1 = p1[keep]
                    c = min(1.0, keep.sum() / 80)
            # every few frames: match straight to the anchor (scale and rotation proof), which removes drift
            if (i - a) % 4 == 0 and desA is not None and len(ptsA) >= 20:
                pred = apply_h(H, quad)
                m = poly_mask(pred, size, 1.25)
                kp, des = sift.detectAndCompute(frames[i], m)
                if des is not None and len(kp) >= 20:
                    good = [x[0] for x in matcher.knnMatch(desA, des, k=2) if len(x) == 2 and x[0].distance < 0.75 * x[1].distance]
                    if len(good) >= 20:
                        src = np.float32([ptsA[g.queryIdx] for g in good])
                        dst = np.float32([kp[g.trainIdx].pt for g in good])
                        Hd, inl = cv2.findHomography(src, dst, cv2.RANSAC, 3.0)
                        if Hd is not None and inl.sum() >= 18:
                            err = np.linalg.norm(apply_h(Hd, quad) - pred, axis=1).max()
                            span_now = max(np.ptp(pred[:, 0]), np.ptp(pred[:, 1]))
                            if err < 0.12 * span_now:
                                H = Hd
                                c = max(c, min(1.0, inl.sum() / 60))
            Hs[i], conf[i] = H.copy(), c
            # keep enough points on the surface: add fresh ones inside where the shape is now
            if len(p1) < 200:
                m = poly_mask(apply_h(H, quad), size, 1.0)
                fresh = good_points(frames[i], m, 400 - len(p1), p1)
                p1 = np.concatenate([p1.reshape(-1, 1, 2), fresh]) if len(fresh) else p1.reshape(-1, 1, 2)
            pts = p1.reshape(-1, 1, 2).astype(np.float32)
            done += 1
            if done % 10 == 0:
                progress(done / n, label)
            i += d
    # smooth the corners a little (sub-pixel jitter), then rebuild each homography from them
    corners = np.array([apply_h(H, quad[:4] if len(quad) == 4 else bbox_quad(quad)) for H in Hs])
    ref = quad[:4] if len(quad) == 4 else bbox_quad(quad)
    corners = smooth_series(corners, 1.0)
    out = [cv2.getPerspectiveTransform(ref.astype(np.float32), c.astype(np.float32)) for c in corners]
    return out, conf


def bbox_quad(pts):
    x0, y0 = pts.min(0)
    x1, y1 = pts.max(0)
    return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], np.float64)


# ---------- SAM2 ----------

_sam = {}


def sam_device():
    import torch
    return "cuda" if torch.cuda.is_available() else "cpu"


def sam_image(img_bgr, box=None, point=None):
    """One mask from one frame (box or point prompt)."""
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    import torch
    if "img" not in _sam:
        _sam["img"] = SAM2ImagePredictor(build_sam2(SAM2_CFG, str(SAM2_CKPT), device=sam_device()))
    pred = _sam["img"]
    with torch.inference_mode(), torch.autocast(sam_device(), dtype=torch.bfloat16, enabled=sam_device() == "cuda"):
        pred.set_image(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
        kw = {}
        if box is not None:
            kw["box"] = np.array(box, np.float32)
        if point is not None:
            kw["point_coords"] = np.array([point], np.float32)
            kw["point_labels"] = np.array([1])
        masks, scores, _ = pred.predict(multimask_output=box is None, **kw)
    best = int(np.argmax(scores))
    return masks[best] > 0, float(scores[best])


def need_sam():
    try:
        import sam2  # noqa: F401
    except ImportError:
        sys.exit("SAM2 is not installed (pip install sam2, model in tools/track/models)")
    if not SAM2_CKPT.exists():
        sys.exit(f"missing SAM2 model {SAM2_CKPT}")


# ---------- commands ----------

def frame_at(path, t, width):
    frames, info, size = read_frames(path, width, start=t, end=t + 0.5, gray=False)
    return frames[0], info, size


def cmd_segment(a):
    need_sam()
    public = Path(a.public)
    src = inside(public, a.video)
    img, info, size = frame_at(src, a.at, 1280)
    box = point = None
    if a.box:
        box = to_px(np.array(nums(a.box, 4)).reshape(2, 2), size).ravel()
    elif a.point:
        point = to_px(nums(a.point, 2), size)
    else:
        sys.exit("give --box or --point")
    progress(0.3, "segment")
    mask, score = sam_image(img, box, point)
    shape = outline_of(mask.astype(np.uint8), size)
    if not shape:
        sys.exit("nothing found there")
    ys, xs = np.nonzero(mask)
    result({"shape": shape, "score": round(score, 3), "box": [round(xs.min() / size[0], 4), round(ys.min() / size[1], 4), round(xs.max() / size[0], 4), round(ys.max() / size[1], 4)], "at": a.at, "src": a.video})


def frame_times(info, n, start):
    return [round(start + i / info["fps"], 4) for i in range(n)]


def write_track(public, a, kind, info, times, Hs_px, conf, size, shape, extra=None):
    out_rel = a.out or f"tracks/{Path(a.video).stem}-{kind}-{int(a.at * 1000) if a.at is not None else 0}.json"
    out = inside(public, out_rel, must_exist=False)
    out.parent.mkdir(parents=True, exist_ok=True)
    frames = []
    for t, H, c in zip(times, Hs_px, conf):
        h = norm_h(H, size).ravel()[:8]
        frames.append([t] + [round(float(x), 6) for x in h] + [round(float(c), 3)])
    doc = {"version": 1, "kind": kind, "src": a.video, "width": info["width"], "height": info["height"], "fps": round(info["fps"], 5),
           "anchor": a.at, "start": times[0], "end": times[-1], "shape": shape, "frames": frames}
    doc.update(extra or {})
    out.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    lost = lost_ranges(times, conf)
    summary = {"track": out_rel, "kind": kind, "frames": len(frames), "start": times[0], "end": times[-1],
               "meanConf": round(float(np.mean(conf)), 3), "lost": lost}
    return out, summary


def lost_ranges(times, conf, below=0.15):
    out, s = [], None
    for t, c in zip(times, conf):
        if c < below and s is None:
            s = t
        elif c >= below and s is not None:
            out.append([s, t]); s = None
    if s is not None:
        out.append([s, times[-1]])
    return out


def preview(public, src, out_json, track, size_hint=960):
    """A small mp4 with the tracked shape drawn on the footage, to check the track by eye."""
    frames, info, size = read_frames(src, size_hint, start=track["start"], end=track["end"] + 0.05, gray=False)
    out = out_json.with_suffix(".preview.mp4")
    w, h = size
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", f"{info['fps']:.5f}", "-i", "-",
                             "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", str(out)], stdin=subprocess.PIPE)
    shape = np.asarray(track["shape"], np.float64)
    outlines = {round(o[0], 3): o[1] for o in track.get("outlines", [])}
    for f, row in zip(frames, track["frames"]):
        img = f.copy()
        H = np.append(np.array(row[1:9]), 1.0).reshape(3, 3)
        pts = apply_h(H, shape) * np.array(size)
        col = (80, 220, 255) if row[9] >= 0.15 else (60, 60, 255)
        cv2.polylines(img, [np.round(pts).astype(np.int32)], True, col, 2, cv2.LINE_AA)
        o = outlines.get(round(row[0], 3))
        if o:
            cv2.polylines(img, [np.round(np.array(o) * np.array(size)).astype(np.int32)], True, (120, 255, 120), 1, cv2.LINE_AA)
        cv2.putText(img, f"{row[0]:.2f}s conf {row[9]:.2f}", (12, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
        proc.stdin.write(img.tobytes())
    proc.stdin.close()
    proc.wait()
    return out


def span_args(a, info):
    s = max(0.0, a.start if a.start is not None else 0.0)
    e = min(info["duration"], a.end if a.end is not None else info["duration"])
    return s, e


def cmd_plane(a):
    public = Path(a.public)
    src = inside(public, a.video)
    info = probe(src)
    s, e = span_args(a, info)
    progress(0.01, "decoding")
    frames, info, size = read_frames(src, work_width(info), start=s, end=e)
    n = len(frames)
    times = frame_times(info, n, s)
    ai = int(np.argmin([abs(t - a.at) for t in times]))
    shape = np.array(nums(a.shape)).reshape(-1, 2)
    if len(shape) < 3:
        sys.exit("--shape needs at least 3 points")
    Hs, conf = track_plane(frames, ai, to_px(shape, size), size)
    out, summary = write_track(public, a, "plane", info, times, Hs, conf, size, shape.round(5).tolist())
    if a.preview:
        summary["preview"] = preview(public, src, out, json.loads(out.read_text())).resolve().relative_to(public.resolve()).as_posix()
    result(summary)


def similarity_from(c0, s0, r0, c1, s1, r1):
    """Homography (pixels) that moves centre c0 to c1, scales by s1/s0 and turns by r1-r0 (radians)."""
    k = s1 / s0
    ca, sa = np.cos(r1 - r0) * k, np.sin(r1 - r0) * k
    A = np.array([[ca, -sa, 0], [sa, ca, 0], [0, 0, 1.0]])
    T0 = np.array([[1, 0, -c0[0]], [0, 1, -c0[1]], [0, 0, 1.0]])
    T1 = np.array([[1, 0, c1[0]], [0, 1, c1[1]], [0, 0, 1.0]])
    return T1 @ A @ T0


def cmd_object(a):
    need_sam()
    import torch
    from sam2.build_sam import build_sam2_video_predictor
    public = Path(a.public)
    src = inside(public, a.video)
    info = probe(src)
    s, e = span_args(a, info)
    # SAM2 video wants a folder of jpgs; 1024 px wide keeps a 4 GB card happy
    import tempfile
    tmp = Path(tempfile.mkdtemp(prefix="sam2_"))
    progress(0.01, "decoding")
    frames, info, size = read_frames(src, 1024, start=s, end=e, gray=False)
    for i, f in enumerate(frames):
        cv2.imwrite(str(tmp / f"{i:05d}.jpg"), f, [cv2.IMWRITE_JPEG_QUALITY, 92])
    n = len(frames)
    times = frame_times(info, n, s)
    ai = int(np.argmin([abs(t - a.at) for t in times]))
    box = to_px(np.array(nums(a.box, 4)).reshape(2, 2), size).ravel()
    dev = sam_device()
    pred = build_sam2_video_predictor(SAM2_CFG, str(SAM2_CKPT), device=dev)
    masks = [None] * n
    with torch.inference_mode(), torch.autocast(dev, dtype=torch.bfloat16, enabled=dev == "cuda"):
        state = pred.init_state(str(tmp), offload_video_to_cpu=True, offload_state_to_cpu=dev == "cuda")
        pred.add_new_points_or_box(state, frame_idx=ai, obj_id=1, box=box)
        done = 0
        for reverse in (False, True):
            for fi, _, logits in pred.propagate_in_video(state, start_frame_idx=ai, reverse=reverse):
                masks[fi] = (logits[0, 0] > 0).cpu().numpy()
                done += 1
                if done % 10 == 0:
                    progress(0.1 + 0.85 * done / (n + 1), "object")
    for f in tmp.iterdir():
        f.unlink()
    tmp.rmdir()
    # each frame's mask -> centre, size (sqrt area) and angle (principal axis) -> similarity from the anchor
    def stats(m):
        ys, xs = np.nonzero(m)
        if len(xs) < 20:
            return None
        c = np.array([xs.mean(), ys.mean()])
        cov = np.cov(np.stack([xs - c[0], ys - c[1]]))
        ang = 0.5 * np.arctan2(2 * cov[0, 1], cov[0, 0] - cov[1, 1])
        return c, np.sqrt(len(xs)), ang
    st = [stats(m) if m is not None else None for m in masks]
    if st[ai] is None:
        sys.exit("the object was not found at the anchor frame")
    c0, s0, r0 = st[ai]
    raw, conf, last = [], [], st[ai]
    for x in st:
        ok = x is not None
        x = x if ok else last
        last = x
        raw.append([x[0][0], x[0][1], np.log(x[1]), x[2]])
        conf.append(1.0 if ok else 0.0)
    raw = np.array(raw)
    # unwrap the 180-degree flips of the principal axis, then smooth
    raw[:, 3] = np.unwrap(raw[:, 3] * 2) / 2
    raw = smooth_series(raw, 1.2)
    Hs = [similarity_from(c0, s0, r0, (r[0], r[1]), np.exp(r[2]), r[3] if a.rotate else r0) for r in raw]
    shape = outline_of(masks[ai].astype(np.uint8), size)
    outlines = []
    for t, m in zip(times, masks):
        o = outline_of(m.astype(np.uint8), size, 0.006) if m is not None else None
        if o:
            outlines.append([t, o])
    out, summary = write_track(public, a, "object", info, times, Hs, conf, size, shape, {"outlines": outlines})
    if a.preview:
        summary["preview"] = preview(public, src, out, json.loads(out.read_text())).resolve().relative_to(public.resolve()).as_posix()
    result(summary)


def cmd_face(a):
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python.vision import FaceDetector, FaceDetectorOptions, RunningMode
    if not FACE_MODEL.exists():
        sys.exit(f"missing face model {FACE_MODEL}")
    public = Path(a.public)
    src = inside(public, a.video)
    info = probe(src)
    s, e = span_args(a, info)
    progress(0.01, "decoding")
    frames, info, size = read_frames(src, 960, start=s, end=e, gray=False)
    n = len(frames)
    times = frame_times(info, n, s)
    det = FaceDetector.create_from_options(FaceDetectorOptions(base_options=BaseOptions(model_asset_path=str(FACE_MODEL)),
                                                               running_mode=RunningMode.VIDEO, min_detection_confidence=0.4))
    want = np.array(nums(a.point, 2)) * np.array(size) if a.point else None
    found = []
    prev = None
    for i, f in enumerate(frames):
        r = det.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(f, cv2.COLOR_BGR2RGB)), int(times[i] * 1000))
        faces = []
        for d in r.detections:
            b = d.bounding_box
            kp = d.keypoints  # right eye, left eye, nose, mouth, right ear, left ear (normalized)
            c = np.array([b.origin_x + b.width / 2, b.origin_y + b.height / 2])
            roll = np.arctan2((kp[1].y - kp[0].y) * size[1], (kp[1].x - kp[0].x) * size[0]) if len(kp) >= 2 else 0.0
            faces.append((c, float(b.width), roll, d.categories[0].score))
        pick = None
        if faces:
            ref = prev[0] if prev is not None else want
            pick = min(faces, key=lambda x: np.linalg.norm(x[0] - ref)) if ref is not None else max(faces, key=lambda x: x[1])
            if prev is not None and np.linalg.norm(pick[0] - prev[0]) > 3 * prev[1]:
                pick = None  # another face; keep following ours
        found.append(pick)
        if pick:
            prev = pick
        if i % 15 == 0:
            progress(i / n, "face")
    at = a.at if a.at is not None else next((t for t, x in zip(times, found) if x), None)
    if at is None:
        sys.exit("no face found")
    a.at = at
    ai = int(np.argmin([abs(t - at) for t in times]))
    if found[ai] is None:
        ai = next(i for i, x in enumerate(found) if x)
    raw, conf, last = [], [], found[ai]
    for x in found:
        ok = x is not None
        x = x if ok else last
        last = x
        raw.append([x[0][0], x[0][1], np.log(x[1]), x[2]])
        conf.append(float(x[3]) if ok else 0.0)
    raw = np.array(raw)
    raw[:, 3] = np.unwrap(raw[:, 3])
    raw = smooth_series(raw, 1.5)
    c0, s0, r0 = found[ai][0], found[ai][1], found[ai][2]
    Hs = [similarity_from(c0, s0, r0, (r[0], r[1]), np.exp(r[2]), r[3]) for r in raw]
    half = np.array([s0 / 2, s0 * 0.62])
    box = [c0 - half, c0 + np.array([half[0], -half[1]]), c0 + half, c0 + np.array([-half[0], half[1]])]
    shape = (np.array(box) / np.array(size)).round(5).tolist()
    out, summary = write_track(public, a, "face", info, times, Hs, conf, size, shape)
    if a.preview:
        summary["preview"] = preview(public, src, out, json.loads(out.read_text())).resolve().relative_to(public.resolve()).as_posix()
    result(summary)


def cmd_stabilize(a):
    public = Path(a.public)
    src = inside(public, a.video)
    info = probe(src)
    s, e = span_args(a, info)
    progress(0.01, "decoding")
    frames, info, size = read_frames(src, 960, start=s, end=e)
    n = len(frames)
    times = frame_times(info, n, s)
    # camera path: chain of frame-to-frame similarity transforms from background points
    path = np.zeros((n, 4))  # x, y, angle, log scale of the camera
    full = np.full((size[1], size[0]), 255, np.uint8)
    pts = good_points(frames[0], full, 500)
    for i in range(1, n):
        p0, p1 = klt_step(frames[i - 1], frames[i], pts)
        dx = dy = da = ds = 0.0
        if len(p0) >= 12:
            M, _ = cv2.estimateAffinePartial2D(p0, p1, method=cv2.RANSAC, ransacReprojThreshold=2.0)
            if M is not None:
                dx, dy = M[0, 2], M[1, 2]
                da = np.arctan2(M[1, 0], M[0, 0])
                ds = np.log(np.hypot(M[0, 0], M[1, 0]))
        path[i] = path[i - 1] + [dx, dy, da, ds]
        pts = p1.reshape(-1, 1, 2) if len(p1) >= 250 else np.concatenate([p1.reshape(-1, 1, 2), good_points(frames[i], full, 500 - len(p1), p1)])
        if i % 15 == 0:
            progress(i / n, "stabilize")
    strength = max(0.0, min(1.0, a.strength))
    if a.lock:
        # lock on a tracked target: cancel its motion so it stays where it is at the track's anchor
        tr = json.loads(inside(public, a.lock).read_text())
        rows = {round(r[0], 3): r for r in tr["frames"]}
        c = np.mean(np.array(tr["shape"]), 0)
        target = []
        for t in times:
            r = rows.get(round(t, 3))
            H = np.append(np.array(r[1:9]), 1.0).reshape(3, 3) if r else np.eye(3)
            target.append(apply_h(H, [c])[0] * np.array(size))
        target = np.array(target)
        smooth = path.copy()
        smooth[:, :2] = path[:, :2] - (target - target[0])
        smooth[:, 2:] = smooth_series(path[:, 2:], 30.0)
    else:
        # strength 0..1 -> smoothing window up to ~2 s; 1 = locked-off tripod look
        sigma = 2 + strength * 2.0 * info["fps"]
        smooth = smooth_series(path, sigma) if strength < 0.98 else np.tile(path.mean(0), (n, 1))
    corr = smooth - path
    c = np.array(size) / 2
    Hs = [similarity_from(c, 1.0, 0.0, c + d[:2], np.exp(d[3]), d[2]) for d in corr]
    # the zoom that hides every moved edge: how far the most-moved frame's corners come in
    need = 1.0
    corners = np.array([[0, 0], [size[0], 0], [size[0], size[1]], [0, size[1]]], np.float64)
    for H in Hs:
        inv = np.linalg.inv(H)
        p = apply_h(inv, corners) - c  # where the viewport corners land in the corrected frame
        k = np.max(np.abs(p) / c)
        need = max(need, k)
    a.at = 0.0
    out, summary = write_track(public, a, "stabilize", info, times, Hs, [1.0] * n, size, corners.tolist(), {"zoom": round(float(need), 4), "strength": strength})
    summary["zoom"] = round(float(need), 4)
    result(summary)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    def common(x, at=True):
        x.add_argument("public"); x.add_argument("video")
        x.add_argument("--at", type=float, required=at, default=None)
        x.add_argument("--out"); x.add_argument("--preview", action="store_true")
        x.add_argument("--from", dest="start", type=float); x.add_argument("--to", dest="end", type=float)
    x = sp.add_parser("segment"); common(x); x.add_argument("--box"); x.add_argument("--point")
    x = sp.add_parser("plane"); common(x); x.add_argument("--shape", required=True)
    x = sp.add_parser("object"); common(x); x.add_argument("--box", required=True); x.add_argument("--rotate", action="store_true")
    x = sp.add_parser("face"); common(x, at=False); x.add_argument("--point")
    x = sp.add_parser("stabilize"); common(x, at=False); x.add_argument("--strength", type=float, default=0.6); x.add_argument("--lock")
    a = ap.parse_args()
    {"segment": cmd_segment, "plane": cmd_plane, "object": cmd_object, "face": cmd_face, "stabilize": cmd_stabilize}[a.cmd](a)


if __name__ == "__main__":
    main()
