"""Reference reel -> style DNA. Downloads a URL with yt-dlp (or takes a local file), measures cut rhythm,
visual-change rate, zooms, speech pace, music tempo, loudness and look, then writes style.json,
style.md (summary + how to apply it to edit.json) and sheet.jpg (1 frame/s, for caption/graphic style).

  python tools/edit/reference.py URL_OR_FILE [-o work/refs/<name>] [--no-transcribe] [--lang auto|ar|en]
  python tools/edit/reference.py --compare work/refs/a/style.json work/refs/b/style.json
"""
import argparse, json, re, subprocess, sys
from pathlib import Path
import numpy as np, cv2
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _media import probe
from _visual import analyze, gaps

ROOT = Path(__file__).resolve().parents[2]


def fetch(src, out):
    """Local file -> itself; URL -> out/source.mp4 via yt-dlp (cached), plus info.json."""
    p = Path(src)
    if p.exists():
        return p.resolve(), {"title": p.stem, "url": None}
    video = out / "source.mp4"
    if not video.exists():
        subprocess.run(["yt-dlp", "--no-playlist", "--no-progress", "-f", "bv*[height<=1920][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
                        "--merge-output-format", "mp4", "--write-info-json", "-o", str(out / "source.%(ext)s"), src], check=True)
    meta = {}
    info = out / "source.info.json"
    if info.exists():
        d = json.loads(info.read_text(encoding="utf-8"))
        meta = {k: d.get(k) for k in ("title", "uploader", "webpage_url", "view_count", "like_count", "upload_date")}
    meta["url"] = src
    return video, meta


def audio_stats(video):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(video), "-map", "0:a:0?", "-af", "ebur128", "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace").stderr
    m = re.findall(r"I:\s*(-?[\d.]+) LUFS", r)
    out = {"lufs": float(m[-1]) if m else None, "tempo_bpm": None, "beats": []}
    try:
        import librosa
        sr = 22050
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(video), "-map", "0:a:0", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                             capture_output=True, check=True).stdout
        y = np.frombuffer(raw, np.float32)
        if len(y) > sr:
            tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
            out["tempo_bpm"] = round(float(np.atleast_1d(tempo)[0]), 1)
            out["beats"] = [round(float(b), 3) for b in librosa.frames_to_time(beats, sr=sr)]
    except Exception as exc:  # no audio stream or librosa missing: keep the visual report
        out["error"] = str(exc)[:120]
    return out


def speech_stats(video, out, lang):
    from transcribe import transcribe_one
    try:
        data = json.loads(transcribe_one(video, out, "medium", lang).read_text(encoding="utf-8-sig"))
    except (ValueError, subprocess.CalledProcessError) as exc:
        return {"error": str(exc)[:120]}
    words, dur = data["words"], data["duration"] or 1
    if not words:
        return {"words": 0, "language": data.get("language")}
    talk = sum(w["e"] - w["s"] for w in words)
    pauses = [b - a for a, b in data["silences"]]
    return {"language": data.get("language"), "words": len(words), "wpm": round(len(words) / dur * 60),
            "speech_ratio": round(talk / dur, 2), "first_word_at": words[0]["s"],
            "longest_pause": round(max(pauses), 2) if pauses else 0,
            "hook_text": " ".join(w["w"] for w in words if w["s"] < 3.0)}


def sheet(thumbs, path, cols=6):
    if not thumbs:
        return
    h, w = thumbs[0].shape[:2]; tiles = []
    for i, img in enumerate(thumbs[:60]):
        t = cv2.resize(img, (w * 2, h * 2), interpolation=cv2.INTER_CUBIC)
        cv2.putText(t, f"{i}s", (6, 22), cv2.FONT_HERSHEY_SIMPLEX, .6, (0, 0, 0), 3); cv2.putText(t, f"{i}s", (6, 22), cv2.FONT_HERSHEY_SIMPLEX, .6, (255, 255, 255), 1)
        tiles.append(t)
    while len(tiles) % cols:
        tiles.append(np.zeros_like(tiles[0]))
    rows = [np.hstack(tiles[i:i + cols]) for i in range(0, len(tiles), cols)]
    cv2.imwrite(str(path), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 85])


def summarize(v, info, meta, aud, sp):
    dur = info["duration"] or v["duration"]
    shots = np.diff([0.0] + v["cuts"] + [dur]) if dur else np.array([dur])
    g = gaps(v["events"], dur)
    ga = gaps(sorted(v["events"] + v["small"]), dur)
    beats = np.array(aud.get("beats") or [])
    on_beat = round(float(np.mean([np.min(np.abs(beats - c)) < .09 for c in v["cuts"]])), 2) if len(beats) and v["cuts"] else None
    ev = len(v["events"]) / dur if dur else 0
    style = {
        "source": {**meta, "duration": round(dur, 2), "width": info["width"], "height": info["height"], "fps": round(info["fps"], 2)},
        "cuts": {"count": len(v["cuts"]), "per_min": round(len(v["cuts"]) / dur * 60, 1), "avg_shot": round(float(shots.mean()), 2),
                 "median_shot": round(float(np.median(shots)), 2), "min_shot": round(float(shots.min()), 2), "max_shot": round(float(shots.max()), 2),
                 "first_cut": v["cuts"][0] if v["cuts"] else None, "on_beat_ratio": on_beat, "times": v["cuts"]},
        "visual": {"events": len(v["events"]), "events_per_sec": round(ev, 2), "avg_gap": round(dur / max(1, len(v["events"]) + 1), 2),
                   "longest_static": g[0][2] if g else dur, "static_stretches": [list(x) for x in g if x[2] >= 2.5][:10],
                   "events_first_3s": sum(1 for e in v["events"] if e < 3), "times": v["events"],
                   "small_events": len(v["small"]), "any_change_every": round(dur / max(1, len(v["events"]) + len(v["small"]) + 1), 2),
                   "longest_without_any": ga[0][2] if ga else dur, "small_times": v["small"]},
        "zoom": {"punches": v["punches"], "punch_per_min": round(len(v["punches"]) / dur * 60, 1), "pushes": v["pushes"]},
        "speech": sp, "audio": {k: aud.get(k) for k in ("lufs", "tempo_bpm")}, "look": v["look"],
    }
    # Targets for our own edit: what pace.py checks against, and starting values for edit.json.
    # max_gap = big visual change (cut, graphic, layout, zoom); max_gap_any also counts caption-level changes.
    style["targets"] = {"max_gap": round(min(6.0, max(1.5, float(np.percentile([x[2] for x in g], 90)) * 1.1)), 2) if g else 4.0,
                        "max_gap_any": round(min(3.0, max(.8, float(np.percentile([x[2] for x in ga], 90)) * 1.1)), 2) if ga else 2.0,
                        "cut_every": style["cuts"]["avg_shot"], "zoom_every": round(60 / style["zoom"]["punch_per_min"], 1) if style["zoom"]["punch_per_min"] else None,
                        "hook_events_3s": style["visual"]["events_first_3s"], "lufs": style["audio"]["lufs"]}
    return style


def markdown(s, name):
    c, v, z, sp, a, lk, tg = s["cuts"], s["visual"], s["zoom"], s["speech"], s["audio"], s["look"], s["targets"]
    src = s["source"]
    L = [f"# Style DNA: {src.get('title') or name}", "",
         f"Source: {src.get('webpage_url') or src.get('url') or 'local file'} | {src['width']}x{src['height']} {src['fps']} fps | {src['duration']} s"
         + (f" | {src['view_count']:,} views" if src.get("view_count") else ""), "",
         "| Metric | Value |", "|---|---|",
         f"| Cuts | {c['count']} ({c['per_min']}/min), avg shot {c['avg_shot']} s, median {c['median_shot']} s, first cut {c['first_cut']} s |",
         f"| Cuts on the beat | {c['on_beat_ratio'] if c['on_beat_ratio'] is not None else 'n/a'} |",
         f"| Big visual change (cut/graphic/layout) | {v['events_per_sec']}/s (one every {v['avg_gap']} s), longest without {v['longest_static']} s, {v['events_first_3s']} in first 3 s |",
         f"| Any change (incl. captions, small graphics) | one every {v['any_change_every']} s, longest without {v['longest_without_any']} s |",
         f"| Zoom punches | {len(z['punches'])} ({z['punch_per_min']}/min); slow pushes {len(z['pushes'])} |",
         f"| Speech | {sp.get('wpm', '-')} wpm, talking {sp.get('speech_ratio', '-')} of the time, first word {sp.get('first_word_at', '-')} s, longest pause {sp.get('longest_pause', '-')} s |",
         f"| Music / loudness | {a['tempo_bpm']} BPM, {a['lufs']} LUFS |",
         f"| Look | brightness {lk['brightness']}, contrast {lk['contrast']}, saturation {lk['saturation']}, warmth {lk['warmth']}, palette {' '.join(lk['palette'])} |", ""]
    if sp.get("hook_text"):
        L += [f"Hook (first 3 s): \"{sp['hook_text']}\"", ""]
    if v["static_stretches"]:
        L += ["Stretches without a big change (>=2.5 s): " + ", ".join(f"{a}-{b}" for a, b, _ in v["static_stretches"]), ""]
    L += ["## Apply to our edit", "",
          f"- Big visual change (cut, graphic, layout, zoom) at least every **{tg['max_gap']} s**; something changes on screen at least every **{tg['max_gap_any']} s** (check: `python tools/edit/pace.py <edit.json> --target style.json`).",
          f"- Cut or switch layout about every **{tg['cut_every']} s**; put {tg['hook_events_3s']}+ visual events in the first 3 s.",
          f"- Zoom punch about every **{tg['zoom_every']} s**." if tg["zoom_every"] else "- The reference uses no punch zooms; rely on cuts and graphics.",
          f"- Mix to about {tg['lufs']} LUFS." if tg["lufs"] is not None else "",
          "- Open sheet.jpg (1 frame per second) and note caption font, size, position, colours, words per line, and graphic types; write them under ## Caption & graphics below.",
          "", "## Caption & graphics (fill in after viewing sheet.jpg)", "", "- captions:", "- graphics:", "- transitions:", ""]
    return "\n".join(x for x in L if x is not None)


def compare(paths):
    rows = [("cuts/min", "cuts.per_min"), ("avg shot s", "cuts.avg_shot"), ("events/s", "visual.events_per_sec"), ("longest static s", "visual.longest_static"),
            ("events first 3s", "visual.events_first_3s"), ("punch/min", "zoom.punch_per_min"), ("wpm", "speech.wpm"), ("BPM", "audio.tempo_bpm"), ("LUFS", "audio.lufs")]
    data = [json.loads(Path(p).read_text(encoding="utf-8")) for p in paths]
    get = lambda d, k: (lambda a, b: d.get(a, {}).get(b))(*k.split("."))
    print("| metric | " + " | ".join(Path(p).parent.name for p in paths) + " |\n|---|" + "---|" * len(paths))
    for label, key in rows:
        print(f"| {label} | " + " | ".join(str(get(d, key)) for d in data) + " |")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", nargs="?")
    ap.add_argument("-o", "--out", type=Path)
    ap.add_argument("--no-transcribe", action="store_true")
    ap.add_argument("--lang", choices=["auto", "ar", "en"], default="auto")
    ap.add_argument("--compare", nargs="+", metavar="STYLE_JSON")
    a = ap.parse_args()
    if a.compare:
        return compare(a.compare)
    if not a.source:
        ap.error("source is required")
    name = re.sub(r"[^\w-]+", "_", Path(a.source).stem if Path(a.source).exists() else a.source.rstrip("/").split("/")[-1].split("?")[0])[:40] or "ref"
    out = (a.out or ROOT / "work" / "refs" / name).resolve(); out.mkdir(parents=True, exist_ok=True)
    video, meta = fetch(a.source, out)
    info = probe(video)
    print(f"Analysing {video.name}: {info['width']}x{info['height']} {info['duration']:.1f}s")
    v = analyze(video)
    aud = audio_stats(video)
    sp = {} if a.no_transcribe else speech_stats(video, out, a.lang)
    style = summarize(v, info, meta, aud, sp)
    (out / "style.json").write_text(json.dumps(style, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "style.md").write_text(markdown(style, name), encoding="utf-8")
    sheet(v["thumbs"], out / "sheet.jpg")
    print(markdown(style, name).split("## Apply")[0])
    print(f"Wrote {out / 'style.json'}, style.md, sheet.jpg")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as exc:
        sys.exit(str(exc))
