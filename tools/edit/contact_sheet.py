"""Create one FFmpeg-tiled JPG with 320px timestamped thumbnails."""
import argparse
import json
import math
from pathlib import Path
import subprocess
import sys
import shutil
import uuid

from PIL import Image, ImageDraw, ImageFont


def run(args):
    proc = subprocess.run([str(v) for v in args],capture_output=True,text=True,encoding="utf-8",errors="replace")
    if proc.returncode:
        raise RuntimeError(proc.stderr[-3000:])
    return proc


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("video",type=Path)
    ap.add_argument("-o","--output",type=Path,required=True)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--every",type=float,default=5)
    mode.add_argument("--times")
    mode.add_argument("--scenes",action="store_true")
    a = ap.parse_args()
    video = a.video.resolve()
    info = json.loads(run(["ffprobe","-v","error","-show_streams","-show_format","-of","json",video]).stdout)
    duration = float(info["format"]["duration"])
    scenes = None
    if a.scenes:
        from scenedetect import open_video, SceneManager
        from scenedetect.detectors import ContentDetector
        media = open_video(str(video))
        manager = SceneManager()
        manager.add_detector(ContentDetector())
        manager.detect_scenes(media,show_progress=False)
        pairs = manager.get_scene_list(start_in_scene=True)
        scenes = [{"start":s.get_seconds(),"end":e.get_seconds()} for s,e in pairs]
        if not scenes:
            scenes = [{"start":0.0,"end":duration}]
        times = [(s["start"]+s["end"])/2 for s in scenes]
    elif a.times:
        times = [float(t) for t in a.times.split(",")]
    else:
        if a.every <= 0:
            ap.error("--every must be >0")
        times = [i*a.every for i in range(math.ceil(duration/a.every))]
    if not times or any(not math.isfinite(t) or t < 0 or t >= duration for t in times):
        ap.error("thumbnail times must be >=0 and less than video duration")
    output = a.output.resolve()
    output.parent.mkdir(parents=True,exist_ok=True)
    # Scratch stays next to output, so smoke artifacts remain inside its temp root.
    work = output.parent / f"sheet_{uuid.uuid4().hex}"
    work.mkdir()
    try:
        height = 180
        font_path = Path(__file__).resolve().parents[2]/"capcut_assets/fonts/IBMPlexSansArabic-Bold.ttf"
        font = ImageFont.truetype(str(font_path),16) if font_path.exists() else ImageFont.load_default()
        for i,t in enumerate(times):
            frame = work/"frame.png"
            run(["ffmpeg","-hide_banner","-y","-ss",str(t),"-i",video,"-frames:v","1",
                 "-vf","scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2",
                 frame])
            with Image.open(frame) as im:
                canvas = Image.new("RGB",(320,height+30),"#171717")
                canvas.paste(im.convert("RGB"),(0,0))
            ImageDraw.Draw(canvas).text((8,height+3),f"{t:07.2f}s",font=font,fill="white")
            canvas.save(work/f"thumb{i:05}.png")
        columns = min(4,len(times))
        rows = math.ceil(len(times)/columns)
        run(["ffmpeg","-hide_banner","-y","-framerate","1","-i",work/"thumb%05d.png",
             "-vf",f"tile={columns}x{rows}:nb_frames={len(times)}:padding=6:margin=6:color=0x171717",
             "-frames:v","1","-q:v","2",output])
    finally:
        shutil.rmtree(work)
    if scenes is not None:
        Path(str(output)+".scenes.json").write_text(json.dumps(scenes,indent=2),encoding="utf-8")
    print(f"Contact sheet: {len(times)} thumbnails -> {output}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        main()
    except (ValueError,RuntimeError) as exc:
        sys.exit(str(exc))
