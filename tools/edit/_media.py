"""Shared local media helpers. Ported from OpenMontage/lib/media_profiles.py (profile concepts)."""
import json, subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent

def run(args):
    subprocess.run([str(x) for x in args], check=True)
def probe(path):
    p=subprocess.run(["ffprobe","-v","error","-show_streams","-show_format","-of","json",str(path)],capture_output=True,text=True,encoding="utf-8",check=True)
    d=json.loads(p.stdout); v=next((s for s in d["streams"] if s["codec_type"]=="video"),{})
    return {"width":int(v.get("width",0)),"height":int(v.get("height",0)),"fps":eval(v.get("avg_frame_rate","30/1")),"duration":float(d.get("format",{}).get("duration",0))}
def ffmpeg(*args): run(["ffmpeg","-hide_banner","-y",*args])
