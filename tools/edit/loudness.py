"""Report integrated LUFS, true peak, LRA and RMS for optional sections."""
import argparse
import math
from pathlib import Path
import re
import subprocess
import sys


def measure(file, filters, start=None, duration=None):
    args = ["ffmpeg","-hide_banner","-nostats"]
    if start is not None:
        args += ["-ss",str(start)]
    args += ["-i",str(file)]
    if duration is not None:
        args += ["-t",str(duration)]
    args += ["-map","0:a:0","-vn","-af",filters,"-f","null","-"]
    result = subprocess.run(args,capture_output=True,text=True,encoding="utf-8",errors="replace")
    if result.returncode:
        raise RuntimeError(result.stderr[-2000:])
    return result.stderr


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("file",type=Path)
    ap.add_argument("--sections",default="")
    a = ap.parse_args()
    report = measure(a.file,"ebur128=peak=true").rsplit("Summary:",1)[-1]
    def field(pattern):
        found = re.search(pattern,report)
        return float(found.group(1)) if found else float("nan")
    integrated = field(r"I:\s+([-\w.]+) LUFS")
    lra = field(r"LRA:\s+([-\w.]+) LU")
    peak = field(r"Peak:\s+([-\w.]+) dBFS")
    print("Integrated LUFS | True peak dBTP | LRA LU")
    print(f"{integrated:15.2f} | {peak:14.2f} | {lra:6.2f}")
    if peak > -1:
        print("WARNING: true peak exceeds -1 dBTP")
    sections = []
    for section in a.sections.split(","):
        if not section.strip():
            continue
        start,end = map(float,section.split("-"))
        if not (0 <= start < end):
            ap.error("sections must be positive start-end intervals")
        text = measure(a.file,"astats=metadata=0:reset=0",start,end-start)
        overall = text.rsplit("Overall",1)[-1]
        match = re.search(r"RMS level dB:\s*([-\w.]+)",overall)
        rms = float(match.group(1)) if match else float("nan")
        sections.append((section,rms))
    if sections:
        print("Section        | RMS dBFS")
        # Without speech labels, use the loudest section as dialogue reference.
        reference = max(v for _,v in sections)
        for section,rms in sections:
            print(f"{section:14} | {rms:8.2f}")
            if rms < reference-10:
                print(f"WARNING: {section} is >10 dB below dialogue reference (loudest section)")
    if not math.isfinite(integrated):
        print("WARNING: no finite integrated loudness (possibly silent audio)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        main()
    except (ValueError,RuntimeError) as exc:
        sys.exit(str(exc))
