"""Real CLI integration smoke. All generated artifacts stay under tmp/edit_smoke."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import time

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
TOOLS = ROOT / "tools/edit"
TMP = ROOT / "tmp/edit_smoke"


def command(args, label, expected=0):
    result = subprocess.run([str(a) for a in args], capture_output=True, text=True,
                            encoding="utf-8", errors="replace", env={**os.environ,"PYTHONUTF8":"1",
                            "HF_HUB_OFFLINE":"1","PYTHONDONTWRITEBYTECODE":"1"})
    if (expected == 0 and result.returncode != 0) or (expected != 0 and result.returncode == 0):
        raise AssertionError(f"{label}: return code {result.returncode}\n{result.stdout}\n{result.stderr}")
    print(f"OK {label}",flush=True)
    return result


def tool(name,*args,**kwargs):
    return command([sys.executable,"-B",TOOLS/name,*args],**kwargs)


def probe(path):
    r = subprocess.run(["ffprobe","-v","error","-show_streams","-show_format","-of","json",str(path)],
                       capture_output=True,text=True,check=True)
    return json.loads(r.stdout)


def verify(path, width, height):
    info = probe(path)
    duration = float(info["format"]["duration"])
    assert abs(duration-4.0) < .12, duration
    v = next(s for s in info["streams"] if s["codec_type"]=="video")
    a = next(s for s in info["streams"] if s["codec_type"]=="audio")
    assert (v["width"],v["height"],v["codec_name"],v["pix_fmt"]) == (width,height,"h264","yuv420p"),v
    assert a["codec_name"]=="aac" and a["sample_rate"]=="48000",a
    assert v["avg_frame_rate"]=="30/1",v
    print(f"OK output probe: {duration:.3f}s (expected 4.000), {width}x{height}, H.264/yuv420p + AAC/48k",flush=True)


def main():
    TMP.mkdir(parents=True,exist_ok=True)
    # Use a fresh run folder so a previous run cannot conceal extraction failures.
    run = TMP / f"run_{time.time_ns()}"
    run.mkdir()
    edit = run/"edit"
    (edit/"transcripts").mkdir(parents=True)
    source = run/"synthetic source.mp4"
    command(["ffmpeg","-hide_banner","-y","-f","lavfi","-i","testsrc2=size=640x360:rate=30",
             "-f","lavfi","-i","sine=frequency=440:sample_rate=48000:duration=6","-t","6",
             "-c:v","libx264","-preset","veryfast","-pix_fmt","yuv420p","-c:a","aac",source],
            "generate 6s testsrc2 + sine")
    words = [{"w":w,"s":s,"e":e,"p":.99} for w,s,e in [
        ("Hello",.1,.45),("world",.5,.9),("مرحبا",1.2,1.5),("بكم",1.55,1.9),
        ("Second",3.1,3.45),("range",3.5,3.9),("ends",4.3,4.6),("here",4.65,4.9)]]
    transcript = edit/"transcripts"/f"{source.stem}.json"
    stat = source.stat()
    transcript.write_text(json.dumps({"source":str(source),"fingerprint":{"size":stat.st_size,"mtime_ns":stat.st_mtime_ns},"duration":6,"language":"en","words":words,
                                     "silences":[[1.9,3.1]],"peak_dbfs":-18},ensure_ascii=False),encoding="utf-8")
    print("OK fake word transcript (Whisper intentionally not run)",flush=True)
    cached = tool("transcribe.py",source,"--edit-dir",edit,label="transcribe fingerprint cache (no Whisper invocation)")
    assert "Cached:" in cached.stdout
    no_audio = run/"no audio.mp4"
    command(["ffmpeg","-hide_banner","-y","-i",source,"-map","0:v:0","-c:v","copy","-an",no_audio],
            "create source without audio")
    guard = tool("transcribe.py",no_audio,"--edit-dir",edit,label="transcribe refuses missing audio (no Whisper invocation)",expected=1)
    assert "has no audio stream" in guard.stderr
    tool("pack_transcripts.py","--edit-dir",edit,label="pack transcripts")
    packed = (edit/"takes_packed.md").read_text(encoding="utf-8")
    assert "Hello world" in packed and "مرحبا" in packed and "duration: 6.0s" in packed,packed
    tool("timeline_view.py",source,"0","5","--words",transcript,"--frames","4","-o",run/"timeline.png",
         label="timeline with waveform, silence shading and Arabic labels")
    tool("grade.py","--list-presets",label="grade presets list")
    for preset in ("none","natural","warm_cinematic","neutral_punch","house"):
        tool("grade.py",source,"-o",run/f"grade_{preset}.mp4","--preset",preset,label=f"grade {preset}")
    png = run/"alpha overlay.png"
    im = Image.new("RGBA",(96,96),(0,0,0,0))
    ImageDraw.Draw(im).rectangle((10,10,85,85),fill=(255,50,30,160))
    im.save(png)
    overlay = run/"alpha overlay.mov"
    command(["ffmpeg","-hide_banner","-y","-loop","1","-i",png,"-t","1","-r","30",
             "-c:v","qtrle","-pix_fmt","argb",overlay],"generate alpha MOV overlay")
    edl = {"version":1,"sources":{"A":{"path":"../synthetic source.mp4","mirror":True,"stabilize":True}},
           "ranges":[{"source":"A","start":0,"end":2},{"source":"A","start":3,"end":5}],
           "grade":"natural","overlays":[{"file":"../alpha overlay.mov","start_in_output":1,"duration":1}],
           "subtitles":None,"output":{"width":640,"height":360,"fps":30},"total_duration_s":4}
    edl_path = edit/"edl.json"
    edl_path.write_text(json.dumps(edl),encoding="utf-8")
    tool("gate.py",edit,"reset",label="gate reset")
    refused = tool("render.py",edl_path,"-o",run/"refused.mp4",label="full render refused before approval",expected=1)
    assert "must both be approved" in refused.stderr
    assert not (run/"refused.mp4").exists()
    draft = run/"draft.mp4"
    r = tool("render.py",edl_path,"-o",draft,"--draft","--build-subtitles",label="draft render: 2 ranges + alpha overlay + SRT + two-pass loudnorm")
    assert "Loudnorm two-pass" in r.stdout and "Stabilization detected" in r.stdout,r.stdout
    print(r.stdout.strip(),flush=True)
    verify(draft,1280,720)
    assert (edit/"cache"/f"{source.stem}.trf").exists()
    srt = (edit/"master.srt").read_text(encoding="utf-8")
    assert "00:00:02,100" in srt and "مرحبا" in srt,srt
    segments = list((edit/"cache/segments").glob("*.mkv"))
    assert len(segments)==2,segments
    before = {p.name:p.stat().st_mtime_ns for p in segments}
    r = tool("render.py",edl_path,"-o",run/"cached.mp4","--preview","--build-subtitles","--no-loudnorm",
             label="preview cache reuse and --no-loudnorm")
    assert r.stdout.count("Segment ")==2 and r.stdout.count(": cache hit")==2,r.stdout
    assert before == {p.name:p.stat().st_mtime_ns for p in segments}
    # Editing just one range must retain the other cached segment.
    edl["ranges"][1].update(start=3.1,end=5.1)
    edl_path.write_text(json.dumps(edl),encoding="utf-8")
    changed = tool("render.py",edl_path,"-o",run/"changed.mp4","--draft","--no-loudnorm",
                   label="one range edit reuses one segment and extracts one")
    assert changed.stdout.count("Segment ")==2 and changed.stdout.count(": cache hit")==1,changed.stdout
    assert changed.stdout.count(": extracted")==1,changed.stdout
    edl["ranges"][1].update(start=3,end=5)
    edl_path.write_text(json.dumps(edl),encoding="utf-8")
    tool("gate.py",edit,"approve","plan",label="gate approve plan")
    tool("render.py",edl_path,"-o",run/"still_refused.mp4",label="full render still refused without storyboard",expected=1)
    tool("gate.py",edit,"approve","storyboard",label="gate approve storyboard")
    tool("gate.py",edit,"status",label="gate status")
    final = run/"final.mp4"
    tool("render.py",edl_path,"-o",final,"--build-subtitles",label="approved full render")
    verify(final,640,360)
    levels = tool("loudness.py",final,"--sections","0-2,2-4",label="loudness + section RMS report")
    print(levels.stdout.strip(),flush=True)
    assert "True peak dBTP" in levels.stdout and "0-2" in levels.stdout
    tool("contact_sheet.py",final,"-o",run/"every.jpg","--every","1",label="contact sheet --every 1")
    tool("contact_sheet.py",final,"-o",run/"scenes.jpg","--scenes",label="contact sheet --scenes")
    scenes = json.loads((run/"scenes.jpg.scenes.json").read_text(encoding="utf-8"))
    assert scenes and scenes[0]["start"]==0 and scenes[-1]["end"] >= 3.9,scenes
    for name in ("every.jpg","scenes.jpg"):
        with Image.open(run/name) as sheet:
            assert sheet.width >= 320 and sheet.height >= 210
    tool("new_project.py","test_project","--projects-dir",run/"projects","--source",source,
         label="new project under tmp with copied/hard-linked source")
    project = run/"projects/test_project"
    assert (project/"source"/source.name).read_bytes()==source.read_bytes()
    for name in ("project.md","approval.json","LICENSES.md","transcripts","cache","storyboard","verify","animations"):
        assert (project/"edit"/name).exists(),name
    tool("gate.py",edit,"reset",label="gate reset after approval")
    override = tool("render.py",edl_path,"-o",run/"override.mp4","--force-unapproved","--no-loudnorm",
                    label="explicit unapproved override")
    assert "WARNING: --force-unapproved" in override.stdout
    print(f"ALL SMOKE STEPS OK\nArtifacts: {run}",flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
