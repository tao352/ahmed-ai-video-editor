"""Download the two models tracking needs into tools/track/models/ and check them.

  python tools/track/get_models.py          # both (about 185 MB)
  python tools/track/get_models.py --check  # only report what is there

They are not in git (SAM2 alone is larger than GitHub's 100 MB file limit).
"""
import argparse
import hashlib
from pathlib import Path
import sys
import urllib.request

MODELS = Path(__file__).resolve().parent / "models"
FILES = [
    # (file, url, sha256, what for)
    ("sam2.1_hiera_small.pt", "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt",
     "6d1aa6f30de5c92224f8172114de081d104bbd23dd9dc5c58996f0cad5dc4d38", "SAM2: outlines and object tracking"),
    ("blaze_face_short_range.tflite",
     "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite",
     "b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f", "MediaPipe: face tracking"),
]


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    MODELS.mkdir(exist_ok=True)
    ok = True
    for name, url, digest, what in FILES:
        p = MODELS / name
        if p.exists() and sha256(p) == digest:
            print(f"ok       {name}  ({what})")
            continue
        if a.check:
            print(f"missing  {name}  ({what})"); ok = False
            continue
        print(f"download {name} ...", flush=True)
        tmp = p.with_suffix(p.suffix + ".part")
        urllib.request.urlretrieve(url, tmp)
        if sha256(tmp) != digest:
            tmp.unlink()
            print(f"FAILED   {name}: checksum does not match"); ok = False
            continue
        tmp.replace(p)
        print(f"ok       {name}  ({what})")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
