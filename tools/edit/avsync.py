"""Check audio/video timing and apply constant audio offsets."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfiltfilt


def run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode:
        raise ValueError(p.stderr[-500:])
    return p.stdout


def probe(path):
    data = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)]))
    streams = data.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), {})
    audio = next((s for s in streams if s.get("codec_type") == "audio"), {})
    fps = eval(video.get("avg_frame_rate", "0/1")) if video.get("avg_frame_rate") else 0
    return data, video, audio, float(fps or 0)


def check(args):
    data, v, a, fps = probe(args.video)
    vstart, astart = float(v.get("start_time", 0)), float(a.get("start_time", 0))
    vdur, adur = float(v.get("duration", data.get("format", {}).get("duration", 0))), float(a.get("duration", data.get("format", {}).get("duration", 0)))
    frame = 1 / fps if fps else 1 / 30
    audio_y, sr = _extract_audio(args.video)
    cuts = []
    try:
        info = json.loads(run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", str(args.video)]))
        pts = np.array([float(x["best_effort_timestamp_time"]) for x in info.get("frames", []) if "best_effort_timestamp_time" in x])
        delta = np.diff(pts); vfr = bool(len(delta) and np.max(np.abs(delta - np.median(delta))) > max(.002, frame * .02))
        if len(pts) > 1:
            frames = _extract_frames(args.video)
            changes = []
            for x, y in zip(frames[:-1], frames[1:]): changes.append(float(np.mean(y.astype(float) - x.astype(float))))
            positive = np.asarray([c for c in changes if c > 0])
            med = np.median(positive) if len(positive) else 0; mad = np.median(np.abs(positive - med)) + 1e-5
            cuts = [float(pts[i + 1]) for i, c in enumerate(changes) if c > max(12, med * .25, 6 * mad)]
    except Exception:
        vfr = False
    if args.cuts:
        obj = json.loads(Path(args.cuts).read_text(encoding="utf-8")); cuts = [float(c.get("t", c.get("time", 0))) for c in obj.get("cuts", obj) if isinstance(c, dict)]
    if args.analysis:
        analysis = json.loads(Path(args.analysis).read_text(encoding="utf-8")); events = [float(x) + args.music_start for x in analysis.get("downbeats", [])] + [float(x["t"]) + args.music_start for x in analysis.get("onsets", []) if x.get("strength", 0) > .7]
    else:
        frame_n = max(1, int(.01 * sr)); env = np.sqrt(np.maximum(0, np.convolve(audio_y * audio_y, np.ones(frame_n) / frame_n, mode="same")))
        active = env > max(.01, float(np.max(env)) * .25)
        rises = np.where(np.diff(active.astype(np.int8), prepend=0) > 0)[0]
        events = [float(i / sr) for i in rises]
    pairs, used = [], set()
    for cut in cuts:
        choices = [(abs(t - cut), i, t) for i, t in enumerate(events) if i not in used and abs(t - cut) <= .15]
        if choices:
            _, i, event = min(choices); used.add(i); pairs.append({"cut": cut, "audio": event, "offset_ms": (event - cut) * 1000})
    offsets = np.array([p["offset_ms"] for p in pairs]); med = float(np.median(offsets)) if len(offsets) else None
    mad = float(np.median(np.abs(offsets - med))) if len(offsets) else None
    within1 = float(np.mean(np.abs(offsets) <= frame * 1000)) if len(offsets) else 0
    within2 = float(np.mean(np.abs(offsets) <= 2 * frame * 1000)) if len(offsets) else 0
    step = .01; count = max(1, int(min(vdur, adur) / step) + 1)
    visual_env = np.zeros(count); audio_env = np.zeros(count)
    for t in cuts:
        ix = min(count - 1, max(0, round(t / step))); visual_env[ix] = 1
    for t in events:
        ix = min(count - 1, max(0, round(t / step))); audio_env[ix] = 1
    lag_candidates = range(-30, 31); corr = []
    for lag in lag_candidates:
        shift = abs(lag)
        score = np.dot(visual_env[:-shift or None], audio_env[shift:]) if lag >= 0 else np.dot(visual_env[shift:], audio_env[:-shift or None])
        corr.append(float(score))
    global_lag = float(list(lag_candidates)[int(np.argmax(corr))] * step * 1000) if max(corr, default=0) > 0 else med
    click_band = sosfiltfilt(butter(2, [6000, 16000], fs=sr, btype="bandpass", output="sos"), audio_y) if sr > 32000 and len(audio_y) > sr else audio_y
    clicks = []
    window = max(1, round(.006 * sr)); gap = max(window, round(.024 * sr))
    for t in cuts:
        ix = int(t * sr); lo, hi = max(0, ix - window // 2), min(len(audio_y), ix + window // 2)
        near = float(np.mean(click_band[lo:hi] ** 2)) if hi > lo else 0.0
        side = []
        for start in (ix - gap - window, ix + gap):
            end = start + window
            if start >= 0 and end <= len(audio_y): side.append(float(np.mean(click_band[start:end] ** 2)))
        base = float(np.median(side)) if side else 1e-12
        discontinuity = float(np.max(np.abs(np.diff(audio_y[max(0, ix - 1):min(len(audio_y), ix + 2)])))) if 1 <= ix < len(audio_y) - 1 else 0.0
        clicks.append({"t": t, "hf_ratio": near / max(base, 1e-12), "max_sample_discontinuity": discontinuity, "flag": near / max(base, 1e-12) > 8})
    fail_stream = abs(astart - vstart) > .02 or abs(adur - vdur) > 3 * frame or vfr  # 1-3 frames of AAC tail is normal: warn only
    # A systematic lag (offsets cluster tightly) is a real sync error. Scattered offsets mean cuts and audio hits are not
    # tied together, which is normal for voice-led edits (speech starts after the cut) and a warning for music-led ones.
    systematic = mad is not None and mad <= .75 * frame * 1000
    if fail_stream or (len(pairs) >= 6 and abs(med or 0) > frame * 1000 and systematic): verdict = "FAIL"
    elif len(pairs) >= 6 and not systematic: verdict = "WARN" if args.music_led else "INCONCLUSIVE"
    else: verdict = "WARN" if within1 < .7 or abs(adur - vdur) > frame else "PASS"
    report = {"streams": {"video_start": vstart, "audio_start": astart, "video_duration": vdur, "audio_duration": adur, "duration_diff": adur - vdur, "fps": fps, "vfr": vfr, "sample_rate": int(a.get("sample_rate", 0))}, "pairs": pairs, "median_offset_ms": med, "mad_ms": mad, "within_1_frame_pct": within1 * 100, "within_2_frames_pct": within2 * 100, "free_cuts": len(cuts) - len(pairs), "global_lag_ms": global_lag, "clicks": clicks, "verdict": verdict}
    if args.report: Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("cut (s)     audio (s)   offset (ms)")
    for p in pairs: print(f"{p['cut']:8.3f}   {p['audio']:8.3f}   {p['offset_ms']:9.1f}")
    print(f"{verdict}: {len(pairs)} matched, {report['free_cuts']} free cuts, median {med if med is not None else 'n/a'} ms; {within1*100:.1f}% within 1 frame")
    if verdict in ("FAIL", "WARN") and med is not None and abs(med) > 1: print(f"Fix suggestion: shift audio by {-med:.1f} ms")
    return 1 if verdict == "FAIL" else 0


def _extract_audio(video):
    td = Path("tmp/avsync_work"); td.mkdir(parents=True, exist_ok=True)
    wav = td / "audio.wav"; run(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-map", "0:a:0", "-ac", "1", "-ar", "44100", str(wav)])
    return sf.read(wav, dtype="float32")


def _extract_frames(video):
    td = Path("tmp/avsync_work"); td.mkdir(parents=True, exist_ok=True)
    for old in td.glob("f_*.pgm"): old.unlink()
    out = td / "f_%06d.pgm"
    run(["ffmpeg", "-v", "error", "-i", str(video), "-vf", "scale=160:-1,format=gray", str(out)])
    frames = []
    for p in sorted(td.glob("f_*.pgm")):
        raw = p.read_bytes(); pos = raw.find(b"\n255\n") + 5; header = raw[:pos].split(); w, h = int(header[1]), int(header[2]); frames.append(np.frombuffer(raw[pos:pos + w * h], dtype=np.uint8).reshape(h, w))
    return frames


def offset(args):
    td = Path("tmp/avsync_work"); td.mkdir(parents=True, exist_ok=True); temp = td / "shifted.mp4"
    if args.ms >= 0:
            filt = f"adelay={args.ms}:all=1"
    else:
        shift = -args.ms / 1000
        filt = f"atrim=start={shift:.6f},asetpts=PTS-STARTPTS,apad=pad_dur={shift:.6f}"
    run(["ffmpeg", "-v", "error", "-y", "-i", str(args.video), "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy", "-af", filt, "-c:a", "aac", "-b:a", "256k", "-t", str(probe(args.video)[1].get("duration", 0)), str(temp)])
    Path(args.output).parent.mkdir(parents=True, exist_ok=True); temp.replace(args.output)
    print(f"OK audio offset {args.ms} ms: {args.output}")


def main():
    p = argparse.ArgumentParser(); sp = p.add_subparsers(dest="cmd", required=True)
    c = sp.add_parser("check"); c.add_argument("video", type=Path); c.add_argument("--analysis"); c.add_argument("--cuts"); c.add_argument("--report"); c.add_argument("--music-start", type=float, default=0); c.add_argument("--music-led", action="store_true", help="cuts are meant to land on audio hits: scattered offsets warn instead of being inconclusive")
    o = sp.add_parser("offset"); o.add_argument("video", type=Path); o.add_argument("--ms", type=float, required=True); o.add_argument("-o", "--output", required=True, type=Path)
    a = p.parse_args()
    try: code = check(a) if a.cmd == "check" else offset(a) or 0
    except (ValueError, OSError) as e: print(f"Error: {e}", file=sys.stderr); code = 2
    raise SystemExit(code)


if __name__ == "__main__": sys.stdout.reconfigure(encoding="utf-8"); main()
