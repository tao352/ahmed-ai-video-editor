# Ported from browser-use/video-use helpers/render.py (MIT)
"""Render an EDL: cached extracts, copy concat, overlays, subtitles, two-pass loudnorm."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid

import sys as _sys
from pathlib import Path as _P
_sys.path.insert(0,str(_P(__file__).resolve().parent))  # allow python -I
from grade import grade_filter, filter_path

REPO = Path(__file__).resolve().parents[2]


@contextmanager
def scratch(parent):
    # Normal mkdir inherits the project ACL. Python 3.12's private temp-directory
    # ACL can prevent child FFmpeg processes from opening files in this sandbox.
    path = parent / f"render_{uuid.uuid4().hex}"
    path.mkdir()
    try:
        yield path
    finally:
        shutil.rmtree(path)


def run(args, cwd=None):
    proc = subprocess.run([str(a) for a in args], cwd=cwd, capture_output=True,
                          text=True, encoding="utf-8", errors="replace")
    if proc.returncode:
        raise RuntimeError(f"{args[0]} failed:\n{proc.stderr[-8000:]}")
    return proc


def ffmpeg(args, cwd=None):
    return run(["ffmpeg", "-hide_banner", "-nostats", "-y", *args], cwd)


def probe(path):
    return json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format",
                           "-of", "json", path]).stdout)


def fingerprint(path):
    stat = path.stat()
    return {"path": str(path.resolve()), "size": stat.st_size, "mtime_ns": stat.st_mtime_ns}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode("utf-8")).hexdigest()[:24]


def resolve_path(value, edit):
    """Files resolve relative to the EDL, then its project parent."""
    path = Path(value)
    if path.is_absolute():
        return path.resolve()
    for base in (edit, edit.parent):
        candidate = (base / path).resolve()
        if candidate.exists():
            return candidate
    raise ValueError(f"File not found relative to EDL or project: {value}")


def source_entry(value, edit):
    entry = {"file": value} if isinstance(value, str) else dict(value)
    path = entry.get("file", entry.get("path"))
    if not path:
        raise ValueError("Source must be a path or {file/path, mirror?, stabilize?}")
    entry["path"] = resolve_path(path, edit)
    return entry


def video_stream(info):
    return next(s for s in info["streams"] if s["codec_type"] == "video")


def output_spec(edl, first, preview):
    stream = video_stream(first)
    width, height = int(stream["width"]), int(stream["height"])
    rotation = next((s.get("rotation", 0) for s in stream.get("side_data_list", [])
                     if "rotation" in s), 0)
    if round(float(rotation)) % 180:
        width, height = height, width
    output = edl.get("output") or {}
    width, height = int(output.get("width", width)), int(output.get("height", height))
    fps = Fraction(str(output.get("fps") or stream.get("avg_frame_rate") or "30"))
    if min(width, height) < 2 or fps <= 0:
        raise ValueError("Output dimensions must be >=2, fps must be positive")
    if preview:
        if height > width:
            width, height = 720, 1280
        else:
            width, height = round(width * 720 / height / 2) * 2, 720
    if width % 2 or height % 2:
        raise ValueError("H.264 yuv420p dimensions must be even")
    return width, height, str(fps)


def stabilization(entry, info, cache, start, work):
    """Cache full-source detection; align a transform slice to the seeked input."""
    source = entry["path"]
    trf = cache / f"{source.stem}.trf"
    meta = trf.with_suffix(".trf.json")
    fp = {**fingerprint(source), "format": "ascii-v1"}
    valid = trf.exists() and meta.exists() and json.loads(meta.read_text(encoding="utf-8")) == fp
    if not valid:
        ffmpeg(["-i", source, "-vf", "vidstabdetect=shakiness=5:accuracy=15:fileformat=ascii:result=detected.trf",
                "-an", "-f", "null", "-"], work)
        shutil.copy2(work / "detected.trf", trf)
        meta.write_text(json.dumps(fp), encoding="utf-8")
        print(f"Stabilization detected: {trf.name}")
    else:
        print(f"Stabilization cache hit: {trf.name}")
    stream = video_stream(info)
    fps = float(Fraction(stream.get("avg_frame_rate") or stream["r_frame_rate"]))
    first_frame = math.ceil(start * fps - 1e-6)
    lines = []
    for line in trf.read_text(encoding="utf-8").splitlines():
        match = re.match(r"Frame (\d+) ", line)
        if match:
            index = int(match.group(1))
            if index <= first_frame:
                continue
            line = re.sub(r"^Frame \d+", f"Frame {index - first_frame}", line)
        lines.append(line)
    (work / "segment.trf").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return "vidstabtransform=input=segment.trf:smoothing=15:optzoom=1"


def extract_segments(edl, edit, spec, preview, work):
    cache = edit / "cache"
    segment_dir = cache / "segments"
    segment_dir.mkdir(parents=True, exist_ok=True)
    width, height, fps = spec
    preset, crf = ("veryfast", "28") if preview else ("fast", "18")
    sources = {key: source_entry(value, edit) for key, value in edl["sources"].items()}
    infos = {key: probe(entry["path"]) for key, entry in sources.items()}
    paths = []
    for i, item in enumerate(edl["ranges"]):
        entry = sources[item["source"]]
        source = entry["path"]
        start, end = float(item["start"]), float(item["end"])
        source_duration = float(infos[item["source"]]["format"]["duration"])
        if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end <= source_duration + .05):
            raise ValueError(f"Invalid range {i}: {start}-{end}, source duration {source_duration}")
        duration = end - start
        grade = grade_filter(item.get("grade", edl.get("grade", "none")))
        flags = {k: bool(item.get(k, entry.get(k, False))) for k in ("mirror", "stabilize")}
        # optional static RGBA layer (wall decor) composited inside the grade, right after `after`
        decor = item.get("decor", edl.get("decor"))
        decor_key = None
        if decor:
            decor_path = (edit / decor["image"]).resolve()
            decor_key = [fingerprint(decor_path), decor.get("after", "")]
        key = digest({"version": 4, "source": fingerprint(source), "start": start, "end": end,
                      "grade": grade, "flags": flags, "output": spec, "preview": preview,
                      **({"decor": decor_key} if decor_key else {})})
        target = segment_dir / f"{key}.mkv"
        if target.exists() and target.stat().st_size:
            print(f"Segment {i+1}: cache hit {key}")
            paths.append(target)
            continue
        filters = ["setpts=PTS-STARTPTS"]
        if flags["stabilize"]:
            filters.append(stabilization(entry, infos[item["source"]], cache, start, work))
        if flags["mirror"]:
            filters.append("hflip")
        if grade:
            filters.append(grade)
        filters += [f"scale={width}:{height}:force_original_aspect_ratio=decrease",
                    f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2", "setsar=1", f"fps={fps}", "format=yuv420p"]
        chain = ",".join(filters)
        if decor:
            after = decor.get("after", "")
            cut = chain.index(after) + len(after) if after and after in chain else len("setpts=PTS-STARTPTS")
            image = filter_path(decor_path)
            chain = (f"[in]{chain[:cut]}[base];movie={image},format=rgba[decor];"
                     f"[base][decor]overlay=0:0:format=auto{chain[cut:]}[out]")
        args = ["-ss", str(start), "-i", source]
        audio = any(s["codec_type"] == "audio" for s in infos[item["source"]]["streams"])
        if not audio:
            args += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        args += ["-t", str(duration), "-map", "0:v:0", "-map", "0:a:0" if audio else "1:a:0",
                 "-vf", chain, "-af",
                 f"asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.03,afade=t=out:st={max(0,duration-.03)}:d=0.03",
                 "-c:v", "libx264", "-preset", preset, "-crf", crf,
                 "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"]
        temporary = target.with_suffix(".partial.mkv")
        try:
            ffmpeg([*args, temporary], work)
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
        print(f"Segment {i+1}: extracted {start:.3f}-{end:.3f} -> {key}")
        paths.append(target)
    return paths


def timestamp(seconds):
    ms = max(0, round(seconds * 1000))
    hours, ms = divmod(ms, 3600000)
    minutes, ms = divmod(ms, 60000)
    seconds, ms = divmod(ms, 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02},{ms:03}"


def build_master_srt(edl, edit):
    cues, offset = [], 0.0
    for item in edl["ranges"]:
        entry = source_entry(edl["sources"][item["source"]], edit)
        path = edit / "transcripts" / f"{entry['path'].stem}.json"
        if not path.exists():
            raise ValueError(f"Cannot build subtitles: missing {path}")
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        start, end = float(item["start"]), float(item["end"])
        words = [w for w in data["words"] if w["s"] < end and w["e"] > start and w["w"].strip()]
        chunk = []
        for i, word in enumerate(words):
            chunk.append(word)
            nxt = words[i+1] if i+1 < len(words) else None
            if (len(chunk) == 3 or nxt is None or word["w"].rstrip()[-1] in ".!?،؟؛:;," or
                nxt["s"] - word["e"] >= .3 or
                (len(chunk) >= 2 and word["e"] - chunk[0]["s"] >= .35)):
                a = max(start, chunk[0]["s"]) - start + offset
                b = min(end, chunk[-1]["e"]) - start + offset
                text = " ".join(w["w"].strip() for w in chunk).replace("\n", " ")
                if b > a:
                    cues.append((a, b, text))
                chunk = []
        offset += end - start
    target = edit / "master.srt"
    target.write_text("\n\n".join(f"{i}\n{timestamp(a)} --> {timestamp(b)}\n{text}"
                                    for i, (a,b,text) in enumerate(cues,1)) + "\n", encoding="utf-8")
    print(f"Master SRT: {len(cues)} cues")
    return target


def composite(base, edl, edit, subs, work, preview):
    overlays = edl.get("overlays") or []
    if not overlays and subs is None:
        return base
    args, graph, current = ["-i", base], [], "[0:v]"
    for i, overlay in enumerate(overlays, 1):
        path = resolve_path(overlay["file"], edit)
        if path.suffix.lower() == ".webm":
            args += ["-c:v", "libvpx-vp9" if video_stream(probe(path))["codec_name"] == "vp9" else "libvpx"]
        args += ["-i", path]
        start, duration = float(overlay["start_in_output"]), float(overlay["duration"])
        if start < 0 or duration <= 0:
            raise ValueError("Overlay start must be >=0 and duration >0")
        graph.append(f"[{i}:v]trim=duration={duration},setpts=PTS-STARTPTS+{start}/TB[ov{i}]")
        graph.append(f"{current}[ov{i}]overlay=x={int(overlay.get('x',0))}:y={int(overlay.get('y',0))}:"
                     f"eof_action=pass:repeatlast=0:enable='gte(t,{start})*lt(t,{start+duration})'[v{i}]")
        current = f"[v{i}]"
    if subs is not None:
        shutil.copyfile(subs, work / "captions.srt")
        fonts = REPO / "capcut_assets/fonts"
        style = "FontName=IBM Plex Sans Arabic,FontSize=18,Bold=1,Outline=2,Shadow=0,MarginV=35"
        graph.append(f"{current}subtitles=filename=captions.srt:fontsdir={filter_path(fonts)}:force_style='{style}'[captions]")
        current = "[captions]"
    graph.append(f"{current}format=yuv420p[outv]")
    target = work / "composite.mkv"
    ffmpeg([*args, "-filter_complex", ";".join(graph), "-map", "[outv]", "-map", "0:a:0",
            "-c:v", "libx264", "-preset", "veryfast" if preview else "fast",
            "-crf", "28" if preview else "18", "-c:a", "copy", target], work)
    print(f"Composite: {len(overlays)} overlays; subtitles LAST: {subs is not None}")
    return target


def loudnorm(input_path, output_path, enabled):
    args = ["-i", input_path, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy"]
    if enabled:
        settings = "loudnorm=I=-14:TP=-1:LRA=11"
        result = ffmpeg(["-i", input_path, "-af", settings + ":print_format=json", "-vn", "-f", "null", "-"])
        match = re.search(r'\{\s*"input_i".*?\}', result.stderr, re.S)
        if not match:
            raise ValueError("loudnorm measurement did not return JSON")
        m = json.loads(match.group())
        if not all(math.isfinite(float(m[k])) for k in ("input_i","input_tp","input_lra","input_thresh","target_offset")):
            print("WARNING: silent audio has no finite loudness; preserving silence")
        else:
            settings += (f":measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
                         f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:"
                         f"offset={m['target_offset']}:linear=true")
            # loudnorm's true-peak target is not exact after AAC encoding: add a -1.5 dBFS limiter as the ceiling.
            args += ["-af", settings + ",aresample=48000,alimiter=limit=0.84:attack=5:release=50:level=0"]
            print(f"Loudnorm two-pass: measured {m['input_i']} LUFS -> I=-14 TP=-1 LRA=11")
    ffmpeg([*args, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", output_path])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("edl", type=Path)
    ap.add_argument("-o", "--output", type=Path, required=True)
    ap.add_argument("--preview", action="store_true", help="720p, veryfast, CRF 28")
    ap.add_argument("--draft", action="store_true", help="Alias of --preview")
    ap.add_argument("--force-unapproved", action="store_true")
    ap.add_argument("--build-subtitles", action="store_true")
    ap.add_argument("--no-subtitles", action="store_true")
    ap.add_argument("--no-loudnorm", action="store_true")
    a = ap.parse_args()
    edit = a.edl.resolve().parent
    preview = a.preview or a.draft
    approval = edit / "approval.json"
    state = json.loads(approval.read_text(encoding="utf-8-sig")) if approval.exists() else {}
    if not preview and any(state.get(k) != "approved" for k in ("plan","storyboard")):
        if a.force_unapproved:
            print("WARNING: --force-unapproved overrides pending plan/storyboard approval")
        else:
            ap.error("Full render refused: plan and storyboard must both be approved in edit/approval.json")
    edl = json.loads(a.edl.read_text(encoding="utf-8-sig"))
    if edl.get("version",1) != 1 or not edl.get("ranges"):
        ap.error("EDL version must be 1 and ranges must be nonempty")
    first = source_entry(edl["sources"][edl["ranges"][0]["source"]], edit)
    spec = output_spec(edl, probe(first["path"]), preview)
    output = a.output.resolve()
    if output in [source_entry(s,edit)["path"] for s in edl["sources"].values()]:
        ap.error("output must not overwrite a source")
    output.parent.mkdir(parents=True,exist_ok=True)
    cache = edit / "cache"
    cache.mkdir(parents=True,exist_ok=True)
    with scratch(cache) as temp:
        work = Path(temp)
        paths = extract_segments(edl,edit,spec,preview,work)
        for i,path in enumerate(paths):
            try:
                (work / f"seg{i}.mkv").hardlink_to(path)
            except OSError:
                shutil.copyfile(path,work / f"seg{i}.mkv")
        (work/"concat.txt").write_text("".join(f"file 'seg{i}.mkv'\n" for i in range(len(paths))),encoding="utf-8")
        base = work/"base.mkv"
        ffmpeg(["-f","concat","-safe","0","-i","concat.txt","-c","copy",base],work)
        print("Concat: lossless -c copy")
        subs = None
        if not a.no_subtitles:
            if a.build_subtitles:
                subs = build_master_srt(edl,edit)
            elif edl.get("subtitles"):
                subs = resolve_path(edl["subtitles"],edit)
        composed = composite(base,edl,edit,subs,work,preview)
        loudnorm(composed,output,not a.no_loudnorm)
    print(f"Rendered {spec[0]}x{spec[1]} @ {spec[2]} fps: {output}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        main()
    except (ValueError,OSError,KeyError,StopIteration,RuntimeError) as exc:
        sys.exit(str(exc))
