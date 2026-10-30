# Ported from browser-use/video-use helpers/grade.py (MIT)
"""FFmpeg color grades shared by the standalone CLI and renderer."""
import argparse
from pathlib import Path
import subprocess
import sys

REPO = Path(__file__).resolve().parents[2]
NATURAL = "eq=brightness=0.05:contrast=0.92:gamma=1.1:saturation=0.95,colorbalance=rs=0.01:bs=-0.01:rm=-0.04:gm=0.005:bm=0.03:rh=-0.02:bh=0.015"


def filter_path(path):
    """Escape a Windows filename in a quoted FFmpeg filter option."""
    return "'" + path.resolve().as_posix().replace(":", "\\:").replace("'", "'\\\\''") + "'"


PRESETS = {
    "none": "",
    "natural": NATURAL,
    "warm_cinematic": (
        "eq=contrast=1.12:brightness=-0.02:saturation=0.88,"
        "colorbalance=rs=0.02:gs=0:bs=-0.03:rm=0.04:gm=0.01:bm=-0.02:rh=0.08:gh=0.02:bh=-0.05,"
        "curves=master='0/0 0.25/0.22 0.75/0.78 1/1'"
    ),
    "neutral_punch": "eq=contrast=1.06:brightness=0:saturation=1,curves=master='0/0 0.25/0.23 0.75/0.77 1/1'",
    "house": f"hqdn3d=1.5:1.5:4:4,lut3d=file={filter_path(REPO / 'work/look/B.cube')},cas=0.5,{NATURAL}",
}


def grade_filter(preset_or_raw):
    if not preset_or_raw:
        return ""
    if preset_or_raw in PRESETS:
        return PRESETS[preset_or_raw]
    if "=" not in preset_or_raw:
        raise ValueError(f"Unknown grade {preset_or_raw!r}; choose {', '.join(PRESETS)} or a raw filter")
    return preset_or_raw


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input", nargs="?", type=Path)
    ap.add_argument("-o", "--output", type=Path)
    ap.add_argument("--preset", choices=PRESETS, default="none")
    ap.add_argument("--filter")
    ap.add_argument("--list-presets", action="store_true")
    a = ap.parse_args()
    if a.list_presets:
        for name, value in PRESETS.items():
            print(f"{name}: {value or '(no filter)'}")
        return
    if a.input is None or a.output is None:
        ap.error("input and -o are required")
    if a.input.resolve() == a.output.resolve():
        ap.error("input and output must differ")
    a.output.parent.mkdir(parents=True, exist_ok=True)
    vf = grade_filter(a.filter if a.filter is not None else a.preset)
    cmd = ["ffmpeg", "-hide_banner", "-y", "-i", str(a.input)]
    if vf:
        cmd += ["-vf", vf]
    cmd += ["-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", "48000", "-movflags", "+faststart", str(a.output)]
    subprocess.run(cmd, check=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
