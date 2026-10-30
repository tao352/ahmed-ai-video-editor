"""Media jobs the Studio Editor runs on a project's public/ files (one command per job).

Every command prints progress lines and ends with one line `RESULT {json}` the editor reads.
Paths are relative to the project's public/ folder, and outputs are written next to the source,
so the original is never overwritten.

  lut      <public> <video> <cube>           bake a .cube LUT into a new video file
  voice    <public> <audio> [--preset pro]   clean voice chain: denoise, EQ, compressor, de-esser, limiter
  loudness <public> <audio>                  integrated LUFS, true peak and LRA
  beats    <public> <music>                  beat and downbeat times of a music file (music.py analysis)
  proxy    <public> <video>                  light preview copy in public/.proxy/ (half size, keyframe every 10 frames)
  thumbs   <public> <video>                  filmstrip sprite for the timeline: one frame per second in public/.proxy/
  reverse  <public> <video> --from S --to E  the stretch S..E of a video played backwards, as a new file
  audio    <public> <video> --from S --to E  the sound of a video's stretch S..E as its own audio file
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
ROOT = HERE.parents[1]

# Voice chains. Order matters: clean the low end and noise first, shape tone, then control dynamics.
# After the chain the level is set in a second pass: gain to -14 LUFS (reels / shorts), then a
# limiter holds the peaks under -1.5 dB.
VOICE_PRESETS = {
    # light touch for good mics
    "light": "highpass=f=70,afftdn=nr=6:nf=-45:tn=1,acompressor=threshold=-18dB:ratio=2:attack=10:release=150:makeup=1.5dB",
    # the default "pro voice": phone/lav recordings in a room
    "pro": ("highpass=f=80,afftdn=nr=12:nf=-40:tn=1,"
            "equalizer=f=250:t=q:w=1:g=-2.5,equalizer=f=3500:t=q:w=1.2:g=2.5,equalizer=f=9000:t=q:w=1:g=1,"
            "acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=3dB,deesser=i=0.45"),
    # heavy: noisy rooms, gym background
    "strong": ("highpass=f=100,afftdn=nr=20:nf=-32:tn=1,"
               "equalizer=f=300:t=q:w=1:g=-3,equalizer=f=3200:t=q:w=1.2:g=3,"
               "acompressor=threshold=-24dB:ratio=4:attack=5:release=100:makeup=4dB,deesser=i=0.55"),
}
TARGET_LUFS = -14.0
CEILING = "alimiter=limit=0.84:level=false:attack=4:release=60"  # 0.84 ~ -1.5 dBFS


def result(payload):
    print("RESULT " + json.dumps(payload, ensure_ascii=False), flush=True)


def inside(public: Path, rel: str) -> Path:
    p = (public / rel).resolve()
    if public.resolve() not in p.parents and p != public.resolve():
        sys.exit(f"path outside public/: {rel}")
    if not p.exists():
        sys.exit(f"missing file: {rel}")
    return p


def run(args):
    print("$ " + " ".join(str(a) for a in args[:6]) + " ...", flush=True)
    r = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode:
        sys.exit(r.stderr[-1500:])
    return r


def measure(path: Path):
    r = run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-map", "0:a:0", "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"])
    summary = r.stderr.rsplit("Summary:", 1)[-1]
    def field(pattern):
        m = re.search(pattern, summary)
        return float(m.group(1)) if m else None
    return {"lufs": field(r"I:\s+(-?[\d.]+) LUFS"), "peak": field(r"Peak:\s+(-?[\d.]+) dBFS"), "lra": field(r"LRA:\s+(-?[\d.]+) LU")}


def rel(public: Path, p: Path) -> str:
    return p.resolve().relative_to(public.resolve()).as_posix()


def cmd_lut(a):
    public = Path(a.public)
    src, cube = inside(public, a.video), inside(public, a.cube)
    out = src.with_name(f"{src.stem}.lut-{cube.stem}{src.suffix}")
    cube_arg = cube.resolve().as_posix().replace(":", "\\:")
    run(["ffmpeg", "-y", "-hide_banner", "-i", str(src), "-vf", f"lut3d=file='{cube_arg}'", "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "copy", str(out)])
    result({"src": rel(public, out), "from": a.video, "lut": a.cube})


def cmd_voice(a):
    public = Path(a.public)
    src = inside(public, a.audio)
    chain = VOICE_PRESETS[a.preset]
    out = src.with_name(f"{src.stem}.voice-{a.preset}.wav")
    before = measure(src)
    shaped = out.with_name(out.stem + ".tmp.wav")
    run(["ffmpeg", "-y", "-hide_banner", "-i", str(src), "-vn", "-af", chain, "-ar", "48000", "-ac", "1", str(shaped)])
    level = measure(shaped)["lufs"]
    gain = 0.0 if level is None else TARGET_LUFS - level
    run(["ffmpeg", "-y", "-hide_banner", "-i", str(shaped), "-af", f"volume={gain:.2f}dB,{CEILING}", "-ar", "48000", str(out)])
    shaped.unlink(missing_ok=True)
    after = measure(out)
    result({"src": rel(public, out), "from": a.audio, "preset": a.preset, "before": before, "after": after})


def cmd_loudness(a):
    public = Path(a.public)
    result({"file": a.audio, **measure(inside(public, a.audio))})


def cmd_beats(a):
    import os
    os.chdir(ROOT)  # music.py keeps its cache under work/music_cache
    from music import analyze
    info = analyze(inside(Path(a.public), a.music))
    result({"file": a.music, "tempo": info.get("tempo"), "beats": [round(t, 3) for t in info.get("beats", [])], "downbeats": [round(t, 3) for t in info.get("downbeats", [])]})


PROXY_DIR = ".proxy"


def proxy_name(rel_path: str) -> str:
    """public/.proxy/<path with / as __>.<mp4|webm>; the editor computes the same name."""
    stem = re.sub(r"[\\/]", "__", rel_path)
    return f"{PROXY_DIR}/{stem}.{'webm' if rel_path.lower().endswith('.webm') else 'mp4'}"


def cmd_proxy(a):
    # Like CapCut's proxy media: the editor's live preview decodes these small, seek-friendly
    # copies; renders always use the original file.
    public = Path(a.public)
    src = inside(public, a.video)
    out = public / proxy_name(a.video)
    out.parent.mkdir(exist_ok=True)
    tmp = out.with_name(out.stem + ".part" + out.suffix)
    half = "scale=trunc(iw/4)*2:trunc(ih/4)*2"
    if out.suffix == ".webm":
        # keep the alpha: decode with libvpx so the alpha plane is read, encode fast VP9 with alpha
        args = ["ffmpeg", "-y", "-hide_banner", "-c:v", "libvpx-vp9", "-i", str(src), "-an", "-vf", half,
                "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-deadline", "realtime", "-cpu-used", "8",
                "-row-mt", "1", "-b:v", "900k", "-g", "10", "-auto-alt-ref", "0", str(tmp)]
    else:
        args = ["ffmpeg", "-y", "-hide_banner", "-i", str(src), "-an", "-vf", half, "-c:v", "libx264",
                "-preset", "veryfast", "-crf", "24", "-g", "10", "-keyint_min", "10", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", str(tmp)]
    run(args)
    tmp.replace(out)
    result({"proxy": rel(public, out), "from": a.video})


def cmd_reverse(a):
    # CapCut "reverse": a new file holding only the chosen stretch, backwards. Alpha mattes (.webm)
    # keep their alpha so a reversed footage piece and its matte still line up.
    public = Path(a.public)
    src = inside(public, a.video)
    start, end = float(a.start), float(a.end)
    if end - start < 0.05:
        sys.exit("the stretch is too short to reverse")
    out = src.with_name(f"{src.stem}.rev-{start:.2f}-{end:.2f}{src.suffix}")
    alpha = src.suffix.lower() == ".webm"
    args = ["ffmpeg", "-y", "-hide_banner"] + (["-c:v", "libvpx-vp9"] if alpha else []) + [
        "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", str(src), "-vf", "reverse", "-an"]
    args += (["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "4M", "-deadline", "realtime", "-cpu-used", "6", "-row-mt", "1"]
             if alpha else ["-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"])
    run(args + [str(out)])
    result({"file": rel(public, out), "from": a.video, "start": start, "end": end})


def cmd_audio(a):
    # CapCut "extract audio": the video's own sound becomes a separate file the edit can place.
    public = Path(a.public)
    src = inside(public, a.video)
    start, end = float(a.start), float(a.end)
    out = src.with_name(f"{src.stem}.audio-{start:.2f}-{end:.2f}.m4a")
    run(["ffmpeg", "-y", "-hide_banner", "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", str(src), "-vn", "-c:a", "aac", "-b:a", "192k", str(out)])
    if not out.exists() or out.stat().st_size < 1000:
        sys.exit("this video has no sound to extract")
    result({"file": rel(public, out), "from": a.video, "start": start, "end": end})


THUMB_H = 64
THUMB_COLS = 20


def cmd_thumbs(a):
    # One small frame per second, tiled 20 across, plus a JSON with the layout; the editor draws
    # the footage lane's filmstrip from it (CapCut shows thumbnails on the main track).
    public = Path(a.public)
    src = inside(public, a.video)
    stem = proxy_name(a.video).rsplit(".", 1)[0]
    sprite, meta = public / f"{stem}.thumbs.jpg", public / f"{stem}.thumbs.json"
    sprite.parent.mkdir(exist_ok=True)
    r = run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", str(src)])
    info = json.loads(r.stdout)
    w0, h0 = info["streams"][0]["width"], info["streams"][0]["height"]
    count = max(1, int(float(info["format"]["duration"])) + 1)
    tw = max(2, round(THUMB_H * w0 / h0 / 2) * 2)
    rows = (count + THUMB_COLS - 1) // THUMB_COLS
    tmp = sprite.with_name(sprite.stem + ".part.jpg")
    run(["ffmpeg", "-y", "-hide_banner", "-i", str(src), "-an", "-vf",
         f"fps=1,scale={tw}:{THUMB_H},tile={THUMB_COLS}x{rows}", "-frames:v", "1", "-q:v", "5", str(tmp)])
    tmp.replace(sprite)
    meta.write_text(json.dumps({"sprite": rel(public, sprite), "every": 1, "w": tw, "h": THUMB_H, "cols": THUMB_COLS, "count": count}), encoding="utf-8")
    result({"thumbs": rel(public, meta), "from": a.video})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    x = sp.add_parser("lut"); x.add_argument("public"); x.add_argument("video"); x.add_argument("cube")
    x = sp.add_parser("voice"); x.add_argument("public"); x.add_argument("audio"); x.add_argument("--preset", choices=sorted(VOICE_PRESETS), default="pro")
    x = sp.add_parser("loudness"); x.add_argument("public"); x.add_argument("audio")
    x = sp.add_parser("beats"); x.add_argument("public"); x.add_argument("music")
    x = sp.add_parser("proxy"); x.add_argument("public"); x.add_argument("video")
    x = sp.add_parser("thumbs"); x.add_argument("public"); x.add_argument("video")
    x = sp.add_parser("audio"); x.add_argument("public"); x.add_argument("video"); x.add_argument("--from", dest="start", required=True); x.add_argument("--to", dest="end", required=True)
    x = sp.add_parser("reverse"); x.add_argument("public"); x.add_argument("video"); x.add_argument("--from", dest="start", required=True); x.add_argument("--to", dest="end", required=True)
    a = ap.parse_args()
    {"lut": cmd_lut, "voice": cmd_voice, "loudness": cmd_loudness, "beats": cmd_beats, "proxy": cmd_proxy, "thumbs": cmd_thumbs, "reverse": cmd_reverse, "audio": cmd_audio}[a.cmd](a)


if __name__ == "__main__":
    main()
