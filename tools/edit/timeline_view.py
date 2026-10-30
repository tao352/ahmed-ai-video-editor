# Ported from browser-use/video-use helpers/timeline_view.py (MIT)
"""Filmstrip, RMS waveform, silence shading and Arabic-safe word labels."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys
import uuid

import arabic_reshaper
from bidi.algorithm import get_display
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONT = Path(__file__).resolve().parents[2]/"capcut_assets/fonts/IBMPlexSansArabic-Bold.ttf"


def frame(video,time,target):
    subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-ss",str(time),"-i",str(video),
                    "-frames:v","1","-vf","scale=240:135:force_original_aspect_ratio=decrease,pad=240:135:(ow-iw)/2:(oh-ih)/2",
                    str(target)],check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("video",type=Path)
    ap.add_argument("start",type=float)
    ap.add_argument("end",type=float)
    ap.add_argument("-o","--output",type=Path)
    ap.add_argument("--words","--transcript",dest="words",type=Path)
    ap.add_argument("--frames","--n-frames",dest="frames",type=int,default=8)
    a = ap.parse_args()
    info = json.loads(subprocess.check_output(["ffprobe","-v","error","-show_entries","format=duration","-of","json",str(a.video)]))
    duration = float(info["format"]["duration"])
    if not (0 <= a.start < a.end <= duration+.01) or a.frames < 1:
        ap.error("require 0 <= start < end <= duration and frames >=1")
    output = a.output or a.video.parent/"edit/verify"/f"{a.video.stem}_{a.start:.2f}-{a.end:.2f}.png"
    output.parent.mkdir(parents=True,exist_ok=True)
    work = output.parent/f"timeline_{uuid.uuid4().hex}"
    work.mkdir()
    try:
        font = ImageFont.truetype(str(FONT),15,layout_engine=ImageFont.Layout.BASIC)
        small = ImageFont.truetype(str(FONT),12,layout_engine=ImageFont.Layout.BASIC)
        span = a.end-a.start
        width = max(800,a.frames*244)
        left,right = 20,width-20
        wave_top,wave_bottom = 225,405
        canvas = Image.new("RGB",(width,470),"#121216")
        draw = ImageDraw.Draw(canvas,"RGBA")
        def label(position,text,fill="white",f=font):
            draw.text(position,get_display(arabic_reshaper.reshape(text)),font=f,fill=fill)
        label((20,8),f"{a.video.name}   {a.start:.2f}-{a.end:.2f}s")
        cell = (right-left)/a.frames
        for i,t in enumerate(np.linspace(a.start,max(a.start,a.end-min(.04,span/10)),a.frames)):
            target = work/f"f{i}.png"
            frame(a.video,t,target)
            with Image.open(target) as image:
                image.thumbnail((int(cell)-4,135))
                canvas.paste(image,(int(left+i*cell),42))
            label((int(left+i*cell),180),f"{t:.2f}s",f=small)
        transcript = a.words or a.video.parent/"edit/transcripts"/f"{a.video.stem}.json"
        data = json.loads(transcript.read_text(encoding="utf-8-sig")) if transcript.exists() else {}
        words = [w for w in data.get("words",[]) if w["s"] < a.end and w["e"] > a.start]
        gaps = data.get("silences")
        if gaps is None and data:
            gaps,previous = [],a.start
            for word in words:
                if word["s"]-previous >= .4:
                    gaps.append([previous,word["s"]])
                previous = max(previous,word["e"])
            if a.end-previous >= .4:
                gaps.append([previous,a.end])
        def x(t):
            return left+int((min(a.end,max(a.start,t))-a.start)/span*(right-left))
        draw.rectangle((left,wave_top,right,wave_bottom),fill="#202026")
        audio = subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-ss",str(a.start),
                                "-i",str(a.video),"-t",str(span),"-map","0:a:0","-vn","-ac","1",
                                "-ar","8000","-f","f32le","-"],capture_output=True)
        if audio.returncode==0:
            samples = np.frombuffer(audio.stdout,dtype="<f4")
            bins = np.array_split(samples,right-left)
            envelope = np.array([np.sqrt(np.mean(b*b)) if len(b) else 0 for b in bins])
            envelope /= max(float(envelope.max()),1e-8)
            mid = (wave_top+wave_bottom)//2
            for i,value in enumerate(envelope):
                amplitude = int(value*(wave_bottom-wave_top)/2)
                draw.line((left+i,mid-amplitude,left+i,mid+amplitude),fill=(140,180,255,220))
        # Tint after drawing the waveform so even high-energy audio cannot hide gaps.
        for start,end in gaps or []:
            if start < a.end and end > a.start:
                draw.rectangle((x(start),wave_top,x(end),wave_bottom),fill=(30,50,90,100))
        for i,word in enumerate(words):
            pos = x(word["s"])
            draw.line((pos,wave_top,pos,wave_bottom),fill=(235,235,235,60))
            label((pos,wave_top+8+(i%3)*23),word["w"],f=small)
        for t in np.linspace(a.start,a.end,7):
            label((min(right-45,x(t)),415),f"{t:.2f}s",fill="#aaaaaa",f=small)
        label((left,445),"Shaded bands: silence >= 0.4s",fill="#aaaaaa",f=small)
        canvas.save(output,"PNG")
    finally:
        shutil.rmtree(work)
    print(f"Timeline: {output}")


if __name__=="__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
