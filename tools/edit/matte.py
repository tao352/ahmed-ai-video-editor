"""Person matte for "behind the subject" text: MediaPipe selfie-multiclass segmentation per frame,
temporal smoothing (reset on cuts), largest body kept, holes filled, edges feathered.

Writes a VP9 alpha WebM (person RGB + alpha) that Edit uses as base[].matte, and/or a grayscale
mask MP4 for FFmpeg compositing (alphamerge). Generalised from work/matte.py and drfit1 make_cutouts.py.

  python tools/edit/matte.py projects/x/edit/public/base.mp4 -o projects/x/edit/public/matte.webm [--mask mask.mp4]
         [--start 0 --duration 5] [--preview verify/matte.jpg] [--work-width 384] [--keep-all]
"""
import argparse, json, subprocess, sys, time
from pathlib import Path
import numpy as np, cv2
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _media import probe

MODEL = Path(__file__).resolve().parents[2] / "work" / "models" / "selfie_multiclass.tflite"
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite"


def clean(a, keep_all):
    """Binary body mask -> largest component (or all big ones), holes filled; returns float mask 0..1."""
    m = (a > .5).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    if n > 1:
        areas = st[1:, cv2.CC_STAT_AREA]
        keep = [1 + i for i, v in enumerate(areas) if v >= (.15 * areas.max() if keep_all else areas.max())]
        m = np.isin(lab, keep).astype(np.uint8)
    h, w = m.shape
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (max(3, w // 60) | 1,) * 2))
    inv = 1 - m; n2, lab2, st2, _ = cv2.connectedComponentsWithStats(inv, 4)
    for k in range(1, n2):  # interior holes (between arm and body stay open: they touch the border region rarely)
        x, y, bw, bh, area = st2[k]
        if x > 0 and y > 0 and x + bw < w and y + bh < h and area < .02 * w * h:
            m[lab2 == k] = 1
    return m.astype(np.float32)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", type=Path)
    ap.add_argument("-o", "--output", type=Path, help="alpha WebM (person RGB + alpha)")
    ap.add_argument("--mask", type=Path, help="grayscale mask MP4 (white = person)")
    ap.add_argument("--start", type=float, default=0)
    ap.add_argument("--duration", type=float)
    ap.add_argument("--preview", type=Path, help="JPEG: 6 frames of the cutout over magenta")
    ap.add_argument("--work-width", type=int, default=384, help="segmentation width (quality vs speed)")
    ap.add_argument("--keep-all", action="store_true", help="keep every large person, not only the biggest")
    ap.add_argument("--model", type=Path, default=MODEL)
    a = ap.parse_args()
    if not (a.output or a.mask or a.preview):
        ap.error("give -o, --mask or --preview")
    if not a.model.exists():
        sys.exit(f"Missing model {a.model}. Download: curl -L -o \"{a.model}\" {MODEL_URL}")
    import mediapipe as mp
    from mediapipe.tasks.python import vision, BaseOptions
    info = probe(a.video); W, H, fps = info["width"], info["height"], info["fps"]
    fps = round(fps) if abs(fps - round(fps)) < .05 else fps  # avg_frame_rate jitter (29.98) -> 30
    dur = a.duration or max(0, info["duration"] - a.start); total = int(round(dur * fps))
    ww = a.work_width; wh = int(round(H * ww / W / 2) * 2)
    seg = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(
        base_options=BaseOptions(model_asset_path=str(a.model)), output_confidence_masks=True, running_mode=vision.RunningMode.VIDEO))
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", str(a.start), "-t", str(dur), "-i", str(a.video),
                            "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    rate = f"{fps:.6f}"
    enc = mask = None
    if a.output:
        a.output.parent.mkdir(parents=True, exist_ok=True)
        enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-r", rate, "-i", "-",
                                "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "6M", "-deadline", "realtime", "-cpu-used", "8",
                                "-row-mt", "1", "-auto-alt-ref", "0", "-metadata:s:v:0", "alpha_mode=1", str(a.output)], stdin=subprocess.PIPE)
    if a.mask:
        a.mask.parent.mkdir(parents=True, exist_ok=True)
        mask = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{W}x{H}", "-r", rate, "-i", "-",
                                 "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p", str(a.mask)], stdin=subprocess.PIPE)
    pick = set(np.linspace(0, max(0, total - 1), 6).astype(int).tolist()) if a.preview else set()
    shots, tops, prev, prev_small, n, t0, size = [], [], None, None, 0, time.time(), W * H * 3
    while True:
        buf = dec.stdout.read(size)
        if len(buf) < size:
            break
        rgb = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        small = cv2.resize(rgb, (ww, wh), interpolation=cv2.INTER_AREA)
        res = seg.segment_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(small)), int(n * 1000 / fps))
        conf = 1.0 - np.squeeze(res.confidence_masks[0].numpy_view())  # class 0 = background
        g = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY)
        cut = prev_small is not None and cv2.absdiff(g, prev_small).mean() > 40
        # Flicker damping: blend with the previous frame unless the shot changed.
        prev = conf if prev is None or cut else .6 * conf + .4 * prev
        prev_small = g
        body = clean(prev, a.keep_all) * np.clip((prev - .3) / .4, 0, 1)
        alpha = cv2.GaussianBlur(cv2.resize(body, (W, H), interpolation=cv2.INTER_LINEAR), (0, 0), max(1.0, W / 600))
        a8 = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
        rows = np.where(body.mean(axis=1) > .02)[0]
        tops.append(round(float(rows[0]) * H / wh) if len(rows) else None)
        if enc:
            enc.stdin.write(np.dstack([rgb, a8]).tobytes())
        if mask:
            mask.stdin.write(a8.tobytes())
        if n in pick:
            comp = (rgb * alpha[..., None] + np.array([255, 0, 255]) * (1 - alpha[..., None])).astype(np.uint8)
            shots.append(cv2.resize(cv2.cvtColor(comp, cv2.COLOR_RGB2BGR), (W * 360 // H, 360)))
        n += 1
        if n % 150 == 0:
            print(f"  {n}/{total} frames ({n / (time.time() - t0):.1f} fps)", flush=True)
    dec.wait()
    for p in (enc, mask):
        if p:
            p.stdin.close(); p.wait()
    if a.preview and shots:
        a.preview.parent.mkdir(parents=True, exist_ok=True); cv2.imwrite(str(a.preview), np.hstack(shots))
    # Sidecar for captions preset "behind": set captions.style.position.headTop = head_top.
    known = [t for t in tops if t is not None]
    side = {"fps": fps, "frames": n, "start": a.start, "head_top": int(np.median(known)) if known else None,
            "head_top_every_0_5s": [tops[i] for i in range(0, len(tops), max(1, round(fps / 2)))]}
    target = (a.output or a.mask or a.preview).with_suffix(".json")
    target.write_text(json.dumps(side, indent=1), encoding="utf-8")
    print(f"Head top (median): {side['head_top']} px -> captions.style.position.headTop; sidecar {target}")
    print(f"Matte: {n} frames at {n / max(.01, time.time() - t0):.1f} fps -> " + ", ".join(str(p) for p in (a.output, a.mask, a.preview) if p))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        sys.exit(str(exc))
