# Ported from browser-use/video-use helpers/transcribe_batch.py (MIT)
"""Transcribe the videos in a directory with two workers (local CPU or Groq API)."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import sys

VIDEO_EXTENSIONS = {".mp4",".mov",".mkv",".webm",".avi",".m4v",".mts",".m2ts",".mpeg",".mpg",".wmv"}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("videos_dir",type=Path)
    ap.add_argument("--edit-dir",type=Path,required=True)
    ap.add_argument("--engine",choices=["auto","local","groq"],default="auto")
    ap.add_argument("--lang",choices=["ar","en","auto"],default="auto")
    a = ap.parse_args()
    files = sorted(p for p in a.videos_dir.iterdir() if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS)
    if len({p.stem.lower() for p in files}) != len(files):
        ap.error("Video stems collide; rename sources before creating per-stem transcript caches")
    def worker(path):
        return subprocess.run([sys.executable,str(Path(__file__).with_name("transcribe.py")),
                               str(path),"--edit-dir",str(a.edit_dir),"--engine",a.engine,"--lang",a.lang])
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(worker,files))
    if any(result.returncode for result in results):
        sys.exit("One or more transcriptions failed")
    print(f"Completed {len(files)} videos")


if __name__=="__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
